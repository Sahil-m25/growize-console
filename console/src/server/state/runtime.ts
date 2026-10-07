/**
 * Which SharedState this process uses — chosen once from STATE_STORE (docs/architecture/shared-state.md):
 *
 *   unset | "memory"   the in-process adapter (one instance only; what the console always did)
 *   "catalyst"         Zoho Catalyst NoSQL (./catalyst.ts) — every GZ_STATE_* variable (legacy CATALYST_* names still read as a fallback) must be right
 *
 * Fails closed: an unknown value or a misconfigured catalyst store throws, here and at server start
 * (src/instrumentation.ts runs `startupCheck`, which also makes one live claim/release round trip). It never
 * falls back to memory: a multi-instance host on memory would silently multiply every limit and dedupe nothing.
 */

import { randomUUID } from "node:crypto";
import { catalystConfigFromEnv, createCatalystState, type CatalystDeps } from "./catalyst";
import { createMemoryState } from "./memory";
import { SharedStateError, type SharedState } from "./shared-state";

export type StateStoreKind = "memory" | "catalyst";

export function stateStoreKind(env: NodeJS.ProcessEnv = process.env): StateStoreKind {
  const v = (env.STATE_STORE ?? "").trim();
  if (v === "" || v === "memory") return "memory";
  if (v === "catalyst") return "catalyst";
  throw new Error(`STATE_STORE must be "memory" or "catalyst" (got an unknown value).`);
}

/**
 * True when the per-instance items (webhook seen-ids, the request index, the push outbox queue, and — unless
 * GRANT_STORE says otherwise — the grant store) live in SharedState instead of this process's memory/day files.
 * Follows STATE_STORE: a multi-instance host sets STATE_STORE=catalyst and gets all of them at once; a
 * single-instance host keeps the file behaviour it always had (docs/architecture/shared-state.md).
 */
export function instanceStateShared(env: NodeJS.ProcessEnv = process.env): boolean {
  return stateStoreKind(env) === "catalyst";
}

export function createStateFromEnv(env: NodeJS.ProcessEnv = process.env, deps: CatalystDeps = {}): SharedState {
  return stateStoreKind(env) === "catalyst" ? createCatalystState(catalystConfigFromEnv(env), deps) : createMemoryState();
}

const G = globalThis as typeof globalThis & { __gzSharedState?: SharedState };

/** The process's one SharedState (kept across dev reloads). Throws when STATE_STORE is misconfigured. */
export function sharedState(): SharedState {
  return (G.__gzSharedState ??= createStateFromEnv());
}

export interface ProbeOptions {
  /** Total tries when the store answers "unavailable" (429/5xx/network). Default 4. */
  readonly attempts?: number;
  /** Wait before retry n (ms). Default 500, 1000, 2000, 4000. */
  readonly backoffMs?: readonly number[];
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Prove the store answers: claim a throwaway key, see a second claim refused, release it. Throws on failure.
 * A transient SharedStateError("unavailable") is retried (up to 4 attempts, ~0.5/1/2 s between them) so a brief
 * Catalyst blip at deploy time does not refuse the start; anything else (bad config, non-atomic claim) fails at once.
 */
export async function probeState(state: SharedState, opts: ProbeOptions = {}): Promise<void> {
  const attempts = Math.max(1, opts.attempts ?? 4);
  const backoff = opts.backoffMs ?? [500, 1_000, 2_000, 4_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    const key = `startup-probe|${randomUUID()}`;
    let first: boolean, second: boolean;
    try {
      first = await state.claim(key, 60);
      second = await state.claim(key, 60);
      await state.release(key);
    } catch (e) {
      const transient = e instanceof SharedStateError && e.code === "unavailable";
      if (transient && attempt < attempts) { await sleep(backoff[attempt - 1] ?? backoff[backoff.length - 1] ?? 500); continue; }
      throw new Error(`STATE_STORE=${state.kind}: the shared state store did not answer at startup${attempts > 1 && transient ? ` after ${attempt} attempts` : ""} (${e instanceof Error ? e.message : "unknown"}).`);
    }
    if (!first || second) throw new Error(`STATE_STORE=${state.kind}: claim() is not set-if-absent on this store (first ${first}, second ${second}); refusing to start.`);
    return;
  }
}

/** Server start (src/instrumentation.ts): build the store from env and, unless memory, probe it. */
export async function startupCheck(): Promise<StateStoreKind> {
  const state = sharedState();
  if (state.kind !== "memory") await probeState(state);
  return state.kind as StateStoreKind;
}
