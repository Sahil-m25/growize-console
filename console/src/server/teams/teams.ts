/**
 * M17-S01-T01 — TEAMS FROM ZOHO: members, seats, teams and the rights grid (D40/D53/D59/D60/D68).
 *
 * Pure. Given the Zoho Users answer (GET /users?type=AllUsers, every page), the roles and profiles
 * (GET /settings/roles, /settings/profiles) and what the grant store holds, it builds what the Teams
 * page reads — and nothing a seat may not see:
 *
 *   seatOrg        every Zoho user seated exactly as the sign-in door seats them (seat.ts
 *                  resolveDirectoryUser: pinned role/profile ids; Administrator seats named). A
 *                  deactivated user is seated from the role they still hold and marked `left`.
 *   teamsAccess    who may open Teams and what they see, asked of the front end's own rules (never
 *                  re-ported): the lead side through `reachForSides`/`manageable`/`canManage`
 *                  (`@/lib/selectors`), the Investors side through `pageReadable`/`may`/`maySeat`
 *                  (`@/lib/im`). IR Manager = herself and her reporting chain (leavers included);
 *                  Head of Finance / AM / KAM = the Investors side seats; Digital Infrastructure =
 *                  everyone on both sides. An IR (or anyone reaching neither page) is refused.
 *   teamsView      the rows. Emails only on Investors side rows, and only the viewer's own unless the
 *                  viewer may change seats (the prototype's vTeam); lead rows carry none (vMembers);
 *                  phones never. A leaver still holding leads or accounts is flagged for handover.
 *   rightsGrid     one column per D80 seat, built from the Zoho roles and profiles and checked against
 *                  the pinned ids (drift named, never trusted); rows are the Investors rights (CAN).
 *
 * Nothing here logs or caches. PROVISIONAL: a Zoho user whose `status` is anything but "active"
 * (v8 "disabled"/"deleted") counts as left — confirm the deactivated value on the sandbox.
 */

import type { Cap, CapGrid, Person, PersonKey, SeatKey } from "../../domain";
import { NOSIGN, SEAT } from "../../domain";
import { CAN, emptyImData, maySeat, may as imMay, pageReadable, ROLE, TEAM, type ImCan, type ImRoleKey } from "../../lib/im";
import { EMPTY_PLAN } from "../../lib/data/empty";
import { canManage, capDevOf, chainOf, clashOf, consoleAccount, manageable, reachBase, teamName, teamOfPerson, type CapDeviation, type Grants } from "../../lib/selectors/access";
import type { Ctx } from "../../lib/selectors/ctx";
import type { ZohoProfileRow, ZohoRoleRow } from "../../lib/zoho/client";
import { reachForSides, seatPresets } from "../access/guard-core";
import { ZOHO_SEAT_SIDES } from "../access/policy";
import { IM_SEAT_TO_ZOHO } from "../access/seat-change";
import { ZOHO_SEAT_POLICIES, type ZohoProfileName, type ZohoRoleName, type ZohoSeat, type ZohoSeatDirectory } from "../oauth/seat";
import { CONSOLE_SEAT } from "../oauth/user-session";

const USER_ID = /^\d{15,25}$/;
const MAX_NAME = 200;

/* ---- the org ---------------------------------------------------------------------------------- */

export interface OrgMember {
  readonly id: string;
  readonly name: string;
  /** held in memory for the one response that may show it; never logged or cached */
  readonly email: string;
  readonly seat: ZohoSeat;
  readonly mgr: string | null;
  readonly left: boolean;
}

export interface Org {
  readonly members: readonly OrgMember[];
  /** Zoho users with no console seat (an unknown role, profile drift, a non-human user) — a count only */
  readonly unseated: number;
}

const str = (v: unknown, max = MAX_NAME): string => (typeof v === "string" ? v.slice(0, max) : "");

function managerOf(u: Record<string, unknown>): string | null {
  for (const key of ["Reporting_To", "reports_to"]) {
    const m = u[key];
    const id = typeof m === "object" && m !== null ? (m as { id?: unknown }).id : undefined;
    if (typeof id === "string" && USER_ID.test(id)) return id;
  }
  return null;
}

/** Every Zoho user seated from their role/profile ids; leavers seated from the role they still hold. */
export function seatOrg(users: readonly unknown[], seats: ZohoSeatDirectory): Org {
  const resolve = seats.resolveDirectoryUser;
  const out: OrgMember[] = [];
  const seen = new Set<string>();
  let unseated = 0;
  for (const raw of users) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { unseated++; continue; }
    const u = raw as Record<string, unknown>;
    const left = u.status !== "active";
    /* a leaver is seated from the role they still hold: the same checks, status aside */
    const r = resolve ? resolve({ users: [left ? { ...u, status: "active" } : u] }) : null;
    if (!r || !r.ok || seen.has(r.value.userId)) { unseated++; continue; }
    seen.add(r.value.userId);
    const mgr = managerOf(u);
    out.push(Object.freeze({
      id: r.value.userId, name: str(u.full_name), email: str(u.email, 320), seat: r.value.seat,
      mgr: mgr === r.value.userId ? null : mgr, left,
    }));
  }
  const ids = new Set(out.map((m) => m.id));
  /* a manager Zoho did not list (not visible, unseated) is no manager here: the chain stops there */
  const members = out.map((m) => (m.mgr && !ids.has(m.mgr) ? Object.freeze({ ...m, mgr: null }) : m));
  return Object.freeze({ members: Object.freeze(members), unseated });
}

/* ---- the two books the front-end rules read ------------------------------------------------------ */

const initials = (n: string): string => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Lead side: every member as a Person (on = still active), with what each holds by name. */
export function leadCtx(viewer: string, org: Org, grants: Readonly<Record<string, CapGrid>>, now: Date): Ctx {
  const PEOPLE: Record<PersonKey, Person> = {};
  for (const m of org.members) {
    const lead = ZOHO_SEAT_SIDES[m.seat].lead;
    PEOPLE[m.id] = {
      n: m.name, i: initials(m.name), seat: lead, mgr: m.mgr, on: !m.left, c: 1, em: "", ph: "",
      ...((NOSIGN as readonly string[]).includes(lead) ? { ext: "the Investors pages" } : {}),
    } as Person;
  }
  const CAPS: Record<PersonKey, CapGrid> = {};
  for (const k of Object.keys(PEOPLE)) CAPS[k] = { ...(grants[k] ?? {}) };
  return {
    WHO: viewer, ROLE: PEOPLE[viewer]?.seat ?? "exec", NOW: now, TODAY: now,
    PEOPLE, LEADS: [], LOG: [], EVENTS: [], DOCS: [],
    PLAN: structuredClone(EMPTY_PLAN), INV: { total: 0, released: 0, by: "", at: "", src: "" },
    CAPS: CAPS as Ctx["CAPS"], TEMP: [], TEMPON: null, COVER: {}, PAPER: {},
    SC: { today: "mine", leads: "mine", activity: "mine" } as Ctx["SC"],
    IM: emptyImData(now.toISOString()),
  };
}

/** Investors side: the active members holding an Investors seat (the prototype's SIGNINS). */
export function imCtxOf(org: Org, now: Date): { data: ReturnType<typeof emptyImData> } {
  const data = emptyImData(now.toISOString());
  for (const m of org.members) {
    const im = ZOHO_SEAT_SIDES[m.seat].im;
    if (!im || m.left) continue;
    data.P[m.id] = { n: m.name, i: initials(m.name), r: im, c: 1, em: "" };
    data.SIGNINS.push(m.id);
  }
  return { data };
}

/* ---- who may open Teams, and what they see ------------------------------------------------------- */

export type TeamsRefusal = "not-seated" | "seat-moved" | "no-teams";

export const TEAMS_REFUSALS: Readonly<Record<TeamsRefusal, string>> = Object.freeze({
  "not-seated": "Zoho does not list you as a console seat. Digital Infrastructure can check your role.",
  "seat-moved": "Your seat has changed in Zoho. Sign in again.",
  "no-teams": "Teams is for the people who look after seats and teams. Your manager can tell you who is on your team.",
});

export type TeamsAccess =
  | {
    readonly ok: true;
    readonly viewer: string;
    readonly seat: ZohoSeat;
    /** D68: Digital Infrastructure — every member on both sides */
    readonly superUser: boolean;
    /** lead-side list: the viewer and everyone they manage (leavers included); null = no lead Teams page */
    readonly leadScope: readonly string[] | null;
    /** Investors side seats: null = not shown to this seat */
    readonly imScope: readonly string[] | null;
    /** the Investors Team rule (may "team"): seat dropdowns, others' emails */
    readonly canChangeSeats: boolean;
    /** may assign a KAM (sees every KAM's account count) */
    readonly seesBooks: boolean;
  }
  | { readonly ok: false; readonly refusal: TeamsRefusal; readonly message: string };

/** The session's seat token must still be what Zoho says (a moved seat signs in again). */
function tokenMatches(seat: ZohoSeat, token: string): boolean {
  const t = CONSOLE_SEAT[seat];
  if (t !== null) return t === token;
  /* Administrator-profile seats have no console token yet (seat.ts); the lead-side DI token is the super user (D68, data/scope.ts). PROVISIONAL */
  return seat === "digital-infrastructure" && (token === "ops" || token === "di");
}

export function teamsAccess(viewer: string, token: string, org: Org, grants: Readonly<Record<string, CapGrid>>, now: Date = new Date(0)): TeamsAccess {
  const no = (refusal: TeamsRefusal): TeamsAccess => ({ ok: false, refusal, message: TEAMS_REFUSALS[refusal] });
  const me = org.members.find((m) => m.id === viewer);
  if (!me || me.left) return no("not-seated");
  if (!tokenMatches(me.seat, token)) return no("seat-moved");
  const sides = ZOHO_SEAT_SIDES[me.seat];
  const superUser = me.seat === "digital-infrastructure";

  const lead = reachForSides(sides, viewer, grants[viewer] ?? {}, now).pages.includes("people");
  let leadScope: string[] | null = null;
  if (lead) {
    const ctx = leadCtx(viewer, org, grants, now);
    leadScope = [viewer, ...manageable(ctx).filter((k) => k !== viewer)];
  }

  const im = imCtxOf(org, now);
  const imPage = sides.im !== null && pageReadable(im, viewer, "team");
  /* a viewer seat (Exec) holds no Investors seat but reads the Investors side seats, read only (M17-S01 acceptance) */
  const imScope = imPage || me.seat === "viewer" || superUser
    ? org.members.filter((m) => ZOHO_SEAT_SIDES[m.seat].im !== null || m.seat === "viewer").map((m) => m.id)
    : null;
  if (!leadScope && !imScope) return no("no-teams");
  const canChangeSeats = sides.im !== null && !!im.data.P[viewer] && imMay(im, viewer, "team");
  const seesBooks = sides.im !== null && !!im.data.P[viewer] && imMay(im, viewer, "assign");
  return Object.freeze({
    ok: true, viewer, seat: me.seat, superUser,
    leadScope: leadScope && Object.freeze(leadScope), imScope: imScope && Object.freeze(imScope), canChangeSeats, seesBooks,
  });
}

/** The members whose lead count / account count the page shows (to fetch them, scoped, in one go). */
export function countTargets(a: Extract<TeamsAccess, { ok: true }>, org: Org): { readonly owners: readonly string[]; readonly kams: readonly string[] } {
  const byId = new Map(org.members.map((m) => [m.id, m]));
  const owners = (a.leadScope ?? []).filter((id) => byId.has(id));
  const kams = (a.imScope ?? []).filter((id) => {
    const m = byId.get(id);
    return !!m && ZOHO_SEAT_SIDES[m.seat].im === "kam" && (a.seesBooks || id === a.viewer || m.left);
  });
  return Object.freeze({ owners: Object.freeze(owners), kams: Object.freeze(kams) });
}

/* ---- the rows ------------------------------------------------------------------------------------ */

export interface LeadMemberRow {
  readonly id: string;
  readonly name: string;
  readonly seat: ZohoSeat;
  readonly seatLabel: string;
  /** the team they are on (their manager's team, or their own when they manage), and the manager */
  readonly team: string | null;
  readonly managerId: string | null;
  readonly managerName: string | null;
  readonly status: "active" | "left";
  readonly you: boolean;
  /** the name is a button: only people the viewer manages (canManage), never a leaver */
  readonly canOpen: boolean;
  /** Works the Investors pages and holds no lead pages */
  readonly investorsSide: boolean;
  /** holds a lead-console account (false = "no login here") */
  readonly loginHere: boolean;
  readonly pages: number;
  /** leads they own, as the viewer's own token counts them; null = not counted */
  readonly leads: number | null;
  /** a leaver still owning leads or accounts */
  readonly handover: boolean;
}

export interface InvestorsSeatRow {
  readonly id: string;
  readonly name: string;
  readonly team: string;
  readonly seat: ZohoSeat;
  /** the Investors seat (null: a viewer seat, which holds none) */
  readonly role: ImRoleKey | null;
  readonly seatLabel: string;
  /** the rights the seat holds, less "view"; empty = read only */
  readonly may: readonly ImCan[];
  readonly status: "active" | "left";
  readonly you: boolean;
  /** only the viewer's own, unless the viewer may change seats (vTeam); never a phone */
  readonly email: string | null;
  /** seats this person may be moved to by the viewer (maySeat; Zoho-writable seats only). Empty = no control */
  readonly seatOptions: readonly ImRoleKey[];
  /** the viewer may change seats but not this one ("another team's seat") */
  readonly otherTeam: boolean;
  readonly accounts: number | null;
  readonly handover: boolean;
}

export interface TeamsView {
  readonly viewer: string;
  readonly seat: ZohoSeat;
  readonly superUser: boolean;
  readonly canChangeSeats: boolean;
  /** "you can change seats" / "read only" — the header tag */
  readonly header: "you can change seats" | "read only";
  readonly activeMembers: number;
  readonly members: readonly LeadMemberRow[] | null;
  readonly investorsSide: readonly InvestorsSeatRow[] | null;
  /** Zoho users with no console seat (super user only; a count) */
  readonly unseated: number | null;
}

export interface Counts {
  readonly leads: Readonly<Record<string, number>> | null;
  readonly accounts: Readonly<Record<string, number>> | null;
}

export function teamsView(a: Extract<TeamsAccess, { ok: true }>, org: Org, grants: Readonly<Record<string, CapGrid>>, counts: Counts, now: Date = new Date(0)): TeamsView {
  const byId = new Map(org.members.map((m) => [m.id, m]));
  const ctx = leadCtx(a.viewer, org, grants, now);
  const im = imCtxOf(org, now);
  const handover = (id: string) => byId.get(id)!.left && ((counts.leads?.[id] ?? 0) > 0 || (counts.accounts?.[id] ?? 0) > 0);

  const members = a.leadScope && a.leadScope.filter((id) => byId.has(id)).map((id): LeadMemberRow => {
    const m = byId.get(id)!;
    const p = ctx.PEOPLE[id]!;
    const t = teamOfPerson(ctx.PEOPLE, id);
    const mgr = m.mgr ? byId.get(m.mgr) ?? null : null;
    return Object.freeze({
      id, name: m.name, seat: m.seat, seatLabel: SEAT[p.seat as SeatKey] ?? "",
      team: t ? teamName(ctx.PEOPLE, t) : null, managerId: mgr?.id ?? null, managerName: mgr?.name ?? null,
      status: m.left ? "left" : "active", you: id === a.viewer,
      canOpen: !m.left && canManage(ctx, id),
      investorsSide: (NOSIGN as readonly string[]).includes(p.seat) && ZOHO_SEAT_SIDES[m.seat].im !== null,
      loginHere: !m.left && consoleAccount(ctx.PEOPLE, id, ctx.CAPS as Grants),
      pages: m.left ? 0 : reachBase(ctx.PEOPLE, id, ctx.CAPS as Grants).length,
      leads: counts.leads ? counts.leads[id] ?? 0 : null,
      handover: handover(id),
    });
  });

  const writable = Object.keys(IM_SEAT_TO_ZOHO) as ImRoleKey[];
  const investorsSide = a.imScope && a.imScope.filter((id) => byId.has(id)).map((id): InvestorsSeatRow => {
    const m = byId.get(id)!;
    const role = ZOHO_SEAT_SIDES[m.seat].im;
    const r = role ? ROLE[role] : null;
    const you = id === a.viewer;
    const seatOptions = !m.left && role && a.canChangeSeats ? writable.filter((x) => x !== role && maySeat(im, a.viewer, id, x)) : [];
    return Object.freeze({
      id, name: m.name, team: r ? TEAM[r.tm] : "Viewers", seat: m.seat, role,
      seatLabel: r ? r.t : SEAT[ZOHO_SEAT_SIDES[m.seat].lead] ?? "Viewer",
      may: Object.freeze(r ? r.can.filter((c) => c !== "view") : []),
      status: m.left ? "left" : "active", you,
      email: you || a.canChangeSeats ? m.email || null : null,
      seatOptions: Object.freeze(seatOptions),
      otherTeam: a.canChangeSeats && !you && !m.left && seatOptions.length === 0,
      accounts: counts.accounts && role === "kam" && Object.prototype.hasOwnProperty.call(counts.accounts, id) ? counts.accounts[id]! : null,
      handover: handover(id),
    });
  });

  const active = new Set([...(members ?? []), ...(investorsSide ?? [])].filter((r) => r.status === "active").map((r) => r.id));
  return Object.freeze({
    viewer: a.viewer, seat: a.seat, superUser: a.superUser, canChangeSeats: a.canChangeSeats || a.superUser,
    header: a.canChangeSeats || a.superUser ? "you can change seats" : "read only",
    activeMembers: members ? members.filter((r) => r.status === "active").length : active.size,
    members: members && Object.freeze(members), investorsSide: investorsSide && Object.freeze(investorsSide),
    unseated: a.superUser ? org.unseated : null,
  });
}

/* ---- one member in full -------------------------------------------------------------------------- */

export interface MemberDetail {
  readonly row: LeadMemberRow | InvestorsSeatRow;
  readonly side: "lead" | "investors";
  /** lead-side pages they reach now, and each page's caps held by name */
  readonly pages: readonly string[];
  readonly grants: Readonly<Record<string, readonly Cap[]>>;
  /** their managers, nearest first: ids and names (the shape of the org is not a secret) */
  readonly chain: readonly { readonly id: string; readonly name: string }[];
  readonly email: string | null;
  /** M17-S01-W2 — the lead pages their seat asks for that their managers cannot reach (page keys; empty = no clash) */
  readonly clash: readonly string[];
  /** M17-S01-W2 — what was changed from their seat by name, per page (the "N changed from the seat" tag) */
  readonly changed: readonly CapDeviation[];
  /** M17-S01-W2 — PROVISIONAL: Zoho records no absences, so only a leaver reads "out"; needs a Zoho source for availability (D49) */
  readonly availability: { readonly out: boolean; readonly soon: boolean; readonly detail: string; readonly cover: string };
}

export type DetailResult = { readonly ok: true; readonly detail: MemberDetail } | { readonly ok: false; readonly code: "cannot-open"; readonly message: string };

export const CANNOT_OPEN = "You can open only the people inside your own access.";

/** A member the viewer may open: themselves, someone they manage (lead side), or an Investors seat row they may read. */
export function memberDetail(a: Extract<TeamsAccess, { ok: true }>, org: Org, grants: Readonly<Record<string, CapGrid>>, view: TeamsView, id: string, now: Date = new Date(0)): DetailResult {
  const no: DetailResult = { ok: false, code: "cannot-open", message: CANNOT_OPEN };
  if (typeof id !== "string" || !USER_ID.test(id)) return no;
  const lead = view.members?.find((r) => r.id === id) ?? null;
  const inv = view.investorsSide?.find((r) => r.id === id) ?? null;
  const side: "lead" | "investors" | null = lead && (lead.you || lead.canOpen) ? "lead" : inv && inv.status === "active" ? "investors" : null;
  if (!side) return no;
  const ctx = leadCtx(a.viewer, org, grants, now);
  const byId = new Map(org.members.map((m) => [m.id, m]));
  const m = byId.get(id)!;
  const g = grants[id] ?? {};
  const own: Record<string, readonly Cap[]> = {};
  for (const [p, caps] of Object.entries(g)) own[p] = Object.freeze([...(caps as Cap[])]);
  const chain = chainOf(ctx.PEOPLE, id).filter((k) => byId.has(k)).map((k) => Object.freeze({ id: k, name: byId.get(k)!.name }));
  return {
    ok: true,
    detail: Object.freeze({
      row: side === "lead" ? lead! : inv!, side,
      pages: Object.freeze(m.left ? [] : reachBase(ctx.PEOPLE, id, ctx.CAPS as Grants)),
      grants: Object.freeze(own),
      chain: Object.freeze(chain),
      email: id === a.viewer || view.canChangeSeats ? m.email || null : null,
      clash: Object.freeze(m.left ? [] : clashOf(ctx.PEOPLE, id)),
      changed: Object.freeze(m.left ? [] : capDevOf(ctx.PEOPLE, ctx.CAPS as Grants, id).map((d) => Object.freeze({ ...d, off: Object.freeze([...d.off]) as Cap[], on: Object.freeze([...d.on]) as Cap[] }))),
      availability: Object.freeze(m.left
        ? { out: true, soon: false, detail: "Left the company", cover: "" }
        : { out: false, soon: false, detail: "No absence is recorded", cover: "" }),
    }),
  };
}

/* ---- the rights grid ------------------------------------------------------------------------------ */

export interface GridColumn {
  readonly seat: ZohoSeat;
  readonly roleName: ZohoRoleName;
  readonly profileName: ZohoProfileName;
  /** the role and profile as Zoho lists them today; null = not found */
  readonly roleId: string | null;
  readonly profileId: string | null;
  /** the listed role/profile id differs from the pinned one, or is missing: the column is the policy's, not Zoho's */
  readonly drift: boolean;
  readonly administrator: boolean;
  readonly lead: SeatKey;
  readonly leadLabel: string;
  readonly im: ImRoleKey | null;
  readonly imLabel: string | null;
  /** Investors rights this seat holds (CAN keys) */
  readonly rights: readonly ImCan[];
  /** lead-side pages the seat reaches with no grant (the rail) */
  readonly pages: readonly string[];
}

export interface RightsGrid {
  /** "zoho": built from /settings/roles and /settings/profiles; "pinned": Zoho could not be read, the pinned policy stands in */
  readonly source: "zoho" | "pinned";
  readonly columns: readonly GridColumn[];
  readonly rights: readonly { readonly key: ImCan; readonly label: string }[];
}

export interface PinnedSeatIds {
  readonly roleIds: Readonly<Record<ZohoRoleName, string>>;
  readonly profileIds: Readonly<Record<ZohoProfileName, string>>;
}

export function rightsGrid(roles: readonly ZohoRoleRow[] | null, profiles: readonly ZohoProfileRow[] | null, pinned: PinnedSeatIds, now: Date = new Date(0)): RightsGrid {
  const zoho = roles !== null && profiles !== null;
  const presets = seatPresets(now);
  const columns = (Object.keys(ZOHO_SEAT_POLICIES) as ZohoRoleName[]).map((roleName): GridColumn => {
    const p = ZOHO_SEAT_POLICIES[roleName];
    const role = roles?.find((r) => r.name === roleName) ?? null;
    const profile = profiles?.find((r) => r.name === p.profile) ?? null;
    const drift = zoho && (!role || role.id !== pinned.roleIds[roleName] || !profile || profile.id !== pinned.profileIds[p.profile]);
    const sides = ZOHO_SEAT_SIDES[p.seat];
    return Object.freeze({
      seat: p.seat, roleName, profileName: p.profile, roleId: role?.id ?? null, profileId: profile?.id ?? null,
      drift, administrator: p.administrator,
      lead: sides.lead, leadLabel: SEAT[sides.lead] ?? "", im: sides.im, imLabel: sides.im ? ROLE[sides.im].t : null,
      rights: Object.freeze(sides.im ? [...ROLE[sides.im].can] : []),
      /* DI is the super user's lead side (D68); its Administrator profile is not a console login of its own */
      pages: Object.freeze([...((p.seat === "digital-infrastructure" ? presets["super-user"] : presets[p.seat])?.pages ?? [])]),
    });
  });
  const rights = (Object.keys(CAN) as ImCan[]).map((key) => Object.freeze({ key, label: CAN[key] }));
  return Object.freeze({ source: zoho ? "zoho" : "pinned", columns: Object.freeze(columns), rights: Object.freeze(rights) });
}
