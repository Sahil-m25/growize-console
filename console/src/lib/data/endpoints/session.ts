/* M01-S01-W1 / M01-S02-W1 / M01-S10-W1 — the session: who is signed in, their own seat records, and step-up.
   GET /api/session (who, the sign-in screen's refusal, `signedOut`, and — live — the person's one-person book),
   GET /api/auth/step-up/status?action=… (is a step-up open), and the step-up navigation /api/auth/step-up.
   Live: the routes. Fixture: the same answers from the demo book (the fixture session cookie still comes from
   the route, because the store's bootstrap reads it on the wire in both modes). */

import type { CapGrid, PersonKey, SignOutWhy } from "@/domain";
import type { ImPerson } from "@/lib/im";
import type { ConsoleState } from "@/lib/state";
import type { Dataset } from "@/lib/data/types";
import type { Session } from "@/lib/data/session";
import type { SessionAccess } from "@/server/access/session-access";
import { fail, ok, type ReadEndpoint } from "../api";

/* ---- GET /api/session ------------------------------------------------------------------------- */
export type SessionAnswer = {
  session: Session | null;
  /** a session that ended on its own: past its 12 hours, or revoked */
  signedOut?: "expired" | "revoked";
  /** a refused Zoho sign-in, once, for the sign-in screen */
  refusal?: { code: string; message: string };
  /** live only: the signed-in person's own one-person book (server/access/session-access) */
  access?: SessionAccess | null;
};

const signedOutOf = (v: unknown): SessionAnswer["signedOut"] => (v === "expired" || v === "revoked" ? v : undefined);

export const sessionRead: ReadEndpoint<ConsoleState, void, SessionAnswer> = {
  path: () => "/api/session",
  pick(j) {
    const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
    const s = o.session as Session | null | undefined;
    const r = o.refusal as SessionAnswer["refusal"] | undefined;
    return {
      session: s && typeof s.who === "string" && typeof s.seat === "string" ? { who: s.who, seat: s.seat } : null,
      ...(signedOutOf(o.signedOut) ? { signedOut: signedOutOf(o.signedOut) } : {}),
      ...(r && typeof r.message === "string" ? { refusal: { code: String(r.code), message: r.message } } : {}),
      ...(o.access && typeof o.access === "object" ? { access: o.access as SessionAccess } : {}),
    };
  },
  /* the demo book already holds every person, so the fixture answer carries no `access` */
  fixture: (s) => ok({ session: s.authed ? { who: s.WHO, seat: s.PEOPLE[s.WHO]?.seat ?? "" } : null }),
};

/** Put the session's one-person book on a live book (what server/access/policy accessBook builds, exactly as
 *  lib/data/stub-user withStubUser does for the phase-1 stub). A copy; the book's other records are untouched. */
export function withSessionAccess(ds: Dataset, who: PersonKey, a: SessionAccess): Dataset {
  const out: Dataset = {
    ...ds,
    PEOPLE: { ...ds.PEOPLE, [who]: keepIdentity({ ...a.lead }, ds.PEOPLE[who]) },
    SIGNINS: [...ds.SIGNINS.filter((k) => k !== who), who],
    GRANT: { ...ds.GRANT, [who]: a.grants as CapGrid },
  };
  if (a.im) {
    out.im = {
      ...ds.im,
      P: { ...ds.im.P, [who]: keepIdentity({ ...(a.im as ImPerson) }, ds.im.P[who]) },
      SIGNINS: [...ds.im.SIGNINS.filter((k) => k !== who), who],
    };
  }
  return out;
}

/** B-15: the session decides the seat (seat, manager, grants); who the person IS — name, initials, email, phone, badge —
 *  comes from the book's own record of them (the Zoho Users read with their saved badge) when it has one, because the
 *  session's are blank. Overwriting them blanked the /today greeting, "Recorded by", note authors and the /me name. */
type Identity = { n: string; i: string; em?: string; ph?: string; c: number; sq?: boolean };
function keepIdentity<T extends Identity>(fromSession: T, onBook: Partial<Identity> | undefined): T {
  if (!onBook) return fromSession;
  const out = { ...fromSession } as T & Identity;
  for (const k of ["n", "i", "em", "ph"] as const) {
    const v = onBook[k];
    if (typeof v === "string" && v) (out as Identity)[k] = v;
  }
  if (typeof onBook.c === "number") out.c = onBook.c;
  if (typeof onBook.sq === "boolean") out.sq = onBook.sq;
  return out;
}

/** The sign-out reason a session answer asks the screen to show (expired / revoked), else null. */
export const signedOutWhy = (a: SessionAnswer | null): SignOutWhy | null => a?.signedOut ?? null;

/* ---- step-up (M01-S10-W1) --------------------------------------------------------------------- */
export type StepUpAction = "reveal" | "export" | "erase" | "release" | "seat" | "refund";
/** GET /api/auth/step-up/status — the route's own answer */
export type StepUpStatus = { valid: true; until: number } | { valid: false; code: string; message: string };
/** what the step-up callback put on the address when it sent the person back */
export type StepUpReturn = "ok" | "failed" | "cancelled" | "locked" | "signed-out" | "not-configured";

export const STEPUP_RETURN: Readonly<Record<StepUpReturn, string>> = Object.freeze({
  ok: "Confirmed. You have five minutes.",
  failed: "The fresh sign-in did not complete. Nothing was shown.",
  cancelled: "The fresh sign-in was cancelled. Nothing was shown.",
  locked: "Too many failed confirmations. Step-up is locked; Digital Infrastructure has been told.",
  "signed-out": "You are signed out. Sign in again.",
  "not-configured": "Zoho sign-in is not configured here, so nothing can be confirmed.",
});

export const stepUpReturnOf = (v: string | null | undefined): StepUpReturn | null =>
  v && Object.prototype.hasOwnProperty.call(STEPUP_RETURN, v) ? (v as StepUpReturn) : null;

/** The step-up navigation: a fresh Zoho sign-in, then back to `back` with ?stepup=<code>. */
export const stepUpHref = (action: StepUpAction, back: string): string =>
  `/api/auth/step-up?action=${encodeURIComponent(action)}&back=${encodeURIComponent(back)}`;

/* Fixture: the demo has no Zoho, so no step-up is ever open — exactly what the route answers when Zoho sign-in
   is not configured, except that the demo still asks (the panel's question is what the UI cases check). */
export const stepUpStatus: ReadEndpoint<unknown, StepUpAction | null, StepUpStatus> = {
  path: (a) => (a ? `/api/auth/step-up/status?action=${encodeURIComponent(a)}` : null),
  pick: (j) => j as StepUpStatus,
  fixture: (_b, a) => (a ? ok({ valid: false, code: "step-up", message: "Confirm it is you with a fresh sign-in first." }) : fail(400, "bad-request", "Unknown action.")),
};

/** The reducer's reveal, run only once a live step-up is open (fixture: the panel stops at the question). */
export const revealIsOpen = (st: StepUpStatus | null): boolean => !!st && st.valid;
