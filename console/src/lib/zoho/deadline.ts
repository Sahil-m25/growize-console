/**
 * M18-S09-NOTE-3 — THE REQUEST DEADLINE, AND ZOHO'S PER-ATTEMPT TIMEOUT (docs/architecture/catalyst-limits-audit.md §2.1).
 *
 * AppSail answers 504 at 30 s and may leave the handler running, so a write the person was told "failed" could still
 * land. Every route therefore gets its own deadline (REQUEST_DEADLINE_MS, default 25 s) inside `withErrorCapture`
 * (server/http/error-capture.ts): one AbortSignal = the request's own signal + the deadline timer, which the handler
 * sees as `request.signal`, and which this module also carries in AsyncLocalStorage so a Zoho call made without a
 * signal is still bound by it. The Zoho client (client.ts) adds a per-attempt timeout (ZOHO_ATTEMPT_TIMEOUT_MS,
 * default 10 s) and never sleeps for a retry that would end past the deadline.
 *
 * The three routes that cannot fit (statements auto-match, event sheet load, KAM seat change) ask `remainingMs()`
 * before each unit of work and stop early with a resumable answer, rather than being cut off mid-write.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_REQUEST_DEADLINE_MS = 25_000;
export const DEFAULT_ZOHO_ATTEMPT_TIMEOUT_MS = 10_000;
/** Work that may take one more round of Zoho calls is not started with less than this left (one attempt + slack). */
export const DEFAULT_STOP_MARGIN_MS = 8_000;

/** The reason a deadline aborts with (signal.reason). */
export class DeadlineExceeded extends Error {
  constructor() {
    super("request deadline exceeded");
    this.name = "DeadlineExceeded";
  }
}

export interface Deadline {
  /** request signal + deadline timer */
  readonly signal: AbortSignal;
  /** epoch ms (Date.now) at which the deadline fires */
  readonly at: number;
}

const store = new AsyncLocalStorage<Deadline>();

const envMs = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** REQUEST_DEADLINE_MS (1 s – 29 s; anything else falls back to 25 s, under AppSail's 30 s). */
export const requestDeadlineMs = (env: NodeJS.ProcessEnv = process.env): number =>
  envMs(env.REQUEST_DEADLINE_MS, DEFAULT_REQUEST_DEADLINE_MS, 1_000, 29_000);

/** ZOHO_ATTEMPT_TIMEOUT_MS (100 ms – 29 s; default 10 s). */
export const zohoAttemptTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number =>
  envMs(env.ZOHO_ATTEMPT_TIMEOUT_MS, DEFAULT_ZOHO_ATTEMPT_TIMEOUT_MS, 100, 29_000);

/** Run `fn` with `deadline` as the current request's deadline. */
export const runWithDeadline = <T>(deadline: Deadline, fn: () => T): T => store.run(deadline, fn);

/** The current request's deadline, or null outside a wrapped route (a background job, a test). */
export const currentDeadline = (): Deadline | null => store.getStore() ?? null;

/** Milliseconds left on the current request's deadline; Infinity when there is none. */
export function remainingMs(now: number = Date.now()): number {
  const d = store.getStore();
  if (!d) return Infinity;
  return d.signal.aborted ? 0 : Math.max(0, d.at - now);
}

/** True when less than `marginMs` is left: do not start another unit of work. */
export const pastStopMargin = (marginMs: number = DEFAULT_STOP_MARGIN_MS): boolean => remainingMs() < marginMs;

/** The signals given, combined (undefined ones dropped; one alone is returned as-is). */
export function anySignal(...signals: readonly (AbortSignal | null | undefined)[]): AbortSignal | undefined {
  const xs = [...new Set(signals.filter((s): s is AbortSignal => !!s))];
  if (xs.length <= 1) return xs[0];
  return AbortSignal.any(xs);
}

/**
 * Bounded concurrency: run `fn` over `items`, at most `limit` at a time, in order of start. Before starting each item
 * `stop()` is asked; once it says true no further item starts and the rest are returned unstarted (in order).
 * Never rejects on account of `fn`: each settled result is passed through as returned (`fn` decides what a failure is).
 */
export async function runBounded<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>,
  stop: () => boolean = () => false): Promise<{ readonly done: readonly { readonly index: number; readonly value: R }[]; readonly notStarted: readonly number[] }> {
  const n = Math.max(1, Math.floor(limit));
  const done: { index: number; value: R }[] = [];
  let next = 0, halted = false;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (halted || next >= items.length) return;
      if (stop()) { halted = true; return; }
      const i = next++;
      done.push({ index: i, value: await fn(items[i]!, i) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  const started = new Set(done.map((d) => d.index));
  const notStarted: number[] = [];
  for (let i = 0; i < items.length; i++) if (!started.has(i)) notStarted.push(i);
  done.sort((a, b) => a.index - b.index);
  return { done, notStarted };
}
