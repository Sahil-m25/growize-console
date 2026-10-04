/* POST /api/receipts — Finance records a receipt through commit() (M08-S03-T04).
   Header Idempotency-Key (required, one per press). Body: { allotmentId, kind: advance|balance|full, mode, ref,
   receivedOn? (YYYY-MM-DD, default today IST), amount? (whole rupees; balance/full default to what is due),
   prepared? { preparedAt, contextToken, expected } (from /api/receipts/prepare), queuedAt? }.
   Writes ONE Receipts record with the allotment lookup, on the person's own token (recorded_by = the token user), and —
   D113: a Finance seat's record is Finance's approval — matches it at once when the paper is verified (Match_State
   Matched, Matched_By = the recorder; the gate, money.confirmed and the app account follow, server/money/match.ts).
   Never refused for unsigned paper (D21): it stays Pending ("unmatched") and the answer carries the note.
   200 → { receipt: { receiptId, duplicate, state: "matched" | "unmatched", matchedBy, matchedAt, match, kind, mode,
           amountRupees, ref, receivedOn, recordedBy, link: { allotmentId, investorId, farmId }, matchable, matchNote, paymentStatus } }
   4xx/5xx → { error: "Not saved yet — …" | "Read only — …", code, saved: false, retry } */
import { sessionCredential } from "@/server/oauth/request";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cookies } from "next/headers";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, failureResponse, receiptsConfigured, recordReceipt } from "./compose";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;

async function post_(req: Request) {
  if (!receiptsConfigured()) return Response.json({ error: "Not saved yet — receipts are recorded in Zoho once it is connected.", code: "not-configured", saved: false }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Not saved yet — the form is too long.", code: "invalid-request", saved: false }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const r = await (await recordReceipt()).commit({ credential: s.credential, sessionId: sid }, body, req.headers.get("Idempotency-Key"), req.signal);
  if (r.ok) return Response.json({ receipt: r.value }, { headers: NO_STORE });
  return failureResponse(r);
}

export const POST = withErrorCapture(guardApi("/api/receipts", post_), "/api/receipts");
