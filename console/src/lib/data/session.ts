/* THE SESSION — who is signed in, and on which seat. Held in one cookie set by `/api/session` on
   sign-in and cleared on sign-out. Phase 2 puts the Zoho identity behind it; the shape stays. */

import type { PersonKey } from "@/domain";

export const SESSION_COOKIE = "gz_session";
/** A console session lasts 12 hours (SIGNOUTMSG.expired). */
export const SESSION_MAX_AGE_S = 12 * 60 * 60;

export type Session = { who: PersonKey; seat: string };

const b64 = (s: string): string => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string): string => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

export function encodeSession(s: Session): string {
  return b64(JSON.stringify({ who: s.who, seat: s.seat }));
}

/** The cookie's value read back — null for anything that is not exactly a session. */
export function decodeSession(v: string | null | undefined): Session | null {
  if (!v) return null;
  try {
    const o: unknown = JSON.parse(unb64(v));
    if (!o || typeof o !== "object") return null;
    const { who, seat } = o as Record<string, unknown>;
    return typeof who === "string" && who && typeof seat === "string" ? { who, seat } : null;
  } catch {
    return null;
  }
}
