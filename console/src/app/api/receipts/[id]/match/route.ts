/* POST /api/receipts/[id]/match — "Match it" (M10-S02-T02, D21/D22, D113 ruling 1).
   Body: { expectedModifiedTime? } (the row's Modified_Time as the page loaded it). For a pending receipt (paper verified
   since, a legacy or added-as-paid row, one the statement shows): any Finance seat, the recorder included (D113). A
   refund keeps D22's second hand: the Head of Finance or an administrator, never the person who recorded it.
   200 → { match: { receiptId, state: "matched", duplicate, matchedBy, matchedAt, kind, amountRupees, link, gate,
           paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, hold } }
   A refund is money leaving: after the approver and same-hand checks it needs a live step-up "refund" on this session
   (D22, M01-S10-NOTE-6) — 403 { code: "step-up", start } / 423 { code: "locked" } until then, and nothing is written.
   403 not the matcher / not the approver / same hand (refund) · 409 not pending / changed / paper not verified · 503 Zoho not answering.
   Server: server/money/match.ts. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, receiptsConfigured, RECEIPTS_OFF } from "../../compose";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  if (!receiptsConfigured()) return Response.json({ error: "Not matched — " + RECEIPTS_OFF, code: "not-configured", saved: false }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 1024)); } catch { body = null; }
  const { receiptMatch, moneyFailure } = await import("@/server/money/runtime");
  const r = await (await receiptMatch()).match({ credential: s.credential, sessionId: sid }, (await params).id, body, req.signal);
  if (r.ok) return Response.json({ match: r.value }, { headers: NO_STORE });
  /* a refund (money leaving) needs a live step-up "refund" (D22): say where to start it, as requireStepUp does */
  if (r.kind === "refused" && (r.reasonCode === "step-up" || r.reasonCode === "step-up-locked")) {
    return Response.json({ error: r.message, code: r.reasonCode === "step-up" ? "step-up" : "locked", saved: false, retry: false, start: "/api/auth/step-up?action=refund" },
      { status: r.reasonCode === "step-up" ? 403 : 423, headers: NO_STORE });
  }
  return moneyFailure(r, NO_STORE);
}

export const POST = withErrorCapture(guardApi("/api/receipts/[id]/match", post_), "/api/receipts/[id]/match");
