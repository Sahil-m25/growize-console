/**
 * M18-S01-T02 — COALESCE IDENTICAL IN-FLIGHT READS: ONE ZOHO CALL FOR A BURST OF THE SAME QUESTION.
 *
 * The scoped cache (cache.ts) already single-flights its aggregates per scope key. Record reads are
 * never cached (D45/D52), so two identical reads by the same person at the same moment — a page
 * mounting two panels on one endpoint, a double click on Refresh, a reload racing its own first
 * render — each spent a gate slot and a Zoho call. This shares the one in flight instead.
 *
 * The key is built by the caller and must carry the acting person (D53: same token, same answer; a
 * different person never joins another's read, even for an identical query). Nothing is kept once
 * the call lands: this is a meeting point, not a cache, so no answer outlives its own request.
 *
 * Aborts: the leader's signal governs the shared call. A joiner that aborts stops waiting at once
 * (the leader carries on). If the leader aborts, a joiner whose own signal is live runs its own call
 * (`retryAlone`) rather than inherit an abort it never asked for.
 */

export const JOIN_ABORTED: unique symbol = Symbol("coalesce.join-aborted");

export interface Flights<T> {
  /**
   * Runs `lead()` if nothing is in flight for `key`, else waits on the one that is.
   * `wasAborted(result)` says whether a shared result is the leader's abort; the joiner then runs
   * `retryAlone()` if its own signal is still live.
   */
  run(key: string, lead: () => Promise<T>, join: {
    readonly signal?: AbortSignal;
    readonly wasAborted: (result: T) => boolean;
    readonly retryAlone: () => Promise<T>;
    readonly onJoinAborted: () => T;
  }): Promise<T>;
  /** Keys in flight right now (tests and the load-test snapshot). */
  size(): number;
  /** How many calls joined one already in flight since creation. */
  joined(): number;
}

function untilAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T | typeof JOIN_ABORTED> {
  if (!signal) return p;
  if (signal.aborted) return Promise.resolve(JOIN_ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(JOIN_ABORTED);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

export function createFlights<T>(): Flights<T> {
  const flying = new Map<string, Promise<T>>();
  let joins = 0;
  return {
    async run(key, lead, join) {
      const current = flying.get(key);
      if (!current) {
        const p: Promise<T> = lead().finally(() => {
          if (flying.get(key) === p) flying.delete(key);
        });
        flying.set(key, p);
        return p;
      }
      joins++;
      const out = await untilAborted(current, join.signal);
      if (out === JOIN_ABORTED) return join.onJoinAborted();
      if (join.wasAborted(out) && !join.signal?.aborted) return join.retryAlone();
      return out;
    },
    size: () => flying.size,
    joined: () => joins,
  };
}
