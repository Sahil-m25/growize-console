/* /api/investors/[id]/full-paid — D137 ruling 3: mark a Reserved allotment fully paid BY HAND (server/investors/full-paid manual).
   The automatic conversion happens when Finance matches the remaining money (money/match → full-paid auto); this route is the
   manual path for Finance Operations, the Head of Finance, Digital Infrastructure or a KAM, logged like the unlock override.
   POST { allotmentId, reason (10-500 chars), expectedModifiedTime? }
   The reason is a Note on the Contact under the person's own name first, then Converted_At / Converted_By / Converted_Via = Manual
   on the allotment (guarded, D44); ops log `full-paid` / `manual` and Plane C `investor-converted` (fully-paid-manual).
   200 → { stamped }  ·  403 not allowed / not visible  ·  409 changed  ·  422 reason-short / not-reserved / fields-missing  ·
   502 note-failed  ·  503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { ManualResult } from "@/server/investors/full-paid";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = { "invalid-request": 400, "not-allowed": 403, "not-visible": 403, changed: 409, "note-failed": 502 };
/** D137 ruling 3: Finance, Digital Infrastructure or KAM may convert by hand. */
const MANUAL_SEATS: ReadonlySet<string> = new Set(["finance-operations", "head-of-finance", "digital-infrastructure", "key-account-manager"]);
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { createFullPaid } = await import("@/server/investors/full-paid");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { rt, crm, principal } = c.ctx;
  const full = createFullPaid({
    crm, log: rt.log, events: rt.events, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    authority: {
      async mayMarkManually(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && MANUAL_SEATS.has(seat);
      },
    },
  });
  const raw = await req.text().catch(() => "");
  let b: Record<string, unknown> = {};
  if (raw && raw.length <= MAX_BODY) { try { const p: unknown = JSON.parse(raw); if (p && typeof p === "object" && !Array.isArray(p)) b = p as Record<string, unknown>; } catch { b = {}; } }
  const contactId = (await params).id;   // the page's investor: an allotment whose Customer is someone else is refused (not-visible)
  const r: ManualResult = await full.manual({ credential: principal.credential, sessionId: principal.sessionId, seat: principal.session.seat },
    b.allotmentId, b.reason, b.expectedModifiedTime, req.signal, contactId);
  if (r.ok) return Response.json({ stamped: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/full-paid", post_), "/api/investors/[id]/full-paid");
