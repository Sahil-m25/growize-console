/* M03-S02-W1 / M03-S04-W1 / M17-S02-W1 — access writes on Teams: grants, seats, managers.
     POST   /api/grants            { whom, page, cap }    add one capability ("view" first; any other adds "view")
     DELETE /api/grants            { whom, page, cap }    take one away · { whom, page } reset the page to the seat's preset
     PUT    /api/users/{id}        { seat }               an Investors seat (KAM → the book returns to the pool)
     PUT    /api/users/{id}        { seat, side: "lead" } a Leads seat
     PUT    /api/users/{id}/manager { manager }           who they report to (409 loop / would-lose)
   Live: the routes, on the changer's own Zoho token; a refusal is the route's own message. A seat change answers
   403 {code: "step-up"} until a fresh Zoho sign-in (action "seat").
   Fixture: the reducer action each write replaces, behind the same refusals the screen's own gates make. */

import type { Cap, NavKey, PersonKey, SeatKey } from "@/domain";
import { NOSIGN, PAGECAPS } from "@/domain";
import type { Action, ConsoleState } from "@/lib/state";
import type { SaveResult } from "@/lib/save-queue";
import { canGrant, canManage, capsBase, capsFor, moveCost, own, reachCeil, seatClash, seatShape } from "@/lib/selectors";
import { maySeat, who, type ImRoleKey } from "@/lib/im";
import type { GrantChangeResult } from "@/server/access/grant-service";
import type { SeatChangeResult } from "@/server/access/seat-change";
import type { ManagerChangeResult } from "@/server/access/manager-change";
import { fail, ok, type ApiResult, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

/** The lead side's dispatch (useConsole().dispatch): the reducer through the save queue. */
export type LeadDispatch = (a: Action) => SaveResult | undefined;

/* ---- grants ---------------------------------------------------------------------------------- */
export type GrantArgs = { whom: PersonKey; page: string; cap?: Cap };
export type Granted = Pick<Extract<GrantChangeResult, { ok: true }>, "whom" | "page">;

/* the refusals the route makes (server/access/grant-rules GRANT_REFUSALS), asked of the screen's own selectors */
const CANNOT = "You cannot change this person's access. Digital Infrastructure can.";
function grantRefusal(s: ConsoleState, a: GrantArgs): ApiResult<never> | null {
  if (!s.PEOPLE[a.whom] || !PAGECAPS[a.page as NavKey]) return fail(400, "bad-request", "That is not a page and capability the console grants.");
  if (a.page === "me") return fail(403, "own-profile", "A person's own profile is not anyone's to grant.");
  if (!own(s, "people", "seats") || !canManage(s, a.whom)) return fail(403, "cannot-manage", CANNOT);
  if (!a.cap) return null;
  if (reachCeil(s.PEOPLE, a.whom).indexOf(a.page) < 0) return fail(403, "past-ceiling", "This page is past what their seat and their managers reach.");
  if (!seatShape(s.PEOPLE, a.whom, a.page, [a.cap]).includes(a.cap)) return fail(403, "seat-cannot-hold", "Their role cannot hold this, whoever grants it.");
  if (!capsBase(s, s.WHO, a.page).includes(a.cap)) return fail(403, "not-held", "You cannot hand out what you do not hold yourself.");
  return null;
}
const holds = (s: ConsoleState, a: GrantArgs) => !!a.cap && capsFor(s, a.whom, a.page).includes(a.cap);

export const grantAdd: WriteEndpoint<ConsoleState, GrantArgs, Granted, LeadDispatch> = {
  method: "POST",
  path: () => "/api/grants",
  body: (a) => ({ whom: a.whom, page: a.page, cap: a.cap }),
  pick: (j) => { const g = j as Granted; return { whom: g.whom, page: g.page }; },
  fixture(s, d, a) {
    const no = grantRefusal(s, a) ?? (a.cap ? null : fail(400, "bad-request", "Name the capability to grant."));
    if (no) return no;
    /* the reducer's capSave toggles: adding a capability already held changes nothing */
    if (!holds(s, a)) d({ type: "toggleCap", k: a.whom, p: a.page as NavKey, c: a.cap! });
    return ok({ whom: a.whom, page: a.page });
  },
};

export const grantRemove: WriteEndpoint<ConsoleState, GrantArgs, Granted, LeadDispatch> = {
  method: "DELETE",
  path: () => "/api/grants",
  body: (a) => (a.cap ? { whom: a.whom, page: a.page, cap: a.cap } : { whom: a.whom, page: a.page }),
  pick: (j) => { const g = j as Granted; return { whom: g.whom, page: g.page }; },
  fixture(s, d, a) {
    const no = grantRefusal(s, a);
    if (no) return no;
    if (!a.cap) {
      /* resetCap(k, p): toggleCap with c "" — see the reducer; `f` keys the save queue's scope only */
      d({ type: "toggleCap", k: a.whom, p: a.page, c: "", f: "reset" } as Action);
    } else if (holds(s, a)) d({ type: "toggleCap", k: a.whom, p: a.page as NavKey, c: a.cap });
    return ok({ whom: a.whom, page: a.page });
  },
};

/* ---- seats ------------------------------------------------------------------------------------ */
type SeatOk = Extract<SeatChangeResult, { ok: true }>;
/** The Investors seat change's answer the Team page reads (how many accounts went back to the pool). */
export type ImSeated = Pick<Extract<SeatOk, { returned: readonly string[] }>, "whom" | "to" | "continueFrom"> & {
  /** how many accounts this call returned to the pool (the route's count) */
  returned: number;
};
export type LeadSeated = Pick<Extract<SeatOk, { side: "lead" }>, "whom" | "to">;

/* M18-S09-NOTE-3: continueFrom — a KAM's book that did not fit one request; the page sends the same seat again with it. */
export const imSeatChange: WriteEndpoint<ImBook, { whom: string; seat: ImRoleKey; continueFrom?: string | null }, ImSeated, ImDispatch> = {
  method: "PUT",
  path: (a) => `/api/users/${encodeURIComponent(a.whom)}`,
  body: (a) => (a.continueFrom ? { seat: a.seat, continueFrom: a.continueFrom } : { seat: a.seat }),
  pick: (j) => {
    const r = j as { whom: string; to: ImRoleKey; returned?: unknown; continueFrom?: unknown };
    return { whom: r.whom, to: r.to, returned: typeof r.returned === "number" ? r.returned : 0, continueFrom: typeof r.continueFrom === "string" ? r.continueFrom : null };
  },
  /* the route's refusals (server/access/seat-change SEAT_REFUSALS), asked of the reducer's own maySeat; then its setSeat.
     The reducer returns the whole book at once, so the fixture never has anything to continue (continueFrom: null). */
  fixture(b, d, a) {
    const { s, me } = b;
    if (a.continueFrom) return ok({ whom: a.whom, to: a.seat, returned: 0, continueFrom: null });
    if (!s.data.P[a.whom]) return fail(404, "unknown-person", "That person is not a Zoho user you can see.");
    if (a.whom === me) return fail(403, "own-seat", "Nobody changes their own seat.");
    if (who(s, a.whom).r === "root" || a.seat === "root" || a.seat === "di") return fail(403, "super-admin", "The super admin's seat is not changed here, and nobody is made super admin.");
    if (who(s, a.whom).r === a.seat) return fail(409, "same-seat", "They already hold that seat.");
    if (!maySeat(s, me, a.whom, a.seat)) return fail(403, "cannot-seat", "You cannot move this person into that seat.");
    return imFixtureWrite(b, d, { type: "setSeat", k: a.whom, r: a.seat }, { whom: a.whom, to: a.seat, returned: 0, continueFrom: null });
  },
  onLiveError: imLiveError,
};

export const leadSeatChange: WriteEndpoint<ConsoleState, { whom: PersonKey; seat: SeatKey }, LeadSeated, LeadDispatch> = {
  method: "PUT",
  path: (a) => `/api/users/${encodeURIComponent(a.whom)}`,
  body: (a) => ({ seat: a.seat, side: "lead" }),
  pick: (j) => { const r = j as { whom: string; to: SeatKey }; return { whom: r.whom, to: r.to }; },
  fixture(s, d, a) {
    if (!s.PEOPLE[a.whom]) return fail(404, "unknown-person", "That person is not a Zoho user you can see.");
    if (a.whom === s.WHO) return fail(403, "own-seat", "Nobody changes their own seat.");
    if (s.PEOPLE[a.whom].seat === a.seat) return fail(409, "same-seat", "They already hold that seat.");
    if ((NOSIGN as readonly string[]).includes(a.seat) || !canGrant(s, a.seat) || !canManage(s, a.whom) || !own(s, "people", "seats"))
      return fail(403, "cannot-seat", "You cannot move this person into that seat.");
    if (seatClash(s.PEOPLE, a.whom, a.seat).length)
      return fail(409, "above-manager", "That seat is above their manager: it reaches pages whoever they report to cannot. Move them to a manager who reaches it first, then give them the seat.");
    d({ type: "setSeat", seat: a.seat, who: a.whom } as Action);
    return ok({ whom: a.whom, to: a.seat });
  },
};

/* ---- managers --------------------------------------------------------------------------------- */
export type ManagerArgs = { whom: PersonKey; manager: PersonKey | null };
export type ManagerSet = Pick<Extract<ManagerChangeResult, { ok: true }>, "whom" | "to">;

export const managerChange: WriteEndpoint<ConsoleState, ManagerArgs, ManagerSet, LeadDispatch> = {
  method: "PUT",
  path: (a) => `/api/users/${encodeURIComponent(a.whom)}/manager`,
  body: (a) => ({ manager: a.manager }),
  pick: (j) => { const r = j as { whom: string; to: string | null }; return { whom: r.whom, to: r.to }; },
  fixture(s, d, a) {
    if (!s.PEOPLE[a.whom] || (a.manager && !s.PEOPLE[a.manager]?.on)) return fail(404, "unknown-person", "That person is not a Zoho user you can see.");
    if (a.whom === s.WHO) return fail(403, "own-row", "Nobody changes who they report to themselves.");
    if (!own(s, "people", "seats") || !canManage(s, a.whom)) return fail(403, "cannot-manage", "You cannot change who this person reports to. Digital Infrastructure can.");
    if ((s.PEOPLE[a.whom].mgr ?? null) === a.manager) return fail(409, "same-manager", "They already report to that person.");
    const c = moveCost(s.PEOPLE, a.whom, a.manager, s.CAPS);
    if (c.cycle) return fail(409, "loop", "That would make a loop: the new manager already sits under them, which leaves neither with a ceiling. Nothing changed.");
    if (!c.ok) return fail(409, "would-lose", "That appointment would take pages away: the new manager cannot reach them either. Nothing changed.");
    d({ type: "setMgr", k: a.whom, m: a.manager });
    return ok({ whom: a.whom, to: a.manager });
  },
};
