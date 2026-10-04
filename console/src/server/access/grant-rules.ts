/**
 * M03-S02-T01 — WHO MAY GRANT WHAT TO WHOM: the prototype's toggleCap/capSave (ir-merged 6506-6536),
 * asked of the front end's own rules (`@/lib/selectors/access`: canManage, own, seatShape, reachCeil,
 * capsBase, capsFor, consoleAccount) over a small book of real Zoho people — the granter, the holder
 * and both manager chains, each seated from their Zoho role (seat.ts). Nothing is re-ported, so the
 * grid the screen draws and the refusal the server gives cannot disagree.
 *
 * Every refusal capSave makes is made here again, in the same order:
 *   cannot-manage   the holder is not inside the granter's reach (canManage) or the granter's seat
 *                   cannot change seats (own people·seats) — an IR Manager grants only their own IRs
 *   own-profile     a person's Profile is not anyone's to grant
 *   seat-cannot-hold  their role cannot hold it, whoever grants it (seatShape) — "edit" on Leads for Jhalak
 *   past-ceiling    past the holder's ceiling: their seat bounded by every manager above (reachCeil)
 *   not-held        never hand out what you do not hold yourself, or hold only on loan (capsBase)
 * Adding any capability adds "view"; taking "view" away takes the whole page (capSave).
 */

import type { Cap, CapGrid, Person, PersonKey } from "../../domain";
import { PAGECAPS } from "../../domain";
import { EMPTY_PLAN } from "../../lib/data/empty";
import { emptyImData } from "../../lib/im";
import { canManage, capsBase, capsFor, consoleAccount, own, reachCeil, seatShape, type Grants } from "../../lib/selectors/access";
import type { Ctx } from "../../lib/selectors/ctx";
import type { ZohoSeat } from "../oauth/seat";
import { superAdminMark, ZOHO_SEAT_SIDES } from "./policy";

/** One Zoho user as the Users API names them: id, seat (from role/profile ids) and manager. */
export interface SeatedPerson {
  readonly who: string;
  readonly seat: ZohoSeat;
  /** Reporting_To's Zoho user id, or null at the top */
  readonly mgr: string | null;
}

export type GrantOp = "add" | "remove" | "reset";

export interface GrantAsk {
  readonly op: GrantOp;
  readonly whom: string;
  readonly page: string;
  /** required for add/remove; ignored for reset */
  readonly cap?: string;
}

export type GrantRefusal = "bad-request" | "cannot-manage" | "own-profile" | "seat-cannot-hold" | "past-ceiling" | "not-held";

export const GRANT_REFUSALS: Readonly<Record<GrantRefusal, string>> = Object.freeze({
  "bad-request": "That is not a page and capability the console grants.",
  "cannot-manage": "You cannot change this person's access. Digital Infrastructure can.",
  "own-profile": "A person's own profile is not anyone's to grant.",
  "seat-cannot-hold": "Their role cannot hold this, whoever grants it.",
  "past-ceiling": "This page is past what their seat and their managers reach.",
  "not-held": "You cannot hand out what you do not hold yourself.",
});

export type GrantDecision =
  | {
    readonly ok: true;
    /** the holder's caps on this page from now on; null = the per-person grant is removed (reset) */
    readonly caps: readonly Cap[] | null;
    /** a short Plane C code: "<page>-<cap>-add" / "<page>-<cap>-remove" / "<page>-reset" */
    readonly code: string;
    /** the holder could sign in to the console before / after (a granted-only seat crossing the line) */
    readonly accountBefore: boolean;
    readonly accountAfter: boolean;
  }
  | { readonly ok: false; readonly refusal: GrantRefusal; readonly message: string; readonly code: string };

export interface GrantBook {
  /** the granter, the holder and everyone above either of them */
  readonly people: readonly SeatedPerson[];
  /** what each of them holds by name today (the granter's and the holder's at least) */
  readonly grants: Readonly<Record<string, CapGrid>>;
}

function bookOf(b: GrantBook): { PEOPLE: Record<PersonKey, Person>; GRANT: Record<PersonKey, CapGrid> } {
  const PEOPLE: Record<PersonKey, Person> = {};
  for (const p of b.people) {
    const lead = ZOHO_SEAT_SIDES[p.seat].lead;
    PEOPLE[p.who] = { n: "", i: "", seat: lead, mgr: p.mgr && b.people.some((q) => q.who === p.mgr) ? p.mgr : null, on: true, c: 1, em: "", ph: "",
      ...superAdminMark(p.who, lead) };
  }
  const GRANT: Record<PersonKey, CapGrid> = {};
  for (const k of Object.keys(PEOPLE)) GRANT[k] = { ...(b.grants[k] ?? {}) };
  return { PEOPLE, GRANT };
}

/** The front end's Ctx over a small book of seated people, seen by `by` (shared with seat and manager changes). */
export function ctxOf(by: string, b: GrantBook, now: Date): Ctx {
  const { PEOPLE, GRANT } = bookOf(b);
  return {
    WHO: by, ROLE: PEOPLE[by]?.seat ?? "exec", NOW: now, TODAY: now,
    PEOPLE, LEADS: [], LOG: [], EVENTS: [], DOCS: [],
    PLAN: structuredClone(EMPTY_PLAN), INV: { total: 0, released: 0, by: "", at: "", src: "" },
    CAPS: GRANT as Ctx["CAPS"], TEMP: [], TEMPON: null, COVER: {}, PAPER: {},
    SC: { today: "mine", leads: "mine", activity: "mine" } as Ctx["SC"],
    IM: emptyImData(now.toISOString()),
  };
}

const PAGE = (p: string): boolean => Object.prototype.hasOwnProperty.call(PAGECAPS, p) && !(PAGECAPS as Record<string, { nopage?: boolean }>)[p]!.nopage;
const CAP_OF = (p: string, c: string): c is Cap => ((PAGECAPS as Record<string, { caps: readonly string[] }>)[p]?.caps ?? []).includes(c);

/** Decide one grant change by `by` (the signed-in granter) over the book. Pure. */
export function decideGrant(by: string, ask: GrantAsk, b: GrantBook, now: Date = new Date(0)): GrantDecision {
  const page = typeof ask.page === "string" ? ask.page : "";
  const cap = typeof ask.cap === "string" ? ask.cap : "";
  const code = ask.op === "reset" ? `${page}-reset` : `${page}-${cap}-${ask.op}`;
  const no = (refusal: GrantRefusal): GrantDecision => ({ ok: false, refusal, message: GRANT_REFUSALS[refusal], code: /^[a-z][a-z0-9-]{0,47}$/.test(code) ? code : "bad-request" });
  if (!["add", "remove", "reset"].includes(ask.op) || !PAGE(page) || (ask.op !== "reset" && !CAP_OF(page, cap))) return no("bad-request");
  if (!b.people.some((p) => p.who === by) || !b.people.some((p) => p.who === ask.whom)) return no("cannot-manage");

  const ctx = ctxOf(by, b, now);
  const k = ask.whom;
  if (!canManage(ctx, k) || !own(ctx, "people", "seats")) return no("cannot-manage");
  if (page === "me") return no("own-profile");
  const before = consoleAccount(ctx.PEOPLE, k, ctx.CAPS as Grants);

  if (ask.op === "reset") {
    const rest = { ...(ctx.CAPS[k] as Record<string, Cap[]>) };
    delete rest[page];
    const after = consoleAccount(ctx.PEOPLE, k, { ...(ctx.CAPS as Grants), [k]: rest });
    return { ok: true, caps: null, code, accountBefore: before, accountAfter: after };
  }

  const c = cap as Cap;
  if (!seatShape(ctx.PEOPLE, k, page, [c]).includes(c)) return no("seat-cannot-hold");
  if (!reachCeil(ctx.PEOPLE, k).includes(page)) return no("past-ceiling");
  if (!capsBase(ctx, by, page).includes(c)) return no("not-held");

  /* capSave: start from what they hold on the page now, flip the one capability */
  const cur = capsFor(ctx, k, page).slice();
  const i = cur.indexOf(c);
  if (ask.op === "add" && i < 0) cur.push(c);
  if (ask.op === "remove" && i >= 0) cur.splice(i, 1);
  let caps: Cap[] = cur;
  if (c === "view" && ask.op === "remove") caps = [];              /* no capability survives losing the page */
  else if (caps.length && !caps.includes("view")) caps.push("view");
  const after = consoleAccount(ctx.PEOPLE, k, { ...(ctx.CAPS as Grants), [k]: { ...(ctx.CAPS[k] as Record<string, Cap[]>), [page]: caps } });
  return { ok: true, caps: Object.freeze(caps), code, accountBefore: before, accountAfter: after };
}
