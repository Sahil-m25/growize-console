/**
 * A SHARED APPEND-ONLY LIST ON SharedState (docs/architecture/shared-state.md, "Built on SharedState").
 *
 * SharedState has no scan, so a list that every instance must see is a counter plus numbered slots:
 *   append(line)  n = incr("<ns>|seq"), then set("<ns>|<n>", line)
 *   reader.poll() every line written since this reader last looked, at least once each, in NO particular order
 *
 * A slot can be missing for a moment (the writer's incr landed, its set not yet) or forever (the writer crashed
 * between the two, or its set failed and it reported the failure). A reader therefore never waits on a gap: it
 * returns what it finds, keeps the missing slot numbers as "holes", re-reads them on the next polls and gives a
 * hole up after `holeMs`. Users of this list must not depend on order (grants: the highest slot per key wins;
 * the outbox: a set of event ids).
 *
 * Values carry ids and codes only (rule 7), exactly like every other SharedState value.
 */

import type { SharedState } from "./shared-state";

export interface SharedLog {
  readonly ns: string;
  /** Write one line; resolves its slot number. Rejects with SharedStateError when the store cannot answer. */
  append(line: string): Promise<number>;
  /** The highest slot number handed out so far (0 when none). */
  head(): Promise<number>;
  /** Read one slot (null when missing or expired). */
  at(n: number): Promise<string | null>;
  reader(o?: { readonly from?: number }): SharedLogReader;
}

export interface SharedLogReader {
  /** New lines since the last poll (and holes that have since been written). */
  poll(): Promise<ReadonlyArray<{ readonly n: number; readonly line: string }>>;
  /** Every slot up to here has been read or given up, except the holes. */
  readonly cursor: () => number;
  readonly holes: () => readonly number[];
}

export interface SharedLogOptions {
  /** Slot expiry (seconds); omitted = slots live until released. The counter never expires. */
  readonly ttlSeconds?: number;
  /** How long a missing slot is re-checked before a reader gives it up (default 10 minutes). */
  readonly holeMs?: number;
  /** Slots read in parallel per round (default 25). */
  readonly batch?: number;
  /** At most this many slots read per poll (default 2,000); the rest on the next poll. */
  readonly maxPerPoll?: number;
  readonly clock?: () => number;
}

const NS = /^[a-z][a-z0-9-]{0,31}$/;

export function createSharedLog(state: SharedState, ns: string, o: SharedLogOptions = {}): SharedLog {
  if (!NS.test(ns)) throw new TypeError("A shared log name is a short lower-case code.");
  const clock = o.clock ?? Date.now;
  const holeMs = o.holeMs ?? 10 * 60_000;
  const batch = Math.max(1, o.batch ?? 25);
  const maxPerPoll = Math.max(1, o.maxPerPoll ?? 2_000);
  const seqKey = `log|${ns}|seq`;
  const slotKey = (n: number) => `log|${ns}|${n}`;

  const log: SharedLog = {
    ns,
    async append(line: string) {
      const n = await state.incr(seqKey);
      await state.set(slotKey(n), line, o.ttlSeconds);
      return n;
    },
    async head() {
      const v = await state.get(seqKey);
      const n = v === null ? 0 : Number(v);
      return Number.isSafeInteger(n) && n > 0 ? n : 0;
    },
    at: (n: number) => state.get(slotKey(n)),
    reader(r: { readonly from?: number } = {}): SharedLogReader {
      let cursor = Math.max(0, Math.floor(r.from ?? 0));
      const holes = new Map<number, number>();   // slot → first seen missing (ms)
      return {
        cursor: () => cursor,
        holes: () => [...holes.keys()].sort((a, b) => a - b),
        async poll() {
          const now = clock();
          const head = await log.head();
          const want = [...holes.keys()];
          for (let n = cursor + 1; n <= head && want.length < maxPerPoll + holes.size; n++) want.push(n);
          const out: { n: number; line: string }[] = [];
          for (let i = 0; i < want.length; i += batch) {
            const part = want.slice(i, i + batch);
            const got = await Promise.all(part.map((n) => log.at(n)));
            part.forEach((n, j) => {
              const v = got[j];
              if (n > cursor) cursor = n;
              if (v === null || v === undefined) {
                const first = holes.get(n) ?? now;
                if (now - first >= holeMs) holes.delete(n); else holes.set(n, first);
              } else {
                holes.delete(n);
                out.push({ n, line: v });
              }
            });
          }
          return out;
        },
      };
    },
  };
  return Object.freeze(log);
}
