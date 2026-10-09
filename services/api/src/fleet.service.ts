import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Pool } from "pg";
import { createClient } from "redis";
import mqtt, { type MqttClient } from "mqtt";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  actionSchema,
  createDevice,
  createCommand,
  seedFleet,
  validateCommand,
  applyConfirmedConfig,
  FleetError,
  type Device,
  type DeviceCommand,
  type Fleet,
  type Telemetry,
} from "../../../shared/contracts";
import { parseMqtt, commandWire } from "./protocol";
type CommandRow = {
  id: string;
  device_id: string;
  name: DeviceCommand["name"];
  params: Record<string, unknown>;
  status: DeviceCommand["status"];
  created_at: Date;
  expires_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
  message: string | null;
  operator: string;
};
function commandFrom(row: CommandRow): DeviceCommand {
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    params: row.params,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    sentAt: row.sent_at?.toISOString() || null,
    completedAt: row.completed_at?.toISOString() || null,
    message: row.message,
    operator: row.operator,
  };
}
@Injectable()
export class FleetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FleetService.name);
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    statement_timeout: 10000,
  });
  private readonly redis = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 10000 },
  });
  private mqtt!: MqttClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dispatching = false;
  async onModuleInit() {
    for (const key of [
      "DATABASE_URL",
      "REDIS_URL",
      "MQTT_URL",
      "MQTT_PASSWORD",
    ])
      if (!process.env[key]) throw new Error("Configure " + key);
    this.redis.on("error", () =>
      this.logger.warn("Redis indisponível; usando persistência PostgreSQL."),
    );
    await this.redis.connect();
    const sql = await readFile(resolve("migrations/001_initial.sql"), "utf8"),
      client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(714029)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const migrated = await client.query(
        "SELECT id FROM schema_migrations WHERE id=$1",
        ["001_initial"],
      );
      if (!migrated.rowCount) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(id) VALUES ($1)", [
          "001_initial",
        ]);
      }
      for (const device of seedFleet().devices) {
        device.lastSeen = null;
        device.reportedOnline = false;
        await client.query(
          "INSERT INTO devices(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [device.id, device],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    this.mqtt = mqtt.connect(process.env.MQTT_URL!, {
      clientId: "geolab-manager",
      username: process.env.MQTT_USERNAME || "manager",
      password: process.env.MQTT_PASSWORD,
      clean: false,
      reconnectPeriod: 2000,
      connectTimeout: 10000,
    });
    this.mqtt.on("error", () =>
      this.logger.warn(
        "Broker MQTT indisponível. Os comandos permanecem no PostgreSQL.",
      ),
    );
    this.mqtt.on("connect", () => {
      void this.mqtt
        .subscribeAsync(
          [
            "fleet/v1/+/telemetry",
            "fleet/v1/+/status",
            "fleet/v1/+/logs",
            "fleet/v1/+/ack",
          ],
          { qos: 1 },
        )
        .then(() => this.dispatch())
        .catch(() => this.logger.warn("Não foi possível assinar os tópicos."));
    });
    this.mqtt.on("message", (topic, payload, packet) => {
      void this.ingest(topic, payload, packet.retain).catch(() =>
        this.logger.warn("Mensagem rejeitada ou falha de persistência."),
      );
    });
    this.timer = setInterval(() => {
      void this.dispatch().catch(() =>
        this.logger.warn("Não foi possível processar a fila."),
      );
    }, 5000);
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.mqtt) await this.mqtt.endAsync();
    if (this.redis.isOpen) await this.redis.quit();
    await this.pool.end();
  }
  async health() {
    await this.pool.query("SELECT 1");
    return {
      postgres: true,
      redis: this.redis.isReady,
      mqtt: this.mqtt?.connected || false,
    };
  }
  async snapshot(): Promise<Fleet> {
    const [devices, telemetry, logs, commands] = await Promise.all([
      this.pool.query<{ data: Device }>("SELECT data FROM devices ORDER BY id"),
      this.pool.query(
        "SELECT recent.* FROM devices d CROSS JOIN LATERAL (SELECT t.* FROM telemetry t WHERE t.device_id=d.id ORDER BY t.recorded_at DESC LIMIT 60) AS recent ORDER BY recent.recorded_at",
      ),
      this.pool.query(
        "SELECT * FROM device_logs ORDER BY created_at DESC LIMIT 100",
      ),
      this.pool.query<CommandRow>(
        "SELECT * FROM commands ORDER BY created_at DESC LIMIT 100",
      ),
    ]);
    const samples: Telemetry[] = telemetry.rows.map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      recordedAt: row.recorded_at.toISOString(),
      metrics: row.metrics,
    }));
    if (this.redis.isReady && devices.rows.length) {
      try {
        const cached = await this.redis.mGet(
          devices.rows.map((d) => "latest:" + d.data.id),
        );
        for (const value of cached) {
          if (value) {
            const sample = JSON.parse(value) as Telemetry;
            if (
              !samples.some(
                (s) => s.id === sample.id && s.deviceId === sample.deviceId,
              )
            )
              samples.push(sample);
          }
        }
      } catch {
        /* PostgreSQL remains authoritative. */
      }
    }
    return {
      devices: devices.rows.map((r) => r.data),
      telemetry: samples.sort((a, b) =>
        a.recordedAt.localeCompare(b.recordedAt),
      ),
      logs: logs.rows.reverse().map((r) => ({
        id: r.id,
        deviceId: r.device_id,
        level: r.level,
        message: r.message,
        createdAt: r.created_at.toISOString(),
      })),
      commands: commands.rows.reverse().map(commandFrom),
      mode: "mqtt",
      broker: { connected: this.mqtt?.connected || false, name: "Mosquitto" },
      revision: 0,
    };
  }
  async action(raw: unknown) {
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) throw new FleetError("Confira os dados da operação.");
    const action = parsed.data;
    if (action.action === "simulate")
      throw new FleetError("Use o simulador MQTT da stack Docker.", 400);
    if (this.redis.isReady) {
      const window = Math.floor(Date.now() / 60000);
      const count = await this.redis.incr("http-writes:" + window);
      if (count === 1) await this.redis.expire("http-writes:" + window, 90);
      if (count > 60)
        throw new FleetError(
          "Limite de 60 operações por minuto atingido.",
          429,
        );
    }
    const client = await this.pool.connect(),
      now = new Date().toISOString();
    try {
      await client.query("BEGIN");
      if (action.action === "register") {
        const device = createDevice(action.device, now);
        const saved = await client.query(
          "INSERT INTO devices(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING id",
          [device.id, device],
        );
        if (!saved.rowCount)
          throw new FleetError("Este identificador já está cadastrado.", 409);
        await client.query(
          "INSERT INTO device_logs(id,device_id,level,message) VALUES($1,$2,$3,$4)",
          [
            action.requestId,
            device.id,
            "INFO",
            "Dispositivo cadastrado. Provisione a credencial MQTT no broker.",
          ],
        );
      } else {
        const result = await client.query<{ data: Device }>(
          "SELECT data FROM devices WHERE id=$1 FOR UPDATE",
          [action.deviceId],
        );
        if (!result.rowCount)
          throw new FleetError("Dispositivo não encontrado.", 404);
        validateCommand(result.rows[0].data, action.payload);
        const existing = await client.query(
          "SELECT id,device_id FROM commands WHERE id=$1",
          [action.requestId],
        );
        if (existing.rowCount) {
          if (existing.rows[0].device_id !== action.deviceId)
            throw new FleetError("ID do comando já utilizado.", 409);
        } else {
          const pending = await client.query(
            "SELECT id FROM commands WHERE device_id=$1 AND status IN ('QUEUED','SENT') AND expires_at>now()",
            [action.deviceId],
          );
          if (pending.rowCount)
            throw new FleetError(
              "Aguarde a conclusão do comando pendente.",
              409,
            );
          const command = createCommand(action, "Operação local", now);
          await client.query(
            "INSERT INTO commands(id,device_id,name,params,status,created_at,expires_at,operator) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              command.id,
              command.deviceId,
              command.name,
              command.params,
              command.status,
              command.createdAt,
              command.expiresAt,
              command.operator,
            ],
          );
          await client.query(
            "INSERT INTO device_logs(id,device_id,level,message) VALUES($1,$2,$3,$4)",
            [
              action.requestId + "-queue",
              action.deviceId,
              "INFO",
              action.payload.name + " enfileirado.",
            ],
          );
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    void this.dispatch().catch(() =>
      this.logger.warn("Fila será retomada no próximo ciclo."),
    );
    return this.snapshot();
  }
  private async ingest(topic: string, payload: Buffer, retained: boolean) {
    const event = parseMqtt(topic, payload, retained);
    if (!event) return;
    const client = await this.pool.connect();
    let cache: Telemetry | null = null;
    try {
      await client.query("BEGIN");
      const row = await client.query<{ data: Device }>(
        "SELECT data FROM devices WHERE id=$1 FOR UPDATE",
        [event.deviceId],
      );
      if (!row.rowCount) throw new FleetError("Dispositivo não cadastrado.");
      const device = row.rows[0].data,
        now = new Date().toISOString();
      if (event.kind === "telemetry") {
        const allowed = Object.keys(event.value.metrics).every((key) =>
          device.sensors.some((s) => s.key === key && s.enabled),
        );
        if (!allowed)
          throw new FleetError("Sensor não cadastrado ou desabilitado.");
        const inserted = await client.query(
          "INSERT INTO telemetry(id,device_id,recorded_at,metrics) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,id) DO NOTHING RETURNING id",
          [
            event.value.messageId,
            device.id,
            event.value.timestamp,
            event.value.metrics,
          ],
        );
        device.lastSeen = now;
        device.reportedOnline = true;
        if (inserted.rowCount)
          cache = {
            id: event.value.messageId,
            deviceId: device.id,
            recordedAt: event.value.timestamp,
            metrics: event.value.metrics,
          };
      }
      if (event.kind === "status") {
        device.reportedOnline = event.value.online;
        if (event.value.online) device.lastSeen = now;
        if (event.value.firmware) device.firmware = event.value.firmware;
        await client.query(
          "INSERT INTO device_logs(id,device_id,level,message) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,id) DO NOTHING",
          [
            event.value.messageId,
            device.id,
            event.value.online ? "INFO" : "WARN",
            event.value.online
              ? "Dispositivo conectado; firmware " + device.firmware
              : "Dispositivo desconectado (status/LWT).",
          ],
        );
      }
      if (event.kind === "logs")
        await client.query(
          "INSERT INTO device_logs(id,device_id,level,message) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,id) DO NOTHING",
          [
            event.value.messageId,
            device.id,
            event.value.level,
            event.value.message,
          ],
        );
      if (event.kind === "ack") {
        const result = await client.query<CommandRow>(
          "SELECT * FROM commands WHERE id=$1 AND device_id=$2 FOR UPDATE",
          [event.value.commandId, device.id],
        );
        if (result.rowCount) {
          const command = commandFrom(result.rows[0]);
          if (
            ["QUEUED", "SENT"].includes(command.status) &&
            command.expiresAt > now
          ) {
            const success = event.value.status === "ok";
            command.status = success ? "ACKNOWLEDGED" : "FAILED";
            if (success) applyConfirmedConfig(device, command);
            await client.query(
              "UPDATE commands SET status=$1,completed_at=$2,message=$3 WHERE id=$4",
              [
                command.status,
                now,
                event.value.message || "Resposta recebida do dispositivo.",
                command.id,
              ],
            );
            await client.query(
              "INSERT INTO device_logs(id,device_id,level,message) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,id) DO NOTHING",
              [
                event.value.messageId,
                device.id,
                success ? "INFO" : "ERROR",
                command.name +
                  ": " +
                  (event.value.message || event.value.status),
              ],
            );
          }
        }
      }
      await client.query("UPDATE devices SET data=$1 WHERE id=$2", [
        device,
        device.id,
      ]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    if (cache && this.redis.isReady) {
      try {
        await this.redis.set(
          "latest:" + cache.deviceId,
          JSON.stringify(cache),
          { EX: 120 },
        );
      } catch {
        /* Cache outage does not roll back persisted telemetry. */
      }
    }
  }
  private async dispatch() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      await this.pool.query(
        "UPDATE commands SET status='EXPIRED',completed_at=now(),message='Prazo de 120 segundos encerrado.' WHERE status IN ('QUEUED','SENT') AND expires_at<=now()",
      );
      if (!this.mqtt?.connected) return;
      const rows = await this.pool.query<CommandRow>(
        "SELECT * FROM commands WHERE status IN ('QUEUED','SENT') AND expires_at>now() AND (sent_at IS NULL OR sent_at<now()-interval '15 seconds') ORDER BY created_at LIMIT 50",
      );
      for (const row of rows.rows) {
        const command = commandFrom(row);
        try {
          await this.mqtt.publishAsync(
            "fleet/v1/" + command.deviceId + "/commands",
            JSON.stringify(commandWire(command)),
            { qos: 1, retain: false },
          );
          await this.pool.query(
            "UPDATE commands SET status='SENT',sent_at=now(),attempts=attempts+1 WHERE id=$1 AND status IN ('QUEUED','SENT') AND expires_at>now()",
            [command.id],
          );
        } catch {
          this.logger.warn(
            "Envio interrompido; o comando permanecerá na fila.",
          );
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}
