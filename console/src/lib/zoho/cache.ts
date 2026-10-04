/**
 * THE SCOPED CACHE — COUNTS, NOT RECORDS; KEYED BY WHO MAY SEE THEM; NEVER OLDER THAN FIVE MINUTES.
 *
 * Implements D45 (a cache is allowed, a copy is not, and the TypeSafe-pass guards that stop the one
 * becoming the other), D46 (the server-side cache is a week-one concern, because sub-concurrency 10
 * is what binds), D52 (the shared server cache is a named leak path: aggregates and counts only) and
 * D53 (every entry keyed by visibility scope; nothing is shared by query alone).
 *
 * Four rules, each enforced here rather than left to the caller's good manners:
 *
 * 1. Every key carries a scope — one user, one manager's subtree, or one role — and a key can only
 *    be minted by `cacheKey(scope, name)`. There is no unscoped key: `Scope` has no global variant,
 *    a hand-built object literal fails to compile for want of the brand, and a cast-forged object is
 *    refused at runtime because it was never minted. The same COQL aggregate returns different
 *    numbers to an IR and to their manager (D53); a key without a scope would serve the manager's
 *    team-wide figure to an IR who may only see their own book.
 * 2. Values are aggregates and counts: a number, a record of numbers, or a list of `{key, count}`
 *    buckets. A lead, a name or a phone number cannot be typed into it, and one smuggled past the
 *    types is refused at runtime. If a per-record payload could sit here, the cache would be a copy
 *    of lead data under another name — the thing D45 forbids — and a shared one at that (D52).
 * 3. Nothing older than five minutes is ever returned, fresh or stale. TTL defaults to 45 s (inside
 *    D45's 30–60 s band); a TTL above `MAX_AGE_MS` is a thrown RangeError, not a clamp, so a caller
 *    who asked for ten minutes finds out at once. The ceiling is re-checked on every read, so a store
 *    holding a longer TTL (a future Redis with a wrong EXPIRE) still cannot age a number past it.
 * 4. A read is always a tagged result that says how old its number is. When a live load fails and
 *    the entry is past its TTL, the old value is dropped and the caller gets `error` — never the old
 *    number served as though nothing happened. That is the exact failure that let the mirror drift
 *    for weeks behind a dead webhook (D45, TypeSafe pass (a)).
 *
 * Between its TTL and the ceiling an entry is `stale-but-refreshing`: returned once, labelled with
 * its age, while one refresh runs. If that refresh fails, the value is gone. Every value here came
 * from a loader the cache itself called, at a time it recorded, so `asOf` is always honest — which
 * is why there is no `set()`. The cache has no write path into Zoho and no sync job, and it is
 * private to the request path: an export or a report reads Zoho, never this.
 *
 * Storage sits behind `CacheStore`, so the in-memory map can become Redis without a caller changing
 * (the store is already async for that reason). Single-flight is per process: concurrent reads of
 * one key cost one upstream call.
 */

/** D45's 30–60 s band for aggregates and badge counts; the middle of it. */
export const DEFAULT_TTL_MS = 45_000;
/** The hard ceiling (D45 TypeSafe pass, restated by D53). Not configurable, by design. */
export const MAX_AGE_MS = 300_000;
/** After a failed load, how long reads report the error before one of them tries again. */
export const DEFAULT_ERROR_HOLD_MS = 5_000;
/** An aggregate with more buckets than this is a per-record listing wearing a count's clothes. */
export const MAX_BUCKETS = 500;
/** A bucket key is a label ("qualified", "E-04", "2026-Q3"), not a sentence and not a name. */
export const MAX_BUCKET_KEY_LENGTH = 80;

/** Who may see a cached number (D53's table). There is deliberately no "global" or "team" kind. */
export type Scope =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "subtree"; readonly managerId: string }
  | { readonly kind: "role"; readonly role: string };

/** One bar of a funnel, one band of an ageing chart, one badge. */
export type CountBucket = { readonly key: string; readonly count: number };

/**
 * Everything the cache may hold. Numbers, records of numbers, lists of `{key, count}` — and nothing
 * with a string value anywhere a name, an email or a phone number could ride (D52: "aggregates and
 * counts only — never a per-record payload").
 */
export type AggregateValue = number | Readonly<Record<string, number>> | readonly CountBucket[];

/**
 * Resolves to `R` when a loader returns an exact aggregate, and to `never` when a bucket carries a
 * field beyond `{key, count}`. TypeScript lets extra fields ride in a subtype, and it drops its
 * excess-property check on an inferred return type, so without this `[{key, count, phone}]` would
 * compile. It is the compile-time half of rule 2; `checkAggregate` is the runtime half.
 */
export type OnlyAggregate<R> = R extends number
  ? R
  : R extends readonly (infer B)[]
    ? [Exclude<keyof B, keyof CountBucket>] extends [never]
      ? R
      : never
    : R extends Readonly<Record<string, number>>
      ? R
      : never;

/** What `read()` calls on a miss or a stale entry: one live Zoho fetch, returning an aggregate. */
export type AggregateLoader<R> = () => Promise<R & OnlyAggregate<R>>;

declare const mintedKey: unique symbol;
declare const carries: unique symbol;

/** A scoped key. Only `cacheKey()` makes one; an object literal of this shape does not compile. */
export type CacheKey<V extends AggregateValue = AggregateValue> = {
  readonly scope: Scope;
  readonly name: string;
  readonly [mintedKey]: true;
  readonly [carries]?: V;
};

export type CacheFresh<V> = {
  readonly state: "fresh";
  readonly value: V;
  /** When the number was true: the moment its live load started. */
  readonly asOf: number;
  readonly ageMs: number;
  /** "live" when this read had to wait for Zoho. */
  readonly origin: "cache" | "live";
};
export type CacheStale<V> = {
  readonly state: "stale-but-refreshing";
  readonly value: V;
  readonly asOf: number;
  readonly ageMs: number;
  /** The refresh already running. If it fails, the value above is gone for every later read. */
  readonly settled: Promise<CacheSettled<V>>;
};
export type CacheMiss<V> = {
  readonly state: "miss";
  /** The live load this read started or joined. */
  readonly settled: Promise<CacheSettled<V>>;
};
export type CacheError<V> = {
  readonly state: "error";
  /** A short class: a ZohoFailure kind, "not-an-aggregate", or "load-failed". Never a body. */
  readonly reason: string;
  /** The thrown value, for the reads that waited on the failing load; null for later reads. */
  readonly error: unknown;
  readonly failedAt: number;
  /** When the last good number was true, so a screen can say how long it has been. */
  readonly lastGoodAt: number | null;
  /** A retry this read started once the error hold elapsed; null while held. */
  readonly settled: Promise<CacheSettled<V>> | null;
};
export type CacheSettled<V> = CacheFresh<V> | CacheError<V>;
export type CacheRead<V> = CacheFresh<V> | CacheStale<V> | CacheMiss<V> | CacheError<V>;

export type ReadOptions = { readonly ttlMs?: number };

/** Remove after a write, or when a Zoho notification says "record X changed". Removing is never a
 *  leak, so a prefix may cross scopes — but an empty selector is a type error, and `clear()` is the
 *  only way to empty everything. */
export type Invalidation =
  | { readonly scope: Scope; readonly prefix?: string }
  | { readonly prefix: string; readonly scope?: undefined };

export type StoredEntry =
  | { readonly kind: "value"; readonly value: AggregateValue; readonly storedAt: number; readonly ttlMs: number }
  | {
      readonly kind: "failed";
      readonly failedAt: number;
      readonly holdUntil: number;
      readonly lastGoodAt: number | null;
      readonly reason: string;
    };

/** The storage seam. A Redis store implements `keys()` with SCAN and sets EXPIRE to `MAX_AGE_MS`,
 *  so the ceiling holds in the store as well as on every read. */
export interface CacheStore {
  get(key: string): Promise<StoredEntry | undefined>;
  set(key: string, entry: StoredEntry): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export interface ScopedCache {
  /** Returns at once with what is known; never waits on Zoho. A miss carries the load it started. */
  read<V extends AggregateValue, R extends V = V>(key: CacheKey<V>, load: AggregateLoader<R>, options?: ReadOptions): Promise<CacheRead<V>>;
  /** As `read`, but waits on a miss or a retry: for server code that must render a number or an error. */
  readSettled<V extends AggregateValue, R extends V = V>(
    key: CacheKey<V>,
    load: AggregateLoader<R>,
    options?: ReadOptions,
  ): Promise<CacheFresh<V> | CacheStale<V> | CacheError<V>>;
  /** Returns how many stored entries were removed. In-flight loads for matching keys are not stored. */
  invalidate(selector: Invalidation): Promise<number>;
  clear(): Promise<void>;
}

/**
 * M15-S05-NOTE-10 — a rolling 24 h count of cache reads and failed loads (the System card's "Cache load errors").
 * Two numbers per hour bucket, no keys, no values: nothing here can hold a record. A read is one `read()` call;
 * an error is one live load that threw (a held error replayed to a later read is not a new failure).
 */
export interface LoadWindow {
  record(kind: "read" | "error"): void;
  /** Reads and failed loads in the 24 h before `now`. */
  totals(now?: number): { readonly reads: number; readonly errors: number };
}
const HOUR = 3_600_000;
export function createLoadWindow(clock: () => number = Date.now): LoadWindow {
  const buckets = new Map<number, { reads: number; errors: number }>();
  const prune = (now: number) => { for (const h of buckets.keys()) if (now - (h + 1) * HOUR >= 24 * HOUR) buckets.delete(h); };
  return {
    record(kind) {
      const now = clock();
      prune(now);
      const h = Math.floor(now / HOUR);
      const b = buckets.get(h) ?? { reads: 0, errors: 0 };
      if (kind === "read") b.reads++; else b.errors++;
      buckets.set(h, b);
    },
    totals(now = clock()) {
      let reads = 0, errors = 0;
      for (const [h, b] of buckets) if (now - (h + 1) * HOUR < 24 * HOUR) { reads += b.reads; errors += b.errors; }
      return { reads, errors };
    },
  };
}
const GW = globalThis as typeof globalThis & { __gzCacheLoads?: LoadWindow };
/** The process-wide window every cache feeds unless it is given its own (tests). Kept across dev reloads. */
export const processLoadWindow = (): LoadWindow => (GW.__gzCacheLoads ??= createLoadWindow());

export type ScopedCacheOptions = {
  readonly loads?: LoadWindow;
  readonly store?: CacheStore;
  readonly clock?: () => number;
  readonly defaultTtlMs?: number;
  readonly errorHoldMs?: number;
};

export class NotAnAggregateError extends TypeError {
  constructor(message: string) {
    super(`The Zoho cache holds aggregates and counts only (D52): ${message}.`);
    this.name = "NotAnAggregateError";
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PREFIX = /^[A-Za-z0-9._:/-]{0,200}$/;
const NO_SCOPE = "A cache key needs a visibility scope — {kind:\"user\"|\"subtree\"|\"role\"} with its id. There is no unscoped key (D53).";
const minted = new WeakSet<object>();

function scopeOf(scope: unknown): Scope {
  if (typeof scope !== "object" || scope === null) throw new TypeError(NO_SCOPE);
  const s = scope as { kind?: unknown; userId?: unknown; managerId?: unknown; role?: unknown };
  const id = s.kind === "user" ? s.userId : s.kind === "subtree" ? s.managerId : s.kind === "role" ? s.role : undefined;
  if (typeof id !== "string" || id.trim() === "" || id.length > 128 || /[\u0000-\u001f]/.test(id)) throw new TypeError(NO_SCOPE);
  if (s.kind === "user") return Object.freeze({ kind: "user", userId: id });
  if (s.kind === "subtree") return Object.freeze({ kind: "subtree", managerId: id });
  return Object.freeze({ kind: "role", role: id });
}

const scopeId = (scope: Scope): string =>
  scope.kind === "user" ? scope.userId : scope.kind === "subtree" ? scope.managerId : scope.role;
const scopePart = (scope: Scope): string => `${scope.kind}:${encodeURIComponent(scopeId(scope))}`;

/** The only way to make a key. The scope is copied (kind and id only) and frozen with the name. */
export function cacheKey<V extends AggregateValue = AggregateValue>(scope: Scope, name: string): CacheKey<V> {
  const frozenScope = scopeOf(scope);
  if (typeof name !== "string" || !NAME.test(name)) {
    throw new TypeError(`Cache key names are short dotted labels ("numbers.funnel"), never data: got ${JSON.stringify(name)}.`);
  }
  const key = Object.freeze({ scope: frozenScope, name }) as CacheKey<V>;
  minted.add(key);
  return key;
}

function keyString(key: unknown): string {
  if (typeof key !== "object" || key === null || !minted.has(key)) {
    throw new TypeError("Cache keys are minted by cacheKey(scope, name); there is no unscoped key (D53).");
  }
  const k = key as CacheKey;
  return `${scopePart(k.scope)}|${k.name}`;
}

function checkTtl(ttl: number): number {
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) throw new RangeError(`A cache TTL must be a positive number of milliseconds, got ${ttl}.`);
  if (ttl > MAX_AGE_MS) throw new RangeError(`A cache TTL of ${ttl} ms is past the five-minute ceiling (${MAX_AGE_MS} ms, D45). Past it a screen fails loud; it does not age quietly into a copy.`);
  return ttl;
}

function checkCount(count: unknown, where: string): number {
  if (typeof count !== "number" || !Number.isFinite(count)) throw new NotAnAggregateError(`${where} must be a finite number`);
  return count;
}

function checkBucketKey(key: unknown, where: string): string {
  if (typeof key !== "string" || key === "" || key.length > MAX_BUCKET_KEY_LENGTH) {
    throw new NotAnAggregateError(`${where} must be a label of 1–${MAX_BUCKET_KEY_LENGTH} characters`);
  }
  return key;
}

/** Validates and returns a frozen copy, so nothing a loader returns can be mutated in the cache. */
function checkAggregate(value: unknown): AggregateValue {
  if (typeof value === "number") return checkCount(value, "a count");
  if (Array.isArray(value)) {
    if (value.length > MAX_BUCKETS) throw new NotAnAggregateError(`${value.length} buckets is a listing, not an aggregate (max ${MAX_BUCKETS})`);
    return Object.freeze(
      value.map((bucket: unknown, i): CountBucket => {
        if (typeof bucket !== "object" || bucket === null || Array.isArray(bucket)) throw new NotAnAggregateError(`bucket ${i} is not {key, count}`);
        const fields = Object.keys(bucket);
        if (fields.length !== 2 || !fields.includes("key") || !fields.includes("count")) {
          throw new NotAnAggregateError(`bucket ${i} must be exactly {key, count}, got {${fields.join(", ")}}`);
        }
        const b = bucket as { key: unknown; count: unknown };
        return Object.freeze({ key: checkBucketKey(b.key, `bucket ${i}'s key`), count: checkCount(b.count, `bucket ${i}'s count`) });
      }),
    );
  }
  if (typeof value === "object" && value !== null) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new NotAnAggregateError("only plain objects of numbers are allowed");
    const entries = Object.entries(value);
    if (entries.length > MAX_BUCKETS) throw new NotAnAggregateError(`${entries.length} keys is a listing, not an aggregate`);
    const out: Record<string, number> = {};
    for (const [k, v] of entries) out[checkBucketKey(k, `key "${k.slice(0, 20)}"`)] = checkCount(v, `the value at one key`);
    return Object.freeze(out);
  }
  throw new NotAnAggregateError(`a ${typeof value} is not a number, a record of numbers, or a list of {key, count}`);
}

function reasonOf(error: unknown): string {
  if (error instanceof NotAnAggregateError) return "not-an-aggregate";
  if (typeof error === "object" && error !== null) {
    const kind = (error as { kind?: unknown }).kind;
    if (typeof kind === "string" && /^[a-z][a-z-]{0,39}$/.test(kind)) return kind;
  }
  return "load-failed";
}

function holdOf(error: unknown, fallback: number): number {
  const after = typeof error === "object" && error !== null ? (error as { retryAfterMs?: unknown }).retryAfterMs : undefined;
  const wanted = typeof after === "number" && Number.isFinite(after) ? Math.max(after, fallback) : fallback;
  return Math.min(wanted, MAX_AGE_MS);
}

const bornAt = (entry: StoredEntry): number => (entry.kind === "value" ? entry.storedAt : entry.failedAt);

export type MemoryStoreOptions = { readonly maxEntries?: number; readonly clock?: () => number };

/** The in-memory store: insertion-ordered, bounded, and swept of anything past the ceiling. */
export function createMemoryStore(options: MemoryStoreOptions = {}): CacheStore {
  const maxEntries = options.maxEntries ?? 10_000;
  const clock = options.clock ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError("maxEntries must be a positive integer.");
  const map = new Map<string, StoredEntry>();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, entry) {
      map.delete(key);
      map.set(key, entry);
      const now = clock();
      for (const [k, e] of map) {
        if (now - bornAt(e) >= MAX_AGE_MS) map.delete(k); // oldest first: stop at the first live one
        else break;
      }
      while (map.size > maxEntries) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
    },
    async delete(key) {
      map.delete(key);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

type Flight = { cancelled: boolean; promise: Promise<CacheSettled<AggregateValue>> };

const quietly = async (work: () => Promise<void>): Promise<boolean> => {
  try {
    await work();
    return true;
  } catch {
    return false; // The store is an optimisation: a failed write costs a later call, never a wrong number.
  }
};

export function createScopedCache(options: ScopedCacheOptions = {}): ScopedCache {
  const clock = options.clock ?? Date.now;
  const store = options.store ?? createMemoryStore({ clock });
  const defaultTtl = checkTtl(options.defaultTtlMs ?? DEFAULT_TTL_MS);
  const errorHold = options.errorHoldMs ?? DEFAULT_ERROR_HOLD_MS;
  if (!Number.isFinite(errorHold) || errorHold < 0 || errorHold > MAX_AGE_MS) throw new RangeError("errorHoldMs must be between 0 and the five-minute ceiling.");
  const flights = new Map<string, Flight>();
  const loads = options.loads ?? processLoadWindow();

  const launch = (k: string, load: () => Promise<AggregateValue>, ttlMs: number, lastGoodAt: number | null): Flight => {
    const startedAt = clock();
    // Registered before the loader runs, so a loader that throws synchronously still lands cleanly.
    const flight = { cancelled: false } as Flight;
    flights.set(k, flight);
    const land = () => {
      if (flights.get(k) === flight) flights.delete(k);
    };
    flight.promise = (async (): Promise<CacheSettled<AggregateValue>> => {
      let value: AggregateValue;
      try {
        value = checkAggregate(await load());
      } catch (error) {
        const failedAt = clock();
        const reason = reasonOf(error);
        loads.record("error");
        if (!flight.cancelled) {
          const marked = await quietly(() =>
            store.set(k, { kind: "failed", failedAt, holdUntil: failedAt + holdOf(error, errorHold), lastGoodAt, reason }),
          );
          // If the marker could not be written, at least make sure the old value is not left behind.
          if (!marked) await quietly(() => store.delete(k));
        }
        land();
        return { state: "error", reason, error, failedAt, lastGoodAt, settled: null };
      }
      if (!flight.cancelled) await quietly(() => store.set(k, { kind: "value", value, storedAt: startedAt, ttlMs }));
      land();
      return { state: "fresh", value, asOf: startedAt, ageMs: Math.max(0, clock() - startedAt), origin: "live" };
    })();
    return flight;
  };

  const read = async <V extends AggregateValue, R extends V = V>(key: CacheKey<V>, load: AggregateLoader<R>, options?: ReadOptions): Promise<CacheRead<V>> => {
    const k = keyString(key);
    loads.record("read");
    const ttlMs = checkTtl(options?.ttlMs ?? defaultTtl);
    const entry = await store.get(k);
    const now = clock();
    const flying = flights.get(k);
    const join = (lastGoodAt: number | null) =>
      (flying ?? launch(k, load, ttlMs, lastGoodAt)).promise as Promise<CacheSettled<V>>;

    if (entry?.kind === "value") {
      const age = now - entry.storedAt;
      if (age >= 0 && age < Math.min(entry.ttlMs, MAX_AGE_MS)) {
        return { state: "fresh", value: entry.value as V, asOf: entry.storedAt, ageMs: age, origin: "cache" };
      }
      if (age >= 0 && age < MAX_AGE_MS) {
        return { state: "stale-but-refreshing", value: entry.value as V, asOf: entry.storedAt, ageMs: age, settled: join(entry.storedAt) };
      }
      await quietly(() => store.delete(k)); // past the ceiling (or a clock that went backwards): never served
      return { state: "miss", settled: join(entry.storedAt) };
    }
    if (entry?.kind === "failed") {
      const since = now - entry.failedAt;
      if (since >= 0 && since < MAX_AGE_MS) {
        const known = { state: "error", reason: entry.reason, error: null, failedAt: entry.failedAt, lastGoodAt: entry.lastGoodAt } as const;
        if (flying) return { ...known, settled: flying.promise as Promise<CacheSettled<V>> };
        if (now < entry.holdUntil) return { ...known, settled: null };
        return { ...known, settled: join(entry.lastGoodAt) };
      }
      await quietly(() => store.delete(k));
      return { state: "miss", settled: join(entry.lastGoodAt) };
    }
    return { state: "miss", settled: join(null) };
  };

  const readSettled = async <V extends AggregateValue, R extends V = V>(
    key: CacheKey<V>,
    load: AggregateLoader<R>,
    options?: ReadOptions,
  ): Promise<CacheFresh<V> | CacheStale<V> | CacheError<V>> => {
    const result = await read(key, load, options);
    if (result.state === "miss") return result.settled;
    if (result.state === "error" && result.settled) return result.settled;
    return result;
  };

  const matcherOf = (selector: Invalidation): ((k: string) => boolean) => {
    if (typeof selector !== "object" || selector === null) throw new TypeError("invalidate() takes {scope} or {prefix}.");
    const prefix = selector.prefix ?? "";
    if (typeof prefix !== "string" || !PREFIX.test(prefix)) throw new TypeError(`Invalid key prefix ${JSON.stringify(prefix)}.`);
    if (selector.scope !== undefined) {
      const head = `${scopePart(scopeOf(selector.scope))}|${prefix}`;
      return (k) => k.startsWith(head);
    }
    if (prefix === "") throw new TypeError("Invalidating across every scope needs a key prefix; clear() empties the cache.");
    return (k) => {
      const bar = k.indexOf("|");
      return bar >= 0 && k.slice(bar + 1).startsWith(prefix);
    };
  };

  const invalidate = async (selector: Invalidation): Promise<number> => {
    const match = matcherOf(selector);
    let removed = 0;
    for (const k of await store.keys()) {
      if (!match(k)) continue;
      await store.delete(k);
      removed++;
    }
    for (const [k, flight] of flights) {
      if (!match(k)) continue;
      flight.cancelled = true; // its waiters still get their answer, labelled with when it started
      flights.delete(k);
    }
    return removed;
  };

  const clear = async (): Promise<void> => {
    for (const k of await store.keys()) await store.delete(k);
    for (const flight of flights.values()) flight.cancelled = true;
    flights.clear();
  };

  return { read, readSettled, invalidate, clear };
}
