/* POST /api/payouts/[id]/paid — Finance marks one payout paid (M10-S20-T02). Header Idempotency-Key (one per
   press). Body { paidOn? (YYYY-MM-DD, default today IST), mode: NEFT|RTGS|IMPS|UPI, utr, tds? (whole rupees,
   default 0), modifiedTime? (the schedule's Modified_Time) }. Sets Payout_State Paid, Paid_On, Payout_Mode,
   Payout_UTR, Paid_By (the token user), TDS_Amount and Net_Amount = Gross − TDS; a payout is paid once.
   200 → { payout: { payoutId, allotmentId, state, paidOn, mode, utrMasked, gross, tds, net, paidBy, modifiedTime, duplicate } }
   4xx/5xx → { error, code, saved: false, retry } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { markPaid, NO_STORE, writeFailure } from "@/server/payouts/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Not saved yet — the form is too long.", code: "invalid-request", saved: false }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> | null = null;
  try { const b = JSON.parse(raw); body = b && typeof b === "object" && !Array.isArray(b) ? b : null; } catch { body = null; }
  const r = await (await markPaid(c.ctx)).commit(c.ctx.principal.credential, body ? { ...body, payoutId: id } : null, req.headers.get("Idempotency-Key"), req.signal);
  if (r.ok) return Response.json({ payout: r.value }, { headers: NO_STORE });
  return writeFailure(r);
}

export const POST = withErrorCapture(guardApi("/api/payouts", post), "/api/payouts/[id]/paid");
