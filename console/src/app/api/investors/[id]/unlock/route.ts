/* /api/investors/[id]/unlock — the App account card (M10-S21-T02), on the signed-in person's own token.
   GET    → { card }                         what the card reads: state, text, welcome, history, mayChange
   POST   { expectedModifiedTime }           "Send welcome and unlock": App_Access Hold → Invite (the investor
                                             app sends the one welcome; nothing is mailed from here)
   DELETE { reason, expectedModifiedTime }   "Lock app access": App_Access Invite → Hold, reason as a Note
   POST   { expectedModifiedTime, override: { reason, confirmed: true } }
                                             GC-1526 "Unlock without the 10%": Finance Operations / Head of Finance only;
                                             the reason (10+ characters) is a Note on the Contact under their name
   200 → { card, already, noteSaved? }  ·  403 not Finance / not visible / not-override  ·  409 changed ("reload") /
   confirm-needed  ·  422 no account / reason required / ten-percent-not-verified (G2: no matched Advance or Full receipt) /
   override-reason-short  ·  502 note-failed  ·  503 ten-percent-unknown / Zoho not answering. Server: server/investors/unlock. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { AppAccessResult } from "@/server/investors/unlock";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = { "not-finance": 403, "not-visible": 403, changed: 409, "no-account": 422, "reason-required": 422, "invalid-request": 400,
  "ten-percent-not-verified": 422, "ten-percent-unknown": 503, "not-override": 403, "override-reason-short": 422, "confirm-needed": 409, "note-failed": 502 };
/** GC-1526: the seats that may unlock without a verified 10% — Finance Operations and the Head of Finance, nobody else. */
const OVERRIDE_SEATS: ReadonlySet<string> = new Set(["finance-operations", "head-of-finance"]);
type Ctx = { params: Promise<{ id: string }> };

async function service() {
  const c = await investorsContext();
  if (!c.ok) return c;
  const { createAppAccess } = await import("@/server/investors/unlock");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const { rt, crm, principal } = c.ctx;
  const app = createAppAccess({
    crm, log: rt.log, events: rt.events, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    authority: {
      // Finance controls app access (Head of Finance, Finance Operations, super user): the Investors-side "pay" capability.
      async mayChange(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && seatAccess(seat, now.session.who, {}).imCan("pay");
      },
      async mayOverride(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && OVERRIDE_SEATS.has(seat) && seatAccess(seat, now.session.who, {}).imCan("pay");
      },
    },
  });
  return { ok: true as const, app, who: { credential: principal.credential, sessionId: principal.sessionId, seat: principal.session.seat } };
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return {};
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}; } catch { return {}; }
}

function answer(r: AppAccessResult): Response {
  if (r.ok) return Response.json({ card: r.value, already: r.already, ...(r.noteSaved !== undefined ? { noteSaved: r.noteSaved } : {}) }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function get_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  return answer(await s.app.card(s.who, (await params).id, req.signal));
}
async function post_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const b = await bodyOf(req);
  if (b.override !== undefined && b.override !== null) {
    const o = typeof b.override === "object" && !Array.isArray(b.override) ? (b.override as Record<string, unknown>) : {};
    return answer(await s.app.overrideUnlock(s.who, (await params).id, o.reason, o.confirmed, b.expectedModifiedTime, req.signal));
  }
  return answer(await s.app.unlock(s.who, (await params).id, b.expectedModifiedTime, req.signal));
}
async function delete_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const b = await bodyOf(req);
  return answer(await s.app.lock(s.who, (await params).id, b.reason, b.expectedModifiedTime, req.signal));
}

export const GET = withErrorCapture(guardApi("/api/investors/[id]/unlock", get_), "/api/investors/[id]/unlock");
export const POST = withErrorCapture(guardApi("/api/investors/[id]/unlock", post_), "/api/investors/[id]/unlock");
export const DELETE = withErrorCapture(guardApi("/api/investors/[id]/unlock", delete_), "/api/investors/[id]/unlock");
