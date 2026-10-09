/* /api/session — who is signed in (M03-S01-T04, M01-S02).
   GET    → { session: {who, seat} | null }. With Zoho sign-in configured the answer comes from the
            server session (server/oauth): a session past its 12 hours or revoked comes back null with
            `signedOut: "expired" | "revoked"`, and a refused sign-in comes back once with
            `refusal: { code, message }` for the sign-in screen. A live session also carries `access`
            (M01-S01-W1): the person's own one-person book — lead seat, Investors seat, granted pages —
            which the screen puts on its (otherwise people-less) live book so its seat rules can answer.
   POST   → { who } signs in as a listed person. Fixture mode only: outside it the only door is
            Zoho OAuth (/api/auth/zoho), and no person can be picked.
   DELETE → signs out: revokes the Zoho refresh token, deletes the server session, clears the cookies. */
import { cookies } from "next/headers";
import { admitted } from "@/lib/data/admission";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/data/session";
import { fixtureSource } from "@/lib/data/source";
import { currentLane, fixtureModeOn } from "@/lib/fixture-mode";
import { sharedGrantReader } from "@/server/access/grants";
import { sessionAccessOf } from "@/server/access/session-access";
import { styleStore } from "@/server/me/runtime";
import { userSessions, zohoSignInConfigured } from "@/server/oauth/runtime";
import { cleanWhy, NOTE_COOKIE, SID_COOKIE, SIGNIN_REFUSALS, signinDebugOn, WHY_COOKIE, type RefusalCode } from "@/server/oauth/user-session";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function get_() {
  const jar = await cookies();
  if (!zohoSignInConfigured()) {
    return Response.json({ session: decodeSession(jar.get(SESSION_COOKIE)?.value) }, { headers: NO_STORE });
  }
  const note = jar.get(NOTE_COOKIE)?.value;
  if (note) jar.delete(NOTE_COOKIE);
  const why = jar.get(WHY_COOKIE)?.value;
  if (why) jar.delete(WHY_COOKIE);
  const refusal = note && Object.prototype.hasOwnProperty.call(SIGNIN_REFUSALS, note)
    ? { code: note, message: SIGNIN_REFUSALS[note as RefusalCode], ...(why && signinDebugOn() ? { why: cleanWhy(why) } : {}) } : undefined;
  const sid = jar.get(SID_COOKIE)?.value;
  let r = await userSessions().current(sid);
  /* B-15: the display name lives in memory only; a process that has not met this session yet (restart, another instance) asks
     for the credential, whose refresh re-reads Zoho's CurrentUser answer and brings the name with it */
  if (r.ok && !r.name) { await userSessions().credential(sid); r = await userSessions().current(sid); }
  if (r.ok) return Response.json({ session: r.session, access: await sessionAccessOf(r.session, sharedGrantReader(), styleStore(), r.name, r.mobile) }, { headers: NO_STORE });
  jar.delete(SID_COOKIE);
  jar.delete(SESSION_COOKIE);
  return Response.json({ session: null, ...(r.why ? { signedOut: r.why } : {}), ...(refusal ? { refusal } : {}) }, { headers: NO_STORE });
}

async function post_(req: Request) {
  if (!fixtureModeOn()) return Response.json({ error: "Zoho sign-in is connected in phase 2." }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const who = body && typeof body === "object" ? (body as { who?: unknown }).who : null;
  if (typeof who !== "string") return Response.json({ error: "who is required" }, { status: 400 });
  const ds = (await fixtureSource.loadApplied(await currentLane())).ds;
  if (!admitted(ds).includes(who)) return Response.json({ error: "No console access" }, { status: 403 });
  const session = { who, seat: ds.PEOPLE[who]!.seat };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(session), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return Response.json({ session });
}

async function delete_() {
  const jar = await cookies();
  if (zohoSignInConfigured()) await userSessions().signOut(jar.get(SID_COOKIE)?.value, "chose");
  jar.delete(SID_COOKIE);
  jar.delete(SESSION_COOKIE);
  return Response.json({ session: null });
}

export const GET = withErrorCapture(get_, "/api/session");
export const POST = withErrorCapture(post_, "/api/session");
export const DELETE = withErrorCapture(delete_, "/api/session");
