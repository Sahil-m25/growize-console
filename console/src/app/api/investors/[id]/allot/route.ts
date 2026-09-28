/* /api/investors/[id]/allot — M11-S05-T02: verify the signed allocation letter and allot through the blueprint,
   on the signed-in person's own token (D53).
   POST { allotmentId, reference?, expectedModifiedTime? }
   200 → { allotted, already }  ·  403 not Finance / not visible  ·  409 changed ("reload")  ·
   422 { error, code, missing? } refused (facts missing, oversell, no transition, blueprint refused, no letter)  ·
   503 Zoho not answering. Server: server/investors/allot. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import type { AllotResult } from "@/server/investors/allot";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = { "not-finance": 403, "not-visible": 403, changed: 409, "invalid-request": 400 };
type Ctx = { params: Promise<{ id: string }> };

async function service() {
  const c = await investorsContext();
  if (!c.ok) return c;
  const { createAllot } = await import("@/server/investors/allot");
  const { createOversellGuard } = await import("@/server/farms/oversell");
  const { publishToInvestorApp } = await import("@/server/contracts/runtime");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const { rt, crm, principal } = c.ctx;
  const allot = createAllot({
    crm, log: rt.log, recordIdPrefix: process.env.ZOHO_CRM_RECORD_ID_PREFIX!,
    oversell: createOversellGuard({ crm, events: rt.events }),
    publish: publishToInvestorApp,
    authority: {
      // Verifying paper is the Investors-side "doc" capability (Head of Finance, Finance Operations, Compliance, super user).
      async mayVerify(cred, sid) {
        const now = await userSessions().credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && seatAccess(seat, now.session.who, {}).imCan("doc");
      },
    },
  });
  return { ok: true as const, allot, who: { credential: principal.credential, sessionId: principal.sessionId } };
}

async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return {};
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}; } catch { return {}; }
}

function answer(r: AllotResult): Response {
  if (r.ok) return Response.json({ allotted: r.value, already: r.already }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode, ...(r.missing ? { missing: r.missing } : {}) }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function post_(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const b = await bodyOf(req);
  return answer(await s.allot.allot(s.who, (await params).id, { allotmentId: b.allotmentId, reference: b.reference, expectedModifiedTime: b.expectedModifiedTime }, req.signal));
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/allot", post_), "/api/investors/[id]/allot");
