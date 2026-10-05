/* GET /api/system — the System page's live checks (M15-S05-NOTE-2, M15-S03-NOTE-5): Zoho credits headroom, 429s and
   failures from Plane B, the audit archive's last run, investor-app delivery from the outbox, service-token expiry, cache load errors and the last Zoho Sign event (server/system/facts + checks).
   Only seats with the `sys` capability (Digital Infrastructure, the super administrator). A read: no Origin guard, no body.
   200 → SystemView · 403 → not a system reader (logged to Plane B as a refusal) */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { auditChain, logSource, planeBLog } from "@/server/logs/runtime";
import { planeBBetween } from "@/server/logs/reader";
import { auditArchive } from "@/server/activity/runtime";
import { investorAppOutbox } from "@/server/contracts/runtime";
import { processLoadWindow } from "@/lib/zoho/cache";
import { serviceTokenProviders } from "@/server/oauth/service-token";
import { crmEnvironment, expectedCrmOrgId, lastVerifiedCrmOrg } from "@/lib/zoho/client";
import type { SystemCrm } from "@/lib/data/endpoints/system";
import { signLastEventAt } from "@/server/zoho-sign/webhook";
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
    ops: await planeBBetween(logSource(), now - DAY, now + 1),
    archiveLastRun: async () => (archive ? archive.lastRun() : null),
    outbox: investorAppOutbox(),
    serviceTokens: serviceTokenProviders(),
    cacheLoads: () => processLoadWindow().totals(now),
    signLastEventAt: () => signLastEventAt(),
    // Plane C hash chain for the last closed India day (r4-cat-audit, docs/architecture/log-sink.md)
    auditChain: () => auditChain().verify(new Date(now + 5.5 * 3_600_000 - DAY).toISOString().slice(0, 10)),
  }, now);
  return Response.json({ ...systemView(systemChecks(facts, now)), asOf: now, crm: crmFacts() }, { headers: NO_STORE });
}

/** ZOHO_CRM_ENVIRONMENT and the org ids (expected, last proved) — no tokens, no secrets. */
function crmFacts(): SystemCrm {
  const verifiedOrgId = lastVerifiedCrmOrg()?.orgId ?? null;
  try {
    return { environment: crmEnvironment(), expectedOrgId: expectedCrmOrgId(), verifiedOrgId };
  } catch {
    return { environment: "misconfigured", expectedOrgId: null, verifiedOrgId };
  }
}

export const GET = withErrorCapture(guardApi("/api/system", get), "/api/system");
