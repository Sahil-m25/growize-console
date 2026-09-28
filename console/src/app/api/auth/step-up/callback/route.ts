/* /api/auth/step-up/callback — Zoho sends the person back from the step-up (M01-S10-T01). The flow must be
   this session's; the token must name the session's own person. Then back to where they were with
   ?stepup=ok|failed|cancelled|locked|signed-out. Nothing from the query string is echoed or logged. */
import { cookies } from "next/headers";
import { safeBack, STEP_UP_BACK_COOKIE as BACK_COOKIE, STEP_UP_FLOW_COOKIE } from "@/server/identity/step-up";
import { stepUp } from "@/server/access/runtime";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  if (!zohoSignInConfigured()) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const jar = await cookies();
  const flow = jar.get(STEP_UP_FLOW_COOKIE)?.value;
  const back = safeBack(jar.get(BACK_COOKIE)?.value);
  jar.delete({ name: STEP_UP_FLOW_COOKIE, path: "/api/auth/step-up" });
  jar.delete({ name: BACK_COOKIE, path: "/api/auth/step-up" });
  const r = await stepUp().finish(jar.get(SID_COOKIE)?.value, { code: q.get("code"), state: q.get("state"), error: q.get("error") }, flow);
  const code = r.ok ? "ok" : r.code;
  return new Response(null, { status: 303, headers: { Location: new URL(`${back}?stepup=${code}`, req.url).toString(), "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(get_, "/api/auth/step-up/callback");
