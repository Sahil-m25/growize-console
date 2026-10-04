/* /api/availability — out of office / back on (D49, D44), filed in Plane C and read back by server/roster.
   GET    ?day=YYYY-MM-DD (default today, IST) → { day, out: [{ id, backOn }] }  ids and days only — no names, no reasons (rule 7)
   POST   { person?, from, to }  → out from `from`, back on `to` (the first day back); person omitted = yourself
   DELETE { person? }            → mark back in now / cancel a planned absence
   4xx → { error, code } — nothing changed. */
import { guardApi } from "@/server/access/guard";
import { scopesFor } from "@/server/data/scope";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import { availabilityRuntime, rosterRuntime } from "@/server/roster/runtime";
import { isoDay, istToday } from "@/server/roster/roster";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "not-yours-to-change": 403, "bad-dates": 422 };

/** A JSON object sent as application/json, or null (malformed, empty, oversized, other content type). */
async function body(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  const raw = await req.text().catch(() => "");
  if (raw.length > 2048) return null;
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { return null; }
}

async function get(req: Request) {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const q = new URL(req.url).searchParams.get("day");
  const day = q === null ? istToday(Date.now()) : isoDay(q);
  if (!day) return Response.json({ error: "Choose a real day (YYYY-MM-DD).", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  try {
    const v = await rosterRuntime().view(req.signal);
    return Response.json({ day, out: v.outOn(day) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "The roster could not be read. Try again.", code: "roster-unavailable" }, { status: 503, headers: NO_STORE });
  }
}

async function write(req: Request, clear: boolean) {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const kind = scopesFor(s.session.seat, s.credential.userId).leads.kind;
  const actor = { userId: s.credential.userId, seat: s.session.seat, mayChangeOthers: kind === "all" || kind === "subtree" };
  const b = await body(req);
  if (!b) return Response.json({ error: "Nothing changed — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const a = availabilityRuntime();
  const r = clear ? a.clear(actor, b) : a.set(actor, b);
  return r.ok ? Response.json(r.value, { headers: NO_STORE }) : Response.json({ error: `Nothing changed — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/availability", get), "/api/availability");
export const POST = withErrorCapture(guardApi("/api/availability", (req: Request) => write(req, false)), "/api/availability");
export const DELETE = withErrorCapture(guardApi("/api/availability", (req: Request) => write(req, true)), "/api/availability");
