/* PUT /api/investors/[id]/kam — name or move an account's key account manager (M09-S04-T02).
   Body: { kamUserId: "<Zoho user id>" | null, expectedModifiedTime: "<the record's version>" }.
   On the signed-in person's own token (D53): the "assign" right re-derived from the live session (Head of AM;
   a KAM is refused), the assignee must hold the Key Account Manager seat, then one PUT of KAM and KAM_Since
   with If-Unmodified-Since (server/investors/kam-assign). null returns the account to the pool.
   200 → { kam: { contactId, fromKam, toKam, kamSince, modifiedTime, changed } }
   403 → refused (seat-denied, not-visible, not-allotted, assignee-not-am) · 409 → changed by someone else
   400 → invalid-request · 503 → Zoho not answering. Bodies carry codes and ids, never values. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 2 * 1024;

async function put_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "The request is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const { parseKamCommand } = await import("@/server/investors/kam-assign");
  const { kamServices } = await import("@/server/investors/kam-wiring");
  const { principal } = c.ctx;
  const service = (await kamServices(c.ctx)).assignment;
  const cmd = parseKamCommand(id, body);
  const r = await service.assign({ credential: principal.credential, sessionId: principal.sessionId }, cmd, req.signal);
  if (r.ok) return Response.json({ kam: r.value }, { headers: NO_STORE });
  if (r.kind === "refused" && r.reason === "invalid-request") return Response.json({ error: "The request is not valid.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  if (r.kind === "refused" && r.reason !== "not-visible" && r.reason !== "seat-denied") {
    const why = r.reason === "assignee-not-am" ? "Only a key account manager can be named." : "Only an allotted account has a manager.";
    return Response.json({ error: why, code: r.reason }, { status: 403, headers: NO_STORE });
  }
  return failureResponse(r);
}

export const PUT = withErrorCapture(guardApi("/api/investors/[id]/kam", put_), "/api/investors/[id]/kam");
