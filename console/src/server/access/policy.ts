/**
 * SERVER ACCESS POLICY — who a Zoho user is on the console, and whether they sign in (M03-S01, D60/D68).
 *
 * T01  The policy itself (consoleAccount, seatShape, capsFor, hasCap, may, reachCeil) was ported once,
 *      by the front end, into `@/lib/selectors/access` and the door into `@/lib/data/admission`. This
 *      module does NOT re-port them: it maps the seat Zoho gives (seat.ts, read only from the Zoho
 *      user's role/profile ids, never a display field) onto the merged prototype's two sides — a lead
 *      seat (`SeatKey`) and an Investors seat (`ImRoleKey`) — builds the one-person book those
 *      functions read, and asks them. Server and screen therefore cannot disagree.
 * T02  `admitZohoSeat` is the callback's door: `signInAdmits` (either side admits) over that book. A
 *      refusal carries a code whose named message is SIGNIN_REFUSALS (oauth/user-session.ts).
 *
 * Grants are read through an injectable `GrantReader`: the runtimes pass the grant store's reader
 * (access/grants.ts, M03-S02); NO_GRANTS remains the fail-closed default for tests and doubles. Here the
 * seat's own ceiling applies; a grant CHANGE is bounded by the real manager chain (grant-service.ts).
 */

import type { Cap, CapGrid, Person, PersonKey, SeatKey } from "../../domain";
import { BYGRANT, NOSIGN } from "../../domain";
import { imAccount, leadAccount, signInAdmits } from "../../lib/data/admission";
import { EMPTY_PLAN } from "../../lib/data/empty";
import { emptyImData, ROLE, type ImCan, type ImData, type ImRoleKey } from "../../lib/im";
import { capsFor, consoleAccount, hasCap, may, reachBase, reachCeil, seatShape, type Grants } from "../../lib/selectors/access";
import type { Ctx } from "../../lib/selectors/ctx";
import { ZOHO_SEAT_POLICIES, type ZohoSeat } from "../oauth/seat";

/** One Zoho seat on the merged console's two sides. `im: null` = no Investors seat. */
export interface SeatSides {
  readonly lead: SeatKey;
  readonly im: ImRoleKey | null;
}

/**
 * D80 role → the merged prototype's seats (fixtures/book/people.ts + fixtures/im/demo.ts hold the
 * same pairs: Harsha fin+head, Meena fin+ops, Fahad fin+comp, Divya am+amlead, Imran am+kam,
 * Sahil ops+di, Pradeep corp+root). D80 has no Marketing, Auditor or Administrator (im) role, so no
 * Zoho user reaches the `mkt`, `audit` or `admin` seats; one "Compliance and Audit" role takes `comp`
 * (PROVISIONAL, jev decide 0.97).
 */
export const ZOHO_SEAT_SIDES: Readonly<Record<ZohoSeat, SeatSides>> = Object.freeze({
  "corporate-root": Object.freeze({ lead: "corp", im: "root" }),
  "business-unit-owner": Object.freeze({ lead: "bu", im: null }),
  "digital-infrastructure": Object.freeze({ lead: "ops", im: "di" }),
  "ir-manager": Object.freeze({ lead: "conv", im: null }),
  "investor-relations": Object.freeze({ lead: "ir", im: null }),
  "channel-partner": Object.freeze({ lead: "cp", im: null }),
  "head-of-finance": Object.freeze({ lead: "fin", im: "head" }),
  "finance-operations": Object.freeze({ lead: "fin", im: "ops" }),
  "compliance-audit": Object.freeze({ lead: "fin", im: "comp" }),
  "head-of-account-management": Object.freeze({ lead: "am", im: "amlead" }),
  "key-account-manager": Object.freeze({ lead: "am", im: "kam" }),
  viewer: Object.freeze({ lead: "exec", im: null }),
} satisfies Record<ZohoSeat, SeatSides>);

/** The pages Digital Infrastructure has granted this person by name ({page: caps}); M03-S02 stores them. */
export interface GrantReader {
  grantsOf(zohoUserId: string, leadSeat: SeatKey): CapGrid | Promise<CapGrid>;
}
/** Until grants are stored (M03-S02) nobody holds one: granted-only seats are refused. */
export const NO_GRANTS: GrantReader = Object.freeze({ grantsOf: () => ({}) });

/** A grant lookup that throws or answers nonsense counts as no grant (fail closed). */
export async function readGrants(reader: GrantReader, zohoUserId: string, leadSeat: SeatKey): Promise<CapGrid> {
  try {
    const g: unknown = await reader.grantsOf(zohoUserId, leadSeat);
    if (typeof g !== "object" || g === null || Array.isArray(g)) return {};
    const out: Record<string, Cap[]> = {};
    for (const [page, caps] of Object.entries(g)) {
      if (Array.isArray(caps)) out[page] = caps.filter((c): c is Cap => typeof c === "string");
    }
    return out as CapGrid;
  } catch {
    return {};
  }
}

/** The one-person book the front-end policy reads: this user on both sides, holding only their grants. */
export interface AccessBook {
  readonly PEOPLE: Record<PersonKey, Person>;
  readonly GRANT: Record<PersonKey, CapGrid>;
  readonly im: ImData;
  readonly SIGNINS: PersonKey[];
}

export function accessBook(who: PersonKey, sides: SeatSides, grants: CapGrid, imNowIso = "1970-01-01T00:00:00.000Z"): AccessBook {
  const nosign = (NOSIGN as readonly string[]).includes(sides.lead);
  const person: Person = {
    n: "", i: "", seat: sides.lead, mgr: null, on: true, c: 1, em: "", ph: "",
    /* the merged prototype marks the Investors-side staff `ext` on the lead record; NOSIGN never admits anyway */
    ...(nosign ? { ext: "the Investors pages" } : {}),
  };
  const im = emptyImData(imNowIso);
  if (sides.im) {
    im.P[who] = { n: "", i: "", r: sides.im, c: 1, em: "" };
    im.SIGNINS.push(who);
  }
  return { PEOPLE: { [who]: person }, GRANT: { [who]: grants }, im, SIGNINS: [who] };
}

/** Seats whose D80 profile is Administrator (seat.ts): never a console login. */
export const ADMINISTRATOR_SEATS: ReadonlySet<ZohoSeat> = new Set(
  Object.values(ZOHO_SEAT_POLICIES).filter((p) => p.administrator).map((p) => p.seat),
);

export type AdmissionRefusal = "no-seat" | "no-grant";

export type Admission =
  | {
    readonly ok: true;
    readonly lead: SeatKey;
    readonly im: ImRoleKey | null;
    /** which side's rules admitted them (both can) */
    readonly sides: { readonly leads: boolean; readonly investors: boolean };
  }
  | { readonly ok: false; readonly code: AdmissionRefusal; readonly reason: string };

/**
 * D60 door for one seated Zoho user. Administrator-profile seats (CEO, Digital Infrastructure in D80)
 * are refused before the policy is asked — CLAUDE.md bans Administrator tokens in the app (seat.ts
 * refuses them first; this is the second lock).
 */
export function admitZohoSeat(seat: ZohoSeat, who: string, grants: CapGrid): Admission {
  const sides = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_SIDES, seat) ? ZOHO_SEAT_SIDES[seat] : undefined;
  if (!sides) return { ok: false, code: "no-seat", reason: "unknown-role" };
  if (ADMINISTRATOR_SEATS.has(seat)) return { ok: false, code: "no-seat", reason: "administrator-profile" };
  const book = accessBook(who, sides, grants);
  if (signInAdmits(book, who)) {
    return {
      ok: true, lead: sides.lead, im: sides.im,
      sides: { leads: leadAccount(book.PEOPLE, book.GRANT, who), investors: imAccount(book.PEOPLE, book.im, who) },
    };
  }
  return (BYGRANT as readonly string[]).includes(sides.lead) && sides.im === null
    ? { ok: false, code: "no-grant", reason: "no-grant" }
    : { ok: false, code: "no-seat", reason: "no-console-seat" };
}

/** The Ctx the lead-side gates read for this one signed-in person (no records, no loans). */
export function accessCtx(who: PersonKey, sides: SeatSides, grants: CapGrid, now: Date): Ctx {
  const b = accessBook(who, sides, grants, now.toISOString());
  return {
    WHO: who, ROLE: sides.lead, NOW: now, TODAY: now,
    PEOPLE: b.PEOPLE, LEADS: [], LOG: [], EVENTS: [], DOCS: [],
    PLAN: structuredClone(EMPTY_PLAN), INV: { total: 0, released: 0, by: "", at: "", src: "" },
    CAPS: b.GRANT as Ctx["CAPS"], TEMP: [], TEMPON: null, COVER: {}, PAPER: {},
    SC: { today: "mine", leads: "mine", activity: "mine" } as Ctx["SC"],
    IM: b.im,
  };
}

/** What a seated Zoho user may do — the front end's own functions over the one-person book. */
export interface SeatAccess {
  readonly admission: Admission;
  /** lead side: reachCeil (the most they could be granted) and reachBase (what they reach now) */
  readonly ceiling: string[];
  readonly reach: string[];
  capsFor(page: string): Cap[];
  may(page: string, cap: Cap): boolean;
  hasCap(page: string, cap: Cap): boolean;
  seatShape(page: string, caps: readonly Cap[]): Cap[];
  /** Investors side: the seat's `can` list, empty without an Investors seat */
  imCan(can: ImCan): boolean;
}

export function seatAccess(seat: ZohoSeat, who: string, grants: CapGrid, now: Date = new Date(0)): SeatAccess {
  const admission = admitZohoSeat(seat, who, grants);
  const sides = ZOHO_SEAT_SIDES[seat];
  const ctx = accessCtx(who, sides, grants, now);
  const g = ctx.CAPS as Grants;
  const lead = admission.ok && consoleAccount(ctx.PEOPLE, who, g);
  return Object.freeze({
    admission,
    ceiling: reachCeil(ctx.PEOPLE, who),
    reach: lead ? reachBase(ctx.PEOPLE, who, g) : [],
    capsFor: (p: string) => (lead ? capsFor(ctx, who, p) : []),
    may: (p: string, c: Cap) => lead && may(ctx, p, c),
    hasCap: (p: string, c: Cap) => lead && hasCap(ctx, who, p, c),
    seatShape: (p: string, caps: readonly Cap[]) => seatShape(ctx.PEOPLE, who, p, caps),
    imCan: (c: ImCan) => admission.ok && sides.im !== null && ROLE[sides.im].can.includes(c),
  });
}
