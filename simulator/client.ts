import mqtt from "mqtt";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { z } from "zod";
import {
  deviceIdSchema,
  commandPayload,
  sensorCatalog,
  seedFleet,
  type Device,
  type CommandPayload,
} from "../shared/contracts";
const wireSchema = z
  .object({
    commandId: z.string().uuid(),
    name: z.string(),
    params: z.record(z.unknown()),
    expiresAt: z.string().datetime(),
  })
  .strict();
await mkdir(".state", { recursive: true });
const definitions = seedFleet().devices;
if (process.env.DEVICE_ID) {
  deviceIdSchema.parse(process.env.DEVICE_ID);
  definitions.splice(0, definitions.length, {
    ...definitions[1],
    id: process.env.DEVICE_ID,
    name: "Dispositivo personalizado",
  });
}
for (const definition of definitions) {
  const password = process.env.DEVICE_ID
    ? process.env.DEVICE_PASSWORD
    : process.env["MQTT_DEVICE_" + definition.id.slice(-3) + "_PASSWORD"];
  if (!password) throw new Error("Configure a senha de " + definition.id);
  const file = ".state/" + definition.id + ".json";
  let state: {
    device: Device;
    acks: Record<
      string,
      {
        messageId: string;
        commandId: string;
        status: "ok" | "error";
        message: string;
      }
    >;
  } = { device: definition, acks: {} };
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch {
    /* First boot uses seed metadata, never seed telemetry. */
  }
  const persist = async () => {
    const entries = Object.entries(state.acks).slice(-1000);
    state.acks = Object.fromEntries(entries);
    await writeFile(file + ".tmp", JSON.stringify(state));
    await rename(file + ".tmp", file);
  };
  const topic = (kind: string) => "fleet/v1/" + definition.id + "/" + kind;
  const client = mqtt.connect(process.env.MQTT_URL || "mqtt://localhost:1883", {
    clientId: "sim-" + definition.id,
    username: definition.id,
    password,
    clean: false,
    reconnectPeriod: 2000,
    will: {
      topic: topic("status"),
      payload: Buffer.from(
        JSON.stringify({ messageId: randomUUID(), online: false }),
      ),
      qos: 1,
      retain: true,
    },
  });
  const send = (kind: string, body: unknown, retain = false) =>
    client.publishAsync(topic(kind), JSON.stringify(body), { qos: 1, retain });
  const status = (value: boolean) =>
    send(
      "status",
      {
        messageId: randomUUID(),
        online: value,
        firmware: state.device.firmware,
      },
      true,
    );
  client.on("error", () =>
    console.error(definition.id + ": broker indisponível"),
  );
  client.on("connect", () => {
    void client
      .subscribeAsync(topic("commands"), { qos: 1 })
      .then(() => status(true))
      .catch(() => console.error(definition.id + ": falha ao iniciar sessão"));
  });
  let processing = Promise.resolve();
  client.on("message", (received, payload) => {
    if (received !== topic("commands")) return;
    processing = processing
      .then(async () => {
        if (payload.length > 16384) return;
        const raw = wireSchema.parse(JSON.parse(payload.toString()));
        const command = commandPayload.parse({
          name: raw.name,
          params: raw.params,
        });
        if (state.acks[raw.commandId]) {
          await send("ack", state.acks[raw.commandId]);
          return;
        }
        if (Date.parse(raw.expiresAt) <= Date.now()) {
          const ack = {
            messageId: randomUUID(),
            commandId: raw.commandId,
            status: "error" as const,
            message: "Comando expirado no dispositivo.",
          };
          state.acks[raw.commandId] = ack;
          await persist();
          await send("ack", ack);
          return;
        }
        if (command.name === "UPDATE_CONFIG")
          state.device.config.sampleIntervalSec =
            command.params.sampleIntervalSec;
        if (command.name === "ENABLE_SENSOR") {
          const sensor = state.device.sensors.find(
            (s) => s.key === command.params.sensor,
          );
          if (!sensor) {
            const ack = {
              messageId: randomUUID(),
              commandId: raw.commandId,
              status: "error" as const,
              message: "Sensor não disponível.",
            };
            state.acks[raw.commandId] = ack;
            await persist();
            await send("ack", ack);
            return;
          }
          sensor.enabled = command.params.enabled;
        }
        if (command.name === "RESTART") {
          await status(false);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await status(true);
        }
        const ack = {
          messageId: randomUUID(),
          commandId: raw.commandId,
          status: "ok" as const,
          message:
            command.name === "RESTART"
              ? "Reinicialização simulada concluída."
              : "Configuração aplicada no simulador.",
        };
        state.acks[raw.commandId] = ack;
        await persist();
        await send("ack", ack);
        await send("logs", {
          messageId: randomUUID(),
          level: "INFO",
          message: command.name + " confirmado.",
        });
      })
      .catch(() => console.error(definition.id + ": comando rejeitado"));
  });
  let last = 0;
  setInterval(() => {
    if (
      !client.connected ||
      Date.now() - last < state.device.config.sampleIntervalSec * 1000
    )
      return;
    last = Date.now();
    const metrics: Record<string, number> = {};
    for (const sensor of state.device.sensors.filter((s) => s.enabled)) {
      const base = sensorCatalog[sensor.key].base;
      metrics[sensor.key] = Number(
        (base + Math.sin(Date.now() / 7500) * base * 0.03).toFixed(2),
      );
    }
    if (Object.keys(metrics).length)
      void send("telemetry", {
        messageId: randomUUID(),
        timestamp: new Date().toISOString(),
        metrics,
      }).catch(() => {});
    else void status(true).catch(() => {});
  }, 1000);
  process.on("SIGTERM", () => {
    void status(false).finally(() => client.endAsync());
  });
  console.log(definition.id + " aguardando MQTT");
}
