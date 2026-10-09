import { getChatGPTUser } from "@/app/chatgpt-auth";
import { loadFleet, updateFleet } from "@/server/fleet-store";
import { FleetError } from "@/shared/contracts";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user)
      return Response.json(
        { error: "Entre com sua conta para acessar os dispositivos." },
        { status: 401 },
      );
    if (request.method === "GET")
      return Response.json(await loadFleet(), {
        headers: { "Cache-Control": "no-store" },
      });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 10000)
      throw new FleetError("Operação muito grande.", 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FleetError("JSON inválido.", 400);
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("revision" in body) ||
      !("action" in body) ||
      typeof body.revision !== "number" ||
      !Number.isInteger(body.revision) ||
      body.revision < 0
    )
      throw new FleetError("Revisão inválida.");
    return Response.json(
      await updateFleet(body.revision, body.action, user.displayName),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof FleetError)
      return Response.json({ error: e.message }, { status: e.status });
    console.error(
      "fleet storage boundary",
      e instanceof Error ? e.name : "unknown",
    );
    return Response.json(
      { error: "Não foi possível acessar a plataforma. Tente novamente." },
      { status: 503 },
    );
  }
}
export const GET = handler;
export const POST = handler;
