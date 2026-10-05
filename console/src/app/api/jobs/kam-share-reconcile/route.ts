/* POST /api/jobs/kam-share-reconcile — D121 A / ACCESS-PLAN §7 R3: the platform scheduler calls this nightly (and every few
   minutes through the night while a run answers continueFrom) with X-Job-Secret (JOB_SECRET). It drains pending KAM
   shares, then compares every Contact with KAM set against its actual shares and adds / revokes on the "kam-share"
   service credential (server/investors/kam-share-job). One claim per run ("job|kam-share-reconcile"). Guard rule `open`.
   200 → { job, ran, summary: counts and record ids } · 401 job-secret · 503 not-configured / state-unavailable. */
import { guardApi } from "@/server/access/guard";
import { claimJob, jobResponse } from "@/server/jobs/claim";
import { withErrorCapture } from "@/server/ops/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function post(request: Request): Promise<Response> {
  return jobResponse(request, "kam-share-reconcile", async () => {
    const { sharedState } = await import("@/server/state/runtime");
    const { planeBLog } = await import("@/server/logs/runtime");
    const { pastStopMargin } = await import("@/lib/zoho/deadline");
    const { kamShareService, shareServiceUserId } = await import("@/server/investors/kam-share-runtime");
    const { runKamShareReconcile } = await import("@/server/investors/kam-share-job");
    const s = kamShareService();
    return claimJob(sharedState(), "kam-share-reconcile", () => runKamShareReconcile({
      queue: s.queue, client: s.client, credential: s.credential, state: sharedState(), log: planeBLog(),
      serviceUserId: shareServiceUserId(), shouldStop: () => pastStopMargin(),
    }));
  });
}

export const POST = withErrorCapture(guardApi("/api/jobs/kam-share-reconcile", post), "/api/jobs/kam-share-reconcile");
