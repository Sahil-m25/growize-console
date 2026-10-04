/* POST /api/jobs/sign-recheck — M12-S05-T02 on a multi-instance host: the platform scheduler (Catalyst Job
   Scheduling, catalyst/README.md) calls this every 10 minutes with the X-Job-Secret header (JOB_SECRET). One run
   at a time across every instance: the run claims "job|sign-recheck" (server/jobs/claim), so an overlapping call
   answers { ran: false, code: "already-running" } and does nothing. No person, no session: guard rule `open`. */
import { guardApi } from "@/server/access/guard";
import { jobResponse } from "@/server/jobs/claim";
import { withErrorCapture } from "@/server/ops/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function post(request: Request): Promise<Response> {
  return jobResponse(request, "sign-recheck", async () => (await import("@/server/zoho-sign/runtime")).runSignCheckClaimed());
}

export const POST = withErrorCapture(guardApi("/api/jobs/sign-recheck", post), "/api/jobs/sign-recheck");
