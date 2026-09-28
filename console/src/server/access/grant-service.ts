/**
 * M03-S02-T01 — ONE GRANT CHANGE, END TO END: read the granter and the holder (and both manager chains)
 * from Zoho on the granter's own token, decide it with the front end's rules (grant-rules.ts), write
 * the line to the grant store, and file a Plane C `grant-change` (authority.ts) — ok or refused, and a
 * second line when a granted-only seat crosses the sign-in line ("console-on" / "console-off").
 *
 * The session's seat token must still be what Zoho says the granter's role is now; a role moved since
 * sign-in refuses (the session refresh will end it).
 */

import type { UserCredential } from "../../lib/zoho/client";
import type { AuthorityEvents } from "../identity/authority";
import type { ZohoUserDirectory } from "../identity/users";
import { CONSOLE_SEAT, type ConsoleSession } from "../oauth/user-session";
import { decideGrant, GRANT_REFUSALS, type GrantAsk, type GrantRefusal, type SeatedPerson } from "./grant-rules";
import type { GrantStore } from "./grants";
import type { CapGrid } from "../../domain";

export type GrantChangeResult =
  | { readonly ok: true; readonly whom: string; readonly page: string; readonly grants: CapGrid; readonly consoleAccount: boolean }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 503; readonly refusal: GrantRefusal | "unknown-person"; readonly message: string };

export interface GrantService {
  change(as: UserCredential, session: ConsoleSession, ask: GrantAsk): Promise<GrantChangeResult>;
}

const STATUS: Readonly<Record<GrantRefusal, 400 | 403>> = {
  "bad-request": 400, "cannot-manage": 403, "own-profile": 403, "seat-cannot-hold": 403, "past-ceiling": 403, "not-held": 403,
};

export function createGrantService(d: {
  readonly store: GrantStore;
  readonly users: ZohoUserDirectory;
  readonly events: AuthorityEvents;
  readonly clock?: () => number;
}): GrantService {
  const clock = d.clock ?? Date.now;
  return Object.freeze({
    async change(as: UserCredential, session: ConsoleSession, ask: GrantAsk): Promise<GrantChangeResult> {
      const by = session.who;
      const whom = typeof ask.whom === "string" ? ask.whom : "";
      const code = (c: string) => (/^[a-z][a-z0-9-]{0,47}$/.test(c) ? c : "bad-request");
      const refuse = (refusal: GrantRefusal, c: string): GrantChangeResult => {
        d.events.grantChange(by, whom, session.seat, code(c), "refused");
        return { ok: false, status: STATUS[refusal], refusal, message: GRANT_REFUSALS[refusal] };
      };
      if (as.userId !== by) return refuse("cannot-manage", "session-mismatch");
      if (whom === by) return refuse("cannot-manage", "own-grant");

      const [mine, theirs] = await Promise.all([d.users.chainOf(as, by), d.users.chainOf(as, whom)]);
      if (!mine) return { ok: false, status: 503, refusal: "unknown-person", message: "Zoho did not answer who you are. Try again." };
      if (!theirs) {
        d.events.grantChange(by, whom, session.seat, "unknown-person", "refused");
        return { ok: false, status: 404, refusal: "unknown-person", message: "That person is not a console user Zoho shows you." };
      }
      if (CONSOLE_SEAT[mine[0]!.seat] !== session.seat) return refuse("cannot-manage", "seat-moved");

      const people = new Map<string, SeatedPerson>();
      for (const p of [...mine, ...theirs]) people.set(p.who, p);
      const grants: Record<string, CapGrid> = {};
      for (const k of people.keys()) grants[k] = d.store.grantsOf(k);
      const v = decideGrant(by, { ...ask, whom }, { people: [...people.values()], grants }, new Date(clock()));
      if (!v.ok) return refuse(v.refusal, v.code);

      d.store.set({ at: clock(), by, whom, page: ask.page, caps: v.caps });
      d.events.grantChange(by, whom, session.seat, code(v.code), "ok");
      if (v.accountBefore !== v.accountAfter) d.events.grantChange(by, whom, session.seat, v.accountAfter ? "console-on" : "console-off", "ok");
      return { ok: true, whom, page: ask.page, grants: d.store.grantsOf(whom), consoleAccount: v.accountAfter };
    },
  });
}
