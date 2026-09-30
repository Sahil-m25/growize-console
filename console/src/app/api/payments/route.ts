/* GET /api/payments — the Payments register (M10-S01-W1): every receipt, refund and forfeit with received, refunded,
   net banked and still due (MATCHED money only, D21) and — apart — what is recorded but not yet matched.
   Query: kind=advance|full|out · farm=<LLP id> · reconciled=true|false. Server: server/money/register.ts.
   Who reads it is the seat the live session holds now (server/access/policy): the Finance seats and the read-only
   Auditor; a KAM gets 403. The UTR is returned only to a seat that records (the "pay" capability); every other
   seat reads utr null / utrHidden true and the page says "Finance only" (rule 7, D13).
   200 → { rows, counts, totals: { received, refunded, netBanked, stillDue, recorded }, farms, readOnly } · 400 · 403 · 503 */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";
import type { RegisterAccess, RegisterFilter } from "@/server/money/register";

export const dynamic = "force-dynamic";

/** The query as a RegisterFilter, or null when a parameter is not one the register knows. */
function filterOf(url: URL): RegisterFilter | null {
  const q = url.searchParams, f: { kind?: "advance" | "full" | "out"; farm?: string; reconciled?: boolean } = {};
  const kind = q.get("kind"), farm = q.get("farm"), rec = q.get("reconciled");
  if (kind !== null) { if (kind !== "advance" && kind !== "full" && kind !== "out") return null; f.kind = kind; }
  if (farm !== null) f.farm = farm;
  if (rec !== null) { if (rec !== "true" && rec !== "false") return null; f.reconciled = rec === "true"; }
  return f;
}

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const filter = filterOf(new URL(req.url));
  if (!filter) return Response.json({ error: "Reload the page and try again.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const { createPaymentsRegister } = await import("@/server/money/register");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const { NAV } = await import("@/lib/im");
  const { rt, crm, principal } = c.ctx;
  const txnNeeds = (NAV.find(n => n.k === "txn")?.needs ?? []) as readonly string[];
  const register = createPaymentsRegister({
    crm, log: rt.log, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    access: {
      async recheck(cred, sid): Promise<RegisterAccess | null> {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return null;
        const seat = zohoSeatOf(now.session.seat);
        const a = seat ? seatAccess(seat, now.session.who, {}) : null;
        const im = a && a.admission.ok ? a.admission.im : null;
        const actor = { userId: cred.userId } as RegisterAccess["actor"];
        if (!a || !im) return { actor, seesRegister: false, seesUtr: false, canRecord: false };
        // the rail's own rule (lib/im navFor): a page's `needs`, and the read-only Auditor reads every page but System
        const seesRegister = im === "audit" || txnNeeds.some(n => a.imCan(n as Parameters<typeof a.imCan>[0]));
        const pay = a.imCan("pay");
        return { actor, seesRegister, seesUtr: pay, canRecord: pay };
      },
    },
  });
  const r = await register.read({ credential: principal.credential, sessionId: principal.sessionId }, filter, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") {
    const status = r.reasonCode === "invalid-request" ? 400 : r.reasonCode === "source-invalid" ? 502 : r.reasonCode === "session-changed" ? 401 : 403;
    return Response.json({ error: status === 403 ? "This page is not part of your seat." : "Reload the page and try again.", code: r.reasonCode }, { status, headers: NO_STORE });
  }
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/payments", get), "/api/payments");
