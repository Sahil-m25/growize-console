/* M08-S05-NOTE-6 — out of office / back on: GET, POST and DELETE /api/availability (D49 roster in Plane C; D44 return clears cover).
   Live: the route — ids and days only, never the private reason (rule 7); a person, or a manager / Digital Infrastructure for
   someone else. Fixture: the demo book's AVAIL and the reducer actions the absence drawer used (setAvail / setOutFrom / setOutTo).
   The reason select stays a fixture-only control: the route never takes a reason, so live it is not asked. */

import type { PersonKey } from "@/domain";
import { iso } from "@/lib/format";
import { canRosterFor, gone } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/state";
import { fail, ok, type ApiErr, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* server/roster/roster.ts's day rules, restated (client code takes only types from @/server — docs/WIRING.md). The roster test
   (availability endpoint test) pins the two to the same answers. */
export const MAX_AHEAD_DAYS = 30;
export const MAX_ABSENCE_DAYS = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day, or null. */
const rosterDay = (v: unknown): string | null => {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
};
const addDays = (day: string, n: number): string => new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** One live or planned window: first day out, first day back (IST days). */
export type AvailWindow = { id: string; from: string; to: string };
/** GET /api/availability */
export type AvailAnswer = { day: string; out: { id: string; backOn: string }[]; windows: AvailWindow[] };

/* The route's refusals (server/roster/availability.ts REASON), as "Nothing changed — …". */
export const NOT_YOURS_TO_CHANGE = "Nothing changed — you can change your own availability, or a team member's if you manage them.";
export const BAD_DATES = `Nothing changed — choose a start date from today and a later return date, at most ${MAX_AHEAD_DAYS} days ahead and ${MAX_ABSENCE_DAYS} days long.`;
const notYours = (): ApiErr => fail(403, "not-yours-to-change", NOT_YOURS_TO_CHANGE);
const badDates = (): ApiErr => fail(422, "bad-dates", BAD_DATES);

/** The demo book's windows, as the route lists them: spent and departed records are not windows. */
export function fixtureWindows(s: Pick<ConsoleState, "AVAIL" | "NOW">): AvailWindow[] {
  const today = iso(s.NOW);
  return Object.entries(s.AVAIL ?? {})
    .filter(([, a]) => a && !a.perm && rosterDay(a.from) && rosterDay(a.to) && a.from < a.to && a.to > today)
    .map(([id, a]) => ({ id, from: a.from, to: a.to }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const availabilityRead: ReadEndpoint<ConsoleBook, void, AvailAnswer> = {
  path: () => "/api/availability",
  pick(j) {
    const o = (j ?? {}) as Partial<AvailAnswer>;
    const day = typeof o.day === "string" ? o.day : "";
    const windows = (Array.isArray(o.windows) ? o.windows : []).filter((w): w is AvailWindow =>
      !!w && typeof w.id === "string" && !!rosterDay(w.from) && !!rosterDay(w.to));
    const out = (Array.isArray(o.out) ? o.out : []).filter((x) => !!x && typeof x.id === "string" && !!rosterDay(x.backOn));
    return { day, out: out.map((x) => ({ id: x.id, backOn: x.backOn })), windows: windows.map((w) => ({ id: w.id, from: w.from, to: w.to })) };
  },
  fixture(s) {
    const day = iso(s.NOW);
    const windows = fixtureWindows(s);
    return ok({ day, windows, out: windows.filter((w) => w.from <= day && day < w.to).map((w) => ({ id: w.id, backOn: w.to })) });
  },
};

/** The book's AVAIL for live mode, from the route's windows: days only — the reason, who recorded it and when are not served. */
export function availFromWindows(windows: readonly AvailWindow[]): ConsoleState["AVAIL"] {
  return Object.fromEntries(windows.map((w) => [w.id, { why: "", from: w.from, to: w.to, by: "", at: "" }]));
}

/** The route's own date rule (availability.ts), checked before the fixture reducer runs so both halves refuse alike. */
export function datesOk(today: string, from: string, to: string): boolean {
  const f = rosterDay(from), t = rosterDay(to);
  return !!f && !!t && f >= today && t > f && f <= addDays(today, MAX_AHEAD_DAYS) && t <= addDays(f, MAX_ABSENCE_DAYS);
}

export type AvailSetArgs = {
  k: PersonKey; from: string; to: string;
  /** fixture only: the private reason the demo drawer records (never sent) */
  why?: string;
  /** an edit of a recorded window (the drawer's date fields), else a new one */
  change?: "from" | "to";
};
export type AvailWritten = { personId: string; from: string | null; to: string | null; covers?: { cleared: number; pending: number | null } };

const mayChange = (s: ConsoleState, k: PersonKey) => !!s.PEOPLE[k] && canRosterFor(s, k) && !gone(s, k);

export const availabilitySet: WriteEndpoint<ConsoleBook, AvailSetArgs, AvailWritten, ConsoleDispatch> = {
  method: "POST",
  path: () => "/api/availability",
  body: (a) => ({ person: a.k, from: a.from, to: a.to }),
  pick: (j) => j as AvailWritten,
  fixture(s, dispatch, a): ApiResult<AvailWritten> {
    if (!mayChange(s, a.k)) return notYours();
    if (!datesOk(iso(s.NOW), a.from, a.to)) return badDates();
    const act = a.change === "from" ? { type: "setOutFrom" as const, k: a.k, from: a.from }
      : a.change === "to" ? { type: "setOutTo" as const, k: a.k, to: a.to }
      : { type: "setAvail" as const, k: a.k, why: a.why, from: a.from, to: a.to };
    return consoleFixtureWrite(s, dispatch, act, (next) => (next.AVAIL === s.AVAIL ? badDates() : null),
      (next) => ({ personId: a.k, from: next.AVAIL[a.k]?.from ?? null, to: next.AVAIL[a.k]?.to ?? null }));
  },
};

export const availabilityClear: WriteEndpoint<ConsoleBook, { k: PersonKey }, AvailWritten, ConsoleDispatch> = {
  method: "DELETE",
  path: () => "/api/availability",
  body: (a) => ({ person: a.k }),
  pick: (j) => j as AvailWritten,
  fixture(s, dispatch, a): ApiResult<AvailWritten> {
    if (!mayChange(s, a.k)) return notYours();
    /* nothing recorded: the route files "back" anyway and changes nothing a reader sees */
    if (!s.AVAIL[a.k]) return ok({ personId: a.k, from: null, to: null });
    /* the reducer's setAvail on a recorded window marks them back and ends their cover (endCoverFor) — D44, as the route does */
    return consoleFixtureWrite(s, dispatch, { type: "setAvail", k: a.k }, (next) => (next.AVAIL === s.AVAIL ? notYours() : null),
      () => ({ personId: a.k, from: null, to: null }));
  },
};
