/* /api/investors/[id]/test-link — the test sign-in link (M10-S23-T02). Super user only.
   GET                    → { links }  this investor's links: who, why, when made, expiry, when used, state
   POST { why, confirm }  → { link }   a one-time link (url, expiresAt, 10 minutes or first use); nothing is emailed.
                                       A real investor without confirm → 409 { code: "confirm-needed", ask } (the warning).
   403 not the super user / not in scope · 422 no reason · 503 the app's link service is not configured (MA1) or Zoho. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";
import { readLimitedUtf8Body } from "@/server/http/limited-body";

export const dynamic = "force-dynamic";
const MAX_BODY = 2 * 1024;
const STATUS: Record<string, number> = { "seat-denied": 403, "why-missing": 422, "confirm-needed": 409, "not-configured": 503, "issuer-failed": 502 };
const MESSAGE: Record<string, string> = {
  "seat-denied": "Only the super user can make a test sign-in link.",
  "why-missing": "Say why you need to sign in as the investor. It goes on the record with your name.",
  "confirm-needed": "Confirm to make a link for a real investor.",
  "not-configured": "The investor app's test-link service is not connected yet.",
  "issuer-failed": "The investor app did not make the link. Try again.",
};
type Ctx = { params: Promise<{ id: string }> };

async function service() {
  const c = await investorsContext();
  if (!c.ok) return c;
  const t = await import("@/server/investors/test-link");
  const { planeBLog } = await import("@/server/logs/runtime");
  const { rt, crm, principal } = c.ctx;
  const links = t.createTestLinks({ crm, events: rt.events, log: planeBLog(), issuer: t.testLinkIssuer(), testAccounts: t.testAccountsFromEnv() }, t.sharedTestLinkRegister());
  return { ok: true as const, links, principal };
}

async function get(_req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const { id } = await params;
  const list = s.links.list(s.principal.session.seat, id);
  if (!list) return Response.json({ error: MESSAGE["seat-denied"], code: "seat-denied" }, { status: 403, headers: NO_STORE });
  return Response.json({ links: list }, { headers: NO_STORE });
}

async function post(req: Request, { params }: Ctx) {
  const s = await service();
  if (!s.ok) return s.response;
  const { id } = await params;
  const body = await readLimitedUtf8Body(req, MAX_BODY, req.signal);
  if (!body.ok) return Response.json({ error: "Send { why, confirm }.", code: "invalid-request" }, { status: body.reason === "payload-too-large" ? 413 : 400, headers: NO_STORE });
  let ask: { why?: unknown; confirm?: unknown } = {};
  try { const p: unknown = JSON.parse(body.body || "{}"); if (p && typeof p === "object" && !Array.isArray(p)) ask = p as typeof ask; }
  catch { return Response.json({ error: "Send { why, confirm }.", code: "invalid-request" }, { status: 400, headers: NO_STORE }); }
  const r = await s.links.create(s.principal.credential, s.principal.session.seat, id, ask, req.signal);
  if (r.ok) return Response.json({ link: r.link }, { headers: NO_STORE });
  if (r.kind === "test-link") return Response.json({ error: MESSAGE[r.reason], code: r.reason, ...(r.ask ? { ask: r.ask } : {}) }, { status: STATUS[r.reason] ?? 400, headers: NO_STORE });
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/investors/[id]/test-link", get), "/api/investors/[id]/test-link");
export const POST = withErrorCapture(guardApi("/api/investors/[id]/test-link", post), "/api/investors/[id]/test-link");
