/* POST /api/jobs/outbox-drain — M13-S01 on a multi-instance host: the platform scheduler calls this every minute
   with the X-Job-Secret header (JOB_SECRET), so queued and retrying pushes to the investor app are tried even when
   the instance that queued them has been recycled. The drain claims "job|outbox-drain", and each delivery attempt
   is claimed again per event (server/contracts/outbox-queue), so nothing is sent twice. Guard rule `open`. */
import { guardApi } from "@/server/access/guard";
import { jobResponse } from "@/server/jobs/claim";
import { withErrorCapture } from "@/server/ops/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function post(request: Request): Promise<Response> {
  return jobResponse(request, "outbox-drain", async () => (await import("@/server/contracts/runtime")).drainInvestorAppOutboxClaimed());
}

export const POST = withErrorCapture(guardApi("/api/jobs/outbox-drain", post), "/api/jobs/outbox-drain");
