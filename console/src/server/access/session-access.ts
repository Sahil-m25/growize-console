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
 * Names: the session holds a Zoho user id and a seat token; the display name is the one Zoho's CurrentUser
 * answer gave at sign-in (kept on the stored session, B-15). A session opened before that, or one Zoho named
 * no one on, stays blank until the Teams read (M17-S01) supplies it.
 */

import type { CapGrid, ColourSlot, Person } from "../../domain";
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

/** The person's saved badge (server/me/style), read on the session's own user id. */
export interface BadgeReader {
  get(userId: string): Promise<{ readonly c?: number; readonly sq?: boolean; readonly i?: string }>;
}

/** The session's one-person book, or null when its seat token maps to no console seat. With `badges`, the person's saved
 *  colour, shape and initials ride on it (B-15/B-26: saved by PUT /api/me/style and never read back); a failed read is no badge. */
export async function sessionAccessOf(session: ConsoleSession, grants: GrantReader, badges?: BadgeReader, name?: string | null, mobile?: string | null): Promise<SessionAccess | null> {
  const zseat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, session.seat) ? ZOHO_SEAT_OF_TOKEN[session.seat]! : null;
  if (!zseat) return null;
  const sides = ZOHO_SEAT_SIDES[zseat];
  const g = await readGrants(grants, session.who, sides.lead);
  const b = accessBook(session.who, sides, g);
  let st: Awaited<ReturnType<BadgeReader["get"]>> = {};
  if (badges) { try { st = await badges.get(session.who); } catch { st = {}; } }
  const c = typeof st.c === "number" && Number.isInteger(st.c) && st.c >= 1 && st.c <= 8 ? st.c : null;
  const i = typeof st.i === "string" && /^[A-Z0-9]{1,2}$/.test(st.i) ? st.i : null;
  /* B-15: the display name Zoho gave at sign-in (blank when Zoho named no one). Initials: the saved badge wins, else the name's. */
  const n = name?.trim() ?? "", ni = n.split(" ").filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join("");
  const ii = i ?? (ni || null);
  /* B-26: the person's OWN mobile, from their own Zoho user (CurrentUser at sign-in / refresh, or the save Zoho just accepted) */
  const ph = mobile?.trim() ?? "";
  const lead: Person = { ...b.PEOPLE[session.who]!, ...(n ? { n } : {}), ...(ph ? { ph } : {}), ...(c ? { c: c as ColourSlot } : {}), ...(ii ? { i: ii } : {}),
    ...(typeof st.sq === "boolean" ? { sq: st.sq } : {}) };
  const imP = b.im.P[session.who];
  const im: ImPerson | null = imP ? { ...imP, ...(n ? { n } : {}), ...(c ? { c } : {}), ...(ii ? { i: ii } : {}) } : null;
  return Object.freeze({ lead, im, grants: b.GRANT[session.who] ?? {} });
}
