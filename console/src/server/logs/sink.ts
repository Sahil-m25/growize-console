/**
 * THE SINK INTERFACE FOR PLANES B AND C (docs/architecture/log-sink.md).
 *
 * One durable store per plane ("ops", "identity", "errors"). Writes are synchronous and never wait on the
 * network: the file adapter appends straight to the day file, the Stratus adapter (./stratus.ts) buffers and
 * uploads segments. Reads are by UTC day and asynchronous, because a durable store may be remote.
 *
 *   file      the append-only day files under LOG_DIR (./jsonl.ts) — the behaviour before this interface
 *   stratus   batched segment objects plus a manifest each, in a Catalyst Stratus bucket (./stratus.ts)
 *
 * The identity guard (./guard.ts) runs in the factory before any adapter sees a line; Plane C's hash chain
 * (./chain.ts) is added after the guard by `withChain`, so the chain fields are our own hex, never caller data.
 */

import type { ChainLinker, StoredSegment } from "./chain";
import { dayOf, type AppendOnlyStore } from "./jsonl";

export type StorePlane = "ops" | "identity" | "errors";

export interface PlaneStore {
  readonly plane: string;
  /** Keep one guarded record. Never waits on the network; throws only if the line cannot be accepted. */
  append(record: object): void;
  /** The days this store holds, oldest first. */
  days(): Promise<readonly string[]>;
  /** One day's lines in stored order; torn or edited parts are left out (verification reports them). */
  read(day: string): Promise<readonly unknown[]>;
  /** One day as stored, segment by segment, for the chain verifier. */
  segments(day: string): Promise<readonly StoredSegment[]>;
  /** Push whatever is buffered (a no-op for the file adapter). */
  flush(): Promise<void>;
}

/** The file adapter: the existing jsonl day files, behind the async interface. */
export function fileStore(s: AppendOnlyStore): PlaneStore {
  return Object.freeze({
    plane: s.plane,
    append: (record: object) => s.append(record),
    days: async () => s.days(),
    read: async (day: string) => s.read(day),
    segments: async (day: string): Promise<readonly StoredSegment[]> =>
      (s.days().includes(day) ? [Object.freeze({ key: `${s.plane}-${day}.jsonl`, manifest: null, lines: s.read(day), problem: null })] : []),
    flush: async () => {},
  });
}

/** Plane C: every record is linked into this instance's chain before it is stored; the chain advances only once it is kept. */
export function withChain(store: PlaneStore, linker: ChainLinker, clock: () => number = Date.now): PlaneStore {
  return Object.freeze({
    ...store,
    append(record: object): void {
      const day = dayOf(clock());
      const line = linker.link(record, day);
      store.append(line);
      linker.commit(line, day);
    },
  });
}
