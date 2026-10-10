/* /api/investors/[id]/full-paid/request — D138 (owner ruling 10 Oct): a KAM can NOT mark an allotment fully paid; the KAM asks
   Finance to confirm the full payment instead (server/investors/full-paid-request). The request lands on Finance's to-do
   (server/queues/queue.ts, one row per open request) and is logged with who / when / note: the KAM's note is a Note on the
   Contact under their own name, then Convert_Requested_At on the allotment (guarded, D44), on the KAM's own token.
   POST { allotmentId, note (10-500 chars) }
   200 → { requested: { allotmentId, contactId, requestedAt, already } }  ·  400 invalid  ·  403 not a KAM / not visible  ·
   409 changed / supplementary-not-signed / already-converted  ·  422 note-short / not-reserved / fields-missing  ·  502 note-failed  ·
   503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { RequestResult } from "@/server/investors/full-paid-request";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = {
  "invalid-request": 400, "not-allowed": 403, "not-visible": 403, changed: 409, "supplementary-not-signed": 409, "already-converted": 409, "note-failed": 502,
};
/** D138: the KAM asks; Finance and Digital Infrastructure stamp (../route.ts). */
const REQUEST_SEATS: ReadonlySet<string> = new Set(["key-account-manager"]);
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { createFullPaidRequest } = await import("@/server/investors/full-paid-request");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { rt, crm, principal } = c.ctx;
  const ask = createFullPaidRequest({
    crm, log: rt.log, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    authority: {
      async mayRequest(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && REQUEST_SEATS.has(seat);
      },
    },
  });
  const raw = await req.text().catch(() => "");
  let b: Record<string, unknown> = {};
  if (raw && raw.length <= MAX_BODY) { try { const p: unknown = JSON.parse(raw); if (p && typeof p === "object" && !Array.isArray(p)) b = p as Record<string, unknown>; } catch { b = {}; } }
  const contactId = (await params).id;   // the page's investor: an allotment of anyone else is refused (not-visible)
  const r: RequestResult = await ask.request({ credential: principal.credential, sessionId: principal.sessionId }, b.allotmentId, b.note, contactId, req.signal);
  if (r.ok) return Response.json({ requested: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/full-paid/request", post_), "/api/investors/[id]/full-paid/request");
