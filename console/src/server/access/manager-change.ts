/**
 * M17-S02-T01 — WHO SOMEONE REPORTS TO (the prototype's setMgr, vTeams 14399; D60: a manager is the ceiling).
 *
 *   decideManager(by, whom, mgr, book)  pure: the front end's own rules (`@/lib/selectors/access` own,
 *                                       canManage, manageable, moveCost) over the granter's, the holder's and
 *                                       the new manager's chains, seated from Zoho (grant-rules ctxOf):
 *       cannot-manage          the holder is outside the changer's reach, or the changer cannot change seats
 *       manager-out-of-reach   the new manager is neither the changer nor someone they manage (PROVISIONAL:
 *                              the prototype checks only that the manager exists; the server keeps an IR
 *                              Manager from moving their IR into another branch)
 *       same-manager           nothing to change
 *       loop                   "That would make a loop" — the new manager already sits under the holder
 *       would-lose             the new chain cannot reach a page the holder reaches today (moveCost.lose)
 *   createManagerChangeService   reads the three chains on the changer's own token (identity/users.ts), decides,
 *                                writes PUT /users/{id} Reporting_To (client.updateUserManager, never retried),
 *                                and files Plane C `manager-change` — ok or refused, ids and codes only.
 */

import type { CapGrid } from "../../domain";
import type { UserCredential, ZohoResult } from "../../lib/zoho/client";
import { canManage, manageable, moveCost, own } from "../../lib/selectors/access";
import type { AuthorityEvents } from "../identity/authority";
import type { ZohoUserDirectory } from "../identity/users";
import { CONSOLE_SEAT, type ConsoleSession } from "../oauth/user-session";
import { ctxOf, type GrantBook, type SeatedPerson } from "./grant-rules";
import type { GrantStore } from "./grants";

const USER_ID = /^\d{15,25}$/;

export type ManagerRefusal = "bad-request" | "own-row" | "unknown-person" | "seat-moved" | "zoho-unavailable" | "cannot-manage"
  | "manager-out-of-reach" | "same-manager" | "loop" | "would-lose" | "zoho-refused" | "unconfirmed";

export const MANAGER_REFUSALS: Readonly<Record<ManagerRefusal, string>> = Object.freeze({
  "bad-request": "That is not a person the console knows.",
  "own-row": "Nobody changes who they report to themselves.",
  "unknown-person": "That person is not a Zoho user you can see.",
  "seat-moved": "Your own seat has changed in Zoho. Sign in again.",
  "zoho-unavailable": "Zoho did not answer. Nothing was changed; try again.",
  "cannot-manage": "You cannot change who this person reports to. Digital Infrastructure can.",
  "manager-out-of-reach": "You can only put someone under yourself or under a person you manage.",
  "same-manager": "They already report to that person.",
  loop: "That would make a loop: the new manager already sits under them, which leaves neither with a ceiling. Nothing changed.",
  "would-lose": "That appointment would take pages away: the new manager cannot reach them either. Nothing changed.",
  "zoho-refused": "Zoho refused the change. Nothing was changed.",
  unconfirmed: "Zoho did not confirm the change. Reload Teams to see whether it applied.",
});

const STATUS: Readonly<Record<ManagerRefusal, 400 | 403 | 404 | 409 | 502 | 503>> = Object.freeze({
  "bad-request": 400, "own-row": 403, "unknown-person": 404, "seat-moved": 403, "zoho-unavailable": 503, "cannot-manage": 403,
  "manager-out-of-reach": 403, "same-manager": 409, loop: 409, "would-lose": 409, "zoho-refused": 502, unconfirmed: 503,
});

export type ManagerDecision =
  | { readonly ok: true; readonly from: string | null }
  | { readonly ok: false; readonly refusal: ManagerRefusal; readonly lose?: readonly string[] };

/** Decide one manager change by `by` over the book (the three chains). `mgr` null = reports to nobody. Pure. */
export function decideManager(by: string, whom: string, mgr: string | null, b: GrantBook, now: Date = new Date(0)): ManagerDecision {
  const has = (k: string) => b.people.some((p) => p.who === k);
  if (!has(by) || !has(whom) || (mgr !== null && !has(mgr))) return { ok: false, refusal: "unknown-person" };
  if (whom === by) return { ok: false, refusal: "own-row" };
  const ctx = ctxOf(by, b, now);
  if (!own(ctx, "people", "seats") || !canManage(ctx, whom)) return { ok: false, refusal: "cannot-manage" };
  const from = ctx.PEOPLE[whom]?.mgr ?? null;
  if (mgr === from) return { ok: false, refusal: "same-manager" };
  const cost = moveCost(ctx.PEOPLE, whom, mgr, ctx.CAPS as Parameters<typeof moveCost>[3]);
  if (cost.cycle) return { ok: false, refusal: "loop" };
  if (mgr !== null && mgr !== by && !manageable(ctx).includes(mgr)) return { ok: false, refusal: "manager-out-of-reach" };
  if (!cost.ok) return { ok: false, refusal: "would-lose", lose: Object.freeze([...cost.lose]) };
  return { ok: true, from };
}

export type ManagerChangeResult =
  | { readonly ok: true; readonly whom: string; readonly from: string | null; readonly to: string | null }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 502 | 503; readonly refusal: ManagerRefusal; readonly message: string; readonly lose?: readonly string[] };

export interface ManagerChangeDeps {
  readonly users: ZohoUserDirectory;
  readonly crm: { updateUserManager(as: UserCredential, userId: string, managerId: string | null): Promise<ZohoResult<{ readonly updated: true }>> };
  readonly events: AuthorityEvents;
  readonly store?: Pick<GrantStore, "grantsOf">;
  readonly clock?: () => number;
}

export interface ManagerChangeService {
  change(as: UserCredential, session: ConsoleSession, ask: { readonly whom: unknown; readonly manager: unknown }): Promise<ManagerChangeResult>;
}

export function createManagerChangeService(d: ManagerChangeDeps): ManagerChangeService {
  const clock = d.clock ?? Date.now;
  return Object.freeze({
    async change(as: UserCredential, session: ConsoleSession, ask: { readonly whom: unknown; readonly manager: unknown }): Promise<ManagerChangeResult> {
      const by = session.who;
      const whom = typeof ask.whom === "string" && USER_ID.test(ask.whom) ? ask.whom : "";
      const mgr = ask.manager === null ? null : typeof ask.manager === "string" && USER_ID.test(ask.manager) ? ask.manager : undefined;
      const no = (refusal: ManagerRefusal, lose?: readonly string[]): ManagerChangeResult => {
        if (whom) d.events.managerChanged(by, whom, session.seat, "refused", refusal, mgr ? [mgr] : []);
        return { ok: false, status: STATUS[refusal], refusal, message: MANAGER_REFUSALS[refusal], ...(lose ? { lose } : {}) };
      };
      if (!whom || mgr === undefined) return no("bad-request");
      if (as.userId !== by) return no("seat-moved");
      if (whom === by) return no("own-row");
      if (mgr === whom) return no("loop");

      const [mine, theirs, above] = await Promise.all([d.users.chainOf(as, by), d.users.chainOf(as, whom), mgr ? d.users.chainOf(as, mgr) : Promise.resolve([])]);
      if (!mine) return no("zoho-unavailable");
      if (!theirs || !above) return no("unknown-person");
      if (CONSOLE_SEAT[mine[0]!.seat] !== session.seat) return no("seat-moved");
      const people = new Map<string, SeatedPerson>();
      for (const p of [...mine, ...theirs, ...above]) people.set(p.who, p);
      const grants: Record<string, CapGrid> = {};
      for (const k of people.keys()) grants[k] = d.store ? d.store.grantsOf(k) : {};
      const v = decideManager(by, whom, mgr, { people: [...people.values()], grants }, new Date(clock()));
      if (!v.ok) return no(v.refusal, v.lose);

      const put = await d.crm.updateUserManager(as, whom, mgr);
      if (!put.ok) {
        const k = put.error.kind;
        return no(k === "network" || k === "aborted" || k === "server" || k === "unexpected" ? "unconfirmed"
          : k === "busy" || k === "concurrency-exceeded" || k === "credits-exhausted" || k === "rate-limited-unclassified" || k === "auth-expired" ? "zoho-unavailable" : "zoho-refused");
      }
      d.events.managerChanged(by, whom, session.seat, "ok", mgr ? "set" : "cleared", [v.from, mgr].filter((x): x is string => !!x));
      return { ok: true, whom, from: v.from, to: mgr };
    },
  });
}
