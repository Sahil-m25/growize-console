/* /api/availability — out of office / back on (D49, D44), filed in Plane C and read back by server/roster.
   GET    ?day=YYYY-MM-DD (default today, IST) → { day, out: [{ id, backOn }], windows: [{ id, from, to }] }
          ids and days only — no names, no reasons (rule 7). `windows` = every live or planned window (the roster drawer's "Away … · back …").
   POST   { person?, from, to }  → out from `from`, back on `to` (the first day back); person omitted = yourself
   DELETE { person? }            → mark back in now / cancel a planned absence. D44: a person who was OUT today and is marked back
          has their explicit lead covers ended (server/leads/cover.ts `returned`) → also { covers: { cleared, pending } }
          (pending = covers Zoho did not let us end, null = they could not be read; either way they still close on their own expiry). A planned absence cancelled before it began
          ends no cover (they never left).
          D123 Q3: a person who is out TODAY (from <= today) also has Cover_By = each open lead's secondary written (server/leads/cover.ts `absent`;
          Secondary_Owner sharing is off, so Cover_By is the only way a secondary reaches the lead in Zoho) → also { covers: { opened, pending } }.
          An absence that starts later opens nothing yet.
   4xx → { error, code } — nothing changed. */
import { guardApi } from "@/server/access/guard";
import { scopesFor } from "@/server/data/scope";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import { availabilityRuntime, rosterRuntime } from "@/server/roster/runtime";
import { isoDay, istToday } from "@/server/roster/roster";
import { leadsConfigured, leadsRuntime } from "@/server/leads/runtime";
import { cookies } from "next/headers";
import { SID_COOKIE } from "@/server/oauth/user-session";

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
    const windows = [...v.windows].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, w]) => ({ id, from: w.from, to: w.to }));
    return Response.json({ day, out: v.outOn(day), windows }, { headers: NO_STORE });
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
  /* D44: was the person out today? Read before the line is filed (a failed read: unknown → no cover is touched). */
  let wasOut = false;
  if (clear) {
    const person = b.person === undefined || b.person === null ? actor.userId : b.person;
    try { wasOut = typeof person === "string" && !!(await rosterRuntime().view(req.signal)).backOn(person, istToday(Date.now())); } catch { wasOut = false; }
  }
  const r = clear ? a.clear(actor, b) : a.set(actor, b);
  if (!r.ok) return Response.json({ error: `Nothing changed — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (!leadsConfigured()) return Response.json(r.value, { headers: NO_STORE });
  const p = { credential: s.credential, sessionId: (await cookies()).get(SID_COOKIE)?.value ?? "" };
  if (!clear) {
    if (!r.value.from || !r.value.to || r.value.from > istToday(Date.now())) return Response.json(r.value, { headers: NO_STORE });
    const out = await leadsRuntime().cover.absent(p, r.value.personId, r.value.to, req.signal);
    const covers = out.ok ? { opened: out.value.opened.length, pending: out.value.failed.length } : { opened: 0, pending: null };
    return Response.json({ ...r.value, covers }, { headers: NO_STORE });
  }
  if (!wasOut) return Response.json(r.value, { headers: NO_STORE });
  const back = await leadsRuntime().cover.returned(p, r.value.personId, req.signal);
  /* the person is back either way (the line is filed); a cover Zoho would not end is said, never hidden */
  const covers = back.ok ? { cleared: back.value.cleared.length, pending: back.value.failed.length } : { cleared: 0, pending: null };
  return Response.json({ ...r.value, covers }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/availability", get), "/api/availability");
export const POST = withErrorCapture(guardApi("/api/availability", (req: Request) => write(req, false)), "/api/availability");
export const DELETE = withErrorCapture(guardApi("/api/availability", (req: Request) => write(req, true)), "/api/availability");
