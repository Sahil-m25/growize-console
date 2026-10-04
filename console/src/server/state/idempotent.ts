/**
 * ONE ANSWER PER IDEMPOTENCY-KEY, ACROSS INSTANCES (docs/architecture/shared-state.md, inventory 13).
 *
 * The money writes (mark-paid, add-paid, record-receipt) used to keep a Map of "this key's first press" per
 * process: a double press that landed on two instances wrote twice. Now:
 *
 *   1. A press already running in THIS process is joined (the same promise, as before).
 *   2. A stored answer for the key is replayed (its fingerprint must match, else "reused").
 *   3. Otherwise `claim(key, ttl)` decides who runs. The winner stores the fingerprint hash, runs, and — when
 *      the answer is one to keep — stores it for the rest of the TTL; when not (a retryable failure) it
 *      releases the claim so the same key may be pressed again.
 *   4. A loser waits for the stored answer (polling, up to `waitMs`), or takes over if the winner released.
 *      Past `waitMs` it answers "busy" and writes nothing.
 *   5. The store failing answers "unavailable": the caller refuses. A money write never runs unguarded.
 *
 * Rule 7: the stored answer is what `save` returns — the caller strips anything identity-like (a UTR, a
 * reference) and `load` puts it back from the replayed request, whose fingerprint matched. Keys and the stored
 * fingerprint are sha256 hashes; the scope (user, session, key) never leaves the process in clear.
 */

import { createHash } from "node:crypto";
import { SharedStateError, type SharedState } from "./shared-state";

export type Once<R> =
  | { readonly kind: "ran"; readonly result: R }
  | { readonly kind: "replay"; readonly result: R }
  | { readonly kind: "reused" }
  | { readonly kind: "busy" }
  | { readonly kind: "unavailable" };

export interface IdempotencyOptions<R> {
  readonly state: SharedState;
  /** A short code: "mark-paid", "add-paid", "record-receipt". */
  readonly ns: string;
  readonly ttlSeconds: number;
  /** Store this answer for replay (and keep the key taken)? False → the key is freed for another press. */
  readonly keep: (r: R) => boolean;
  /** The answer as stored (ids and codes only). */
  readonly save: (r: R) => string;
  /** The stored answer back; null when unreadable (treated as missing). */
  readonly load: (s: string) => R | null;
  /** How long a second press waits for the first's answer from another instance (default 20 s). */
  readonly waitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => number;
}

export const hashOf = (s: string): string => createHash("sha256").update(s).digest("base64url");

export function createIdempotency<R>(o: IdempotencyOptions<R>) {
  const waitMs = o.waitMs ?? 20_000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const clock = o.clock ?? Date.now;
  const local = new Map<string, { readonly fp: string; readonly promise: Promise<R> }>();

  async function attempt(k: string, fp: string, work: () => Promise<R>, startedAt: number): Promise<Once<R>> {
    const claimKey = `idem|${o.ns}|${k}`, fpKey = `idem-fp|${o.ns}|${k}`, ansKey = `idem-ans|${o.ns}|${k}`;
    let pause = 50, waited = 0;
    for (;;) {
      const mine = local.get(k);
      if (mine) {
        if (mine.fp !== fp) return { kind: "reused" };
        return { kind: "replay", result: await mine.promise };
      }
      const ans = await o.state.get(ansKey);
      if (ans !== null) {
        let parsed: { fp?: unknown; a?: unknown } | null = null;
        try { parsed = JSON.parse(ans) as { fp?: unknown; a?: unknown }; } catch { parsed = null; }
        if (parsed && typeof parsed.fp === "string" && typeof parsed.a === "string") {
          if (parsed.fp !== fp) return { kind: "reused" };
          const r = o.load(parsed.a);
          if (r !== null) return { kind: "replay", result: r };
        }
      }
      if (await o.state.claim(claimKey, o.ttlSeconds)) {
        // Another press in this process may have claimed between our checks; the local map is checked again.
        const promise = (async () => {
          await o.state.set(fpKey, fp, o.ttlSeconds);
          return work();
        })();
        local.set(k, { fp, promise });
        let r: R;
        try { r = await promise; } catch (e) {
          local.delete(k);
          await Promise.allSettled([o.state.release(fpKey), o.state.release(claimKey)]);
          throw e;
        }
        try {
          if (o.keep(r)) await o.state.set(ansKey, JSON.stringify({ fp, a: o.save(r) }), o.ttlSeconds);
          else { await o.state.release(fpKey); await o.state.release(claimKey); }
        } catch { /* the answer stands; a kept key stays claimed until its TTL, so nothing runs twice */ }
        local.delete(k);
        return { kind: "ran", result: r };
      }
      const held = await o.state.get(fpKey);
      if (held !== null && held !== fp) return { kind: "reused" };
      if (waited >= waitMs || clock() - startedAt >= waitMs) return { kind: "busy" };
      await sleep(pause);
      waited += pause;
      pause = Math.min(1_000, pause * 2);
    }
  }

  return Object.freeze({
    /**
     * Run `work` once for `scope` (who + key) with this `fingerprint` (what the press asks for).
     * `work` throwing frees the key and rethrows.
     */
    async once(scope: string, fingerprint: string, work: () => Promise<R>): Promise<Once<R>> {
      const k = hashOf(scope), fp = hashOf(fingerprint);
      try { return await attempt(k, fp, work, clock()); } catch (e) {
        if (e instanceof SharedStateError) return { kind: "unavailable" };
        throw e;
      }
    },
  });
}
