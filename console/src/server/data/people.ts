/**
 * M01-S03-NOTE-4 — PEOPLE FROM ZOHO USERS, on the signed-in person's own token (rule 2, D53).
 *
 * One read per request: GET /users?type=AllUsers (every page, server/teams/service limits) seated by the
 * same seat directory the sign-in door uses (teams.ts seatOrg). Zoho decides who the viewer may list; this
 * module adds no scope of its own and widens nothing. If the list is refused or unreadable, the viewer's own
 * entry is read by id (identity/users.ts `entry`) so a live screen still has a name; if that fails too, the
 * map stays empty and the caller records `people:<code>`.
 *
 * What it keeps: name, seat (role), manager, active flag and — for the viewer alone — their own email.
 * Other people's email and every phone stay blank, as the Teams lead rows do (rule 7: nothing is shown that
 * the screen does not need). Rule 8: a people list is names, so it is never cached — read per request, held
 * for this response only. Nothing is logged here; the client writes its own call line (ids and status).
 */

import type { ColourSlot, Person, PersonKey } from "../../domain/types";
import type { ImPerson } from "../../lib/im/types";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { ZOHO_SEAT_SIDES } from "../access/policy";
import type { ZohoUserDirectory } from "../identity/users";
import type { ZohoSeatDirectory } from "../oauth/seat";
import { MAX_USER_PAGES, USERS_PER_PAGE } from "../teams/service";
import { personOf, seatOrg, type OrgMember } from "../teams/teams";

export interface PeopleDeps {
  readonly crm: Pick<ZohoClient, "listUsers">;
  readonly seats: ZohoSeatDirectory;
  readonly users?: Pick<ZohoUserDirectory, "entry">;
}

export interface People {
  readonly people: Record<PersonKey, Person>;
  /** the Investors side's names (seats with an Investors role only) */
  readonly im: Record<string, ImPerson>;
}

export type PeopleRead = { readonly ok: true; readonly value: People } | { readonly ok: false; readonly code: string };

const slot = (id: string): ColourSlot => ((Number(id.slice(-3)) % 8) + 1) as ColourSlot;

function build(members: readonly OrgMember[], viewer: string): People {
  const people: Record<PersonKey, Person> = {};
  const im: Record<string, ImPerson> = {};
  for (const m of members) {
    const em = m.id === viewer ? m.email : "";
    const p = { ...personOf(m, em), c: slot(m.id) };
    people[m.id] = p;
    const side = ZOHO_SEAT_SIDES[m.seat].im;
    if (side && !m.left) im[m.id] = { n: m.name, i: p.i, r: side, c: p.c, em, ...(m.mgr ? { mgr: m.mgr } : {}) };
  }
  return { people, im };
}

export async function readPeople(d: PeopleDeps, as: UserCredential, signal?: AbortSignal): Promise<PeopleRead> {
  const viewer = as.userId;
  let code = "zoho-unavailable";
  const raw: unknown[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const r = await d.crm.listUsers(as, { type: "AllUsers", page, perPage: USERS_PER_PAGE, signal });
    if (!r.ok) { code = r.error.kind; break; }
    raw.push(...r.value.users);
    if (!r.value.moreRecords) { complete = true; break; }
    if (page === MAX_USER_PAGES) code = "too-many-users";
  }
  const members: OrgMember[] = complete ? [...seatOrg(raw, d.seats).members] : [];
  if (!members.some((m) => m.id === viewer)) {
    // Refused, partial, or the viewer left out: their own entry, by id, on their own token.
    const own = d.users ? await d.users.entry(as, viewer) : null;
    if (own) members.push({ id: own.who, name: own.name, email: own.email, seat: own.seat, mgr: own.mgr, left: false });
    else if (!members.length) return { ok: false, code };
    else code = "self-not-listed";
  }
  return { ok: true, value: build(members, viewer) };
}
