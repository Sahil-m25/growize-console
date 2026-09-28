/* POST /api/payouts/schedule — the payouts schedule job for named allotments (M10-S20-T02, D82): creates the
   missing ones of each Issued allotment's 60 monthly Investor_Payouts, never a duplicate. Finance "pay" seats
   only, on their own token. Body { allotmentIds: string[] (1–100), commit?: boolean (default true; false plans only) }.
   200 → { outcomes: [{ allotmentId, status: created|complete|planned|skipped|failed, … counts/codes }] } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { liveCaps, NO_STORE, readFailure, scheduleJob } from "@/server/payouts/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { credential, sessionId } = c.ctx.principal;
  if (!(await liveCaps(sessionId, credential)).pay) return readFailure({ kind: "refused", reason: "seat-denied" });
  const raw = await req.text().catch(() => "");
  let body: { allotmentIds?: unknown; commit?: unknown } | null = null;
  try { body = raw.length <= MAX_BODY ? JSON.parse(raw) : null; } catch { body = null; }
  if (!body || !Array.isArray(body.allotmentIds)) return readFailure({ kind: "refused", reason: "invalid-request" });
  const r = await (await scheduleJob(c.ctx)).run(credential, body.allotmentIds, { commit: body.commit !== false, signal: req.signal });
  if (!r.ok) return readFailure(r.kind === "refused" ? { kind: "refused", reason: r.reason } : r);
  return Response.json({ outcomes: r.outcomes }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/payouts", post), "/api/payouts/schedule");
