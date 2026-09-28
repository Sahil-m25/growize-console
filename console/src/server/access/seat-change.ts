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
 */

import type { UserCredential, ZohoResult, ZohoPage, ZohoFields, WriteAck, ServiceCredential, UserSeatWrite } from "../../lib/zoho/client";
import { emptyImData, maySeat, ROLE, type ImRoleKey } from "../../lib/im";
import type { AuthorityEvents } from "../identity/authority";
import type { ZohoUserDirectory } from "../identity/users";
import type { ZohoSeat, ZohoSeatDirectory } from "../oauth/seat";
import { CONSOLE_SEAT, type ConsoleSession } from "../oauth/user-session";
import { ADMINISTRATOR_SEATS, ZOHO_SEAT_SIDES } from "./policy";

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

/** The seats nobody is moved into or out of from the console (super admin, super user). */
const UNTOUCHABLE: ReadonlySet<ImRoleKey> = new Set(["root", "di"]);

export type SeatRefusal = "bad-request" | "own-seat" | "super-admin" | "cannot-seat" | "same-seat" | "unknown-person" | "seat-moved" | "zoho-unavailable" | "book-unreadable" | "zoho-refused" | "unconfirmed";

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
});

const STATUS: Readonly<Record<SeatRefusal, 400 | 403 | 404 | 409 | 502 | 503>> = Object.freeze({
  "bad-request": 400, "own-seat": 403, "super-admin": 403, "cannot-seat": 403, "same-seat": 409, "unknown-person": 404,
  "seat-moved": 403, "zoho-unavailable": 503, "book-unreadable": 503, "zoho-refused": 502, "unconfirmed": 503,
});

export type SeatChangeResult =
  | {
    readonly ok: true; readonly whom: string; readonly from: ImRoleKey; readonly to: ImRoleKey;
    /** Contact ids returned to the pool / listed but not written (a newer change, or no write access) */
    readonly returned: readonly string[]; readonly notReturned: readonly string[];
  }
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
  readonly clock?: () => number;
}

export interface SeatChangeService {
  change(as: UserCredential, session: ConsoleSession, ask: { readonly whom: unknown; readonly to: unknown }): Promise<SeatChangeResult>;
}

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

export function createSeatChangeService(d: SeatChangeDeps): SeatChangeService {
  const clock = d.clock ?? Date.now;
  return Object.freeze({
    async change(as: UserCredential, session: ConsoleSession, ask: { readonly whom: unknown; readonly to: unknown }): Promise<SeatChangeResult> {
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
      if (to === theirIm) return no("same-seat");

      /* a KAM leaving the seat: list the whole book first (org scope), or change nothing */
      const leaving = theirIm === "kam" && to !== "kam";
      const book = leaving ? await d.kamBook(whom) : [];
      if (book === null) return no("book-unreadable");

      const put = await d.crm.updateUserSeat(as, whom, { roleId: write.roleId, roleName: write.roleName, profileId: write.profileId, profileName: write.profileName });
      if (!put.ok) {
        const k = put.error.kind;
        /* not retried: a lost reply may have applied (network/aborted/server); refused before sending otherwise */
        return no(k === "network" || k === "aborted" || k === "server" || k === "unexpected" ? "unconfirmed"
          : k === "busy" || k === "concurrency-exceeded" || k === "credits-exhausted" || k === "rate-limited-unclassified" || k === "auth-expired" ? "zoho-unavailable" : "zoho-refused");
      }

      const returned: string[] = [], notReturned: string[] = [];
      for (const row of book) {
        const w = await d.crm.update(as, CONTACTS, row.id, { KAM: null, KAM_Since: null, KAM_Intro_At: null }, { ifUnmodifiedSince: row.modifiedTime });
        (w.ok ? returned : notReturned).push(row.id);
      }
      d.events.seatChanged(by, whom, session.seat, theirIm, to, "ok", returned);
      try { await d.sessions?.endSessionsOf(whom, "seat-changed"); } catch { /* their next refresh ends it (seat mismatch) */ }
      return { ok: true, whom, from: theirIm, to, returned: Object.freeze(returned), notReturned: Object.freeze(notReturned) };
    },
  });
}
