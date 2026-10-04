/**
 * D49 / D44 — THE ROSTER: who is out of office, until when, who is available on a day, and who carries a book.
 *
 * Availability is an authority fact about a person, so it lives in Plane C (D49), not in Zoho: each "out from, back on"
 * is one `availability` line (identity/plane-c.ts) — from and to are IST days, `to` the first day back, no reason (the
 * reason is private). This file only READS those lines back, through the log source interface (logs/reader.ts
 * `LogSource`), so it is the same whether the sink is day files or Stratus. Nothing here writes, and the answer is ids
 * and days only — never a name, never an identity value (rule 7).
 *
 * The latest line per person wins: `ok` sets their window, `ended` clears it (back early / cancelled). A window is out
 * on every day in [from, to); on `to` they are back (D44: automatic leave-based cover closes on the first day back).
 * A line is data, not trusted: it is re-read through a narrow shape and anything else is skipped.
 *
 * "Who carries a book" is not in Plane C: it is read from Zoho on the VIEWER's own token (rule 2) — open leads owned and
 * KAM-held contacts, as counts per user (`bookCarriers`, ./carries.ts).
 */

import type { LogSource } from "../logs/reader";
import type { RosterNow, RosterReader } from "../leads/cover";

const USER_ID = /^\d{15,25}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const D = 86_400_000;
/** An absence is at most 60 days long and may be booked at most 30 days ahead (availability.ts), so a line older than this is spent. */
export const LOOKBACK_DAYS = 100;
export const MAX_ABSENCE_DAYS = 60;
export const MAX_AHEAD_DAYS = 30;

/** A real calendar day, or null. */
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v ? v : null;
}
export const addDays = (day: string, n: number): string => new Date(Date.parse(day + "T00:00:00Z") + n * D).toISOString().slice(0, 10);
export const istToday = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface Absence {
  /** First day out (IST). */
  readonly from: string;
  /** First day back (IST). */
  readonly to: string;
}

export interface RosterView {
  /** Everyone with a live or planned window (to > the day the view was read), by Zoho user id. */
  readonly windows: ReadonlyMap<string, Absence>;
  /** Out on `day`: the first day back, or null when they are in. */
  backOn(id: string, day: string): string | null;
  /** Out on any day of [from, to] inclusive: the first day back of the window that touches it, or null. */
  outDuring(id: string, from: string, to: string): string | null;
  /** Everyone out on `day`, with the day they are back. */
  outOn(day: string): readonly { readonly id: string; readonly backOn: string }[];
  /** Of `candidates`, who is available on `day` (nobody on the roster is available only when out; everyone else is in). */
  availableOn(day: string, candidates: readonly string[]): readonly string[];
}

/** Folds availability lines, oldest first, into the latest window per person. Exported for tests. */
export function foldAvailability(lines: readonly unknown[], today: string): RosterView {
  const ev = lines
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null && !Array.isArray(l) && (l as { action?: unknown }).action === "availability"
      && typeof (l as { at?: unknown }).at === "number" && Number.isFinite((l as { at: number }).at))
    .sort((a, b) => (a.at as number) - (b.at as number));
  const latest = new Map<string, Absence | null>();
  for (const e of ev) {
    const subject = typeof e.whom === "string" && USER_ID.test(e.whom) ? e.whom : typeof e.who === "string" && USER_ID.test(e.who) ? e.who : null;
    if (!subject) continue;
    if (e.outcome === "ended") { latest.set(subject, null); continue; }
    if (e.outcome !== "ok") continue; // a refused attempt changed nothing
    const from = isoDay(e.from), to = isoDay(e.to);
    if (from && to && from < to) latest.set(subject, Object.freeze({ from, to }));
  }
  const windows = new Map<string, Absence>();
  for (const [id, w] of latest) if (w && w.to > today) windows.set(id, w);
  const backOn = (id: string, day: string): string | null => { const w = windows.get(id); return w && w.from <= day && day < w.to ? w.to : null; };
  const outDuring = (id: string, from: string, to: string): string | null => {
    const w = windows.get(id);
    return w && w.from <= to && from < w.to ? w.to : null; // [from, to] touches [w.from, w.to)
  };
  const outOn = (day: string) => Object.freeze([...windows.keys()].filter((id) => backOn(id, day)).sort().map((id) => Object.freeze({ id, backOn: windows.get(id)!.to })));
  const availableOn = (day: string, candidates: readonly string[]): readonly string[] => Object.freeze(candidates.filter((id) => !backOn(id, day)));
  return Object.freeze({ windows, backOn, outDuring, outOn, availableOn });
}

export interface RosterService extends RosterReader {
  /** The view as of now: windows still running or planned. */
  view(signal?: AbortSignal): Promise<RosterView>;
  /** Drop the short memo (the writer calls this after it files a line). */
  forget(): void;
}

/** 30 seconds: a cover check, a team list and an event save in one minute read the log once, not each. */
const MEMO_MS = 30_000;

export function createRoster(source: LogSource, clock: () => number = Date.now): RosterService {
  let memo: { at: number; view: RosterView } | null = null;
  const view = async (signal?: AbortSignal): Promise<RosterView> => {
    const now = clock();
    if (memo && now - memo.at < MEMO_MS && now >= memo.at) return memo.view;
    signal?.throwIfAborted();
    const lines = await source.read("identity", utcDay(now - LOOKBACK_DAYS * D), utcDay(now));
    const v = foldAvailability(lines, istToday(now));
    memo = { at: now, view: v };
    return v;
  };
  return Object.freeze({
    view,
    forget: () => { memo = null; },
    /** What cover.ts asks: owners away today, and the day each is back. No named per-owner cover is filed, so `covers` is empty. */
    async current(signal?: AbortSignal): Promise<RosterNow> {
      const v = await view(signal);
      const today = istToday(clock());
      const out = v.outOn(today);
      return Object.freeze({
        absentOwnerIds: Object.freeze(out.map((o) => o.id)),
        covers: Object.freeze([]),
        backOn: Object.freeze(Object.fromEntries(out.map((o) => [o.id, o.backOn]))),
      });
    },
  });
}
