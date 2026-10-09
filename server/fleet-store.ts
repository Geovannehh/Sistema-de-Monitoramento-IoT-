import { env } from "cloudflare:workers";
import {
  seedFleet,
  applyDemo,
  FleetError,
  type Fleet,
} from "@/shared/contracts";
function db() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding)
    throw new FleetError("Não foi possível acessar os dispositivos.", 503);
  return binding;
}
export async function loadFleet() {
  let row = await db()
    .prepare("SELECT revision,payload FROM fleet_demo WHERE id = ?")
    .bind("main")
    .first<{ revision: number; payload: string }>();
  if (!row) {
    await db()
      .prepare(
        "INSERT OR IGNORE INTO fleet_demo (id,revision,payload) VALUES (?,?,?)",
      )
      .bind("main", 0, JSON.stringify(seedFleet()))
      .run();
    row = await db()
      .prepare("SELECT revision,payload FROM fleet_demo WHERE id = ?")
      .bind("main")
      .first<{ revision: number; payload: string }>();
  }
  if (!row) throw new FleetError("Base indisponível.", 503);
  return { ...(JSON.parse(row.payload) as Fleet), revision: row.revision };
}
export async function updateFleet(
  version: number,
  action: unknown,
  operator: string,
) {
  const current = await loadFleet();
  if (current.revision !== version)
    throw new FleetError(
      "Os dados mudaram em outra sessão. Atualize e tente novamente.",
      409,
    );
  const next = applyDemo(current, action, operator);
  if (next === current) return current;
  const result = await db()
    .prepare(
      "UPDATE fleet_demo SET payload = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
    )
    .bind(JSON.stringify(next), "main", version)
    .run();
  if (result.meta.changes !== 1)
    throw new FleetError(
      "Outro registro foi salvo agora. Atualize e tente novamente.",
      409,
    );
  return next;
}
