import {
  deviceIdSchema,
  telemetrySchema,
  statusSchema,
  logSchema,
  ackSchema,
  FleetError,
  type DeviceCommand,
} from "../../../shared/contracts";
export function parseMqtt(
  topic: string,
  payload: Buffer,
  retained = false,
  now = Date.now(),
) {
  if (payload.length > 16384)
    throw new FleetError("Mensagem MQTT acima de 16 KiB.");
  const match =
    /^fleet\/v1\/([A-Z0-9][A-Z0-9_-]{3,47})\/(telemetry|status|logs|ack)$/.exec(
      topic,
    );
  if (!match) throw new FleetError("Tópico inválido.");
  const deviceId = match[1];
  deviceIdSchema.parse(deviceId);
  let raw: unknown;
  try {
    raw = JSON.parse(payload.toString("utf8"));
  } catch {
    throw new FleetError("JSON MQTT inválido.");
  }
  const kind = match[2];
  if (kind === "telemetry") {
    const value = telemetrySchema.parse(raw);
    const delta = Date.parse(value.timestamp) - now;
    if (delta > 300000 || delta < -86400000)
      throw new FleetError("Timestamp fora da janela de 24 h / 5 min.");
    if (retained) return null;
    return { kind: "telemetry" as const, deviceId, value };
  }
  if (kind === "status") {
    const value = statusSchema.parse(raw);
    if (retained && value.online) return null;
    return { kind: "status" as const, deviceId, value };
  }
  if (retained) return null;
  if (kind === "logs")
    return { kind: "logs" as const, deviceId, value: logSchema.parse(raw) };
  return { kind: "ack" as const, deviceId, value: ackSchema.parse(raw) };
}
export function commandWire(command: DeviceCommand) {
  return {
    commandId: command.id,
    name: command.name,
    params: command.params,
    expiresAt: command.expiresAt,
  };
}
