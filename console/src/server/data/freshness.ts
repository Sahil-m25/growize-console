/**
 * M01-S09-T02 — WHAT /api/data SAYS ABOUT HOW CURRENT IT IS (D41, D45 rule 8).
 *
 * The live source reports its own freshness with every answer, in the contract of the front end's
 * src/lib/data/freshness.ts: `at` (epoch ms of the last read that fully succeeded for this person, or
 * null), `failed` (this read did not fully succeed) and `tone` — "live", "stale" (failed, but the last
 * good read is under the five-minute ceiling) or "error" (failed and past the ceiling, or never good).
 * A read that loses a secondary book (allotments, receipts…) still answers, but says `failed` with the
 * book codes in `problems`, so the page shows its stale/error state instead of old or partial numbers
 * passed off as current. A read that loses the primary book answers 503 with the same freshness block.
 *
 * Only timestamps are kept (last good read per Zoho user id, bounded) — never a row (D45 zero copy).
 * The per-request report travels on AsyncLocalStorage from zoho-source.loadLiveDataset to the route.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { FRESH_MS, freshness, type Fresh } from "../../lib/data/freshness";

export const CEILING_MS = FRESH_MS;
const MAX_TRACKED = 5_000;

/** Problem codes that are the source failing (not a refusal, a truncation or a scope rule). */
const NOT_A_FAILURE = /:(truncated|scope-drift|source-invalid|session-changed|capability-missing|no-team-scope|seat-denied|invalid-request|book-too-large|no-origin|not-own-lead|not-visible)$/;
export const isSourceFailure = (problem: string): boolean => !NOT_A_FAILURE.test(problem);

export interface ServedFreshness {
  /** "zoho" — read live now; "fixtures" — the demo book; "none" — no live source connected (no sign-in configured or nobody signed in). */
  readonly source: "zoho" | "fixtures" | "none";
  /** Last read that fully succeeded for this person (epoch ms), or null. */
  readonly at: number | null;
  /** This read did not fully succeed. */
  readonly failed: boolean;
  readonly tone: Fresh["tone"];
  readonly ceilingMs: number;
  /** When this answer was made (epoch ms). */
  readonly servedAt: number;
  /** `<book>:<code>` — ids and codes only, never a value. */
  readonly problems: readonly string[];
}

interface Report { userId: string | null; problems: string[]; threw: boolean }
const als = new AsyncLocalStorage<Report>();

const G = globalThis as typeof globalThis & { __gzLastGood?: Map<string, number> };
const lastGood = (): Map<string, number> => (G.__gzLastGood ??= new Map());

/** Called by the live source for one person's read: their problems (empty = fully good). */
export function noteLiveRead(userId: string, problems: readonly string[], now: number = Date.now()): void {
  const r = als.getStore();
  if (r) { r.userId = userId; r.problems = [...problems]; }
  if (!problems.some(isSourceFailure)) {
    const m = lastGood();
    m.delete(userId);
    m.set(userId, now);
    while (m.size > MAX_TRACKED) m.delete(m.keys().next().value as string);
  }
}

/** Called by the live source when the read failed outright (the primary book, or an exception). */
export function noteLiveFailure(userId: string | null, problems: readonly string[]): void {
  const r = als.getStore();
  if (r) { r.userId = userId; r.problems = problems.length ? [...problems] : ["load:unexpected"]; r.threw = true; }
}

/** The freshness block for one answer. Pure: exported for tests. */
export function freshnessOf(input: {
  readonly source: ServedFreshness["source"];
  readonly userId: string | null;
  readonly problems: readonly string[];
  readonly threw: boolean;
  readonly now: number;
  readonly lastGoodAt?: number | null;
}): ServedFreshness {
  const { source, now } = input;
  if (source !== "zoho") {
    const at = source === "fixtures" ? now : null;
    return Object.freeze({ source, at, failed: false, tone: freshness(at, false, now).tone, ceilingMs: CEILING_MS, servedAt: now, problems: Object.freeze([]) });
  }
  const failed = input.threw || input.problems.some(isSourceFailure);
  const at = input.lastGoodAt !== undefined ? input.lastGoodAt : input.userId ? lastGood().get(input.userId) ?? null : null;
  return Object.freeze({
    source, at, failed, tone: freshness(at, failed, now).tone, ceilingMs: CEILING_MS, servedAt: now,
    problems: Object.freeze([...input.problems]),
  });
}

export type Served<P> =
  | { readonly status: 200; readonly body: P & { readonly fresh: ServedFreshness } }
  | { readonly status: 503; readonly body: { readonly error: "source-unavailable"; readonly fresh: ServedFreshness } };

/**
 * Runs one /api/data load and attaches its freshness. A primary-book failure (the live source threw
 * `LiveReadError`) becomes a 503 carrying the freshness block — never an empty or older book. Any other
 * throw propagates to the route's error capture.
 */
export async function serveWithFreshness<P extends { readonly fixtures: boolean }>(
  load: () => Promise<P>, isLiveReadError: (e: unknown) => boolean, now: () => number = Date.now,
): Promise<Served<P>> {
  const report: Report = { userId: null, problems: [], threw: false };
  return als.run(report, async () => {
    try {
      const p = await load();
      const source = p.fixtures ? "fixtures" : report.userId ? "zoho" : "none";
      return { status: 200 as const, body: { ...p, fresh: freshnessOf({ source, userId: report.userId, problems: report.problems, threw: false, now: now() }) } };
    } catch (e) {
      if (!isLiveReadError(e)) throw e;
      return { status: 503 as const, body: { error: "source-unavailable" as const, fresh: freshnessOf({ source: "zoho", userId: report.userId, problems: report.problems, threw: true, now: now() }) } };
    }
  });
}
