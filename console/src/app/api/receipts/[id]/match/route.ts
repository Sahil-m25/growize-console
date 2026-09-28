/* POST /api/receipts/[id]/match — "Match it": the second hand (M10-S02-T02, D21/D22).
   Body: { expectedModifiedTime? } (the row's Modified_Time as the page loaded it). Head of Finance or super user only;
   never the person who recorded it (refused here, and again by Zoho's validation rule).
   200 → { match: { receiptId, state: "matched", duplicate, matchedBy, matchedAt, kind, amountRupees, link, gate,
           paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, hold } }
   403 not the matcher / same hand · 409 not pending / changed / paper not verified · 503 Zoho not answering.
   Server: server/money/match.ts. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, receiptsConfigured } from "../../compose";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  if (!receiptsConfigured()) return Response.json({ error: "Not matched — receipts are matched in Zoho once it is connected.", code: "not-configured", saved: false }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  let body: unknown = null;
  try { body = JSON.parse((await req.text()).slice(0, 1024)); } catch { body = null; }
  const { receiptMatch, moneyFailure } = await import("@/server/money/runtime");
  const r = await (await receiptMatch()).match({ credential: s.credential, sessionId: sid }, (await params).id, body, req.signal);
  if (r.ok) return Response.json({ match: r.value }, { headers: NO_STORE });
  return moneyFailure(r, NO_STORE);
}

export const POST = withErrorCapture(guardApi("/api/receipts/[id]/match", post_), "/api/receipts/[id]/match");
