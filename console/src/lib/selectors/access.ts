/* ── selectors/access.ts — seats, teams, the ceiling, and borrowed access ───────────────────
   Ports `ref/03-app.js` lines 63–68, 279–380, 858–859, 939–990, 1104–1130, 1279–1281, 5698–5701
   and 7007–7008. Reads only; every write the prototype did from these regions (`toggleCap`,
   `resetCaps`, `setSeat`, `setMgr`, `setAvail`, `startTemp`, `grantTemp`, `revokeTemp`, `useTemp`,
   `dropTemp`) belongs to the store.

   ===== TEAMS, AND THE CEILING =============================================================
   A team is a manager and the people appointed under them. Three layers decide what somebody
   can do, and they are never mixed up:
     · the MANAGER bounds which pages they reach — you cannot reach past whoever you sit under;
     · the SEAT decides what they may do on the pages they reach;
     · a PERSON may only hand out something they hold themselves.
   The consequence is the point: move somebody to another manager and their reach changes on its
   own, with nobody editing a grid. A seat that asks for a page its chain cannot reach is a
   CLASH — the console names it, on the team card and on the member, rather than quietly
   dropping it, and refuses to create the pairing that would cause one.
   ========================================================================================= */

import {
  SEATSCREENS, SEATCAPS, SEATDEF, DEFSEATS, NOSIGN, BYGRANT, PAGECAPS, NAV, IR, SEAT, TEAMNAME,
} from "@/domain";
import type { Person, PersonKey, SeatKey, NavKey, Lead, TempGrant, TempStateRead } from "@/domain";
import { accessDay, dayOf } from "@/lib/format";
import { MERGE } from "@/domain/signin";
import { imReach } from "@/lib/im";
import type { Cap, Ctx } from "./ctx";
import { me, P } from "./ctx";
import { custodian, inBook, inBookOf, lost, openable } from "./leads";

/* the shape of one NAV row, taken off the data rather than guessed at */
export type NavItem = (typeof NAV)[number];

type People = Record<PersonKey, Person>;
/** the prototype's GRANT — person -> {page:[caps]}, the store's `CAPS` */
export type Grants = Record<PersonKey, Partial<Record<string, readonly string[]>>>;

/* ---- who somebody is ------------------------------------------------------------------------ */

export const roleOf = (PEOPLE: People, k: PersonKey | null | undefined): SeatKey | undefined =>
  (k != null ? PEOPLE[k] : undefined)?.seat as SeatKey | undefined;

export const mgrOf = (PEOPLE: People, k: PersonKey | null | undefined): PersonKey | null =>
  ((k != null ? PEOPLE[k] : undefined)?.mgr as PersonKey | undefined) || null;

/* the chain above somebody, nearest first. The guard is not paranoia: a bad move must never hang. */
export function chainOf(PEOPLE: People, k: PersonKey): PersonKey[] {
  const out: PersonKey[] = [];
  let c = mgrOf(PEOPLE, k), g = 0;
  while (c && PEOPLE[c] && out.indexOf(c) < 0 && g++ < 12) { out.push(c); c = mgrOf(PEOPLE, c); }
  return out;
}

export const titleOf = (PEOPLE: People, k: PersonKey | null | undefined): string => {
  const s = roleOf(PEOPLE, k);
  return (s && SEAT[s]) || "";
};

/* a team is named for what its manager does, not for who they are, so it survives the person */
export const teamName = (PEOPLE: People, k: PersonKey | null | undefined): string => {
  const s = roleOf(PEOPLE, k);
  return (s && TEAMNAME[s]) || "Team";
};

const seatOf = (PEOPLE: People, k: PersonKey | null | undefined): SeatKey | undefined =>
  roleOf(PEOPLE, k);

/* ---- D60: who signs in, and what a seat can hold ---------------------------------------------
   ir-merged.js:540-560, 627-660. */

/* the pages granted to somebody by name — a page counts only while "See it" is on it */
export const grantedPages = (GRANT: Grants | undefined, k: PersonKey): string[] =>
  Object.keys(GRANT?.[k] || {}).filter(p => (GRANT![k]![p] || []).includes("view"));

/* what a seat can HOLD on a page at all, whoever grants it — the shape of the role, read without
   asking whether the person can sign in (a grant is what makes them able to) */
export const seatShape = (PEOPLE: People, k: PersonKey, p: string, caps: readonly Cap[]): Cap[] => {
  const seat = seatOf(PEOPLE, k), lop = ["ir", "cp", "conv"].includes(seat || "");
  if (!seat || (NOSIGN as readonly string[]).includes(seat)) return [];
  if (seat === "ops") return caps.slice();                /* D68: the super user */
  if (seat === "cp" && !["today", "leads", "updates", "add", "activity", "me"].includes(p)) return [];
  if (p === "today" || p === "add") return lop ? caps.filter(c => c === "view" || c === "capture") : [];
  if (p === "leads") return caps.filter(c => c === "view" || (c === "edit" && lop) || (c === "assign" && seat === "conv"));
  if (p === "events") return caps.filter(c => c !== "load" || lop);
  if (p === "pay" || p === "docs") return caps.filter(c => c === "view");
  if (seat === "cp" && p === "activity") return caps.filter(c => c === "view");
  return caps.slice();
};

export const seatReach = (PEOPLE: People, k: PersonKey): string[] => {
  const s = seatOf(PEOPLE, k);
  return s ? ((SEATSCREENS as Record<string, readonly string[]>)[s] as string[] | undefined) ?? [] : [];
};

/* the most somebody could ever be granted: their seat's ceiling, bounded by every manager above */
export function reachCeil(PEOPLE: People, k: PersonKey): string[] {
  let set = seatReach(PEOPLE, k).slice();
  chainOf(PEOPLE, k).forEach(m => { const up = new Set(seatReach(PEOPLE, m)); set = set.filter(p => up.has(p)); });
  return set;
}

/* does a granted-only seat hold at least one real screen? This is what lets them sign in at all,
   so it reads nothing that asks consoleAccount in turn. */
export const hasGrant = (PEOPLE: People, GRANT: Grants | undefined, k: PersonKey): boolean => {
  const ceil = reachCeil(PEOPLE, k);
  return grantedPages(GRANT, k).some(p => !!PAGECAPS[p as NavKey] && !PAGECAPS[p as NavKey]!.nopage && p !== "me"
    && ceil.includes(p) && seatShape(PEOPLE, k, p, ["view"]).includes("view"));
};

/* D60: who signs in. The three console seats always; a granted-only seat while Digital
   Infrastructure has granted it at least one screen; Finance and Marketing never. (The Investors
   side's own door, imAccount, is asked beside this one in `@/lib/data/admission`.) */
export const consoleAccount = (PEOPLE: People, k: PersonKey, GRANT?: Grants): boolean => {
  const p = PEOPLE[k], seat = seatOf(PEOPLE, k);
  return !!p?.on && !p.ext && !!seat
    && ((DEFSEATS as readonly string[]).includes(seat)
      || ((BYGRANT as readonly string[]).includes(seat) && hasGrant(PEOPLE, GRANT, k)));
};

/** Lead operations belong to IR operators, even if another role receives an edit-capability loan. */
export const canOperateLeads = (ctx: Ctx, k: PersonKey = me(ctx)): boolean =>
  consoleAccount(ctx.PEOPLE, k, ctx.CAPS) && ["ir", "conv", "cp"].includes(seatOf(ctx.PEOPLE, k) || "");

const roleCaps = (ctx: Ctx, k: PersonKey, p: string, caps: readonly Cap[]): Cap[] =>
  consoleAccount(ctx.PEOPLE, k, ctx.CAPS) ? seatShape(ctx.PEOPLE, k, p, caps) : [];

/* ---- what somebody reaches ------------------------------------------------------------------ */

/* the pages somebody actually reaches: what their seat holds by default plus whatever has been granted
   to them by name, inside the ceiling. A granted-only seat reaches nothing until its first grant, and
   its Profile — and, with Leads, the team's list — comes with it. */
export function reachBase(PEOPLE: People, k: PersonKey, GRANT?: Grants): string[] {
  const r = seatOf(PEOPLE, k) || "";
  const on = new Set<string>(((SEATDEF as Record<string, readonly string[]>)[r] || []).concat(grantedPages(GRANT, k)));
  if ((BYGRANT as readonly string[]).includes(r) && on.size) { on.add("me"); if (on.has("leads")) on.add("teamscope"); }
  return reachCeil(PEOPLE, k).filter(p => on.has(p));
}

/* what they reach right now — the same set, plus whatever is lent to them and switched on. Only
   ever the signed-in person: borrowed access is not a property of a name, it is a thing in use. */
export function reachOf(ctx: Ctx, k: PersonKey): string[] {
  const set = reachBase(ctx.PEOPLE, k, ctx.CAPS);
  const g = k === ctx.WHO ? tempOn(ctx) : null;
  return g && set.indexOf(g.page as string) < 0 ? set.concat([g.page as string]) : set;
}

/* what their seat asks for and their chain refuses */
export const clashOf = (PEOPLE: People, k: PersonKey): string[] => {
  const has = new Set(reachCeil(PEOPLE, k));
  return seatReach(PEOPLE, k).filter(p => !has.has(p));
};

/* the part of somebody's access that nobody's seat gave them: per page, what their seat holds that was taken off, what was added, and
   whether the page itself (its "view") was taken away. Pure over the people and the grants, so the person drawer's "N changed from the
   seat" is the same count whether the book is the demo's or GET /api/teams/{id}'s (M17-S01-W2). 03-app.js (redesigned):2944 */
export type CapDeviation = { p: NavKey; off: Cap[]; on: Cap[]; gone: boolean };
export function capDevOf(PEOPLE: People, GRANT: Grants, k: PersonKey): CapDeviation[] {
  const grant = (GRANT[k] || {}) as Record<string, readonly string[]>;
  const out: CapDeviation[] = [];
  (Object.keys(grant) as NavKey[]).forEach((p) => {
    if (!(PAGECAPS as Record<string, unknown>)[p] || reachBase(PEOPLE, k, GRANT).indexOf(p) < 0) return;
    const seat = ((SEATCAPS as Record<string, Record<string, Cap[]>>)[roleOf(PEOPLE, k) || ""] || {})[p] || [];
    const now = (grant[p] || []) as Cap[];
    const off = seat.filter((c) => now.indexOf(c) < 0);
    const on = now.filter((c) => seat.indexOf(c) < 0);
    if (off.length || on.length) out.push({ p, off, on, gone: now.indexOf("view") < 0 });
  });
  return out;
}

/* ---- TEMPORARY ACCESS =======================================================================
   Somebody is out and something has to be done from their screen. The way every office solves that
   is a shared password, and a shared password destroys the one thing this console exists for:
   knowing who did what. So the login is never lent — the access is. */

export const tExpired = (g: TempGrant | null | undefined, NOW: Date): boolean => {
  const d = accessDay(g?.until, NOW);
  return !d || d < dayOf(NOW);
};
/* tState(g) — ir-console-redesigned.html:2893-2903. A `"live"` grant is read back as `"live"` only
   when its window has actually opened and both ends of it — the grantee, the grantor, and the page
   itself — still hold up; a seat change, a revoked capability or a since-narrowed chain reads back
   as `"unavailable"` rather than a stale `"live"`. */
export function tState(ctx: Ctx, g: TempGrant | null | undefined): TempStateRead | null {
  if (!g) return null;
  if (g.state !== "live") return g.state;
  const from = accessDay(g.from, ctx.NOW), until = accessDay(g.until, ctx.NOW);
  if (!from || !until || from > until) return "invalid";
  if (until < dayOf(ctx.NOW)) return "expired";
  if (from > dayOf(ctx.NOW)) return "pending";
  const to = ctx.PEOPLE[g.to], by = ctx.PEOPLE[g.by];
  if (!to || !to.on || to.ext || !by || !by.on || by.ext
    || !(PAGECAPS as Record<string, unknown>)[g.page] || !Array.isArray(g.caps) || !g.caps.includes("view")
    || !capsBase(ctx, g.by, g.page).includes("view")) return "unavailable";
  if (!consoleAccount(ctx.PEOPLE, g.to, ctx.CAPS) || !consoleAccount(ctx.PEOPLE, g.by, ctx.CAPS)
    || !roleCaps(ctx, g.to, g.page, g.caps as Cap[]).includes("view")
    || chainOf(ctx.PEOPLE, g.to).some(k => !seatReach(ctx.PEOPLE, k).includes(g.page))) return "unavailable";
  return "live";
}
export const tLive = (ctx: Ctx, g: TempGrant | null | undefined): boolean => tState(ctx, g) === "live";
export const tempFor = (ctx: Ctx, k: PersonKey): TempGrant[] =>
  ctx.TEMP.filter(g => g.to === k && tLive(ctx, g));

/* the grant the signed-in person has switched on, if any */
export const tempOn = (ctx: Ctx): TempGrant | null => {
  const g = ctx.TEMP.find(x => x.id === ctx.TEMPON);
  if (!g || g.to !== ctx.WHO || !tLive(ctx, g)
    || !consoleAccount(ctx.PEOPLE, g.to, ctx.CAPS) || !consoleAccount(ctx.PEOPLE, g.by, ctx.CAPS)
    || !chainOf(ctx.PEOPLE, g.to).every(k => seatReach(ctx.PEOPLE, k).includes(g.page))
    || (seatOf(ctx.PEOPLE, g.to) === "cp" && !["today", "leads", "updates", "add", "activity"].includes(g.page))) return null;
  const from = accessDay(g.from, ctx.NOW);
  if (!from || from > dayOf(ctx.NOW)) return null;
  const held = capsBase(ctx, g.by, g.page);
  return g.caps.length > 0 && g.caps.every(c => held.includes(c)) ? g : null;
};

/* ---- the grid -------------------------------------------------------------------------------
   the effective grid for a person: their seat's preset plus any per-person override, and never a
   page their chain does not reach */

/* what the seat and the chain give, with nothing borrowed — this is what may be lent onward */
export const capsBase = (ctx: Ctx, k: PersonKey, p: string): Cap[] => {
  if (reachBase(ctx.PEOPLE, k, ctx.CAPS).indexOf(p) < 0) return [];
  const grant = ctx.CAPS[k] as Record<string, Cap[]> | undefined;
  const s = seatOf(ctx.PEOPLE, k);
  const preset = s ? (SEATCAPS as Record<string, Record<string, Cap[]>>)[s] || {} : {};
  return roleCaps(ctx, k, p, (grant && grant[p]) || preset[p] || []);
};

export const capsFor = (ctx: Ctx, k: PersonKey, p: string): Cap[] => {
  const base = capsBase(ctx, k, p);
  const g = k === ctx.WHO ? tempOn(ctx) : null;
  const lent = g && (g.page as string) === p ? (g.caps as Cap[]).filter(c => capsBase(ctx, g.by, p).includes(c)) : [];
  return roleCaps(ctx, k, p, [...new Set(base.concat(lent))]);
};

export const hasCap = (ctx: Ctx, k: PersonKey, p: string, c: Cap): boolean =>
  consoleAccount(ctx.PEOPLE, k, ctx.CAPS) && capsFor(ctx, k, p).includes(c);

export const accountAllowed = (ctx: Ctx): boolean => consoleAccount(ctx.PEOPLE, me(ctx), ctx.CAPS);

/* what the signed-in person may do — this is the gate every screen and handler asks */
export const may = (ctx: Ctx, p: string, c: Cap): boolean => hasCap(ctx, me(ctx), p, c);

/* AUTHORITY IS NEVER BORROWED. `may` answers "can I do this now", and a live grant is part of now —
   that is what lending a page is for. But the seven writes it guards are not work, they are
   authority over other people: seats, managers, adding and removing members, changing somebody's
   grid, and lending a page onward. If those read `may`, then lending People-with-seats for a day
   hands over the power to make that day permanent — a one-page loan converts into a seat
   escalation and revoking it undoes nothing. So they ask `own`, which is the seat and the chain
   and nothing borrowed. Every other gate in the product stays on `may`. */
export const own = (ctx: Ctx, p: string, c: Cap): boolean => accountAllowed(ctx) && capsBase(ctx, me(ctx), p).includes(c);

export const myCaps = (ctx: Ctx, p: string): Cap[] => capsFor(ctx, me(ctx), p);

/* D60 — WHO MAY GRANT. Digital Infrastructure may grant any page and capability to anyone. The IR
   Manager may adjust access only for the IRs who report to them (canManage adds the reporting line),
   and never beyond their own (toggleCap asks capsBase). Nobody else grants anything — not an IR, and
   not a granted seat even if it has been given Teams. Finance and Marketing are never a seat anybody
   can hand out here. (ir-merged.js:715-727) */
export const canGrant = (ctx: Ctx, seat: SeatKey): boolean => {
  if (!SEAT[seat] || (NOSIGN as readonly string[]).includes(seat)) return false;
  if (!own(ctx, "people", "seats")) return false;    /* a seat that cannot change seats grants nothing */
  const mine = roleOf(ctx.PEOPLE, me(ctx));
  if (mine === "ops") return true;
  if (mine === "conv") return seat === "ir";
  return false;
};

/* ---- teams ---------------------------------------------------------------------------------- */

export const isMgr = (PEOPLE: People, k: PersonKey): boolean =>
  Object.keys(PEOPLE).some(x => PEOPLE[x].on && PEOPLE[x].mgr === k);

export const membersOf = (PEOPLE: People, k: PersonKey): PersonKey[] =>
  Object.keys(PEOPLE).filter(x => PEOPLE[x].on && PEOPLE[x].mgr === k);

export type TeamRow = { mgr: PersonKey; members: PersonKey[]; clash: number };

export const teamsList = (PEOPLE: People): TeamRow[] =>
  Object.keys(PEOPLE).filter(k => PEOPLE[k].on && isMgr(PEOPLE, k))
    .map(k => ({
      mgr: k, members: membersOf(PEOPLE, k),
      clash: membersOf(PEOPLE, k).filter(x => clashOf(PEOPLE, x).length).length,
    }))
    .sort((a, b) => b.members.length - a.members.length
      || P(PEOPLE, a.mgr).n.localeCompare(P(PEOPLE, b.mgr).n));

/* the team somebody is read as being on: their manager's, or their own if they lead one */
export const teamOfPerson = (PEOPLE: People, k: PersonKey): PersonKey | null =>
  mgrOf(PEOPLE, k) || (isMgr(PEOPLE, k) ? k : null);

/* who reports to me — a manager's team is everyone whose mgr is them, plus anyone they manage
   transitively */
export function teamOf(PEOPLE: People, k: PersonKey): PersonKey[] {
  const direct = Object.keys(PEOPLE).filter(x => PEOPLE[x].mgr === k && PEOPLE[x].on);
  return [...new Set(direct.concat(...direct.map(d => teamOf(PEOPLE, d))))];
}

/* the same reach, but leavers stay listed so their book can be reassigned */
export function teamOfAll(PEOPLE: People, k: PersonKey): PersonKey[] {
  const direct = Object.keys(PEOPLE).filter(x => PEOPLE[x].mgr === k);
  return [...new Set(direct.concat(...direct.map(d => teamOfAll(PEOPLE, d))))];
}

/* the four seats that see the whole org rather than a branch of it */
const ORGWIDE: readonly string[] = ["ops", "corp", "bu", "exec"];

export const myTeam = (ctx: Ctx): PersonKey[] =>
  ORGWIDE.includes(roleOf(ctx.PEOPLE, me(ctx))!)
    ? Object.keys(ctx.PEOPLE).filter(k => ctx.PEOPLE[k].on && k !== me(ctx))
    : teamOf(ctx.PEOPLE, me(ctx));

export const manageable = (ctx: Ctx): PersonKey[] =>
  ORGWIDE.includes(roleOf(ctx.PEOPLE, me(ctx))!)
    ? Object.keys(ctx.PEOPLE).filter(k => k !== me(ctx))
    : teamOfAll(ctx.PEOPLE, me(ctx));

/* you may only change or remove someone whose current seat is already inside your own access */
export const canManage = (ctx: Ctx, k: PersonKey): boolean => {
  const s = roleOf(ctx.PEOPLE, k);
  return k !== me(ctx) && !!s && canGrant(ctx, s) && manageable(ctx).includes(k);
};

/* would appointing k under m cost them anything, or double back on itself? */
export type MoveCost = { ok: boolean; lose: string[]; cycle?: boolean };

export function moveCost(PEOPLE: People, k: PersonKey, m: PersonKey | null, GRANT?: Grants): MoveCost {
  if (!m) return { ok: true, lose: [] };
  if (m === k || chainOf(PEOPLE, m).concat([m]).indexOf(k) >= 0) return { ok: false, cycle: true, lose: [] };
  const up = new Set(seatReach(PEOPLE, m)), upc = chainOf(PEOPLE, m);
  let allow = seatReach(PEOPLE, k).filter(p => up.has(p));
  upc.forEach(x => { const u = new Set(seatReach(PEOPLE, x)); allow = allow.filter(p => u.has(p)); });
  /* against what they REACH today, not what the seat asks for — otherwise a person who already has
     a clash can never be moved to a manager who would fix half of it. */
  const lose = reachBase(PEOPLE, k, GRANT).filter(p => allow.indexOf(p) < 0);
  return { ok: !lose.length, lose };
}

/* what a seat would ask for that this person's chain cannot reach — the same test setMgr makes,
   from the other end, so the two controls cannot disagree about what is allowed */
export function seatClash(PEOPLE: People, k: PersonKey, seat: SeatKey): string[] {
  const up = chainOf(PEOPLE, k);
  return (((SEATSCREENS as Record<string, readonly string[]>)[seat]) || [])
    .filter(pg => !up.every(m => seatReach(PEOPLE, m).indexOf(pg) >= 0));
}

/* ---- seat shorthands ------------------------------------------------------------------------ */

export const isIR = (ROLE: SeatKey): boolean => (IR as readonly string[]).includes(ROLE);
export const isFin = (_ROLE: SeatKey): boolean => false; // Finance writes only in its separate portal.
/** A page permission never gives an IR the Finance history of another person's book. */
export const canReadFinance = (ctx: Ctx, l: Lead | null | undefined, page: "pay" | "docs"): boolean => {
  const canonical = l && ctx.LEADS.find(x => x.id === l.id);
  const role = roleOf(ctx.PEOPLE,me(ctx));
  return !!canonical && may(ctx, page, "view") && openable(ctx).some(x => x.id === canonical.id)
    && (role !== "ir" || (!!canonical.own && inBook(ctx, canonical)))
    && (role !== "conv" || (!!canonical.own && !!ctx.PEOPLE[canonical.own]
      && (canonical.own === me(ctx) || chainOf(ctx.PEOPLE,canonical.own).includes(me(ctx)))));
};

export const financeBook = (ctx: Ctx, page: "pay" | "docs"): Lead[] =>
  openable(ctx).filter(l => canReadFinance(ctx, l, page));

export const canViewInvestorCopy = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  const canonical = l && ctx.LEADS.find(x => x.id === l.id);
  const role = roleOf(ctx.PEOPLE,me(ctx)), ir = role === "ir";
  if (role === "cp") return false;
  const pay = canReadFinance(ctx,canonical,"pay"), docs = canReadFinance(ctx,canonical,"docs");
  return !!canonical && openable(ctx).some(x => x.id === canonical.id)
    && (!ir || (!!canonical.own && inBook(ctx,canonical)))
    && (ir ? pay && docs : pay && docs || may(ctx,"xfer","view"));
};

/** With no record this guards organisational totals, which an IR's held-lead view does not grant. */
export const seeMoney = (ctx: Ctx, l?: Lead | null): boolean => l
  ? canReadFinance(ctx, l, "pay") : !["ir","conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "") && may(ctx, "pay", "view");

/** ir-console-redesigned.html:4227. The two seats whose read of Finance's record is scoped to
 *  their own book, never the reveal-a-reference seats however wide `seeMoney` reads for them. */
export const scopedFinanceReader = (ctx: Ctx): boolean =>
  ["ir", "conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "");

/** Bank and executed-signature identifiers remain Finance-only in the IR mirror. */
export const financeReference = (ctx: Ctx, value: string | null | undefined): string =>
  !value ? "—" : ["ir","conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "") && !/^ARL-INV-\d+$/i.test(value) ? "Finance only" : value;

export const financeBankReference = (ctx: Ctx, value: string | null | undefined): string => {
  const ref = (value || "").trim();
  return !ref || ref === "—" ? "—" : !["ir","conv"].includes(roleOf(ctx.PEOPLE,me(ctx)) || "") ? ref : ref.length <= 4 ? "••••" : "••• " + ref.slice(-4);
};

/* the Team scope lists other people's leads, so those leads must be openable — read-only */
export const seesTeam = (ctx: Ctx): boolean =>
  roleOf(ctx.PEOPLE, me(ctx)) !== "cp" && may(ctx, "leads", "view") && reachOf(ctx, me(ctx)).indexOf("teamscope") >= 0;

/* Reassigning is its own right, not a flavour of editing — the manual treats them separately and
   so does the grid, so a manager can take one away without taking the other. */
export const canAssign = (ctx: Ctx): boolean =>
  may(ctx, "leads", "assign") && ["conv", "ops"].includes(roleOf(ctx.PEOPLE, me(ctx)) as string); /* merged ir-merged.js:1657 */

/* the roster is an execution control, so the Ops Lead, IR lead, Digital and the BU Owner hold it —
   and everybody may always say where they themselves are, which is not a permission worth having.

   Ported verbatim from ir-console-redesigned.html:3690 — `consoleAccount(me()) && (k===me() ||
   canRoster())` — the bare capability, with no check that `k` is inside the caller's own
   management chain. An earlier revision of this port added `manageable(ctx).includes(k)` to keep
   the write inside a reporting line, but that is a narrower rule than the prototype ships, and the
   builder task asked this be aligned rather than left as a local decision. */
export const canRoster = (ctx: Ctx): boolean => may(ctx, "people", "roster");
export const canRosterFor = (ctx: Ctx, k: PersonKey): boolean =>
  consoleAccount(ctx.PEOPLE, me(ctx), ctx.CAPS) && (k === me(ctx) || canRoster(ctx));

export function canEdit(ctx: Ctx, lead: Lead | null | undefined): boolean {
  const l = lead && ctx.LEADS.find(x=>x.id === lead.id);
  if (!l || !l.own) return false;
  if (!openable(ctx).some(x => x.id === l.id)) return false;
  if (!may(ctx, "leads", "edit")) return false;   /* the grid is the outer gate; custody is the inner one */
  /* a lead closed as lost has exactly one control left, and re-opening it is not editing it —
     every other write is refused here rather than at twenty call sites that would drift apart */
  if (lost(l)) return false;
  if (custodian(l) === "Closed") return false;             /* every rung done — the record stands */
  return inBookOf(ctx, l) || ["conv", "ops"].includes(roleOf(ctx.PEOPLE, me(ctx))!);
}

/* the IR's own controls — the tick lists and the call log are theirs and nobody else's */
export const canWork = (ctx: Ctx, l: Lead | null | undefined): boolean => canEdit(ctx, l);

export const canDecideMove = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  canOperateLeads(ctx) && !!l && openable(ctx).some(x => x.id === l.id)
  && (canAssign(ctx) || me(ctx) === (P(ctx.PEOPLE, l.own).mgr ?? null));

export const canDecideExt = (ROLE: SeatKey): boolean => ROLE === "bu";  /* manual Table 15 — the BU Owner, and nobody else */

export const canRecov = (ctx: Ctx): boolean => may(ctx, "goals", "edit");  /* manual Table 22: BU Owner / Operations */

/* Finance and Digital hold this jointly with the farm interface (manual Table 22) */
export const canInv = (ROLE: SeatKey): boolean =>
  isFin(ROLE) || ROLE === "ops";   /* Finance with the farm interface; Digital keeps the field */

/* ---- the nav ---------------------------------------------------------------------------------
   the gate on every route, not merely on every link: a page the seat cannot reach is refused in
   the layout as well as hidden in the rail (PORT-GUIDE, "Routing"). */
export const navForIR = (ctx: Ctx): NavItem[] => {
  const g = tempOn(ctx), mine = grantedPages(ctx.CAPS, me(ctx));
  /* NAV.roles is the default; a page granted by name is reached by name (D60) */
  return (NAV as readonly NavItem[]).filter(n =>
    n.k !== "me" && ((n.roles as readonly string[]).includes(roleOf(ctx.PEOPLE, me(ctx))!) || mine.includes(n.k) || (!!g && (g.page as string) === n.k))
    && may(ctx, n.k, "view")) as NavItem[];
};

/* ---- ONE CONSOLE (merge-glue.js 7-49) ----------------------------------------------------------
   The Investors side's pages join the rail: a page on both sides is one entry, a person holding only
   the Investors half gets it as an Investors page, and the four Investors-only pages form their own
   band. `sidesOf` answers which halves a person holds of an entry. */
export const MT: Record<string, string> = {today:"Today", pay:"Payments", docs:"Documents", activity:"Activity", people:"Teams", system:"System",
  inv:"Investors", farms:"Farms", tkt:"Tickets", invupd:"Investor updates", numbers:"Numbers"};
export const MORDER = ["today","leads","activity","events","inv","farms","tkt","invupd","pay","docs","xfer",
  "goals","numbers","people","system","me","updates"];
/** fuller — only the Investors half shows; section — the Investors half is a section of the lead page */
export const MBOTH: Record<string, "fuller" | "section"> = {pay:"fuller", docs:"fuller", people:"section"};
export const imReachOf = (ctx: Ctx): string[] =>
  ctx.IM && ctx.WHO ? imReach({ data: ctx.IM }, ctx.WHO) : [];
export const sidesOf = (ctx: Ctx, k: string): { ir: boolean; im: boolean } => ({
  ir: navForIR(ctx).some(n => n.k === k),
  im: !!MERGE[k] && imReachOf(ctx).includes(MERGE[k]),
});
export const navFor = (ctx: Ctx): NavItem[] => {
  const base = navForIR(ctx), im = imReachOf(ctx);
  if (!im.length) return base;
  const have = new Set<string>(base.map(n => n.k)), add: NavItem[] = [];
  Object.keys(MERGE).forEach(k => { if (im.includes(MERGE[k]!) && !have.has(k)) add.push({ k: k as NavKey, t: MT[k]!, roles: [], im: true }); });
  if (!add.length) return base;
  return base.concat(add).sort((a, b) => MORDER.indexOf(a.k) - MORDER.indexOf(b.k));
};

export const canReach = (ctx: Ctx, k: NavKey): boolean => k === "me" ? may(ctx, "me", "view") : navFor(ctx).some(n => n.k === k);

/* Change 6 — the one gate every clickthrough to Leads shares, on Numbers, Plan and anywhere else
   a count wants to become a button: a seat that cannot reach Leads, or whose Team scope does not
   cover the names behind a count, must never see a control for one (`NumbersLive`'s own tiles
   already read exactly this pair; this is that gate, named once so nothing else inlines a second
   copy of it). */
export const hasLeads = (ctx: Ctx): boolean => canReach(ctx, "leads") && seesTeam(ctx);

/* The shell and reducer ask the same gate before rendering a drawer or accepting its draft. */
export function canOpenDrawer(ctx: Ctx, kind: string, id: string | null): boolean {
  if (!accountAllowed(ctx)) return false;
  if (kind === "help") return true;
  /* "account" is always about the signed-in person — no id to check. "updates" is the bell: a
     page-owned drawer body, but a leadless one. A "p:" panel delegates to whatever page registers
     it — its own registerDrawer body decides, the same as any other page-owned screen. */
  if (kind === "account") return true;
  if (kind === "updates") return may(ctx, "updates", "view");
  if (kind.startsWith("p:")) return true;
  if (kind === "presence") return may(ctx, "me", "view");
  /* a book that holds nobody (live: the people are GET /api/teams, not the store) leaves the member to GET /api/teams/{id}, which answers 403
     cannot-open for anyone the viewer may not open — the row only offers a name the list let them open (M17-S01-W2) */
  if (kind === "person" && !Object.keys(ctx.PEOPLE).length) return !!id;
  if (kind === "person") return !!id && !!ctx.PEOPLE[id]?.on
    && (id === me(ctx) ? may(ctx, "me", "view") : may(ctx, "people", "view") && canManage(ctx, id));
  if (kind === "absence") return !!id && !!ctx.PEOPLE[id]?.on
    && (id === me(ctx) ? may(ctx, "me", "view") : may(ctx, "people", "view"))
    && canRosterFor(ctx, id);
  if (kind === "temp" || kind === "newp") return may(ctx, "people", "view") && own(ctx, "people", "seats");
  if (kind === "leaver") return !!id && leaverMayManage(ctx, id);
  if (kind === "recov") return may(ctx, "numbers", "view");
  if (kind === "check") return may(ctx, "system", "view");
  const lead = id ? ctx.LEADS.find(l => l.id === id) : null;
  if (kind === "investorcopy" && !canViewInvestorCopy(ctx,lead)) return false;
  if (["money", "claim"].includes(kind) && !canReadFinance(ctx, lead, "pay")) return false;
  if (kind === "acct" && !(canReadFinance(ctx,lead,"pay") || canReadFinance(ctx,lead,"docs"))) return false;
  if (kind === "paper" && !canReadFinance(ctx, lead, "docs")) return false;
  return !!id && openable(ctx).some(l => l.id === id);
}

/* the pages that can be lent — never your own profile, and never a page with no capabilities */
export const lendablePages = (ctx: Ctx): string[] =>
  reachBase(ctx.PEOPLE, me(ctx), ctx.CAPS)
    .filter(x => x !== "me" && !!(PAGECAPS as Record<string, unknown>)[x]);

/* ===== STAFF LEAVING =========================================================================
   Leaving the team is one reviewed write: the entire modeled IR book moves before access ends.
   Historical authors and commercial records are never rewritten by a staff handover — only who
   is responsible for the work going forward. `leaverPlan` is the whole of the decision; the write
   itself (`removePerson`) is the store's, and it must refuse unless the plan it re-checks still
   carries no error and still matches the reviewed `signature`.
   ========================================================================================== */
export const leaverMayManage = (ctx: Ctx, k: PersonKey): boolean =>
  !!ctx.PEOPLE[k] && ctx.PEOPLE[k].on !== false && !ctx.PEOPLE[k].ext
  && own(ctx, "people", "seats") && canManage(ctx, k);

/* whose ownership counts as "inside your team" for the handover's own affected-records check */
export const leaverInScope = (ctx: Ctx, k: PersonKey | null | undefined): boolean =>
  !k || k === me(ctx) || ["ops", "exec"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "")
  || manageable(ctx).includes(k);

/* an IR teammate, not the leaver themselves, not external, and inside the manager's own scope —
   never the port's broader `assignees`, which also hands leads to Channel Partners */
export const leaverSuccessors = (ctx: Ctx, k: PersonKey): PersonKey[] =>
  canAssign(ctx)
    ? Object.keys(ctx.PEOPLE).filter(x => x !== k && ctx.PEOPLE[x].on !== false
        && roleOf(ctx.PEOPLE, x) === "ir" && !ctx.PEOPLE[x].ext && leaverInScope(ctx, x))
    : [];

export type LeaverPlan = {
  k: PersonKey;
  to: PersonKey | null;
  owned: Lead[];
  affected: Lead[];
  coverKeys: PersonKey[];
  kids: PersonKey[];
  up: PersonKey | null;
  secondary: number;
  covers: number;
  needsSuccessor: boolean;
  error: string;
  /** What was reviewed. The write refuses unless a fresh plan still produces this exact string. */
  signature: string;
};

export function leaverPlan(ctx: Ctx, k: PersonKey, to: PersonKey | null): LeaverPlan {
  const PEOPLE = ctx.PEOPLE, LEADS = ctx.LEADS;
  const owned = LEADS.filter(l => l.own === k);
  const coverKeys = Object.keys(ctx.COVER).filter(x => x === k || ctx.COVER[x]?.by === k);
  const affected = LEADS.filter(l =>
    l.own === k || l.sec === k || l.cov?.by === k || (!!l.own && coverKeys.includes(l.own)));
  const kids = Object.keys(PEOPLE).filter(x => PEOPLE[x].mgr === k);
  const up = mgrOf(PEOPLE, k);
  const secondary = LEADS.filter(l => l.sec === k).length;
  const covers = LEADS.filter(l => l.cov?.by === k).length + coverKeys.filter(x => x !== k).length;
  const needsSuccessor = affected.length > 0 || coverKeys.some(x => x !== k);

  let error = "";
  if (!leaverMayManage(ctx, k)) error = "You cannot remove this member from your team.";
  else if (owned.length && !["ir", "conv"].includes(roleOf(PEOPLE, k) || ""))
    error = "This member holds records outside the modeled IR handover. Resolve their ownership before removing them.";
  else if (needsSuccessor && !canAssign(ctx))
    error = "Lead-assignment permission is required to hand over this member's work.";
  else if (affected.some(l => !l.id || !leaverInScope(ctx, l.own)
      || (!!l.own && (!PEOPLE[l.own] || !["ir", "conv"].includes(roleOf(PEOPLE, l.own) || ""))))
    || new Set(LEADS.map(l => l.id)).size !== LEADS.length
    || coverKeys.some(x => !PEOPLE[x] || !leaverInScope(ctx, x)))
    error = "Some affected records are outside your team or need their ownership corrected. The whole handover must be resolved together.";
  else if (up && (!PEOPLE[up] || PEOPLE[up].on === false || up === k))
    error = "Choose an active reporting manager before removing this member.";
  else if (kids.some(x => !moveCost(PEOPLE, x, up, ctx.CAPS).ok))
    error = "Moving the reports up would remove access they need. Resolve their reporting manager first.";
  else if (needsSuccessor && !to) error = "Choose the teammate who will receive this work.";
  else if (to && !leaverSuccessors(ctx, k).includes(to))
    error = "Choose an active IR teammate within your assignment scope.";

  const signature = JSON.stringify({
    k, to: to || null,
    source: PEOPLE[k] && [PEOPLE[k].on, PEOPLE[k].seat, up],
    target: to && PEOPLE[to] && [PEOPLE[to].on, PEOPLE[to].seat, PEOPLE[to].mgr],
    leads: affected.map(l => [l.id, l.own || null, l.sec || null, l.cov || null]),
    cover: coverKeys.map(x => [x, ctx.COVER[x]]),
    kids: kids.map(x => [x, PEOPLE[x].mgr, PEOPLE[x].on]),
  });
  return { k, to, owned, affected, coverKeys, kids, up, secondary, covers, needsSuccessor, error, signature };
}
