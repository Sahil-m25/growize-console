/* /api/auth/zoho — "Continue with Zoho" (M01-S02-T01, D53: every human on their own seat and token).

   With Zoho sign-in configured (server/oauth/runtime — never in fixture mode):
     GET  → starts the OAuth code flow: a fresh state + PKCE verifier sealed into a ten-minute
            httpOnly flow cookie, then a redirect to Zoho's authorize page. The console never sees
            a password; the callback (./callback) finishes the sign-in.
     POST → { wired: false, redirect: "/api/auth/zoho" } — the sign-in button navigates there.
   Without it, the phase-1 behaviour stands: the stub says it is not wired — except outside fixture
   mode and production, where `ZOHO_STUB_USER="Full Name|email|seat"` (@/lib/data/stub-user) names
   the one person this button signs in. */
import { cookies } from "next/headers";
import { signInAdmits } from "@/lib/data/admission";
import { clockDay, kolkataNow } from "@/lib/data/clock";
import { emptyDataset } from "@/lib/data/empty";
import { encodeSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/data/session";
import { parseStubUser, stubAllowed, withStubUser } from "@/lib/data/stub-user";
import { cookieBase, userSessions, zohoSignInConfigured } from "@/server/oauth/runtime";
import { FLOW_COOKIE, FLOW_TTL_MS } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

const PHASE2 = "Zoho sign-in is connected in phase 2.";
const stub = () => Response.json({ wired: false, message: PHASE2 }, { status: 501 });

async function get_() {
  if (!zohoSignInConfigured()) return stub();
  const { url, flowCookie } = userSessions().start();
  const jar = await cookies();
  jar.set(FLOW_COOKIE, flowCookie, { ...cookieBase(), path: "/api/auth/zoho", maxAge: FLOW_TTL_MS / 1000 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

async function post_() {
  if (zohoSignInConfigured()) {
    return Response.json({ wired: false, redirect: "/api/auth/zoho", message: "You finish signing in on zoho.in." }, { headers: { "Cache-Control": "no-store" } });
  }
  const raw = process.env.ZOHO_STUB_USER;
  if (!stubAllowed() || !raw) return stub();
  const r = parseStubUser(raw);
  if (!r.ok) return Response.json({ wired: false, message: r.error }, { status: 500 });
  const now = kolkataNow();
  const ds = withStubUser(emptyDataset(clockDay(now), now), r.user);
  if (!signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, r.user.key)) {
    return Response.json({ wired: false, message: "No console access: this seat signs in only once Digital Infrastructure grants it a page." }, { status: 403 });
  }
  const session = { who: r.user.key, seat: r.user.seat };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(session), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return Response.json({ wired: true, session });
}

export const GET = withErrorCapture(get_, "/api/auth/zoho");
export const POST = withErrorCapture(post_, "/api/auth/zoho");
