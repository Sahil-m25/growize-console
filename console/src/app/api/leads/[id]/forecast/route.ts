/* PUT /api/leads/[id]/forecast — the forecast category and the expected full-payment date (cluster C2 setFc / setFcDate /
   setFcBy, server/leads/forecast). Body { expectedModifiedTime, category?: commit|probable|pipeline, paidBy?: YYYY-MM-DD }.
   200 → { leadId, modifiedTime, forecast, paidBy }   4xx → { error, code, field? } — nothing was written. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { recordConfigured, recordRuntime } from "@/server/leads/journey-runtime";
import { answer, badBody, jsonBody, notReady, principalOf } from "@/server/leads/record-http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "already-paid": 409, "not-qualified": 409 };

async function put_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!recordConfigured()) return notReady();
  const p = await principalOf();
  if (!p.ok) return p.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (!b) return badBody();
  return answer(await recordRuntime().forecast.set(p.principal, id, b.expectedModifiedTime, { category: b.category, paidBy: b.paidBy }, req.signal), STATUS);
}

export const PUT = withErrorCapture(guardApi("/api/leads", put_), "/api/leads/[id]/forecast");
