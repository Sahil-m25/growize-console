/* M17-S01-W1 — the Teams page from Zoho: GET /api/teams (members, Investors side seats, rights grid) and
   GET /api/teams/{id} (one member). Live: the route, on the viewer's own token (server/teams: the IR Manager
   sees herself and her reporting chain, Finance/AM/KAM/viewers the Investors side seats, Digital Infrastructure
   everyone). Fixture: the same rows projected from the demo book with the selectors the screens used. */

import type { NavKey, PersonKey, SeatKey } from "@/domain";
import { PAGECAPS, SEAT } from "@/domain";
import type { ConsoleState } from "@/lib/state";
import { canManage, capDevOf, clashOf, consoleAccount, hasCap, manageable, mgrOf, navFor, P, reachOf, teamName, teamOfPerson, type CapDeviation, type Grants } from "@/lib/selectors";
import { availCover, availStatus } from "@/features/people/helpers";
import { bookOf, isSys, may, maySeat, pageReadable, role, ROLE, teamOf, who, type ImCan, type ImRoleKey, type ImState } from "@/lib/im";
import type { GridColumn, InvestorsSeatRow, LeadMemberRow, MemberDetail, TeamsView } from "@/server/teams/teams";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

/** The parts of a lead member row the Members table draws. */
export type MemberRow = Pick<LeadMemberRow, "id" | "name" | "seatLabel" | "team" | "managerName" | "status" | "you" | "canOpen" | "investorsSide" | "loginHere" | "pages" | "leads">;
/** The parts of an Investors seat row "Who is here" draws. */
export type SeatRow = Pick<InvestorsSeatRow, "id" | "name" | "team" | "role" | "seatLabel" | "may" | "status" | "you" | "email" | "seatOptions" | "otherTeam" | "accounts">;
/** One column of "What each seat holds": an Investors seat and its rights. */
export type GridCol = Pick<GridColumn, "im" | "imLabel" | "rights">;
export type TeamsAnswer = {
  view: Pick<TeamsView, "canChangeSeats" | "activeMembers"> & { members: MemberRow[] | null; investorsSide: SeatRow[] | null };
  grid: { columns: GridCol[] };
};

/* The Investors seats a Zoho seat can be written as (server/access/seat-change IM_SEAT_TO_ZOHO: every seat with a
   non-Administrator Zoho role), less the super user's. The Auditor and Administrator seats have no D80 role. */
const WRITABLE: readonly ImRoleKey[] = ["head", "ops", "comp", "amlead", "kam"];

/** The screens they reach (features/people screensOf: the reach, less no-page routes, where they hold "view"). */
const pagesOf = (s: ConsoleState, k: PersonKey): number => reachOf(s, k).filter((p) => !PAGECAPS[p as NavKey]?.nopage && hasCap(s, k, p, "view")).length;

/** The lead side's Members rows: the viewer and everyone they manage (vMembers' scope). */
export function fixtureMembers(s: ConsoleState): MemberRow[] | null {
  if (!s.PEOPLE[s.WHO] || !navFor(s).some((n) => n.k === "people")) return null;
  const scope = [s.WHO, ...manageable(s).filter((k) => k !== s.WHO)];
  return scope.filter((k) => s.PEOPLE[k]).map((k): MemberRow => {
    const pp = s.PEOPLE[k]!, t = teamOfPerson(s.PEOPLE, k), m = mgrOf(s.PEOPLE, k);
    return {
      id: k, name: P(s.PEOPLE, k).n, seatLabel: SEAT[pp.seat as SeatKey] ?? "",
      team: t ? teamName(s.PEOPLE, t) : null, managerName: m ? P(s.PEOPLE, m).n : null,
      status: pp.on ? "active" : "left", you: k === s.WHO, canOpen: !!pp.on && canManage(s, k),
      investorsSide: !!pp.ext, loginHere: !!pp.on && consoleAccount(s.PEOPLE, k, s.CAPS),
      /* the screens they reach (features/people screensOf: the reach, less no-page routes, where they hold "view") */
      pages: pagesOf(s, k),
      leads: s.LEADS.filter((l) => l.own === k).length,
    };
  });
}

/** The Investors side seats (vTeam's "Who is here"). */
export function fixtureSeats(s: ImState, me: string): SeatRow[] | null {
  if (!pageReadable(s, me, "team")) return null;
  return s.data.SIGNINS.filter((k) => s.data.P[k]).map((k): SeatRow => {
    const w = who(s, k), r = ROLE[w.r];
    const you = k === me;
    const seatOptions = !you && w.r !== "root" && w.r !== "di" ? WRITABLE.filter((x) => x !== w.r && maySeat(s, me, k, x)) : [];
    const nb = bookOf(s, me, k).length;
    return {
      id: k, name: w.n, team: teamOf(s, k), role: w.r, seatLabel: role(s, k).t,
      may: (r ? r.can : []).filter((c) => c !== "view") as ImCan[],
      status: "active", you,
      email: you || may(s, me, "team") ? w.em ?? null : null,
      seatOptions, otherTeam: may(s, me, "team") && !you && seatOptions.length === 0,
      accounts: w.r === "kam" && (you || (!isSys(s, me) && may(s, me, "assign"))) ? nb : null,
    };
  });
}

/** Every Investors seat and what it holds — the prototype's columns (ROLE); live: the Zoho roles that carry one. */
export const fixtureGrid = (): TeamsAnswer["grid"] =>
  ({ columns: (Object.keys(ROLE) as ImRoleKey[]).map((r) => ({ im: r, imLabel: ROLE[r].t, rights: [...ROLE[r].can] })) });

export const teamsRead: ReadEndpoint<ConsoleState, void, TeamsAnswer> = {
  path: () => "/api/teams",
  pick(j) {
    const o = j as { view: TeamsView; grid: { columns: GridColumn[] } };
    const seen = new Set<string>();
    /* one column per Investors seat (several Zoho roles can carry none, and none carries two) */
    const columns = o.grid.columns.filter((c) => c.im && !seen.has(c.im) && !!seen.add(c.im)).map((c) => ({ im: c.im, imLabel: c.imLabel, rights: [...c.rights] }));
    return {
      view: {
        canChangeSeats: o.view.canChangeSeats, activeMembers: o.view.activeMembers,
        members: o.view.members ? [...o.view.members] : null, investorsSide: o.view.investorsSide ? [...o.view.investorsSide] : null,
      },
      grid: { columns },
    };
  },
  fixture(s) {
    const im: ImState = { data: s.IM, ui: s.IMUI };
    const members = fixtureMembers(s), investorsSide = fixtureSeats(im, s.WHO);
    /* server/teams teamsAccess: neither side → "no-teams" (an IR) */
    if (!members && !investorsSide) return fail(403, "no-teams", "Teams is for the people who look after seats and teams. Your manager can tell you who is on your team.");
    const active = members ? members.filter((r) => r.status === "active").length : (investorsSide ?? []).length;
    return ok({ view: { canChangeSeats: may(im, s.WHO, "team"), activeMembers: active, members, investorsSide }, grid: fixtureGrid() });
  },
};

/** The Investors side's half of GET /api/teams ("Investors side seats" on Teams): its rows and the rights grid.
 *  Book: the Investors side's own {s, me}, so the section renders wherever an Investors page does. */
export type SeatsAnswer = { investorsSide: SeatRow[] | null; grid: TeamsAnswer["grid"] };
export const teamSeats: ReadEndpoint<ImBook, void, SeatsAnswer> = {
  path: () => "/api/teams",
  pick(j) { const a = teamsRead.pick(j); return { investorsSide: a.view.investorsSide, grid: a.grid }; },
  fixture({ s, me }) {
    const rows = fixtureSeats(s, me);
    return rows ? ok({ investorsSide: rows, grid: fixtureGrid() })
      : fail(403, "no-teams", "Teams is for the people who look after seats and teams. Your manager can tell you who is on your team.");
  },
};


/* M17-S01-W2 — the person drawer: GET /api/teams/{id}. Live: the route, on the viewer's own token (server/teams memberDetail: only
   themselves, someone they manage, or an Investors seat they may read — anyone else 403 cannot-open). Fixture: the same answer from the
   demo book with the selectors the drawer used (availStatus/availCover, clashOf, capDevOf).
   PROVISIONAL (live): availability is only "Left the company" or "No absence is recorded" — Zoho keeps no absences (needs a source, D49);
   "Carries … as secondary" is not served. */
export type PersonView = {
  id: string; side: "lead" | "investors"; name: string; seatLabel: string; team: string | null; managerName: string | null; email: string | null;
  /** leads they own; null = not counted (the Investors side holds none) */
  leads: number | null;
  /** the lead screens they reach now */
  screens: number;
  clash: string[]; changed: CapDeviation[];
  availability: MemberDetail["availability"];
};
const NOT_OPENABLE = () => fail(403, "cannot-open", "You can open only the people inside your own access.");

export const teamMember: ReadEndpoint<ConsoleState, string | null, PersonView> = {
  path: (id) => (id ? `/api/teams/${encodeURIComponent(id)}` : null),
  pick(j) {
    const d = j as MemberDetail;
    const lead = d.side === "lead" ? (d.row as LeadMemberRow) : null;
    return {
      id: d.row.id, side: d.side, name: d.row.name, seatLabel: d.row.seatLabel, team: d.row.team, managerName: lead ? lead.managerName : null,
      email: d.email, leads: lead ? lead.leads : null, screens: d.pages.length, clash: [...d.clash], changed: d.changed.map((c) => ({ ...c, off: [...c.off], on: [...c.on] })),
      availability: d.availability,
    };
  },
  fixture(s, id) {
    const k = id as PersonKey;
    if (!id || !s.PEOPLE[k] || !s.PEOPLE[k]!.on || !(k === s.WHO || canManage(s, k))) return NOT_OPENABLE();
    const t = teamOfPerson(s.PEOPLE, k), m = mgrOf(s.PEOPLE, k), a = availStatus(s, k);
    return ok({
      id: k, side: "lead", name: P(s.PEOPLE, k).n, seatLabel: SEAT[s.PEOPLE[k]!.seat as SeatKey] ?? "", team: t ? teamName(s.PEOPLE, t) : null,
      managerName: m ? P(s.PEOPLE, m).n : null, email: P(s.PEOPLE, k).em || null, leads: s.LEADS.filter((l) => l.own === k).length, screens: pagesOf(s, k),
      clash: clashOf(s.PEOPLE, k), changed: capDevOf(s.PEOPLE, s.CAPS as Grants, k),
      availability: { out: a.out, soon: a.soon, detail: a.detail, cover: availCover(s, k) },
    });
  },
};
