/**
 * The `memory` SharedState adapter: one process's Map. The default, and exactly what the console did before the
 * interface existed. Correct only while one instance serves (docs/architecture/shared-state.md). Every operation
 * runs to completion synchronously inside its promise, so claim/incr/take are atomic within the process.
 *
 * Bounded: past MAX_ENTRIES, expired entries are swept; if still full, entries that carry an expiry are dropped
 * (buckets, windows, short claims: forgetting one early only makes a limit forget a caller). Entries without an
 * expiry (step-up locks and failure counts) are never evicted.
 */

import { bucketStep, checkKey, checkTtl, checkValue, expiryOf, NO_EXPIRY, type SharedState } from "./shared-state";

export const MAX_ENTRIES = 50_000;

type Entry = { v: string; exp: number };

export function createMemoryState(options: { clock?: () => number; maxEntries?: number } = {}): SharedState & { readonly size: () => number } {
  const clock = options.clock ?? Date.now;
  const max = options.maxEntries ?? MAX_ENTRIES;
  const m = new Map<string, Entry>();

  const live = (key: string, now: number): Entry | null => {
    const e = m.get(key);
    if (!e) return null;
    if (now >= e.exp) { m.delete(key); return null; }
    return e;
  };
  const put = (key: string, e: Entry, now: number): void => {
    if (!m.has(key) && m.size >= max) {
      for (const [k, x] of m) if (now >= x.exp) m.delete(k);
      if (m.size >= max) for (const [k, x] of m) { if (x.exp !== NO_EXPIRY) m.delete(k); if (m.size < max) break; }
    }
    m.set(key, e);
  };

  return Object.freeze({
    kind: "memory",
    size: () => m.size,
    async claim(key: string, ttlSeconds?: number) {
      const k = checkKey(key), ttl = checkTtl(ttlSeconds), now = clock();
      if (live(k, now)) return false;
      put(k, { v: "1", exp: expiryOf(now, ttl) }, now);
      return true;
    },
    async release(key: string) { m.delete(checkKey(key)); },
    async get(key: string) { return live(checkKey(key), clock())?.v ?? null; },
    async set(key: string, value: string, ttlSeconds?: number) {
      const k = checkKey(key), v = checkValue(value), ttl = checkTtl(ttlSeconds), now = clock();
      put(k, { v, exp: expiryOf(now, ttl) }, now);
    },
    async incr(key: string, ttlSeconds?: number) {
      const k = checkKey(key), ttl = checkTtl(ttlSeconds), now = clock();
      const e = live(k, now);
      const n = (e ? Number(e.v) || 0 : 0) + 1;
      put(k, { v: String(n), exp: e ? e.exp : expiryOf(now, ttl) }, now);
      return n;
    },
    async take(key: string, capacity: number, refillPerMinute: number) {
      const k = checkKey(key), now = clock();
      const e = live(k, now);
      let prev: { tokens: number; at: number } | null = null;
      if (e) { try { prev = JSON.parse(e.v) as { tokens: number; at: number }; } catch { prev = null; } }
      const step = bucketStep(prev, capacity, refillPerMinute, now);
      put(k, { v: JSON.stringify(step.next), exp: now + step.fullInMs }, now);
      return step.waitMs;
    },
  });
}
