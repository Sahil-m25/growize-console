/**
 * M03-S02-T01 — THE GRANT STORE: the pages Digital Infrastructure (or an IR Manager, for their own IRs)
 * has granted a person by name, as {page: caps} (D40/D60).
 *
 * Where (OD9, PROVISIONAL — jev decide a=1.00): an app-side, append-only store, not Zoho. Grants are
 * console authority, not investor or lead data (D45 keeps business data in Zoho), no Zoho module for
 * them exists, and agents never write Zoho config. The `GrantStore` interface lets a Zoho-backed store
 * replace this one if Sahil decides OD9 the other way.
 *
 *   GRANT_STORE  "memory" (default on a single-process state store; fixture mode always) | "jsonl" |
 *                "shared" (the default when STATE_STORE=catalyst; refused without it)
 *   GRANT_DIR    absolute directory for the day files; required when GRANT_STORE=jsonl
 *
 * "shared" (docs/architecture/shared-state.md inventory 12): the same lines in a SharedState list
 * (../state/shared-log) that every instance reads, so a grant given on one instance holds on all of them and
 * survives a recycle. The list has no reliable order across instances, so each line carries its slot number and
 * the highest slot for a person+page wins (a later change always gets a higher slot). Reads refresh at most every
 * GRANT_REFRESH_MS (2 s): a grant or a removal reaches the other instances within that.
 *
 * Each change is one line `{at, by, whom, page, caps}` — two Zoho user ids, a page code and cap codes,
 * never a name — appended through server/logs/jsonl.ts (O_APPEND, no rewrite). On start the lines are
 * replayed in order; the last line for a person+page wins, and `caps: null` means "back to the seat's
 * preset" (reset page). A memory store in production loses grants on restart, which fails closed
 * (granted-only seats are refused until re-granted).
 */

import * as path from "node:path";
import type { Cap, CapGrid } from "../../domain";
import { fixtureModeOn } from "../../lib/fixture-mode";
import { createJsonlStore, type AppendOnlyStore } from "../logs/jsonl";
import type { GrantReader } from "./policy";
import { createSharedLog } from "../state/shared-log";
import { instanceStateShared, sharedState } from "../state/runtime";
import type { SharedState } from "../state/shared-state";

const USER_ID = /^\d{15,25}$/;
const CODE = /^[a-z][a-z0-9_]{0,31}$/;

export interface GrantLine {
  readonly at: number;
  /** who changed it (a Zoho user id) */
  readonly by: string;
  /** whose grant (a Zoho user id) */
  readonly whom: string;
  readonly page: string;
  /** the page's caps from now on; null = the per-person grant is removed (back to the seat preset) */
  readonly caps: readonly Cap[] | null;
}

export interface GrantStore {
  /** Everything granted to this person by name. A fresh object; never the store's own. (Async for "shared".) */
  grantsOf(whom: string): CapGrid | Promise<CapGrid>;
  /** Record one page's new caps (null = reset). Throws on a malformed line; nothing is half-written. */
  set(line: GrantLine): void | Promise<void>;
  /** People holding at least one grant line (for the System check / Teams list). */
  holders(): readonly string[] | Promise<readonly string[]>;
}

function cleanLine(x: unknown): GrantLine | null {
  if (typeof x !== "object" || x === null) return null;
  const l = x as Record<string, unknown>;
  if (typeof l.at !== "number" || !Number.isFinite(l.at)) return null;
  if (typeof l.by !== "string" || !USER_ID.test(l.by) || typeof l.whom !== "string" || !USER_ID.test(l.whom)) return null;
  if (typeof l.page !== "string" || !CODE.test(l.page)) return null;
  let caps: Cap[] | null = null;
  if (l.caps !== null) {
    if (!Array.isArray(l.caps) || !l.caps.every((c) => typeof c === "string" && CODE.test(c))) return null;
    caps = [...new Set(l.caps as Cap[])];
  }
  return Object.freeze({ at: l.at, by: l.by, whom: l.whom, page: l.page, caps: caps && Object.freeze(caps) });
}

export function createGrantStore(o: { readonly backing?: AppendOnlyStore | null } = {}): GrantStore {
  const grid = new Map<string, Map<string, Cap[]>>();
  const apply = (l: GrantLine) => {
    const g = grid.get(l.whom) ?? new Map<string, Cap[]>();
    if (l.caps === null) g.delete(l.page);
    else g.set(l.page, l.caps.slice());
    if (g.size) grid.set(l.whom, g);
    else grid.delete(l.whom);
  };
  const backing = o.backing ?? null;
  if (backing) for (const day of backing.days()) for (const raw of backing.read(day)) { const l = cleanLine(raw); if (l) apply(l); }

  return Object.freeze({
    grantsOf(whom: string): CapGrid {
      const g = grid.get(whom);
      const out: Record<string, Cap[]> = {};
      if (g) for (const [p, caps] of g) out[p] = caps.slice();
      return out as CapGrid;
    },
    set(line: GrantLine): void {
      const l = cleanLine(line);
      if (!l) throw new TypeError("A grant line holds two Zoho user ids, a page code and cap codes.");
      backing?.append(l);   /* durable first: a failed append changes nothing */
      apply(l);
    },
    holders: () => Object.freeze([...grid.keys()]),
  });
}

export const GRANT_REFRESH_MS = 2_000;

/**
 * The grant store on SharedState: one shared list of grant lines (ids and codes only, rule 7). A store failure
 * rejects: the door then fails closed (a granted-only seat is refused), a grant change answers an error.
 */
export function createSharedGrantStore(state: SharedState, o: { readonly clock?: () => number; readonly refreshMs?: number } = {}): GrantStore {
  const clock = o.clock ?? Date.now;
  const refreshMs = o.refreshMs ?? GRANT_REFRESH_MS;
  const log = createSharedLog(state, "grants");
  const reader = log.reader();
  const grid = new Map<string, Map<string, { n: number; caps: Cap[] | null }>>();
  let lastAt = -Infinity;
  let running: Promise<void> | null = null;
  const apply = (n: number, l: GrantLine) => {
    const g = grid.get(l.whom) ?? new Map<string, { n: number; caps: Cap[] | null }>();
    const cur = g.get(l.page);
    if (cur && cur.n > n) return;
    g.set(l.page, { n, caps: l.caps === null ? null : l.caps.slice() });
    grid.set(l.whom, g);
  };
  const refresh = (force: boolean): Promise<void> => {
    if (!force && clock() - lastAt < refreshMs) return Promise.resolve();
    running ??= (async () => {
      try {
        for (const { n, line } of await reader.poll()) {
          let raw: unknown = null;
          try { raw = JSON.parse(line); } catch { raw = null; }
          const l = cleanLine(raw);
          if (l) apply(n, l);
        }
        lastAt = clock();
      } finally { running = null; }
    })();
    return running;
  };
  const live = (whom: string): Record<string, Cap[]> => {
    const out: Record<string, Cap[]> = {};
    for (const [p, v] of grid.get(whom) ?? []) if (v.caps) out[p] = v.caps.slice();
    return out;
  };
  return Object.freeze({
    async grantsOf(whom: string): Promise<CapGrid> {
      await refresh(false);
      return live(whom) as CapGrid;
    },
    async set(line: GrantLine): Promise<void> {
      const l = cleanLine(line);
      if (!l) throw new TypeError("A grant line holds two Zoho user ids, a page code and cap codes.");
      const n = await log.append(JSON.stringify(l));   /* durable first: a failed append changes nothing */
      apply(n, l);
      await refresh(true).catch(() => { /* our own line is applied; the rest arrives on the next read */ });
    },
    async holders(): Promise<readonly string[]> {
      await refresh(false);
      return Object.freeze([...grid.keys()].filter((w) => Object.keys(live(w)).length > 0));
    },
  });
}

/** The GrantReader the sign-in door, the route guard and the session refresh read. */
export const grantReaderOf = (store: GrantStore): GrantReader => Object.freeze({ grantsOf: (who: string) => store.grantsOf(who) });

export type GrantStoreKind = "memory" | "jsonl" | "shared";

export function grantStoreKind(env: NodeJS.ProcessEnv = process.env): GrantStoreKind {
  if (fixtureModeOn(env)) return "memory";
  const v = (env.GRANT_STORE ?? "").trim();
  if (v === "") return instanceStateShared(env) ? "shared" : "memory";
  if (v === "memory") return "memory";
  if (v === "jsonl") return "jsonl";
  if (v === "shared") {
    if (!instanceStateShared(env)) throw new Error("GRANT_STORE=shared needs STATE_STORE=catalyst (a shared store on one process's memory is not shared).");
    return "shared";
  }
  throw new Error(`GRANT_STORE must be "memory", "jsonl" or "shared".`);
}

export function createGrantStoreFromEnv(env: NodeJS.ProcessEnv = process.env): GrantStore {
  const kind = grantStoreKind(env);
  if (kind === "memory") return createGrantStore();
  if (kind === "shared") return createSharedGrantStore(sharedState());
  const dir = (env.GRANT_DIR ?? "").trim();
  if (!dir || !path.isAbsolute(dir)) throw new Error("GRANT_DIR (absolute) is required when GRANT_STORE=jsonl.");
  return createGrantStore({ backing: createJsonlStore({ dir, plane: "grants" }) });
}

const G = globalThis as typeof globalThis & { __gzGrantStore?: GrantStore };

/** The one grant store of this process (kept across dev reloads). */
export function sharedGrantStore(): GrantStore {
  G.__gzGrantStore ??= createGrantStoreFromEnv();
  return G.__gzGrantStore;
}

/** The process's GrantReader — what every door reads instead of NO_GRANTS. */
export const sharedGrantReader = (): GrantReader => ({ grantsOf: (who: string) => sharedGrantStore().grantsOf(who) });
