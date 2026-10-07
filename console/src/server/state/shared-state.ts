/**
 * SHARED STATE — the few counters, claims and short-lived values that must agree across every instance of the
 * console and survive one being recycled (docs/architecture/shared-state.md has the inventory and the reasons).
 *
 * Not a store of records (rule 1, D45): nothing here is a copy of a Zoho fact. Keys and values are opaque
 * short strings: hashes, ids, numbers. Never put an identity field (PAN, bank, Aadhaar, a reference) in a key or
 * a value (rule 7); the catalyst adapter hashes every key before it leaves the process as a second guard.
 *
 * Adapters: `memory` (the default; the single-process behaviour the console always had) and `catalyst`
 * (Zoho Catalyst NoSQL over REST, selected only by STATE_STORE=catalyst; ./catalyst.ts). Pick one with
 * ./runtime.ts `sharedState()`; never construct an adapter in a route.
 *
 * Every method may reject with SharedStateError when the backend cannot answer. Callers decide what that means
 * (the rate limiter lets the request through; a webhook asks the sender to redeliver; step-up refuses). An
 * adapter never answers "absent" or "claimed" to cover a failure.
 */

export interface SharedState {
  /** Which adapter this is ("memory" | "catalyst"), for the startup line and tests. */
  readonly kind: string;
  /**
   * Set-if-absent. True when this caller now holds `key`; false when it was already held and not expired.
   * Atomic across instances on every adapter (this is the one primitive dedupe and locks rely on).
   * `ttlSeconds` omitted = held until `release` (a lock lifted only by a person).
   */
  claim(key: string, ttlSeconds?: number): Promise<boolean>;
  /** Forget `key`, whatever wrote it (a claim, a value, a counter, a bucket). Idempotent. */
  release(key: string): Promise<void>;
  /** The value last `set`, or null when absent or expired. */
  get(key: string): Promise<string | null>;
  /** Write a value, replacing any. `ttlSeconds` omitted = no expiry. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /**
   * Add one and return the new count. The first incr (or the first after expiry) starts at 1 and fixes the expiry
   * at now + ttlSeconds; later ones keep it (a fixed window). Memory: exact. Catalyst: read + conditional write,
   * retried; under heavy contention it rejects with SharedStateError("contended") rather than lose a count.
   */
  incr(key: string, ttlSeconds?: number): Promise<number>;
  /**
   * Token bucket: refill `refillPerMinute` per minute up to `capacity`, then take one token. Resolves 0 when a
   * token was taken, else the milliseconds until one will be available (nothing taken). Same contention rule as
   * incr. Exists because a fixed-window incr would change the limiter's burst and Retry-After behaviour.
   */
  take(key: string, capacity: number, refillPerMinute: number): Promise<number>;
}

export type SharedStateFailure = "unavailable" | "contended" | "bad-response" | "bad-key";

/** Optional structured detail for diagnostics (never a token or a value): where it failed, the HTTP status, the backend's own code. */
export interface SharedStateErrorDetail {
  readonly stage?: "token" | "network" | "http" | "item";
  readonly httpStatus?: number;
  readonly catalystCode?: string;
}

export class SharedStateError extends Error {
  constructor(readonly code: SharedStateFailure, message?: string, readonly detail: SharedStateErrorDetail = {}) {
    super(message ?? `shared state: ${code}`);
    this.name = "SharedStateError";
  }
}

export const MAX_KEY_LENGTH = 512;
export const MAX_VALUE_LENGTH = 4_096;

/** Keys are short printable strings; refuse anything else before it reaches a backend. */
export function checkKey(key: unknown): string {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new SharedStateError("bad-key");
  }
  return key;
}

export function checkValue(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) throw new SharedStateError("bad-key", "shared state: value too long or not a string");
  return value;
}

export function checkTtl(ttlSeconds: unknown): number | undefined {
  if (ttlSeconds === undefined) return undefined;
  if (typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new SharedStateError("bad-key", "shared state: ttl must be a positive number of seconds");
  return ttlSeconds;
}

/** Absolute expiry in epoch ms; NO_EXPIRY when none. */
export const NO_EXPIRY = 8_640_000_000_000_000;
export const expiryOf = (now: number, ttlSeconds: number | undefined): number => (ttlSeconds === undefined ? NO_EXPIRY : now + Math.ceil(ttlSeconds * 1_000));

/** The token-bucket step both adapters share, so they cannot drift. Pure. */
export function bucketStep(prev: { tokens: number; at: number } | null, capacity: number, refillPerMinute: number, now: number):
  { readonly next: { tokens: number; at: number }; readonly waitMs: number; readonly fullInMs: number } {
  if (!(capacity > 0) || !(refillPerMinute > 0)) throw new SharedStateError("bad-key", "shared state: bucket capacity and refill must be positive");
  const perMs = refillPerMinute / 60_000;
  const b = prev ?? { tokens: capacity, at: now };
  const tokens = Math.min(capacity, b.tokens + Math.max(0, now - b.at) * perMs);
  if (tokens >= 1) return { next: { tokens: tokens - 1, at: now }, waitMs: 0, fullInMs: Math.ceil((capacity - tokens + 1) / perMs) };
  return { next: { tokens, at: now }, waitMs: Math.ceil((1 - tokens) / perMs), fullInMs: Math.ceil((capacity - tokens) / perMs) };
}
