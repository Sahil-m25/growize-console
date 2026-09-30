/**
 * M01-S01-W1 — THE SIGNED-IN PERSON'S OWN SEAT RECORDS, for the screen (phase 2b, D104).
 *
 * In live mode the book GET /api/data serves holds no people (D45: Zoho is the only store, and the
 * console keeps no roster), so the screen's seat rules — the lead rail (`navFor`), the Investors side's
 * `who()` / `pageReadable()` / `may()` — had nobody to ask about. GET /api/session answers, beside the
 * session, the one-person book the server's own guard already decides with (`accessBook`, policy.ts):
 * this person on the lead side, on the Investors side when their seat works there, and the pages
 * Digital Infrastructure has granted them. The screen puts exactly that on its book, so a page it
 * shows and a page the guard admits are decided by the same rule over the same record.
 *
 * Names are blank: the session holds a Zoho user id and a seat token, never a name (PROVISIONAL —
 * the name arrives with the Teams read, M17-S01).
 */

import type { CapGrid, Person } from "../../domain";
import type { ImPerson } from "../../lib/im";
import type { ConsoleSession } from "../oauth/user-session";
import { ZOHO_SEAT_OF_TOKEN } from "./guard-core";
import { accessBook, readGrants, ZOHO_SEAT_SIDES, type GrantReader } from "./policy";

export interface SessionAccess {
  /** the person on the lead side (their seat; `ext` when they work only the Investors pages) */
  readonly lead: Person;
  /** the person on the Investors side, or null when their seat has none */
  readonly im: ImPerson | null;
  /** the pages granted to them by name */
  readonly grants: CapGrid;
}

/** The session's one-person book, or null when its seat token maps to no console seat. */
export async function sessionAccessOf(session: ConsoleSession, grants: GrantReader): Promise<SessionAccess | null> {
  const zseat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, session.seat) ? ZOHO_SEAT_OF_TOKEN[session.seat]! : null;
  if (!zseat) return null;
  const sides = ZOHO_SEAT_SIDES[zseat];
  const g = await readGrants(grants, session.who, sides.lead);
  const b = accessBook(session.who, sides, g);
  return Object.freeze({ lead: b.PEOPLE[session.who]!, im: b.im.P[session.who] ?? null, grants: b.GRANT[session.who] ?? {} });
}
