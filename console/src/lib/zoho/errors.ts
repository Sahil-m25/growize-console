/**
 * WHAT ZOHO SAID, AS A TYPE — AND WHETHER ASKING AGAIN CAN HELP.
 *
 * Implements D45 (a failed live fetch surfaces as an explicit state, never as old data; D44's
 * concurrent edit surfaces as a conflict — TypeSafe pass (b)), D46 (concurrency binds, so most 429s
 * are a queueing problem, not a budget one), D47 (Plane B records the class of every failure and
 * never its body) and D52/D53 (per-user tokens: a 401 is one person's session, not the console's).
 *
 * The case that matters is 429, which means three different things needing three different answers:
 * the org's daily credits are gone (wait hours — retrying only adds noise to a log someone has to
 * read); the org's concurrency is full (retry in milliseconds); or the sub-concurrency bucket for
 * complex calls is full (retry in milliseconds — and the gate's complex pool is too generous). Only
 * the body tells them apart, and Zoho documents no example body for any of them: the v8 status page
 * has one sentence covering all three. So the classifier reads the code, the message and the details
 * keys for the words Zoho uses ("sub-concurrency", "concurrency", "24 hour", "credits"), prefers the
 * most specific, and when a body names both a daily limit and concurrency — as Zoho's own generic
 * sentence does — it says so honestly: `rate-limited-unclassified`, retried a little and slowly.
 * T10's load test should capture the real bodies and tighten this.
 *
 * 207 Multi-Status is never success. It is parsed per record, in submitted order, and so is any 2xx
 * write response that carries a failed record inside it. Retrying the batch would repeat the records
 * that landed, so a partial result is never retried here: the caller re-sends only the failures.
 *
 * Retry policy per class, stated once so every caller agrees:
 *   credits-exhausted            never — hours away
 *   concurrency-exceeded         yes, fast — refused before it ran, so even a write is safe to resend
 *   rate-limited-unclassified    yes, twice more, slowly
 *   server (5xx), network        only when the call is idempotent — a 5xx write may have landed
 *   everything else              never: conflict (412), forbidden (403), auth, invalid-data,
 *                                partial (207), not-found, refused, busy, aborted, unexpected
 * Backoff is exponential with equal jitter; a Retry-After header, when Zoho sends one, is a floor.
 */

/** Sent only once the org has used half its daily allowance, so its appearance is the warning (D47). */
export const CREDITS_HEADER = "X-API-CREDITS-REMAINING";
/** No Retry-After is honoured past this; a longer wait is a failure to surface, not a sleep. */
export const MAX_RETRY_AFTER_MS = 30_000;

/** One submitted record's outcome in a write response, in submitted order. Ids and codes, no values. */
export type RecordOutcome = {
  readonly index: number;
  readonly ok: boolean;
  readonly id: string | null;
  readonly code: string;
  /** The field Zoho blamed (`details.api_name`), when it named one. */
  readonly field: string | null;
  /** Upsert only: what Zoho did with the record. */
  readonly action: "insert" | "update" | null;
  readonly modifiedTime: string | null;
};

export type ZohoSuccess =
  | { readonly kind: "ok"; readonly status: number; readonly body: unknown; readonly records: readonly RecordOutcome[] | null }
  /** 204: nothing matched (not an error). 304: unchanged since If-Modified-Since. */
  | { readonly kind: "empty"; readonly status: 204 | 304 };

export type ZohoFailure =
  | { readonly kind: "credits-exhausted"; readonly status: 429; readonly code: string; readonly retryAfterMs: number | null }
  | {
      readonly kind: "concurrency-exceeded";
      readonly status: 429;
      /** "org": the 20. "sub": the 10 for COQL, sort_by, cvid, bulk, Send Mail, Convert Lead. */
      readonly pool: "org" | "sub";
      readonly code: string;
      readonly retryAfterMs: number | null;
    }
  | { readonly kind: "rate-limited-unclassified"; readonly status: 429; readonly code: string; readonly retryAfterMs: number | null }
  /** Someone else changed the record since it was loaded (412 ALREADY_MODIFIED) — D44's conflict. */
  | { readonly kind: "conflict"; readonly status: number; readonly code: string; readonly recordId: string | null }
  | {
      readonly kind: "invalid-data";
      readonly status: number;
      readonly code: string;
      readonly field: string | null;
      readonly records: readonly RecordOutcome[] | null;
    }
  /** 207, or a 2xx carrying failed records: look at each record. */
  | { readonly kind: "partial"; readonly status: number; readonly records: readonly RecordOutcome[] }
  /** The user's token is no longer good: the session layer refreshes it or signs them in again. */
  | { readonly kind: "auth-expired"; readonly status: 401 | null; readonly code: string }
  | { readonly kind: "auth-rejected"; readonly status: 401; readonly code: string }
  | { readonly kind: "forbidden"; readonly status: 403; readonly code: string }
  | { readonly kind: "not-found"; readonly status: 404; readonly code: string }
  | { readonly kind: "server"; readonly status: number; readonly code: string }
  | { readonly kind: "network"; readonly status: null }
  | { readonly kind: "aborted"; readonly status: null }
  /** The console's own gate refused: too many requests already waiting. */
  | { readonly kind: "busy"; readonly status: null }
  /** The console's own layer refused before calling Zoho (a stage written as a field, say). */
  | { readonly kind: "refused"; readonly status: null; readonly reason: string }
  | { readonly kind: "unexpected"; readonly status: number; readonly code: string };

export type ZohoFailureKind = ZohoFailure["kind"];
export type ZohoClassified = ZohoSuccess | ZohoFailure;

export type ResponseFacts = {
  readonly status: number;
  readonly body: unknown;
  readonly retryAfter?: string | null;
  /** True for write endpoints, whose `data[]` is one outcome per submitted record. */
  readonly perRecord?: boolean;
};

export type RetryPolicy =
  | { readonly retry: false }
  | { readonly retry: true; readonly maxAttempts: number; readonly baseMs: number; readonly capMs: number };

type Obj = Readonly<Record<string, unknown>>;
const obj = (x: unknown): Obj | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
// Zoho identifiers are JSON strings. Coercing a number would preserve neither provenance nor
// 18/19-digit precision and could make a malformed write acknowledgement look successful.
const idText = (x: unknown): string | null =>
  typeof x === "string" && /^\d{15,22}$/.test(x) ? x : null;
const firstDatum = (b: Obj | null): Obj | null => (b && Array.isArray(b.data) ? obj(b.data[0]) : null);

const AUTH_EXPIRED = new Set(["INVALID_TOKEN", "INVALID_OAUTHTOKEN", "AUTHENTICATION_FAILURE"]);
const CONFLICT = new Set(["ALREADY_MODIFIED"]);

export const isFailure = (c: ZohoClassified): c is ZohoFailure => c.kind !== "ok" && c.kind !== "empty";

function topCode(body: unknown): string {
  const b = obj(body);
  if (!b) return "";
  if (typeof b.code === "string") return b.code;
  if (typeof b.error === "string") return b.error; // the older shape: {"code":429,"error":"TOO_MANY_REQUESTS",...}
  return str(firstDatum(b)?.code) ?? "";
}

function detailOf(body: unknown, field: "id" | "api_name"): string | null {
  const b = obj(body);
  const details = obj(b?.details) ?? obj(firstDatum(b)?.details);
  if (!details) return null;
  return field === "id" ? idText(details.id) : str(details.api_name);
}

function recordsOf(body: unknown): RecordOutcome[] | null {
  const b = obj(body);
  if (!b || !Array.isArray(b.data)) return null;
  return b.data.map((raw: unknown, index): RecordOutcome => {
    const r = obj(raw) ?? {};
    const details = obj(r.details) ?? {};
    const status = str(r.status);
    const code = str(r.code) ?? "";
    return {
      index,
      ok: status === "success" || (status === null && code === "SUCCESS"),
      id: idText(details.id),
      code,
      field: str(details.api_name),
      action: r.action === "insert" || r.action === "update" ? r.action : null,
      modifiedTime: str(details.Modified_Time),
    };
  });
}

/** Lowercased words a 429 body uses: code, message, error text, and details keys and string values. */
function wordsOf(body: unknown): string {
  const parts: string[] = [];
  const take = (o: Obj | null) => {
    if (!o) return;
    for (const k of ["code", "message", "error", "error_info"]) {
      const v = str(o[k]);
      if (v) parts.push(v);
    }
    const details = obj(o.details);
    if (details) {
      for (const [k, v] of Object.entries(details)) {
        parts.push(k);
        if (typeof v === "string") parts.push(v);
      }
    }
  };
  const b = obj(body);
  take(b);
  take(firstDatum(b));
  return parts.join(" ").toLowerCase().slice(0, 2_000);
}

function retryAfterMs(header: string | null | undefined): number | null {
  if (!header || !/^\s*\d{1,6}\s*$/.test(header)) return null;
  return Number(header.trim()) * 1000;
}

function rateLimited(body: unknown, code: string, after: number | null): ZohoFailure {
  const said = wordsOf(body);
  const sub = /sub[\s_-]*concurren/.test(said);
  const concurrency = /concurren/.test(said.replace(/sub[\s_-]*concurren\w*/g, ""));
  const daily = /24[\s-]*hours?|per day|\bdaily\b|credit|for the day|api[\s_-]*limit/.test(said);
  const c = code || "TOO_MANY_REQUESTS";
  if (sub && !daily) return { kind: "concurrency-exceeded", status: 429, pool: "sub", code: c, retryAfterMs: after };
  if (concurrency && !daily) return { kind: "concurrency-exceeded", status: 429, pool: "org", code: c, retryAfterMs: after };
  if (daily && !concurrency && !sub) return { kind: "credits-exhausted", status: 429, code: c, retryAfterMs: after };
  return { kind: "rate-limited-unclassified", status: 429, code: c, retryAfterMs: after };
}

/** A write whose records did not all land. One record: its own failure. Several: look at each. */
function recordFailure(status: number, records: readonly RecordOutcome[]): ZohoFailure {
  if (records.length === 1) {
    const [only] = records;
    if (CONFLICT.has(only.code)) return { kind: "conflict", status, code: only.code, recordId: only.id };
    return { kind: "invalid-data", status, code: only.code || "INVALID_DATA", field: only.field, records };
  }
  return { kind: "partial", status, records };
}

export function classifyResponse(facts: ResponseFacts): ZohoClassified {
  const status = facts.status;
  if (status === 204 || status === 304) return { kind: "empty", status };
  const body = facts.body;
  const code = topCode(body);
  const records = facts.perRecord || status === 207 ? recordsOf(body) : null;

  if (status === 207) return { kind: "partial", status, records: records ?? [] };
  if (status >= 200 && status < 300) {
    if (records && records.some((r) => !r.ok)) return recordFailure(status, records);
    if (obj(body)?.status === "error") return { kind: "invalid-data", status, code: code || "INVALID_DATA", field: detailOf(body, "api_name"), records };
    return { kind: "ok", status, body, records };
  }
  if (status === 412 || CONFLICT.has(code)) {
    return { kind: "conflict", status, code: code || "ALREADY_MODIFIED", recordId: records?.[0]?.id ?? detailOf(body, "id") };
  }
  if (status === 429) return rateLimited(body, code, retryAfterMs(facts.retryAfter));
  if (status === 401) return AUTH_EXPIRED.has(code) ? { kind: "auth-expired", status, code } : { kind: "auth-rejected", status, code };
  if (status === 403) return { kind: "forbidden", status, code };
  if (status === 404) return { kind: "not-found", status, code };
  if (status >= 400 && status < 500) {
    const blamed = records?.find((r) => !r.ok);
    return { kind: "invalid-data", status, code: code || blamed?.code || "INVALID_DATA", field: blamed?.field ?? detailOf(body, "api_name"), records };
  }
  if (status >= 500 && status < 600) return { kind: "server", status, code };
  return { kind: "unexpected", status, code };
}

/** fetch() rejected: our abort, or the network. Zoho never answered, so there is no status. */
export function classifyThrown(error: unknown, signal?: AbortSignal): ZohoFailure {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
  if (signal?.aborted || name === "AbortError") return { kind: "aborted", status: null };
  return { kind: "network", status: null };
}

const NEVER: RetryPolicy = { retry: false };

export function retryPolicy(failure: ZohoFailure, call: { readonly idempotent: boolean }): RetryPolicy {
  switch (failure.kind) {
    case "concurrency-exceeded":
      return { retry: true, maxAttempts: 5, baseMs: 100, capMs: 2_000 };
    case "rate-limited-unclassified":
      return { retry: true, maxAttempts: 3, baseMs: 1_000, capMs: 8_000 };
    case "server":
    case "network":
      return call.idempotent ? { retry: true, maxAttempts: 4, baseMs: 250, capMs: 4_000 } : NEVER;
    case "credits-exhausted":
    case "conflict":
    case "forbidden":
    case "auth-expired":
    case "auth-rejected":
    case "invalid-data":
    case "partial":
    case "not-found":
    case "busy":
    case "refused":
    case "aborted":
    case "unexpected":
      return NEVER;
    default: {
      const unhandled: never = failure;
      throw new TypeError(`No retry policy for ${JSON.stringify(unhandled)}.`);
    }
  }
}

export const retryAfterOf = (failure: ZohoFailure): number | null =>
  failure.kind === "credits-exhausted" || failure.kind === "concurrency-exceeded" || failure.kind === "rate-limited-unclassified"
    ? failure.retryAfterMs
    : null;

/** How long to wait after attempt `attempt` (1-based) failed: exponential, equal jitter, Retry-After as a floor. */
export function backoffDelay(
  attempt: number,
  policy: Extract<RetryPolicy, { retry: true }>,
  retryAfter: number | null = null,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(policy.capMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.round(ceiling / 2 + Math.min(1, Math.max(0, random())) * (ceiling / 2));
  return retryAfter === null ? jittered : Math.max(jittered, Math.min(retryAfter, MAX_RETRY_AFTER_MS));
}

export function parseCreditsRemaining(header: string | null | undefined): number | null {
  if (!header || !/^\s*\d{1,12}\s*$/.test(header)) return null;
  return Number(header.trim());
}
