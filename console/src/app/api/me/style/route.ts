/* /api/me/style — my badge: colour (1-8), round or square, initials. A UI preference kept in the console's own shared state
   store, not Zoho (J15); only MY entry, by the session's own id.
   GET            → { c?, sq?, i? }            what I last chose (empty object = nothing chosen yet)
   PUT { c?, sq?, i? } → { c?, sq?, i? }       merged into my entry
   4xx/5xx → { error, code } — nothing changed: 400 invalid · 422 bad colour/initials · 503 store unavailable. */
import { guardApi } from "@/server/access/guard";
import { styleStore } from "@/server/me/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "invalid-colour": 422, "invalid-initials": 422, unavailable: 503 };

async function get() {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  return Response.json(await styleStore().get(s.credential.userId), { headers: NO_STORE });
}

async function put(req: Request) {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  let b: Record<string, unknown> | null = null;
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    const raw = await req.text().catch(() => "");
    if (raw.length <= 512) { try { const p: unknown = JSON.parse(raw); b = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { b = null; } }
  }
  if (!b) return Response.json({ error: "Nothing changed — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const r = await styleStore().set(s.credential.userId, { c: b.c, sq: b.sq, i: b.i });
  if (!r.ok) return Response.json({ error: `Nothing changed — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json(r.value, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/me", get), "/api/me/style");
export const PUT = withErrorCapture(guardApi("/api/me", put), "/api/me/style");
