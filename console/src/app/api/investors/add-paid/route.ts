/* POST /api/investors/add-paid — Add investor (M09-S09-T02): an investor who already paid, from the Investors page.
   Body: { name, email, mobile, llpId, units, amountPaid, investmentDate }. Optional header Idempotency-Key.
   Writes one Contact (App_Access = Hold — sign-in locked until Finance releases it with Send welcome and unlock; no email), one allotment
   (free units checked by server/farms/oversell first) and one Pending receipt on the signed-in person's own token
   (server/investors/add-paid). Finance and the super user only; everyone else 403.
   200 → { investor: { contactId, code, allotmentId, allocationStatus, receiptId, app, replayed } }
   409 → { error, code: "duplicate-email", existing: { contactId, code, name } } — the in-page link
   4xx/5xx → { error: "Not saved yet — …", code } — nothing was kept (kind "incomplete": 500, ids for the operator). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;
const STATUS: Record<string, number> = { "not-finance": 403, "duplicate-email": 409, "invalid-request": 400, "idempotency-key-invalid": 400, "in-progress": 429 };

async function post_(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Not saved yet — the form is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const { createAddPaid } = await import("@/server/investors/add-paid");
  const { createAllotmentReceiptWrites } = await import("@/server/money/allotment-receipts");
  const { createOversellGuard } = await import("@/server/farms/oversell");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const { rt, crm, principal } = c.ctx;
  const recordIdPrefix = process.env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const receipts = createAllotmentReceiptWrites({
    crm, log: rt.log, recordIdPrefix,
    // guarded() is the only entry used here; the M01-S08 replay path is not.
    replay: { async replay() { return { ok: false, kind: "source-error", source: "zoho", errorKind: "refused", retryable: false } as const; } },
  });
  const service = createAddPaid({
    crm, receipts, log: rt.log, recordIdPrefix, oversell: createOversellGuard({ crm, events: rt.events }),
    authority: {
      // Re-derived from the live session: the Investors-side "pay" capability (Finance, Head of Finance, super user).
      async mayAdd(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && seatAccess(seat, now.session.who, {}).imCan("pay");
      },
    },
  });
  const r = await service.add({ credential: principal.credential, sessionId: principal.sessionId }, body, req.headers.get("Idempotency-Key"), req.signal);
  if (r.ok) return Response.json({ investor: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") {
    return Response.json({ error: r.message, code: r.reasonCode, ...(r.existing ? { existing: r.existing } : {}) },
      { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  }
  if (r.kind === "incomplete") return Response.json({ error: r.message, code: "incomplete", step: r.step, left: r.left }, { status: 500, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind, step: r.step }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/investors/add-paid", post_), "/api/investors/add-paid");
