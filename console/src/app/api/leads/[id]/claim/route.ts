/* GET /api/leads/[id]/claim — the latest report on this lead and Finance's answer (M10-S03).
   200 → { claim: { leadId, claimId, state: "none"|"waiting"|"answered", answer: "found"|"not-found"|null, reason, says } }
   says is "Finance did not find it: <reason>" only for a not-found answer. Read on the person's own token.

   POST /api/leads/[id]/claim — "the investor says they paid" (M08-S03-T01).
   Body: { kind, mode, amount, said_on, ref?, note?, allotmentId? }
   Writes ONE Receipts record with Match_State "Claimed" (D82: there is no Payment_Claims module) against the
   investor's allotment, on the signed-in person's own token; the lead and its stage are not touched.
   200 → { claim: { leadId, claimId, allotmentId, state: "waiting", kind, mode, amountRupees, saidOn, ref (masked),
           says: "Payment reported — waiting for Finance to find it in the bank.", row: "Waiting on Finance", duplicate } }
   4xx → { error, code } — error is the in-page sentence (claimFieldsError's own words for the fields). */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { leadsConfigured, leadsRuntime } from "@/server/leads/runtime";
import type { PaymentClaims } from "@/server/leads/claim";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = {
  "invalid-request": 400, fields: 422, "whole-rupees": 422, "capability-missing": 403, "session-changed": 401, "not-visible": 404,
  "not-in-book": 403, "source-invalid": 502, lost: 409, "not-converted": 409, "already-paid": 409, "supplementary-not-verified": 409,
  "already-waiting": 409, "no-allotment": 409, "allotment-required": 422, "in-progress": 429,
};

const G = globalThis as typeof globalThis & { __gzPaymentClaims?: PaymentClaims };
async function claims(): Promise<PaymentClaims> {
  if (G.__gzPaymentClaims) return G.__gzPaymentClaims;
  const { createPaymentClaims } = await import("@/server/leads/claim");
  const { createZohoClient } = await import("@/lib/zoho/client");
  const { dataRuntime } = await import("@/server/data/zoho-source");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const rt = dataRuntime();
  const recordIdPrefix = process.env.ZOHO_CRM_RECORD_ID_PREFIX!;
  return (G.__gzPaymentClaims = createPaymentClaims({
    crm: createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix }),
    gates: leadsRuntime().gates,
    log: rt.log,
    recordIdPrefix,
    authority: {
      // Re-derived from the live session: the lead side's edit (claims.ts canReportPayment). PROVISIONAL: assign ⊂ edit.
      async mayReport(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && seatAccess(seat, now.session.who, {}).may("leads", "edit");
      },
    },
  }));
}

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!leadsConfigured()) return Response.json({ error: "Payment reports go to Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Keep the note within 1,000 characters.", code: "fields" }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const r = await (await claims()).report({ credential: s.credential, sessionId: sid }, id, body, req.signal);
  if (r.ok) return Response.json({ claim: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.kind === "unknown-outcome") return Response.json({ error: r.message, code: "unknown-outcome" }, { status: 503, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function get_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!leadsConfigured()) return Response.json({ error: "Payment reports are read from Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await (await claims()).read({ credential: s.credential, sessionId: sid }, id, req.signal);
  if (r.ok) return Response.json({ claim: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.kind === "source-error") {
    if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
    return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
  }
  return Response.json({ error: r.message, code: "unknown-outcome" }, { status: 503, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/leads", get_), "/api/leads/[id]/claim");
export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/claim");
