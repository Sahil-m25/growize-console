/**
 * PLANE B — THE CONSOLE'S OWN OPERATIONAL LOG: WHO CALLED WHAT, HOW IT WENT, AND NEVER WHAT WAS SAID.
 *
 * Implements D47 (three log planes; this is Plane B — every Zoho call the console makes, with the
 * acting human, endpoint, status, latency, the credits header, 429s and errors, plus every refusal
 * our own layer issues, because Zoho logs nothing when someone is refused), D52 (Plane B is a named
 * leak path: ids and status codes, never request or response bodies), D53 (every line carries the
 * acting human, since every human calls with their own token) and D45/D46 (the System page's "API
 * concurrency and credit headroom" check is assembled from here plus `X-API-CREDITS-REMAINING`,
 * because Zoho has no usage endpoint).
 *
 * A record has no field that could hold a body, and the writer does not trust the type alone: it
 * rebuilds every record field by field from an allow-list, so a caller who spreads a response into
 * it keeps nothing but the allowed fields. Endpoints are path templates with no query string — a
 * search's `criteria` or a COQL `WHERE` is exactly where a phone number would ride. Record ids must
 * look like Zoho ids (15–22 digits), so a mobile number cannot pass for one. Actor ids refuse `@`, so
 * an email address is never the name a line is filed under.
 *
 * Where Plane B physically lives is D47's open question (S3 with Object Lock is the candidate). Until
 * it is answered it ships with an in-memory ring buffer; the sink is an interface, and a sink that
 * throws never takes a request down with it.
 */

import type { ZohoFailureKind } from "./errors";
import type { CallClass } from "./gate";

export type LogActor =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "service"; readonly job: string };

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** One attempt at one Zoho call. There is no body field, and none may be added (D52). */
export interface ZohoCallEntry {
  readonly at: number;
  readonly actor: LogActor;
  /** The client method: "getRecord", "update", "coql"… */
  readonly op: string;
  readonly method: HttpMethod;
  /** A path template — "/Leads/{id}" — never a URL, never a query string. */
  readonly endpoint: string;
  readonly callClass: CallClass;
  /** null when Zoho never answered (network, abort, our own gate). */
  readonly status: number | null;
  readonly durationMs: number;
  readonly gateWaitMs: number;
  readonly attempt: number;
  /** The X-API-CREDITS-REMAINING header on this response, when Zoho sent it. */
  readonly creditsRemaining: number | null;
  readonly errorClass: ZohoFailureKind | null;
  readonly recordIds: readonly string[];
}

/** Our layer said no. Zoho will never know it was asked (D47, limit 2). */
export interface RefusalEntry {
  readonly at: number;
  readonly actor: LogActor;
  /** A short code: "update", "readLead"… */
  readonly action: string;
  /** A short code: "stage-field-write", "token-expired", "not-visible"… */
  readonly reason: string;
  readonly recordIds: readonly string[];
}

export type OpsRecord = ({ readonly kind: "zoho-call" } & ZohoCallEntry) | ({ readonly kind: "refusal" } & RefusalEntry);

export interface OpsSink {
  write(record: OpsRecord): void;
}

export interface OpsLog {
  call(entry: ZohoCallEntry): void;
  refusal(entry: RefusalEntry): void;
}

/** A Zoho record id: 18–19 digits in practice. A 10–12 digit mobile number does not qualify. */
export const RECORD_ID = /^\d{15,22}$/;
/** A person or job id: letters, digits, `.`, `_`, `-`. No `@`, so never an email address. */
export const ACTOR_ID = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_IDS_PER_RECORD = 200;

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT = /^\/[A-Za-z0-9_{}/.-]{0,200}$/;
const OP = /^[A-Za-z][A-Za-z0-9.-]{0,63}$/;
const CODE = /^[a-z][a-z0-9.-]{0,63}$/;
const ERROR_CLASS = /^[a-z][a-z-]{0,39}$/;

const finite = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const intOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null);

function actorOf(actor: unknown): LogActor {
  const a = typeof actor === "object" && actor !== null ? (actor as { kind?: unknown; userId?: unknown; job?: unknown }) : {};
  if (a.kind === "user" && typeof a.userId === "string" && ACTOR_ID.test(a.userId)) return Object.freeze({ kind: "user", userId: a.userId });
  if (a.kind === "service" && typeof a.job === "string" && ACTOR_ID.test(a.job)) return Object.freeze({ kind: "service", job: a.job });
  return Object.freeze({ kind: "user", userId: "unrecognised" });
}

function idsOf(ids: unknown): readonly string[] {
  if (!Array.isArray(ids)) return Object.freeze([]);
  const kept = ids.filter((x): x is string => typeof x === "string" && RECORD_ID.test(x));
  return Object.freeze([...new Set(kept)].slice(0, MAX_IDS_PER_RECORD));
}

/** Rebuilt from the allow-list, field by field. Whatever else the caller passed is not copied. */
function callRecord(e: ZohoCallEntry): OpsRecord {
  return Object.freeze({
    kind: "zoho-call",
    at: finite(e.at),
    actor: actorOf(e.actor),
    op: typeof e.op === "string" && OP.test(e.op) ? e.op : "unrecognised",
    method: typeof e.method === "string" && METHODS.has(e.method) ? e.method : "GET",
    endpoint: typeof e.endpoint === "string" && ENDPOINT.test(e.endpoint) ? e.endpoint : "/unrecognised",
    callClass: e.callClass === "complex" ? "complex" : "simple",
    status: intOrNull(e.status),
    durationMs: finite(e.durationMs),
    gateWaitMs: finite(e.gateWaitMs),
    attempt: intOrNull(e.attempt) ?? 0,
    creditsRemaining: intOrNull(e.creditsRemaining),
    errorClass: typeof e.errorClass === "string" && ERROR_CLASS.test(e.errorClass) ? e.errorClass : null,
    recordIds: idsOf(e.recordIds),
  });
}

function refusalRecord(e: RefusalEntry): OpsRecord {
  return Object.freeze({
    kind: "refusal",
    at: finite(e.at),
    actor: actorOf(e.actor),
    action: typeof e.action === "string" && CODE.test(e.action) ? e.action : typeof e.action === "string" && OP.test(e.action) ? e.action : "unrecognised",
    reason: typeof e.reason === "string" && CODE.test(e.reason) ? e.reason : "unrecognised",
    recordIds: idsOf(e.recordIds),
  });
}

export type OpsLogOptions = { readonly onSinkError?: (error: unknown) => void };

export function createOpsLog(sink: OpsSink, options: OpsLogOptions = {}): OpsLog {
  const write = (record: OpsRecord) => {
    try {
      sink.write(record);
    } catch (error) {
      try {
        options.onSinkError?.(error);
      } catch {
        /* A log that cannot be written must not fail the call it describes. */
      }
    }
  };
  return {
    call: (entry) => write(callRecord(entry)),
    refusal: (entry) => write(refusalRecord(entry)),
  };
}

/** What D45's "API concurrency and credit headroom" check reads, from what is in the buffer. */
export interface Headroom {
  readonly calls: number;
  readonly refusals: number;
  readonly failures: Readonly<Partial<Record<ZohoFailureKind, number>>>;
  readonly lastCreditsRemaining: number | null;
  readonly lowestCreditsRemaining: number | null;
  /** The header has appeared at all: the org is past half its daily allowance (D47). */
  readonly creditsWarning: boolean;
}

export interface MemorySink extends OpsSink {
  records(): readonly OpsRecord[];
  headroom(): Headroom;
  clear(): void;
}

export function createMemorySink(options: { readonly capacity?: number } = {}): MemorySink {
  const capacity = options.capacity ?? 5_000;
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer.");
  let buffer: OpsRecord[] = [];
  return {
    write(record) {
      buffer.push(record);
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    },
    records: () => buffer.slice(),
    clear() {
      buffer = [];
    },
    headroom() {
      let calls = 0;
      let refusals = 0;
      let last: number | null = null;
      let lowest: number | null = null;
      const failures: Partial<Record<ZohoFailureKind, number>> = {};
      for (const r of buffer) {
        if (r.kind === "refusal") {
          refusals++;
          continue;
        }
        calls++;
        if (r.errorClass) failures[r.errorClass] = (failures[r.errorClass] ?? 0) + 1;
        if (r.creditsRemaining !== null) {
          last = r.creditsRemaining;
          lowest = lowest === null ? r.creditsRemaining : Math.min(lowest, r.creditsRemaining);
        }
      }
      return { calls, refusals, failures, lastCreditsRemaining: last, lowestCreditsRemaining: lowest, creditsWarning: lowest !== null };
    },
  };
}
