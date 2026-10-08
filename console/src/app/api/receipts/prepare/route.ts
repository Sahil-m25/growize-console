/* POST /api/receipts/prepare — seal the live allotment context for the Record-a-receipt drawer (M08-S03-T04).
   Body: { allotmentId }. Finance seats only; any other seat gets 403 "Read only — Finance Operations and the Head
   of Finance record money." (the section's read-only line).
   200 → { prepared: { preparedAt, contextToken, expected, amountDueRupees, matchable, matchNote } } — pass
   `prepared` back unchanged with POST /api/receipts (an offline press replays it within five minutes). */
import { sessionCredential } from "@/server/oauth/request";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cookies } from "next/headers";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, failureResponse, receiptsConfigured, RECEIPTS_OFF, recordReceipt } from "../compose";

export const dynamic = "force-dynamic";

async function post_(req: Request) {
  if (!receiptsConfigured()) return Response.json({ error: "Not ready — " + RECEIPTS_OFF, code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  let body: { allotmentId?: unknown } | null = null;
  try { body = JSON.parse((await req.text()).slice(0, 1024)); } catch { body = null; }
  const r = await (await recordReceipt()).prepare({ credential: s.credential, sessionId: sid }, body?.allotmentId, req.signal);
  if (r.ok) return Response.json({ prepared: r.value }, { headers: NO_STORE });
  return failureResponse(r);
}

export const POST = withErrorCapture(guardApi("/api/receipts", post_), "/api/receipts/prepare");
