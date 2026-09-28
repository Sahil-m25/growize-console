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
 * Where Plane B physically lives: append-only daily JSONL files under LOG_DIR (M01-S04, PROVISIONAL,
 * Jev 0.93), chosen by `server/logs/factory.ts`; memory stays the default in tests and fixture mode.
 * The sink is an interface, and a sink that throws never takes a request down with it.
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

/**
 * M18-S02-T03 — shapes that are an identity value or free text, never a code or an id. PAN, Aadhaar
 * (12 digits, spaced or not), an Indian mobile (with or without +91), any 9–14 digit run (account
 * numbers, IMPS/UPI UTRs), an alphanumeric NEFT/RTGS UTR or IFSC, an email, and whitespace (a body).
 * Zoho record and user ids (15–22 digits) are not matched: the digit rules are bounded by non-digits.
 */
export const IDENTITY_SHAPES: readonly RegExp[] = Object.freeze([
  /(?<![A-Za-z0-9])[A-Za-z]{5}[0-9]{4}[A-Za-z](?![A-Za-z0-9])/, // PAN
  /(?<![0-9])[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}(?![0-9])/, // Aadhaar, spaced
  /(?<![0-9])[0-9]{9,14}(?![0-9])/, // Aadhaar, mobile, account number, numeric UTR
  /\+[0-9]/, // +91…
  /(?<![A-Za-z0-9])[A-Za-z]{4}[A-Za-z0-9][0-9]{6,}/, // NEFT/RTGS UTR, IFSC
  /@/, // email
  /\s/, // free text: a message, a note, a body
]);

/** True when a string could carry an identity value or a body. Codes, ids and templates never do. */
export function looksLikeIdentity(value: string): boolean {
  return IDENTITY_SHAPES.some((re) => re.test(value));
}

const TEMPLATE_SEGMENT = /^[A-Za-z_][A-Za-z_.-]{0,63}$|^\{[a-zA-Z]{1,20}\}$|^v[0-9]{1,2}$/;

/**
 * M18-S02-T03 — an endpoint reduced to a path template: no query, no fragment, and any segment that
 * is not a plain word, a `{name}` placeholder or an API version becomes `{id}`. A caller who passes
 * "/Leads/9876543210" or "/Payments/HDFCN52022092812345" files "/Leads/{id}".
 */
export function endpointTemplate(x: unknown): string {
  if (typeof x !== "string" || !x.startsWith("/")) return "/unrecognised";
  const path = x.split(/[?#]/)[0]!;
  if (path !== x) return "/unrecognised";
  const segments = path.split("/").filter(Boolean).slice(0, 12);
  const t = "/" + segments.map((s) => (TEMPLATE_SEGMENT.test(s) && !looksLikeIdentity(s) ? s : "{id}")).join("/");
  return ENDPOINT.test(t) ? t : "/unrecognised";
}

const safeCode = (x: unknown, re: RegExp): string | null => (typeof x === "string" && re.test(x) && !looksLikeIdentity(x) ? x : null);

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT = /^\/[A-Za-z0-9_{}/.-]{0,200}$/;
const OP = /^[A-Za-z][A-Za-z0-9.-]{0,63}$/;
const CODE = /^[a-z][a-z0-9.-]{0,63}$/;
const ERROR_CLASS = /^[a-z][a-z-]{0,39}$/;

const finite = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const intOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null);
/** M18-S02-T03: no count or duration in a line reaches nine digits, so a mobile or Aadhaar cannot ride in one. */
const MAX_COUNT = 100_000_000;
const bounded = (x: unknown): number => { const v = finite(x); return v >= 0 && v < MAX_COUNT ? v : 0; };
const countOrNull = (x: unknown): number | null => { const v = intOrNull(x); return v !== null && v < MAX_COUNT ? v : null; };
const statusOrNull = (x: unknown): number | null => { const v = intOrNull(x); return v !== null && v >= 100 && v <= 599 ? v : null; };

function actorOf(actor: unknown): LogActor {
  const a = typeof actor === "object" && actor !== null ? (actor as { kind?: unknown; userId?: unknown; job?: unknown }) : {};
  if (a.kind === "user" && safeCode(a.userId, ACTOR_ID) !== null) return Object.freeze({ kind: "user", userId: a.userId as string });
  if (a.kind === "service" && safeCode(a.job, ACTOR_ID) !== null) return Object.freeze({ kind: "service", job: a.job as string });
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
    op: safeCode(e.op, OP) ?? "unrecognised",
    method: typeof e.method === "string" && METHODS.has(e.method) ? e.method : "GET",
    endpoint: endpointTemplate(e.endpoint),
    callClass: e.callClass === "complex" ? "complex" : "simple",
    status: statusOrNull(e.status),
    durationMs: bounded(e.durationMs),
    gateWaitMs: bounded(e.gateWaitMs),
    attempt: countOrNull(e.attempt) ?? 0,
    creditsRemaining: countOrNull(e.creditsRemaining),
    errorClass: typeof e.errorClass === "string" && ERROR_CLASS.test(e.errorClass) ? e.errorClass : null,
    recordIds: idsOf(e.recordIds),
  });
}

function refusalRecord(e: RefusalEntry): OpsRecord {
  return Object.freeze({
    kind: "refusal",
    at: finite(e.at),
    actor: actorOf(e.actor),
    action: safeCode(e.action, CODE) ?? safeCode(e.action, OP) ?? "unrecognised",
    reason: safeCode(e.reason, CODE) ?? "unrecognised",
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
