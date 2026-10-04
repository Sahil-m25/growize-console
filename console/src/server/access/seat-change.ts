/**
 * M03-S04-T02 — A SEAT CHANGE THROUGH THE GRANTS ENGINE (D40/D47/D53/D60): the prototype's setSeat
 * (lib/im/reducer.ts, imx vTeam) made on the server.
 *
 *   1. Both people are read from Zoho Users on the changer's own token (identity/users.ts), seated from
 *      their role/profile ids; the changer's session seat must still be what Zoho says (else refused).
 *   2. The front end's own rule decides it — `maySeat` from `@/lib/im`, not re-ported — over a two-person
 *      Investors book. On top, the server refuses what the screen must never offer: your own row, the
 *      super admin's (or Digital Infrastructure's) row, and any seat without a non-Administrator Zoho
 *      role (super admin, super user, Administrator, Auditor).
 *   3. A KAM moved off the seat: their whole book is listed by an ORG-SCOPE read (the "kam-pool-return"
 *      service job — the changer's own book is not the KAM's), before anything changes; unreadable → 503.
 *   4. PUT /users/{id} role + profile on the changer's own token (client.updateUserSeat).
 *   5. Each listed Contact returns to the pool — KAM, KAM_Since and KAM_Intro_At cleared — on the
 *      changer's own token, guarded by If-Unmodified-Since (jev decide a=0.98, PROVISIONAL). A Contact
 *      that could not be written is reported back as not returned, never retried silently.
 *   6. Plane C `seat-change`: who, whom, from → to (reason "kam-to-amlead"), count and the returned ids;
 *      the moved person's sessions end at once (their seat token is stale).
 *
 * M18-S09-NOTE-3 — a book of 200 inside a 30 s request: the Contacts are cleared 4 at a time, and no clear starts inside
 * the request deadline's stop margin. What is left comes back as `continueFrom` (the first Contact id not tried; the book
 * is read in id order). The page sends the same seat again with { continueFrom }: every check runs again, the seat is
 * not written twice (they already hold it), the book is re-read at org scope and the clears go on from that id — a
 * Contact already back in the pool is no longer in the book, and one that could not be written is not retried.
 * Plane C files the continuation as `seat-change` reason "kam-to-<seat>-continued" with its own count and ids.
 *
 * M17-S02-T01 — the Leads side (`side: "lead"`), the prototype's setSeat (vTeams 14426): the front end's own
 * canManage / canGrant / seatClash over the granter's and the holder's manager chains (grant-rules ctxOf), so
 * Digital Infrastructure seats anyone into a Leads seat and an IR Manager only gives "ir" to their own IRs;
 * a seat above the holder's manager is refused. The new seat's preset replaces their by-name grid (every
 * page they held by name is reset in the grant store). The route asks a live step-up first (D22).
 */

import type { UserCredential, ZohoResult, ZohoPage, ZohoFields, WriteAck, ServiceCredential, UserSeatWrite } from "../../lib/zoho/client";
import { emptyImData, maySeat, ROLE, type ImRoleKey } from "../../lib/im";
import type { AuthorityEvents } from "../identity/authority";
import type { ZohoUserDirectory } from "../identity/users";
import type { ZohoSeat, ZohoSeatDirectory } from "../oauth/seat";
import { CONSOLE_SEAT, type ConsoleSession } from "../oauth/user-session";
import { ADMINISTRATOR_SEATS, ZOHO_SEAT_SIDES } from "./policy";
import type { CapGrid, SeatKey } from "../../domain";
import { canGrant, canManage, seatClash } from "../../lib/selectors/access";
import { ctxOf, type GrantBook, type SeatedPerson } from "./grant-rules";
import type { GrantStore } from "./grants";
import { DEFAULT_STOP_MARGIN_MS, pastStopMargin, runBounded } from "../../lib/zoho/deadline";

export const CONTACTS = "Contacts";
export const POOL_PAGE = 200;
export const POOL_MAX = 2_000;
const USER_ID = /^\d{15,25}$/;
const RECORD_ID = /^\d{15,22}$/;

/** Investors seat → the Zoho seat it is written as. Seats with no non-Administrator Zoho role are absent. */
export const IM_SEAT_TO_ZOHO: Readonly<Partial<Record<ImRoleKey, ZohoSeat>>> = Object.freeze(Object.fromEntries(
  (Object.entries(ZOHO_SEAT_SIDES) as [ZohoSeat, { im: ImRoleKey | null }][])
    .filter(([z, s]) => s.im !== null && !ADMINISTRATOR_SEATS.has(z)).map(([z, s]) => [s.im!, z]),
) as Partial<Record<ImRoleKey, ZohoSeat>>);

/** Leads seat → the Zoho seat it is written as: the seats with no Investors side, never an Administrator one. */
export const LEAD_SEAT_TO_ZOHO: Readonly<Partial<Record<SeatKey, ZohoSeat>>> = Object.freeze(Object.fromEntries(
  (Object.entries(ZOHO_SEAT_SIDES) as [ZohoSeat, { lead: SeatKey; im: ImRoleKey | null }][])
    .filter(([z, s]) => s.im === null && !ADMINISTRATOR_SEATS.has(z)).map(([z, s]) => [s.lead, z]),
) as Partial<Record<SeatKey, ZohoSeat>>);

/** The seats nobody is moved into or out of from the console (super admin, super user). */
const UNTOUCHABLE: ReadonlySet<ImRoleKey> = new Set(["root", "di"]);

export type SeatRefusal = "bad-request" | "own-seat" | "super-admin" | "cannot-seat" | "same-seat" | "unknown-person" | "seat-moved" | "zoho-unavailable" | "book-unreadable" | "zoho-refused" | "unconfirmed"
  | "ir-seat-only" | "above-manager";

export const SEAT_REFUSALS: Readonly<Record<SeatRefusal, string>> = Object.freeze({
  "bad-request": "That is not a seat the console hands out.",
  "own-seat": "Nobody changes their own seat.",
  "super-admin": "The super admin's seat is not changed here, and nobody is made super admin.",
  "cannot-seat": "You cannot move this person into that seat.",
  "same-seat": "They already hold that seat.",
  "unknown-person": "That person is not a Zoho user you can see.",
  "seat-moved": "Your own seat has changed in Zoho. Sign in again.",
  "zoho-unavailable": "Zoho did not answer. Nothing was changed; try again.",
  "book-unreadable": "Their accounts could not be listed, so the seat was not changed. Try again.",
  "zoho-refused": "Zoho refused the seat change. Nothing was changed.",
  "unconfirmed": "Zoho did not confirm the seat change. Reload Teams to see whether it applied.",
  "ir-seat-only": "An IR Manager gives only the Investor Relations seat, and only to their own IRs. Nothing changed.",
  "above-manager": "That seat is above their manager: it reaches pages whoever they report to cannot. Move them to a manager who reaches it first, then give them the seat.",
});

const STATUS: Readonly<Record<SeatRefusal, 400 | 403 | 404 | 409 | 502 | 503>> = Object.freeze({
  "bad-request": 400, "own-seat": 403, "super-admin": 403, "cannot-seat": 403, "same-seat": 409, "unknown-person": 404,
  "seat-moved": 403, "zoho-unavailable": 503, "book-unreadable": 503, "zoho-refused": 502, "unconfirmed": 503,
  "ir-seat-only": 403, "above-manager": 409,
});

export type SeatChangeResult =
  | {
    readonly ok: true; readonly whom: string; readonly from: ImRoleKey; readonly to: ImRoleKey;
    /** Contact ids returned to the pool / listed but not written (a newer change, or no write access) */
    readonly returned: readonly string[]; readonly notReturned: readonly string[];
    /** M18-S09-NOTE-3: the first Contact not tried inside the request deadline; send the seat again with it. null = done. */
    readonly continueFrom: string | null;
  }
  | { readonly ok: true; readonly side: "lead"; readonly whom: string; readonly from: SeatKey; readonly to: SeatKey; readonly overridesCleared: number }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 502 | 503; readonly refusal: SeatRefusal; readonly message: string };

/** One Contact of the moved KAM's book: its id and the Modified_Time the clear is guarded by. */
export interface PoolRow { readonly id: string; readonly modifiedTime: string | null }

/** The org-scope read of a KAM's whole book. null = could not be read completely (nothing may change). */
export type KamBookOrgRead = (kamUserId: string, signal?: AbortSignal) => Promise<readonly PoolRow[] | null>;

export interface SeatChangeDeps {
  readonly users: ZohoUserDirectory;
  readonly seats: ZohoSeatDirectory;
  readonly crm: {
    updateUserSeat(as: UserCredential, userId: string, seat: UserSeatWrite): Promise<ZohoResult<{ readonly updated: true }>>;
    update(as: UserCredential, module: string, id: string, fields: ZohoFields, options: { readonly ifUnmodifiedSince: string | null }): Promise<ZohoResult<WriteAck>>;
  };
  readonly kamBook: KamBookOrgRead;
  readonly events: AuthorityEvents;
  readonly sessions?: { endSessionsOf(who: string, reason: string): Promise<number> };
  /** M17-S02: the grant store — read for the Leads-side rules, and reset when a Leads seat changes */
  readonly store?: Pick<GrantStore, "grantsOf" | "set">;
  readonly clock?: () => number;
  /** Contacts cleared at once (default 4). */
  readonly concurrency?: number;
  /** No clear starts with less than this left on the request deadline (default 8 s). */
  readonly stopMarginMs?: number;
}

export type SeatAsk = { readonly whom: unknown; readonly to: unknown; readonly side?: unknown; readonly continueFrom?: unknown };
export interface SeatChangeService {
  change(as: UserCredential, session: ConsoleSession, ask: SeatAsk): Promise<SeatChangeResult>;
}

/** Record ids compared as numbers (15–22 digits). */
const idAtLeast = (id: string, from: string): boolean => BigInt(id) >= BigInt(from);

const putFailure = (k: string): SeatRefusal =>
  /* not retried: a lost reply may have applied (network/aborted/server); refused before sending otherwise */
  k === "network" || k === "aborted" || k === "server" || k === "unexpected" ? "unconfirmed"
    : k === "busy" || k === "concurrency-exceeded" || k === "credits-exhausted" || k === "rate-limited-unclassified" || k === "auth-expired" ? "zoho-unavailable" : "zoho-refused";

/** The org-scope KAM book read over a service client (COQL, ids and Modified_Time only, ≤2000 rows). */
export function kamBookOrgRead(service: { coql(as: ServiceCredential, q: string, o?: { signal?: AbortSignal }): Promise<ZohoResult<ZohoPage>> },
  credential: (signal?: AbortSignal) => Promise<ServiceCredential | null>): KamBookOrgRead {
  return async (kamUserId, signal) => {
    if (!USER_ID.test(kamUserId)) return null;
    let cred: ServiceCredential | null;
    try { cred = await credential(signal); } catch { return null; }
    if (!cred || cred.job !== "kam-pool-return") return null;
    const out: PoolRow[] = [];
    for (let offset = 0; ; offset += POOL_PAGE) {
      const r = await service.coql(cred, `select id, Modified_Time from ${CONTACTS} where KAM = '${kamUserId}' order by id asc limit ${offset}, ${POOL_PAGE}`, { signal });
      if (!r.ok || r.value.invalidRecordIds) return null;
      for (const rec of r.value.records) {
        if (!RECORD_ID.test(rec.id)) return null;
        const mt = (rec as { Modified_Time?: unknown }).Modified_Time;
        out.push(Object.freeze({ id: rec.id, modifiedTime: typeof mt === "string" ? mt : null }));
      }
      if (!r.value.moreRecords || r.value.records.length < POOL_PAGE) break;
      if (out.length >= POOL_MAX) return null;   /* a book past one call's ceiling is not half-returned */
    }
    return Object.freeze(out);
  };
}

/**
 * M17-S02-T01: may `by` give `whom` the Leads seat `to`? The front end's own canManage / canGrant / seatClash
 * over the two chains (the prototype's setSeat). null = yes; otherwise the refusal. Pure: exported for tests.
 */
export function decideLeadSeat(by: string, whom: string, to: SeatKey, b: GrantBook, now: Date = new Date(0)): SeatRefusal | null {
  const me = b.people.find((p) => p.who === by), them = b.people.find((p) => p.who === whom);
  if (!me || !them) return "unknown-person";
  if (by === whom) return "own-seat";
  if (ADMINISTRATOR_SEATS.has(them.seat)) return "super-admin";
  if (!Object.prototype.hasOwnProperty.call(LEAD_SEAT_TO_ZOHO, to)) return "bad-request";
  const ctx = ctxOf(by, b, now);
  if (!canManage(ctx, whom)) return "cannot-seat";
  if (!canGrant(ctx, to)) return ZOHO_SEAT_SIDES[me.seat].lead === "conv" ? "ir-seat-only" : "cannot-seat";
  if (ZOHO_SEAT_SIDES[them.seat].lead === to) return "same-seat";
  if (seatClash(ctx.PEOPLE, whom, to).length) return "above-manager";
  return null;
}

export function createSeatChangeService(d: SeatChangeDeps): SeatChangeService {
  const clock = d.clock ?? Date.now;

  /** M17-S02-T01: a Leads-side seat (setSeat), decided by the front end's canManage/canGrant/seatClash. */
  async function changeLead(as: UserCredential, session: ConsoleSession, ask: { readonly whom: unknown; readonly to: unknown }): Promise<SeatChangeResult> {
    const by = session.who;
    const whom = typeof ask.whom === "string" && USER_ID.test(ask.whom) ? ask.whom : "";
    const to = typeof ask.to === "string" && Object.prototype.hasOwnProperty.call(LEAD_SEAT_TO_ZOHO, ask.to) ? (ask.to as SeatKey) : null;
    let from = "none";
    const no = (refusal: SeatRefusal): SeatChangeResult => {
      if (whom) d.events.seatChanged(by, whom, session.seat, from, to ?? "none", "refused");
      return { ok: false, status: STATUS[refusal], refusal, message: SEAT_REFUSALS[refusal] };
    };
    if (!whom || !to) return no("bad-request");
    if (as.userId !== by) return no("seat-moved");
    if (whom === by) return no("own-seat");
    const [mine, theirs] = await Promise.all([d.users.chainOf(as, by), d.users.chainOf(as, whom)]);
    if (!mine) return no("zoho-unavailable");
    if (!theirs) return no("unknown-person");
    const me = mine[0]!, them = theirs[0]!;
    if (CONSOLE_SEAT[me.seat] !== session.seat) return no("seat-moved");
    from = ZOHO_SEAT_SIDES[them.seat].lead;
    if (ADMINISTRATOR_SEATS.has(them.seat)) return no("super-admin");
    const people = new Map<string, SeatedPerson>();
    for (const p of [...mine, ...theirs]) people.set(p.who, p);
    const grants: Record<string, CapGrid> = {};
    for (const k of people.keys()) grants[k] = d.store ? d.store.grantsOf(k) : {};
    const v = decideLeadSeat(by, whom, to, { people: [...people.values()], grants }, new Date(clock()));
    if (v) return no(v);
    const target = LEAD_SEAT_TO_ZOHO[to]!;
    const write = d.seats.seatWrite ? d.seats.seatWrite(target) : null;
    if (!write) return no("cannot-seat");
    const put = await d.crm.updateUserSeat(as, whom, { roleId: write.roleId, roleName: write.roleName, profileId: write.profileId, profileName: write.profileName });
    if (!put.ok) return no(putFailure(put.error.kind));
    /* the new seat's preset replaces the grid (prototype: delete GRANT[k]) */
    const held = d.store ? Object.keys(d.store.grantsOf(whom)) : [];
    for (const page of held) d.store!.set({ at: clock(), by, whom, page, caps: null });
    d.events.seatChanged(by, whom, session.seat, from, to, "ok");
    try { await d.sessions?.endSessionsOf(whom, "seat-changed"); } catch { /* their next refresh ends it (seat mismatch) */ }
    return { ok: true, side: "lead", whom, from: from as SeatKey, to, overridesCleared: held.length };
  }

  /** Clear KAM on each Contact, `concurrency` at a time, never starting one inside the deadline's stop margin. */
  async function poolReturn(as: UserCredential, rows: readonly PoolRow[]) {
    const r = await runBounded(rows, d.concurrency ?? 4,
      async (row) => (await d.crm.update(as, CONTACTS, row.id, { KAM: null, KAM_Since: null, KAM_Intro_At: null }, { ifUnmodifiedSince: row.modifiedTime })).ok,
      () => pastStopMargin(d.stopMarginMs ?? DEFAULT_STOP_MARGIN_MS));
    const returned: string[] = [], notReturned: string[] = [];
    for (const x of r.done) (x.value ? returned : notReturned).push(rows[x.index]!.id);
    return { returned, notReturned, continueFrom: r.notStarted.length ? rows[r.notStarted[0]!]!.id : null };
  }

  return Object.freeze({
    async change(as: UserCredential, session: ConsoleSession, ask: SeatAsk): Promise<SeatChangeResult> {
      if (ask.side === "lead") return changeLead(as, session, ask);
      const by = session.who;
      const whom = typeof ask.whom === "string" && USER_ID.test(ask.whom) ? ask.whom : "";
      const to = typeof ask.to === "string" && Object.prototype.hasOwnProperty.call(ROLE, ask.to) ? (ask.to as ImRoleKey) : null;
      let from = "none";
      const no = (refusal: SeatRefusal): SeatChangeResult => {
        if (whom) d.events.seatChanged(by, whom, session.seat, from, to ?? "none", "refused");
        return { ok: false, status: STATUS[refusal], refusal, message: SEAT_REFUSALS[refusal] };
      };
      if (!whom || !to) return no("bad-request");
      if (as.userId !== by) return no("seat-moved");
      if (whom === by) return no("own-seat");
      if (UNTOUCHABLE.has(to)) return no("super-admin");

      const [me, them] = await Promise.all([d.users.lookup(as, by), d.users.lookup(as, whom)]);
      if (!me) return no("zoho-unavailable");
      if (!them) return no("unknown-person");
      if (CONSOLE_SEAT[me.seat] !== session.seat) return no("seat-moved");
      const myIm = ZOHO_SEAT_SIDES[me.seat].im, theirIm = ZOHO_SEAT_SIDES[them.seat].im;
      if (theirIm) from = theirIm;
      if (ADMINISTRATOR_SEATS.has(them.seat) || (theirIm && UNTOUCHABLE.has(theirIm))) return no("super-admin");
      const target = IM_SEAT_TO_ZOHO[to];
      const write = target && d.seats.seatWrite ? d.seats.seatWrite(target) : null;
      if (!myIm || !theirIm || !write) return no("cannot-seat");

      /* the front end's rule over a two-person Investors book */
      const data = emptyImData(new Date(clock()).toISOString());
      data.P[by] = { n: "", i: "", r: myIm, c: 1, em: "" };
      data.P[whom] = { n: "", i: "", r: theirIm, c: 1, em: "" };
      data.SIGNINS.push(by, whom);
      if (!maySeat({ data }, by, whom, to)) return no("cannot-seat");

      /* M18-S09-NOTE-3: the rest of a pool return that ran out of request time — they already hold `to`, not KAM */
      if (ask.continueFrom !== undefined && ask.continueFrom !== null) {
        const from = typeof ask.continueFrom === "string" && RECORD_ID.test(ask.continueFrom) ? ask.continueFrom : null;
        if (!from || to !== theirIm || theirIm === "kam") return no("bad-request");
        const rest = await d.kamBook(whom);
        if (rest === null) return no("book-unreadable");
        const out = await poolReturn(as, rest.filter((row) => idAtLeast(row.id, from)));
        d.events.seatChanged(by, whom, session.seat, "kam", `${to}-continued`, "ok", out.returned);
        return { ok: true, whom, from: "kam", to, returned: Object.freeze(out.returned), notReturned: Object.freeze(out.notReturned), continueFrom: out.continueFrom };
      }
      if (to === theirIm) return no("same-seat");

      /* a KAM leaving the seat: list the whole book first (org scope), or change nothing */
      const leaving = theirIm === "kam" && to !== "kam";
      const book = leaving ? await d.kamBook(whom) : [];
      if (book === null) return no("book-unreadable");

      const put = await d.crm.updateUserSeat(as, whom, { roleId: write.roleId, roleName: write.roleName, profileId: write.profileId, profileName: write.profileName });
      if (!put.ok) return no(putFailure(put.error.kind));

      const { returned, notReturned, continueFrom } = await poolReturn(as, book);
      d.events.seatChanged(by, whom, session.seat, theirIm, to, "ok", returned);
      try { await d.sessions?.endSessionsOf(whom, "seat-changed"); } catch { /* their next refresh ends it (seat mismatch) */ }
      return { ok: true, whom, from: theirIm, to, returned: Object.freeze(returned), notReturned: Object.freeze(notReturned), continueFrom };
    },
  });
}
