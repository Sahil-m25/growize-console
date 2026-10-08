/* B-27 — the nightly audit export now has a caller: POST /api/jobs/audit-export runs runAuditExportClaimed, one claimed,
   bounded run. Without the audit-archive service grant it says so (and alerts) instead of silently filling nothing.
   No request reaches Zoho: the grant is absent, so no token is ever asked for. */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/ops/runtime", async () => {
  const real = await vi.importActual<typeof import("@/server/ops/runtime")>("@/server/ops/runtime");
  return { ...real, reportOpsFailure: vi.fn(), withErrorCapture: (h: unknown) => h };
});
vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));

const SECRET = "synthetic-job-secret-never-live-0123456789";

describe("POST /api/jobs/audit-export (B-27)", () => {
  it("is guarded by JOB_SECRET and, with no audit-archive grant, answers credential-not-configured and alerts backup-failed", async () => {
    const before = { secret: process.env.JOB_SECRET, token: process.env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN };
    process.env.JOB_SECRET = SECRET;
    delete process.env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN;
    try {
      const { POST } = await import("@/app/api/jobs/audit-export/route");
      const { reportOpsFailure } = await import("@/server/ops/runtime");
      const req = (h?: string) => new Request("http://localhost/api/jobs/audit-export", { method: "POST", headers: h ? { "X-Job-Secret": h } : {} });
      expect((await (POST as (r: Request) => Promise<Response>)(req("wrong"))).status).toBe(401);
      const r = await (POST as (r: Request) => Promise<Response>)(req(SECRET));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ job: "audit-export", ran: true, summary: { ok: false, code: "credential-not-configured" } });
      expect(reportOpsFailure).toHaveBeenCalledWith("backup-failed", "credential-not-configured");
    } finally {
      if (before.secret === undefined) delete process.env.JOB_SECRET; else process.env.JOB_SECRET = before.secret;
      if (before.token !== undefined) process.env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN = before.token;
    }
  });
});
