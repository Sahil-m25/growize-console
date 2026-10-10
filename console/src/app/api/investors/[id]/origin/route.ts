/* /api/investors/[id]/origin — the lead this investor came from (server/investors/origin), on the signed-in person's own token.
   GET   W6-KAM-1: the origin lead, read-only (status, source, owner, units interested, created / said yes / lost) for a seat
         without the Leads page whom Zoho lets read it — the Journey's "Open lead ›" shows it in place instead of bouncing to /today.
         200 → { lead }  (lead.readable false + reason "no-origin" | "not-shared" when Zoho does not return it)  ·  403 not visible  ·
         502 / 503 Zoho.
   POST  W7-FIN-2: Digital Infrastructure only — "Set originating IR from the lead owner": Contacts.Originating_IR = Origin_Lead.Owner,
         on DI's own token, empty field only, guarded and read back. Body: none.
         200 → { set: { contactId, originatingIrId, already } }  ·  403 not allowed / not visible / lead not visible  ·  409 changed  ·
         422 no-origin / no-owner / not-written  ·  502 / 503 Zoho. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { FixResult, ViewResult } from "@/server/investors/origin";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "invalid-request": 400, "not-allowed": 403, "not-visible": 403, "lead-not-visible": 403, changed: 409 };
/** D122: Originating_IR's writers are the admin, the AM Head and Digital Infrastructure — of the console's seats, DI. */
const FIX_SEATS: ReadonlySet<string> = new Set(["digital-infrastructure"]);
type Ctx = { params: Promise<{ id: string }> };

async function origin(c: Extract<Awaited<ReturnType<typeof investorsContext>>, { ok: true }>["ctx"]) {
  const { createOrigin } = await import("@/server/investors/origin");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  return createOrigin({
    crm: c.crm, log: c.rt.log, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    authority: {
      async mayFixOriginatingIr(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && FIX_SEATS.has(seat);
      },
    },
  });
}

async function get_(req: Request, { params }: Ctx) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const r: ViewResult = await (await origin(c.ctx)).view({ credential: c.ctx.principal.credential, sessionId: c.ctx.principal.sessionId }, (await params).id, req.signal);
  if (r.ok) return Response.json({ lead: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 403, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function post_(req: Request, { params }: Ctx) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const r: FixResult = await (await origin(c.ctx)).fixOriginatingIr({ credential: c.ctx.principal.credential, sessionId: c.ctx.principal.sessionId }, (await params).id, req.signal);
  if (r.ok) return Response.json({ set: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: "Not done — Zoho did not take it. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors/[id]/origin", get_), "/api/investors/[id]/origin");
export const POST = withErrorCapture(guardApi("/api/investors/[id]/origin", post_), "/api/investors/[id]/origin");
