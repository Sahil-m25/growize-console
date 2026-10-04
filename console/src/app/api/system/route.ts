/* GET /api/system — the System page's live checks (M15-S05-NOTE-2, M15-S03-NOTE-5): Zoho credits headroom, 429s and
   failures from Plane B, the audit archive's last run, investor-app delivery from the outbox (server/system/facts + checks).
   Only seats with the `sys` capability (Digital Infrastructure, the super administrator). A read: no Origin guard, no body.
   200 → SystemView · 403 → not a system reader (logged to Plane B as a refusal) */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { logSource, planeBLog } from "@/server/logs/runtime";
import { planeBBetween } from "@/server/logs/reader";
import { auditArchive } from "@/server/activity/runtime";
import { investorAppOutbox } from "@/server/contracts/runtime";
import { gatherFacts, mayReadSystem } from "@/server/system/facts";
import { systemChecks, systemView } from "@/server/system/checks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const DAY = 86_400_000;

async function get(): Promise<Response> {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  if (!mayReadSystem(s.session.seat)) {
    planeBLog().refusal({ at: Date.now(), actor: { kind: "user", userId: s.credential.userId }, action: "system-read", reason: "not-a-system-reader", recordIds: [] });
    return Response.json({ error: "The system checks are Digital Infrastructure's.", code: "not-a-system-reader" }, { status: 403, headers: NO_STORE });
  }
  const now = Date.now();
  const archive = auditArchive();
  const facts = await gatherFacts({
    ops: planeBBetween(logSource(), now - DAY, now + 1),
    archiveLastRun: async () => (archive ? archive.lastRun() : null),
    outbox: investorAppOutbox(),
  }, now);
  return Response.json({ ...systemView(systemChecks(facts, now)), asOf: now }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/system", get), "/api/system");
