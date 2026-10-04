/* /api/auth/step-up?action=reveal|export|erase|release|seat|refund&back=/path — start a fresh Zoho sign-in before an
   authoritative action (M01-S10-T01). Redirects to Zoho (prompt=login, max_age) with a ten-minute sealed
   flow cookie bound to this session; ./callback finishes it. Locked, signed out or not configured: straight
   back to `back` with ?stepup=<code>. The session itself is read here, so this navigation is not wrapped
   in guardApi (like /api/auth/zoho); the step-up opens nothing but a five-minute window for this session. */
import { cookies } from "next/headers";
import { isStepUpAction, safeBack, STEP_UP_BACK_COOKIE as BACK_COOKIE, STEP_UP_FLOW_COOKIE, STEP_UP_FLOW_TTL_MS } from "@/server/identity/step-up";
import { stepUp } from "@/server/access/runtime";
import { cookieBase, zohoSignInConfigured } from "@/server/oauth/runtime";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  const q = new URL(req.url).searchParams;
  const back = safeBack(q.get("back"));
  const home = (code: string) => new Response(null, { status: 303, headers: { Location: new URL(`${back}?stepup=${code}`, req.url).toString(), "Cache-Control": "no-store" } });
  const action = q.get("action");
  if (!isStepUpAction(action)) return home("failed");
  if (!zohoSignInConfigured()) return home("not-configured");
  const jar = await cookies();
  const r = await stepUp().start(jar.get(SID_COOKIE)?.value, action);
  if (!r.ok) return home(r.code);
  const opts = { ...cookieBase(), path: "/api/auth/step-up", maxAge: STEP_UP_FLOW_TTL_MS / 1000 };
  jar.set(STEP_UP_FLOW_COOKIE, r.flowCookie, opts);
  jar.set(BACK_COOKIE, back, opts);
  return new Response(null, { status: 302, headers: { Location: r.url, "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(get_, "/api/auth/step-up");
