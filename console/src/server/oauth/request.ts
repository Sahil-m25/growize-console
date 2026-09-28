/**
 * Route-side helpers over the Zoho session (M01-S02-T02): every API route that reads or writes Zoho
 * as the signed-in person asks `sessionCredential()` first. An expired or revoked session comes back
 * as a 401 carrying the matching sign-out reason, with the session cookie already cleared, so the
 * client can signOut(why) and show SIGNOUTMSG[why].
 */

import { cookies } from "next/headers";
import type { UserCredential } from "../../lib/zoho/client";
import { SESSION_COOKIE } from "../../lib/data/session";
import { userSessions } from "./runtime";
import { SID_COOKIE, type ConsoleSession, type SignOutWhy } from "./user-session";

export type SessionCredential =
  | { readonly ok: true; readonly credential: UserCredential; readonly session: ConsoleSession }
  | { readonly ok: false; readonly response: Response };

export function signedOutResponse(why: SignOutWhy | null): Response {
  return Response.json({ session: null, signedOut: why }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(SID_COOKIE);
  jar.delete(SESSION_COOKIE);
}

export async function sessionCredential(): Promise<SessionCredential> {
  const jar = await cookies();
  const r = await userSessions().credential(jar.get(SID_COOKIE)?.value);
  if (r.ok) return r;
  if (r.unavailable) {
    return { ok: false, response: Response.json({ error: "Zoho is not answering. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } }) };
  }
  await clearSessionCookies();
  return { ok: false, response: signedOutResponse(r.why) };
}
