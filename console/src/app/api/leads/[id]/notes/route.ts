/* POST /api/leads/[id]/notes — a free note on the investor (cluster C2 addNote, server/leads/notes).
   Header Idempotency-Key (one per press). Body { text }.
   200 → { noteId, leadId }   4xx → { error, code } — nothing was written. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { recordConfigured, recordRuntime } from "@/server/leads/journey-runtime";
import { answer, badBody, jsonBody, notReady, principalOf } from "@/server/leads/record-http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "note-empty": 422, "note-too-long": 422, "idempotency-key-invalid": 400, "key-reused": 409, busy: 409, unavailable: 503 };

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!recordConfigured()) return notReady();
  const p = await principalOf();
  if (!p.ok) return p.response;
  const { id } = await params;
  const b = await jsonBody(req);
  if (!b) return badBody();
  return answer(await recordRuntime().notes.add(p.principal, id, b.text, req.headers.get("Idempotency-Key"), req.signal), STATUS);
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/notes");
