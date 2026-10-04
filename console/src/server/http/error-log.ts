/**
 * M18-S04-T01 — PLANE B'S ERROR LINES: WHICH REQUEST FAILED, FOR WHOM, WHERE, AND WHAT ZOHO SAID.
 *
 * D47 (Plane B is the console's own operational log) and D52 (ids and status codes, never bodies):
 * a server error or a browser-reported failure is filed as request id, user id, route, HTTP status,
 * Zoho status and Zoho code, the error class and the error's constructor name. There is no field
 * for a message, a stack, a URL or a body, and — as in `lib/zoho/log.ts` — the writer rebuilds every
 * record field by field from an allow-list, so a caller who spreads an Error or a request into it
 * keeps nothing else. User ids refuse `@` and bare digit runs, so an email address or a mobile
 * number is never the name a line is filed under. Route names are templates: a segment holding a
 * digit becomes `{id}`.
 *
 * Storage follows `lib/zoho/log.ts`: an in-memory ring until D47 names Plane B's home; a sink that
 * throws never fails the request it describes.
 */

import { ACTOR_ID, RECORD_ID, looksLikeIdentity } from "../../lib/zoho/log";
import { BEACON_SOURCES, type BeaconSource } from "../../lib/zoho/error-beacon";

export interface RouteErrorEntry {
  readonly at: number;
  readonly requestId: string;
  readonly userId: string | null;
  /** The route template ("/api/data"), never a URL. */
  readonly route: string;
  readonly method: string;
  /** The status the console answered with. */
  readonly status: number;
  readonly zohoStatus: number | null;
  readonly zohoCode: string | null;
  /** A ZohoFailureKind, or "exception" for anything thrown that was not a Zoho failure. */
  readonly errorClass: string | null;
  readonly errorName: string | null;
  readonly durationMs: number;
}

export interface ClientErrorEntry {
  readonly at: number;
  /** The id this server gave the beacon request itself. */
  readonly requestId: string;
  /** The failed call's request id, when the browser had one. */
  readonly failedRequestId: string | null;
  readonly userId: string | null;
  readonly route: string;
  readonly source: BeaconSource;
  readonly zohoStatus: number | null;
  readonly zohoCode: string | null;
  readonly errorName: string | null;
}

export type ErrorRecord = ({ readonly kind: "route-error" } & RouteErrorEntry) | ({ readonly kind: "client-error" } & ClientErrorEntry);

export interface ErrorSink {
  write(record: ErrorRecord): void;
}

export interface ErrorLog {
  routeError(entry: RouteErrorEntry): ErrorRecord;
  clientError(entry: ClientErrorEntry): ErrorRecord;
}

export const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;
const DIGITS_ONLY = /^\+?\d{6,}$/;
const ZOHO_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const ERROR_CLASS = /^[a-z][a-z-]{0,39}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SEGMENT = /^[A-Za-z_-]{1,40}$|^\[[A-Za-z]{1,30}\]$|^\{[a-z]{1,10}\}$/;
const SOURCES: ReadonlySet<string> = new Set(BEACON_SOURCES);

const finite = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const statusOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x >= 100 && x <= 599 ? x : null);

export const safeRequestId = (x: unknown): string | null =>
  typeof x === "string" && REQUEST_ID.test(x) && !DIGITS_ONLY.test(x) && !x.includes("@") && !looksLikeIdentity(x) ? x : null;

/* M01-S04-NOTE-4: a Zoho user id is 15–22 digits (RECORD_ID) — an id, not identity, and the same shape every other Plane B line
   carries as its actor (lib/zoho/log actorOf). Any OTHER digit-only string (a mobile, an account number, an OTP) is still refused. */
export const safeUserId = (x: unknown): string | null =>
  typeof x === "string" && ACTOR_ID.test(x) && (RECORD_ID.test(x) || !DIGITS_ONLY.test(x)) && !looksLikeIdentity(x) ? x : null;

export const safeZohoCode = (x: unknown): string | null => (typeof x === "string" && ZOHO_CODE.test(x) && !looksLikeIdentity(x) ? x : null);
export const safeErrorName = (x: unknown): string | null => (typeof x === "string" && ERROR_NAME.test(x) && !looksLikeIdentity(x) ? x : null);

/** A path reduced to a template: no query, no fragment, any segment with a digit or oddity → `{id}`. */
export function routeTemplate(x: unknown): string {
  if (typeof x !== "string" || !x.startsWith("/")) return "/unrecognised";
  const path = x.split(/[?#]/)[0]!;
  const segments = path.split("/").filter(Boolean).slice(0, 8);
  return "/" + segments.map((s) => (SEGMENT.test(s) ? s : "{id}")).join("/");
}

function routeRecord(e: RouteErrorEntry): ErrorRecord {
  return Object.freeze({
    kind: "route-error",
    at: finite(e.at),
    requestId: safeRequestId(e.requestId) ?? "unrecognised",
    userId: safeUserId(e.userId),
    route: routeTemplate(e.route),
    method: typeof e.method === "string" && METHODS.has(e.method) ? e.method : "GET",
    status: statusOrNull(e.status) ?? 500,
    zohoStatus: statusOrNull(e.zohoStatus),
    zohoCode: safeZohoCode(e.zohoCode),
    errorClass: typeof e.errorClass === "string" && ERROR_CLASS.test(e.errorClass) ? e.errorClass : null,
    errorName: safeErrorName(e.errorName),
    durationMs: finite(e.durationMs),
  });
}

function clientRecord(e: ClientErrorEntry): ErrorRecord {
  return Object.freeze({
    kind: "client-error",
    at: finite(e.at),
    requestId: safeRequestId(e.requestId) ?? "unrecognised",
    failedRequestId: safeRequestId(e.failedRequestId),
    userId: safeUserId(e.userId),
    route: routeTemplate(e.route),
    source: typeof e.source === "string" && SOURCES.has(e.source) ? e.source : "onerror",
    zohoStatus: statusOrNull(e.zohoStatus),
    zohoCode: safeZohoCode(e.zohoCode),
    errorName: safeErrorName(e.errorName),
  });
}

export function createErrorLog(sink: ErrorSink, options: { readonly onSinkError?: (error: unknown) => void } = {}): ErrorLog {
  const write = (record: ErrorRecord): ErrorRecord => {
    try {
      sink.write(record);
    } catch (error) {
      try {
        options.onSinkError?.(error);
      } catch {
        /* A log that cannot be written must not fail the request it describes. */
      }
    }
    return record;
  };
  return {
    routeError: (entry) => write(routeRecord(entry)),
    clientError: (entry) => write(clientRecord(entry)),
  };
}

export interface MemoryErrorSink extends ErrorSink {
  records(): readonly ErrorRecord[];
  clear(): void;
}

export function createMemoryErrorSink(options: { readonly capacity?: number } = {}): MemoryErrorSink {
  const capacity = options.capacity ?? 2_000;
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer.");
  let buffer: ErrorRecord[] = [];
  return {
    write(record) {
      buffer.push(record);
      if (buffer.length > capacity) buffer.splice(0, buffer.length - capacity);
    },
    records: () => buffer.slice(),
    clear() {
      buffer = [];
    },
  };
}
