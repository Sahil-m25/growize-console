/* PUT /api/leads/[id]/permission — per-channel contact permission (cluster C2 saveContactPermission, server/leads/details).
   Body { expectedModifiedTime, con: { msg, email, call }, how?, date?, time? }   (no visit: the org has no Consent_Visit)
   200 → { leadId, modifiedTime, fields }   4xx → { error, code, field? } — nothing was written. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { recordConfigured, recordRuntime } from "@/server/leads/journey-runtime";
import { answer, badBody, jsonBody, notReady, principalOf } from "@/server/leads/record-http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "how-needed": 422, "given-at-invalid": 422, "email-needed": 422 };

async function put_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!recordConfigured()) return notReady();
  const p = await principalOf();
  if (!p.ok) return p.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (!b || !b.con || typeof b.con !== "object") return badBody();
  return answer(await recordRuntime().details.permission(p.principal, id, b.expectedModifiedTime,
    { con: b.con as Record<string, unknown>, how: b.how, date: b.date, time: b.time }, req.signal), STATUS);
}

export const PUT = withErrorCapture(guardApi("/api/leads", put_), "/api/leads/[id]/permission");
