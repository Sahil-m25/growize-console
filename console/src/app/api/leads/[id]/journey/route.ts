/* POST /api/leads/[id]/journey — the ladder (cluster C2, server/leads/journey).
   Body { op: "tick", expectedModifiedTime, scorecard?: true }   tick / tickCommit / recordRung (scorecard: the IR's stated scorecard for Qualified)
        { op: "skip", expectedModifiedTime }                     skipStage (Engagement only)
        { op: "untick", expectedModifiedTime, reason }           untick / undoRung (one of journey UNDO_REASONS)
   200 → { rung, modifiedTime }   4xx → { error, code, field? } — nothing was written.
   code "field-missing" (422, with `field`): Zoho has no Leads.Engagement_Skipped / Rung_Undone_At yet. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { recordConfigured, recordRuntime } from "@/server/leads/journey-runtime";
import { answer, badBody, jsonBody, notReady, principalOf } from "@/server/leads/record-http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = {
  "first-touch-by-followup": 409, "gate-shut": 409, "not-skippable": 409, "nothing-to-undo": 409, "undo-window-closed": 409,
  "already-undone": 409, "payment-stands": 409, "scorecard-needed": 422, "next-step-needed": 422, "units-needed": 422, "reason-needed": 422,
};

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!recordConfigured()) return notReady();
  const p = await principalOf();
  if (!p.ok) return p.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (!b || typeof b.expectedModifiedTime !== "string") return badBody();
  const j = recordRuntime().journey, mt = b.expectedModifiedTime;
  if (b.op === "tick") return answer(await j.tick(p.principal, id, mt, b.scorecard === true, req.signal), STATUS);
  if (b.op === "skip") return answer(await j.skip(p.principal, id, mt, req.signal), STATUS);
  if (b.op === "untick") return answer(await j.untick(p.principal, id, mt, typeof b.reason === "string" ? b.reason : "", req.signal), STATUS);
  return badBody();
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/journey");
