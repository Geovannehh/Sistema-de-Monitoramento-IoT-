import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  seedFleet,
  applyDemo,
  online,
  FleetError,
  actionSchema,
  type FleetAction,
} from "../../../shared/contracts";
import { parseMqtt, commandWire } from "./protocol";
const at = "2026-10-09T12:00:00.000Z",
  now = Date.parse(at),
  seed = () => seedFleet(new Date(at));
const action = (
  payload: Omit<Extract<FleetAction, { action: "command" }>, "requestId">,
) => ({ ...payload, requestId: randomUUID() });
test("online status uses report and last server contact, respecting the configured interval", () => {
  const d = seed().devices[0];
  assert.equal(online(d, now), true);
  assert.equal(online(d, now + 90001), false);
  d.config.sampleIntervalSec = 60;
  assert.equal(online(d, now + 90001), true);
  d.reportedOnline = false;
  assert.equal(online(d, now), false);
});
test("registration starts offline, keeps unique sensor keys and rejects duplicate IDs", () => {
  const a = {
    action: "register",
    requestId: randomUUID(),
    device: {
      id: "ESP32-004",
      name: "Teste",
      project: "Laboratório",
      firmware: "v1",
      model: "ESP32",
      sensors: ["temperature", "temperature"],
    },
  };
  const s = applyDemo(seed(), a, "Teste", at);
  assert.equal(s.devices.at(-1)?.lastSeen, null);
  assert.equal(s.devices.at(-1)?.sensors.length, 1);
  assert.throws(() => applyDemo(s, a, "Teste", at), /já está cadastrado/);
  assert.equal(
    actionSchema.safeParse({ ...a, device: { ...a.device, id: "ESP32/other" } })
      .success,
    false,
  );
});
test("configuration changes only after simulated acknowledgment", () => {
  const a = action({
    action: "command",
    deviceId: "ESP32-002",
    payload: { name: "UPDATE_CONFIG", params: { sampleIntervalSec: 60 } },
  });
  const queued = applyDemo(seed(), a, "Teste", at);
  assert.equal(queued.commands[0].status, "QUEUED");
  assert.equal(queued.devices[1].config.sampleIntervalSec, 10);
  const done = applyDemo(
    queued,
    { action: "simulate", requestId: randomUUID(), deviceId: "ESP32-002" },
    "Teste",
    new Date(now + 10000).toISOString(),
  );
  assert.equal(done.commands[0].status, "ACKNOWLEDGED");
  assert.equal(done.devices[1].config.sampleIntervalSec, 60);
  assert.equal(queued.devices[1].config.sampleIntervalSec, 10);
});
test("command idempotency prevents duplicate queue records", () => {
  const a = action({
    action: "command",
    deviceId: "ESP32-001",
    payload: { name: "RESTART", params: {} },
  });
  const s = applyDemo(seed(), a, "Teste", at);
  assert.equal(applyDemo(s, a, "Teste", at), s);
  assert.equal(s.commands.length, 1);
  assert.throws(
    () =>
      applyDemo(
        s,
        action({
          action: "command",
          deviceId: "ESP32-001",
          payload: { name: "RESTART", params: {} },
        }),
        "Teste",
        at,
      ),
    /pendente/,
  );
});
test("expired commands cannot update the device configuration", () => {
  const s = applyDemo(
    seed(),
    action({
      action: "command",
      deviceId: "ESP32-002",
      payload: { name: "UPDATE_CONFIG", params: { sampleIntervalSec: 60 } },
    }),
    "Teste",
    at,
  );
  const expired = applyDemo(
    s,
    { action: "simulate", requestId: randomUUID(), deviceId: "ESP32-002" },
    "Teste",
    new Date(now + 120001).toISOString(),
  );
  assert.equal(expired.commands[0].status, "EXPIRED");
  assert.equal(expired.devices[1].config.sampleIntervalSec, 10);
});
test("disabled sensors stop producing simulated telemetry and cannot refer to another sensor", () => {
  const s = applyDemo(
    seed(),
    action({
      action: "command",
      deviceId: "ESP32-002",
      payload: {
        name: "ENABLE_SENSOR",
        params: { sensor: "temperature", enabled: false },
      },
    }),
    "Teste",
    at,
  );
  const done = applyDemo(
    s,
    { action: "simulate", requestId: randomUUID(), deviceId: "ESP32-002" },
    "Teste",
    at,
  );
  assert.equal(done.telemetry.at(-1)?.metrics.temperature, undefined);
  assert.ok(done.telemetry.at(-1)?.metrics.humidity);
  assert.throws(
    () =>
      applyDemo(
        seed(),
        action({
          action: "command",
          deviceId: "ESP32-002",
          payload: {
            name: "ENABLE_SENSOR",
            params: { sensor: "rpm", enabled: true },
          },
        }),
        "Teste",
        at,
      ),
    /não está cadastrado/,
  );
});
test("command parameters are bounded and unknown commands are rejected", () => {
  for (const value of [0, 4, 3601, 1.1])
    assert.throws(
      () =>
        applyDemo(
          seed(),
          {
            ...action({
              action: "command",
              deviceId: "ESP32-002",
              payload: {
                name: "UPDATE_CONFIG",
                params: { sampleIntervalSec: value },
              },
            }),
          },
          "Teste",
          at,
        ),
      FleetError,
    );
  assert.throws(
    () =>
      applyDemo(
        seed(),
        {
          action: "command",
          requestId: randomUUID(),
          deviceId: "ESP32-001",
          payload: { name: "SHELL", params: {} },
        },
        "Teste",
        at,
      ),
    FleetError,
  );
});
test("MQTT telemetry parses valid namespaced payloads and refuses malformed or unexpected metrics", () => {
  const body = {
    messageId: randomUUID(),
    timestamp: at,
    metrics: { temperature: 26.4, humidity: 60 },
  };
  const topic = "fleet/v1/ESP32-002/telemetry";
  const parsed = parseMqtt(
    topic,
    Buffer.from(JSON.stringify(body)),
    false,
    now,
  );
  assert.equal(parsed?.deviceId, "ESP32-002");
  assert.equal(parsed?.kind, "telemetry");
  for (const invalid of [
    "fleet/v1/ESP32-002/commands",
    "fleet/v1/+/telemetry",
    "wrong/ESP32-002/telemetry",
  ])
    assert.throws(() =>
      parseMqtt(invalid, Buffer.from(JSON.stringify(body)), false, now),
    );
  assert.throws(() => parseMqtt(topic, Buffer.from("{bad"), false, now));
  assert.throws(() => parseMqtt(topic, Buffer.alloc(16385), false, now));
  assert.throws(() =>
    parseMqtt(
      topic,
      Buffer.from(JSON.stringify({ ...body, metrics: { humidity: 101 } })),
      false,
      now,
    ),
  );
  assert.throws(() =>
    parseMqtt(
      topic,
      Buffer.from(JSON.stringify({ ...body, metrics: { unknown: 1 } })),
      false,
      now,
    ),
  );
});
test("retained online and telemetry cannot make an old session appear live; LWT offline is accepted", () => {
  const status = { messageId: randomUUID(), online: true };
  assert.equal(
    parseMqtt(
      "fleet/v1/ESP32-001/status",
      Buffer.from(JSON.stringify(status)),
      true,
      now,
    ),
    null,
  );
  const offline = parseMqtt(
    "fleet/v1/ESP32-001/status",
    Buffer.from(JSON.stringify({ ...status, online: false })),
    true,
    now,
  );
  assert.equal(offline?.kind, "status");
  assert.equal(
    parseMqtt(
      "fleet/v1/ESP32-001/telemetry",
      Buffer.from(
        JSON.stringify({
          messageId: randomUUID(),
          timestamp: at,
          metrics: { power: 1000 },
        }),
      ),
      true,
      now,
    ),
    null,
  );
});
test("timestamps outside the allowed ingestion window are rejected", () => {
  for (const timestamp of [
    new Date(now + 300001).toISOString(),
    new Date(now - 86400001).toISOString(),
  ])
    assert.throws(
      () =>
        parseMqtt(
          "fleet/v1/ESP32-002/telemetry",
          Buffer.from(
            JSON.stringify({
              messageId: randomUUID(),
              timestamp,
              metrics: { temperature: 25 },
            }),
          ),
          false,
          now,
        ),
      /Timestamp/,
    );
});
test("wire command carries stable execution fields without internal status or actor", () => {
  const s = applyDemo(
    seed(),
    action({
      action: "command",
      deviceId: "ESP32-001",
      payload: { name: "RESTART", params: {} },
    }),
    "Teste",
    at,
  );
  assert.deepEqual(Object.keys(commandWire(s.commands[0])).sort(), [
    "commandId",
    "expiresAt",
    "name",
    "params",
  ]);
  assert.equal(commandWire(s.commands[0]).commandId, s.commands[0].id);
  assert.equal(Date.parse(commandWire(s.commands[0]).expiresAt) - now, 120000);
});
test("MQTT acknowledgments require UUIDs and explicit ok/error result", () => {
  const valid = {
    messageId: randomUUID(),
    commandId: randomUUID(),
    status: "ok",
    message: "Executado",
  };
  assert.equal(
    parseMqtt(
      "fleet/v1/ESP32-001/ack",
      Buffer.from(JSON.stringify(valid)),
      false,
      now,
    )?.kind,
    "ack",
  );
  assert.throws(() =>
    parseMqtt(
      "fleet/v1/ESP32-001/ack",
      Buffer.from(JSON.stringify({ ...valid, status: "received" })),
      false,
      now,
    ),
  );
});
