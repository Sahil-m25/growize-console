/* GET /api/auth/step-up/status?action=… — is a step-up open for this session and action? (M01-S10-T01)
   200 → { valid: true, until } | { valid: false, code: "step-up" | "locked", message }. The screen asks
   before it offers "reveal" or "Release the reservation", and shows the lock message instead. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { stepUp } from "@/server/access/runtime";
import { isStepUpAction, STEP_UP_MESSAGES } from "@/server/identity/step-up";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function get_(req: Request) {
  const action = new URL(req.url).searchParams.get("action");
  if (!isStepUpAction(action)) return Response.json({ error: "Unknown action.", code: "bad-request" }, { status: 400, headers: NO_STORE });
  if (!zohoSignInConfigured()) return Response.json({ valid: false, code: "not-configured", message: STEP_UP_MESSAGES["not-configured"] }, { headers: NO_STORE });
  const v = await stepUp().valid((await cookies()).get(SID_COOKIE)?.value, action);
  return Response.json(v.ok ? { valid: true, until: v.until } : { valid: false, code: v.code, message: STEP_UP_MESSAGES[v.code] }, { status: v.ok || v.code !== "signed-out" ? 200 : 401, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/auth/step-up", get_), "/api/auth/step-up/status");
