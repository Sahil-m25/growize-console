/* POST /api/jobs/audit-export — M15-S03-T01 / B-27: the nightly Zoho audit-log export into the activity archive, called by the
   platform scheduler (Catalyst Job Scheduling, catalyst/README.md) with the X-Job-Secret header (JOB_SECRET), every 10 minutes
   from 01:30 to 03:30 IST. Each call is short: it requests yesterday's export or resumes the one already requested
   (server/activity/runtime runAuditExportClaimed), so a slow Zoho export finishes over several calls. One run at a time across
   instances ("job|audit-export"). No person, no session: guard rule `open`. Answers codes and counts only. */
import { guardApi } from "@/server/access/guard";
import { jobResponse } from "@/server/jobs/claim";
import { withErrorCapture } from "@/server/ops/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function post(request: Request): Promise<Response> {
  return jobResponse(request, "audit-export", async () => (await import("@/server/activity/runtime")).runAuditExportClaimed());
}

export const POST = withErrorCapture(guardApi("/api/jobs/audit-export", post), "/api/jobs/audit-export");
