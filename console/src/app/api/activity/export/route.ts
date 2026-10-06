/* POST /api/activity/export { view: "log"|"person"|"day", rows: n } — the log line for an activity CSV export (J14).
   A server log line only: who, when, which view, how many rows; no values, no Zoho call. Send an Idempotency-Key and a
   repeated press writes nothing twice. 200 → { logged: true, replayed } · 400 invalid · 403 this seat has no Activity · 503. */
import { guardApi } from "@/server/access/guard";
import { exportAudit } from "@/server/me/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "no-activity": 403, unavailable: 503 };

async function post(req: Request) {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  let b: Record<string, unknown> | null = null;
  if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    const raw = await req.text().catch(() => "");
    if (raw.length <= 512) { try { const p: unknown = JSON.parse(raw); b = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { b = null; } }
  }
  if (!b) return Response.json({ error: "Nothing logged — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const r = await exportAudit().record({ userId: s.credential.userId, seat: s.session.seat }, { view: b.view, rows: b.rows }, req.headers.get("idempotency-key"));
  if (!r.ok) return Response.json({ error: `Nothing logged — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ logged: true, replayed: r.replayed }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/activity", post), "/api/activity/export");
