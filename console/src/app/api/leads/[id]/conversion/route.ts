/* /api/leads/[id]/conversion — GC-1527 / D137 ruling 1: the investor is created only after Finance confirms the 10%, on Finance's
   own token (server/investors/convert).
   GET  ?llp=<LLP id>&units=<n>     the lead's Money view: receipts recorded on the lead (Receipts.Lead) and, with a farm, the 10%
                                     trail (IST date-time, amount, masked reference, who matched it, running total). Finance and
                                     Digital Infrastructure (read-only) only.
   POST { receipt?: { kind, amount, mode, utr, receivedOn }, terms?: { llpId, units? } }
                                     Finance Operations / Head of Finance: record a receipt on the lead (matched — D113), and with
                                     terms, when the matched sum reaches 10% of units × unit price: create the Contact (Origin_Lead,
                                     App_Access Hold), the Reserved allotment (Hold_Until +30 days), link the lead's receipts to it.
                                     Resumable: a second press continues where the first stopped.
   200 → { money, recorded, converted }  ·  403 not Finance / lead not shared  ·  409 reference reused / duplicate email  ·
   422 { error, code, money? } (ten-percent-not-reached, receipt-invalid, terms-invalid, farm closed / units not free, lead lost,
   fields-missing)  ·  503 Zoho not answering. Logs carry ids and codes only; the full bank reference is never answered. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { ConvertResult } from "@/server/investors/convert";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = {
  "invalid-request": 400, "not-finance": 403, "lead-not-visible": 403, "reference-reused": 409, "duplicate-email": 409, "receipts-unread": 503,
};
/** Finance confirms money (rule 2: on their own token); Digital Infrastructure reads the trail. */
const CONFIRM_SEATS: ReadonlySet<string> = new Set(["finance-operations", "head-of-finance"]);
const READ_SEATS: ReadonlySet<string> = new Set(["finance-operations", "head-of-finance", "digital-infrastructure"]);
type Ctx = { params: Promise<{ id: string }> };

async function service() {
  const c = await investorsContext();
  if (!c.ok) return c;
  const { createConversion } = await import("@/server/investors/convert");
  const { createFullPaid } = await import("@/server/investors/full-paid");
  const { createOversellGuard } = await import("@/server/farms/oversell");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const { rt, crm, principal } = c.ctx;
  const recordIdPrefix = process.env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const seatIn = async (cred: { userId: string }, sid: string, seats: ReadonlySet<string>) => {
    const now = await userSessions().credential(sid);
    if (!now.ok || now.credential.userId !== cred.userId) return false;
    const seat = zohoSeatOf(now.session.seat);
    return !!seat && seats.has(seat) && seatAccess(seat, now.session.who, {}).imCan("pay");
  };
  const conversion = createConversion({
    crm, log: rt.log, events: rt.events, recordIdPrefix,
    oversell: createOversellGuard({ crm, events: rt.events }),
    fullPaid: createFullPaid({ crm, log: rt.log, events: rt.events, recordIdPrefix }),
    authority: { mayConfirm: (cred, sid) => seatIn(cred, sid, CONFIRM_SEATS), mayRead: (cred, sid) => seatIn(cred, sid, READ_SEATS) },
  });
  return { ok: true as const, conversion, who: { credential: principal.credential, sessionId: principal.sessionId, seat: principal.session.seat } };
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return {};
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}; } catch { return {}; }
}

function answer(r: ConvertResult): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode, ...(r.money ? { money: r.money } : {}) }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind, step: r.step }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function get_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const q = new URL(req.url).searchParams;
  const llp = q.get("llp"), units = q.get("units");
  const terms = llp ? { llpId: llp, ...(units && /^\d{1,5}$/.test(units) ? { units: Number(units) } : {}) } : null;
  return answer(await s.conversion.trail(s.who, (await params).id, terms, req.signal));
}
async function post_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  return answer(await s.conversion.confirm(s.who, (await params).id, await bodyOf(req), req.signal));
}

export const GET = withErrorCapture(guardApi("/api/leads/[id]/conversion", get_), "/api/leads/[id]/conversion");
export const POST = withErrorCapture(guardApi("/api/leads/[id]/conversion", post_), "/api/leads/[id]/conversion");
