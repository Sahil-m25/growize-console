/* /api/auth/zoho/callback — where Zoho sends the person back (M01-S02-T01/T03).
   Success: an opaque httpOnly session id (12 hours), then the console, which reads GET /api/session
   and lands on the seat's first page. Refusal (no seat, no granted page, cancelled, failed): no
   session; a five-minute one-shot note that GET /api/session hands the sign-in screen with its named
   message. Plane C records both. Nothing from the query string is echoed or logged. */
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/data/session";
import { cookieBase, userSessions, zohoSignInConfigured } from "@/server/oauth/runtime";
import { FLOW_COOKIE, NOTE_COOKIE, SESSION_ABSOLUTE_MS, SID_COOKIE } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  if (!zohoSignInConfigured()) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const jar = await cookies();
  const flow = jar.get(FLOW_COOKIE)?.value;
  jar.delete({ name: FLOW_COOKIE, path: "/api/auth/zoho" });
  const sessions = userSessions();
  /* a sign-in on a browser that still holds somebody's session ends that session first (D30) */
  const prior = jar.get(SID_COOKIE)?.value;
  if (prior) await sessions.signOut(prior, "chose");
  jar.delete(SID_COOKIE);
  jar.delete(SESSION_COOKIE);
  const r = await sessions.callback(
    { code: q.get("code"), state: q.get("state"), error: q.get("error"), accountsServer: q.get("accounts-server") },
    flow,
  );
  if (r.ok) {
    jar.set(SID_COOKIE, r.sid, { ...cookieBase(), maxAge: SESSION_ABSOLUTE_MS / 1000 });
  } else {
    jar.set(NOTE_COOKIE, r.code, { ...cookieBase(), maxAge: 300 });
  }
  return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(get_, "/api/auth/zoho/callback");
