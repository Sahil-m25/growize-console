/**
 * M03-S02-T01 — THE GRANT STORE: the pages Digital Infrastructure (or an IR Manager, for their own IRs)
 * has granted a person by name, as {page: caps} (D40/D60).
 *
 * Where (OD9, PROVISIONAL — jev decide a=1.00): an app-side, append-only store, not Zoho. Grants are
 * console authority, not investor or lead data (D45 keeps business data in Zoho), no Zoho module for
 * them exists, and agents never write Zoho config. The `GrantStore` interface lets a Zoho-backed store
 * replace this one if Sahil decides OD9 the other way.
 *
 *   GRANT_STORE  "memory" (default; fixture mode always) | "jsonl"
 *   GRANT_DIR    absolute directory for the day files; required when GRANT_STORE=jsonl
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
  /** Everything granted to this person by name. A fresh object; never the store's own. */
  grantsOf(whom: string): CapGrid;
  /** Record one page's new caps (null = reset). Throws on a malformed line; nothing is half-written. */
  set(line: GrantLine): void;
  /** People holding at least one grant line (for the System check / Teams list). */
  holders(): readonly string[];
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

/** The GrantReader the sign-in door, the route guard and the session refresh read. */
export const grantReaderOf = (store: GrantStore): GrantReader => Object.freeze({ grantsOf: (who: string) => store.grantsOf(who) });

export type GrantStoreKind = "memory" | "jsonl";

export function grantStoreKind(env: NodeJS.ProcessEnv = process.env): GrantStoreKind {
  if (fixtureModeOn(env)) return "memory";
  const v = (env.GRANT_STORE ?? "").trim();
  if (v === "" || v === "memory") return "memory";
  if (v === "jsonl") return "jsonl";
  throw new Error(`GRANT_STORE must be "memory" or "jsonl".`);
}

export function createGrantStoreFromEnv(env: NodeJS.ProcessEnv = process.env): GrantStore {
  if (grantStoreKind(env) === "memory") return createGrantStore();
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
