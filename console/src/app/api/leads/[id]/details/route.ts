/* PUT /api/leads/[id]/details — correct the investor's details (cluster C2 saveProfileDetails, server/leads/details).
   Body { expectedModifiedTime, name?, mobile?, email?, city?, units?, contactPreference?, introducedBy? } — only what changed.
   contactPreference → Leads.Preferred_Communication (Email / WhatsApp / Phone); introducedBy answers field-missing (no Introduced_By).
   200 → { leadId, modifiedTime, fields }   4xx → { error, code, field? } — nothing was written. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { recordConfigured, recordRuntime } from "@/server/leads/journey-runtime";
import { answer, badBody, jsonBody, notReady, principalOf } from "@/server/leads/record-http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "duplicate-mobile": 409, "units-locked": 409, "nothing-changed": 422 };
const KEYS = ["name", "mobile", "email", "city", "units", "contactPreference", "introducedBy"] as const;

async function put_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!recordConfigured()) return notReady();
  const p = await principalOf();
  if (!p.ok) return p.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (!b) return badBody();
  const patch = Object.fromEntries(KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  return answer(await recordRuntime().details.profile(p.principal, id, b.expectedModifiedTime, patch, req.signal), STATUS);
}

export const PUT = withErrorCapture(guardApi("/api/leads", put_), "/api/leads/[id]/details");
