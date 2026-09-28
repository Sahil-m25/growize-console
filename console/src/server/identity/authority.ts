/**
 * M01-S04-T01 — PLANE C'S WRITER FOR THE ACCESS POLICY: refused pages, refused actions and grant
 * changes, filed as who, what, whom, when and outcome (D47; acceptance: "a sign-in, sign-out, grant
 * change, seat change, reveal or refused action … Plane C stores who, what, whom, when and outcome").
 *
 * Sign-in, sign-out and expiry are written by oauth/user-session.ts; reveal, step-up and seat change
 * by data/events.ts. This module covers the rest, for the access layer and the page guard to call:
 *
 *   authorityEvents().refusedPage(zohoUserId, seat, "numbers")
 *
 * Every argument is cleaned by plane-c.ts (ids must be Zoho ids, codes short lower-case codes) and
 * by the shared sink's guard, so a caller who passes an email or a name files "unrecognised".
 */

import { sharedPlaneCSink } from "../logs/factory";
import { createPlaneCLog, type PlaneCLog, type PlaneCOutcome } from "./plane-c";

export interface AuthorityEvents {
  /** The access layer refused a page (a deep link, a menu the seat does not carry). */
  refusedPage(who: string, seat: string | null, page: string): void;
  /** The access layer refused an action (a write, a reveal, a record outside the book). */
  refusedAction(who: string, seat: string | null, action: string, recordIds?: readonly string[]): void;
  /** A grant was given, returned or refused (D35 borrowed grants, M03-S02). `grant` is a short code. */
  grantChange(who: string, whom: string, seat: string | null, grant: string, outcome: Exclude<PlaneCOutcome, "ended">): void;
}

/** Lower-cased only. Anything that is not already a code (a space, an `@`, a digit run) is left for
 *  plane-c.ts to file as "unrecognised" — never slugged into something that passes, like a name. */
const code = (x: string): string => (typeof x === "string" ? x.toLowerCase() : "");

export function createAuthorityEvents(planeC: PlaneCLog, clock: () => number = Date.now): AuthorityEvents {
  return Object.freeze({
    refusedPage(who: string, seat: string | null, page: string): void {
      planeC.record({ at: clock(), who, action: "refused-page", outcome: "refused", reason: code(page), seat });
    },
    refusedAction(who: string, seat: string | null, action: string, recordIds: readonly string[] = []): void {
      planeC.record({ at: clock(), who, action: "refused-action", outcome: "refused", reason: code(action), seat, recordIds });
    },
    grantChange(who: string, whom: string, seat: string | null, grant: string, outcome: Exclude<PlaneCOutcome, "ended">): void {
      planeC.record({ at: clock(), who, whom, action: "grant-change", outcome, reason: code(grant), seat });
    },
  });
}

const G = globalThis as typeof globalThis & { __gzIdentityLog?: { log: PlaneCLog; events: AuthorityEvents } };

function held() {
  if (!G.__gzIdentityLog) {
    const log = createPlaneCLog(sharedPlaneCSink());
    G.__gzIdentityLog = { log, events: createAuthorityEvents(log) };
  }
  return G.__gzIdentityLog;
}

/** The process's Plane C log on the shared sink. */
export const identityLog = (): PlaneCLog => held().log;
/** The process's authority-event writer on the shared sink. */
export const authorityEvents = (): AuthorityEvents => held().events;
