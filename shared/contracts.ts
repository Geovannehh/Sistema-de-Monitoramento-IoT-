import { z } from "zod";
export const sensorKeys = [
  "temperature",
  "humidity",
  "voltage",
  "current",
  "power",
  "speed",
  "rpm",
] as const;
export type SensorKey = (typeof sensorKeys)[number];
export const sensorCatalog: Record<
  SensorKey,
  { name: string; unit: string; color: string; base: number }
> = {
  temperature: {
    name: "Temperatura",
    unit: "°C",
    color: "#3d9aff",
    base: 26.4,
  },
  humidity: { name: "Umidade", unit: "%", color: "#26cba1", base: 61 },
  voltage: { name: "Tensão", unit: "V", color: "#8090ff", base: 220.4 },
  current: { name: "Corrente", unit: "A", color: "#f4b34d", base: 4.7 },
  power: { name: "Potência", unit: "W", color: "#4b9bff", base: 1040 },
  speed: { name: "Velocidade", unit: "km/h", color: "#32c9a5", base: 32 },
  rpm: { name: "Rotação", unit: "rpm", color: "#f3b14b", base: 3450 },
};
export type Device = {
  id: string;
  name: string;
  project: string;
  firmware: string;
  model: string;
  createdAt: string;
  lastSeen: string | null;
  reportedOnline: boolean;
  sensors: { key: SensorKey; enabled: boolean }[];
  config: { sampleIntervalSec: number };
};
export type Telemetry = {
  id: string;
  deviceId: string;
  recordedAt: string;
  metrics: Partial<Record<SensorKey, number>>;
};
export type DeviceLog = {
  id: string;
  deviceId: string;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  createdAt: string;
};
export const commandPayload = z.discriminatedUnion("name", [
  z
    .object({ name: z.literal("RESTART"), params: z.object({}).strict() })
    .strict(),
  z
    .object({
      name: z.literal("UPDATE_CONFIG"),
      params: z
        .object({ sampleIntervalSec: z.number().int().min(5).max(3600) })
        .strict(),
    })
    .strict(),
  z
    .object({
      name: z.literal("ENABLE_SENSOR"),
      params: z
        .object({ sensor: z.enum(sensorKeys), enabled: z.boolean() })
        .strict(),
    })
    .strict(),
]);
export type CommandPayload = z.infer<typeof commandPayload>;
export type DeviceCommand = {
  id: string;
  deviceId: string;
  name: CommandPayload["name"];
  params: Record<string, unknown>;
  status: "QUEUED" | "SENT" | "ACKNOWLEDGED" | "FAILED" | "EXPIRED";
  createdAt: string;
  expiresAt: string;
  sentAt: string | null;
  completedAt: string | null;
  message: string | null;
  operator: string;
};
export type Fleet = {
  devices: Device[];
  telemetry: Telemetry[];
  logs: DeviceLog[];
  commands: DeviceCommand[];
  mode: "demo" | "mqtt";
  broker: { connected: boolean; name: string };
  revision: number;
};
export const deviceIdSchema = z.string().regex(/^[A-Z0-9][A-Z0-9_-]{3,47}$/);
export const registrationSchema = z
  .object({
    id: deviceIdSchema,
    name: z.string().trim().min(2).max(80),
    project: z.string().trim().min(2).max(80),
    firmware: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(40),
    sensors: z.array(z.enum(sensorKeys)).min(1).max(7),
  })
  .strict();
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("register"),
      requestId: z.string().uuid(),
      device: registrationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("command"),
      requestId: z.string().uuid(),
      deviceId: deviceIdSchema,
      payload: commandPayload,
    })
    .strict(),
  z
    .object({
      action: z.literal("simulate"),
      requestId: z.string().uuid(),
      deviceId: deviceIdSchema,
    })
    .strict(),
]);
export type FleetAction = z.infer<typeof actionSchema>;
export const telemetrySchema = z
  .object({
    messageId: z.string().uuid(),
    timestamp: z.string().datetime(),
    metrics: z
      .object({
        temperature: z.number().finite().min(-100).max(1000).optional(),
        humidity: z.number().finite().min(0).max(100).optional(),
        voltage: z.number().finite().min(0).max(2000).optional(),
        current: z.number().finite().min(0).max(10000).optional(),
        power: z.number().finite().min(0).max(10000000).optional(),
        speed: z.number().finite().min(0).max(500).optional(),
        rpm: z.number().finite().min(0).max(100000).optional(),
      })
      .strict()
      .refine((x) => Object.keys(x).length > 0),
  })
  .strict();
export const statusSchema = z
  .object({
    messageId: z.string().uuid(),
    online: z.boolean(),
    firmware: z.string().max(40).optional(),
  })
  .strict();
export const logSchema = z
  .object({
    messageId: z.string().uuid(),
    level: z.enum(["INFO", "WARN", "ERROR"]),
    message: z.string().min(1).max(500),
  })
  .strict();
export const ackSchema = z
  .object({
    messageId: z.string().uuid(),
    commandId: z.string().uuid(),
    status: z.enum(["ok", "error"]),
    message: z.string().max(500).optional(),
  })
  .strict();
export class FleetError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function online(device: Device, now = Date.now()) {
  return (
    device.reportedOnline &&
    !!device.lastSeen &&
    now - Date.parse(device.lastSeen) <
      Math.max(90000, device.config.sampleIntervalSec * 3000)
  );
}
export function validateCommand(device: Device, payload: CommandPayload) {
  if (
    payload.name === "ENABLE_SENSOR" &&
    !device.sensors.some((s) => s.key === payload.params.sensor)
  )
    throw new FleetError("Este sensor não está cadastrado no dispositivo.");
}
export function applyConfirmedConfig(device: Device, command: DeviceCommand) {
  if (command.name === "UPDATE_CONFIG")
    device.config.sampleIntervalSec = Number(command.params.sampleIntervalSec);
  if (command.name === "ENABLE_SENSOR") {
    const sensor = device.sensors.find((s) => s.key === command.params.sensor);
    if (sensor) sensor.enabled = Boolean(command.params.enabled);
  }
}
export function createDevice(
  input: z.infer<typeof registrationSchema>,
  now: string,
): Device {
  return {
    ...input,
    sensors: [...new Set(input.sensors)].map((key) => ({ key, enabled: true })),
    createdAt: now,
    lastSeen: null,
    reportedOnline: false,
    config: { sampleIntervalSec: 10 },
  };
}
export function createCommand(
  action: Extract<FleetAction, { action: "command" }>,
  operator: string,
  now: string,
): DeviceCommand {
  return {
    id: action.requestId,
    deviceId: action.deviceId,
    ...action.payload,
    status: "QUEUED",
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 120000).toISOString(),
    sentAt: null,
    completedAt: null,
    message: null,
    operator,
  };
}
export function seedFleet(now = new Date()): Fleet {
  const at = now.toISOString();
  const devices: Device[] = [
    {
      ...createDevice(
        {
          id: "ESP32-001",
          name: "Energy Monitor",
          project: "EnergyLab",
          firmware: "v1.4.2",
          model: "ESP32-WROOM",
          sensors: ["voltage", "current", "power"],
        },
        at,
      ),
      reportedOnline: true,
      lastSeen: at,
    },
    {
      ...createDevice(
        {
          id: "ESP32-002",
          name: "Temperature Sensor",
          project: "BoxTwin",
          firmware: "v2.1.0",
          model: "ESP32 + DHT22",
          sensors: ["temperature", "humidity"],
        },
        at,
      ),
      reportedOnline: true,
      lastSeen: at,
    },
    {
      ...createDevice(
        {
          id: "ESP32-003",
          name: "Baja Telemetry",
          project: "Baja / Telemetria",
          firmware: "v0.9.3",
          model: "ESP32-C3",
          sensors: ["speed", "rpm", "temperature"],
        },
        at,
      ),
      reportedOnline: false,
      lastSeen: new Date(now.getTime() - 19 * 60000).toISOString(),
    },
  ];
  const telemetry: Telemetry[] = [];
  for (const d of devices)
    for (let i = 29; i >= 0; i--) {
      const t =
        now.getTime() - (d.reportedOnline ? i * 10000 : 19 * 60000 + i * 10000);
      const metrics: Telemetry["metrics"] = {};
      for (const s of d.sensors) {
        const base = sensorCatalog[s.key].base;
        metrics[s.key] = Number(
          (
            base +
            Math.sin(i * 0.4) * base * 0.035 +
            Math.cos(i * 0.7) * base * 0.012
          ).toFixed(2),
        );
      }
      telemetry.push({
        id: d.id + "-sample-" + i,
        deviceId: d.id,
        recordedAt: new Date(t).toISOString(),
        metrics,
      });
    }
  return {
    devices,
    telemetry,
    commands: [],
    logs: devices.map((d, i) => ({
      id: "seed-log-" + i,
      deviceId: d.id,
      level: d.reportedOnline ? "INFO" : "WARN",
      message: d.reportedOnline
        ? "Sessão de demonstração iniciada; sensores disponíveis."
        : "Dispositivo sem contato. Última sessão encerrada.",
      createdAt: d.lastSeen!,
    })),
    mode: "demo",
    broker: { connected: false, name: "Simulador de demonstração" },
    revision: 0,
  };
}
export function applyDemo(
  fleet: Fleet,
  raw: unknown,
  operator: string,
  now = new Date().toISOString(),
): Fleet {
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) throw new FleetError("Confira os dados da operação.");
  const action = parsed.data;
  const next = structuredClone(fleet);
  if (action.action === "register") {
    if (next.devices.some((d) => d.id === action.device.id))
      throw new FleetError("Este identificador já está cadastrado.", 409);
    if (next.devices.length >= 50)
      throw new FleetError(
        "Limite de 50 dispositivos da demonstração atingido.",
      );
    next.devices.push(createDevice(action.device, now));
    next.logs.push({
      id: action.requestId,
      deviceId: action.device.id,
      level: "INFO",
      message: "Dispositivo cadastrado. Aguardando primeiro contato.",
      createdAt: now,
    });
  } else {
    const device = next.devices.find((d) => d.id === action.deviceId);
    if (!device) throw new FleetError("Dispositivo não encontrado.", 404);
    if (action.action === "command") {
      if (next.commands.some((c) => c.id === action.requestId)) return fleet;
      validateCommand(device, action.payload);
      if (
        next.commands.some(
          (c) =>
            c.deviceId === device.id &&
            ["QUEUED", "SENT"].includes(c.status) &&
            c.expiresAt > now,
        )
      )
        throw new FleetError("Aguarde a conclusão do comando pendente.", 409);
      next.commands.push(createCommand(action, operator, now));
      next.logs.push({
        id: action.requestId + "-log",
        deviceId: device.id,
        level: "INFO",
        message:
          action.payload.name +
          " enfileirado; aguardando confirmação do dispositivo.",
        createdAt: now,
      });
    }
    if (action.action === "simulate") {
      device.lastSeen = now;
      device.reportedOnline = true;
      for (const command of next.commands.filter(
        (c) =>
          c.deviceId === device.id && ["QUEUED", "SENT"].includes(c.status),
      )) {
        command.completedAt = now;
        if (command.expiresAt <= now) {
          command.status = "EXPIRED";
          command.message = "Prazo de 120 segundos encerrado.";
        } else {
          command.status = "ACKNOWLEDGED";
          command.sentAt = now;
          command.message = "Execução confirmada pelo dispositivo simulado.";
          applyConfirmedConfig(device, command);
        }
        next.logs.push({
          id: action.requestId + "-" + command.id,
          deviceId: device.id,
          level: command.status === "EXPIRED" ? "WARN" : "INFO",
          message: command.name + ": " + command.message,
          createdAt: now,
        });
      }
      const metrics: Telemetry["metrics"] = {};
      for (const sensor of device.sensors.filter((s) => s.enabled)) {
        const base = sensorCatalog[sensor.key].base;
        metrics[sensor.key] = Number(
          (base + Math.sin(Date.parse(now) / 8500) * base * 0.035).toFixed(2),
        );
      }
      if (Object.keys(metrics).length)
        next.telemetry.push({
          id: action.requestId,
          deviceId: device.id,
          recordedAt: now,
          metrics,
        });
      next.logs.push({
        id: action.requestId + "-sample",
        deviceId: device.id,
        level: "INFO",
        message: "Telemetria recebida do simulador.",
        createdAt: now,
      });
    }
  }
  for (const c of next.commands)
    if (["QUEUED", "SENT"].includes(c.status) && c.expiresAt <= now) {
      c.status = "EXPIRED";
      c.completedAt = now;
      c.message = "Prazo de 120 segundos encerrado.";
    }
  next.telemetry = next.telemetry.slice(-600);
  next.logs = next.logs.slice(-250);
  next.commands = next.commands.slice(-150);
  next.revision++;
  return next;
}
