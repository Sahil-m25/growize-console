/**
 * THE ZOHO CRM v8 CLIENT — EVERY CALL AS SOMEBODY, THROUGH THE GATE, CLASSIFIED, AND WRITTEN DOWN.
 *
 * Implements D45 (the console reads and writes Zoho live; a stage moves by blueprint transition;
 * D44's concurrent edit surfaces through If-Unmodified-Since as a conflict), D46 (concurrency is the
 * constraint, so every call passes the gate; the credits header is the early warning), D47 (every
 * attempt is one Plane B line), D52 (one Enterprise org; no administrator token is ever used by the
 * application) and D53 (every human reads and writes with their own token; service tokens are for
 * background work only and never serve a screen).
 *
 * Who is calling is the first argument of every method, and it is a credential, not a string. There
 * are exactly two kinds and no third: a `UserCredential` — the signed-in human's own access token —
 * and a `ServiceCredential` for one of the four background jobs D53 names. `ZohoClient` accepts only
 * the first and `ZohoServiceClient` only the second. They are branded so neither can be passed where
 * the other is expected. A user credential is minted only after that token itself answers Zoho's
 * CurrentUser endpoint, so callers cannot choose the actor written to Plane B or receipt HMACs.
 * There is no admin credential type to reach for.
 *
 * The API domain is whatever the token response said in `api_domain` — `.in`, `.com`, `.eu`, or a
 * data centre that does not exist yet — never a constant here. It is checked to be an https Zoho API
 * host before a token is ever sent to it. The access token is non-enumerable and redacted from JSON,
 * so a credential logged by accident logs nothing useful.
 *
 * Every method returns a `ZohoResult`: `ok` with a value, or a classified `ZohoFailure`. Zoho's
 * refusals are data, not exceptions; a throw from here is a programming error (a module name with a
 * slash in it, 101 records to upsert). Retries follow `retryPolicy` in errors.ts; each attempt
 * re-enters the gate and gives its slot back while it sleeps.
 *
 * Deliberately absent: token refresh (the session layer holds refresh tokens; a 401 comes back as
 * `auth-expired`), identity reveals (D13/D22 — a second, reasoned call belonging to the reveal flow),
 * and any field write that moves a stage: `update()` and `upsert()` refuse fields a blueprint owns,
 * and `blueprintTransition()` is the only way to move a rung.
 */

import {
  backoffDelay,
  classifyResponse,
  classifyThrown,
  CREDITS_HEADER,
  isFailure,
  parseCreditsRemaining,
  retryAfterOf,
  retryPolicy,
  type RecordOutcome,
  type ZohoClassified,
  type ZohoFailure,
  type ZohoFailureKind,
  type ZohoSuccess,
} from "./errors";
import { classOf, GateQueueFullError, type CallClass, type CallShape, type Gate, type GateLease } from "./gate";
import { RECORD_ID, type HttpMethod, type LogActor, type OpsLog } from "./log";

export const API_VERSION = "v8";
export const MAX_UPSERT_RECORDS = 100;
export const MAX_ATTEMPTS = 5;
export const MAX_FIELDS = 50;
export const DELETED_PAGE_SIZE = 200;
export const DEFAULT_DELETED_PAGES = 5;
export const USER_IDENTITY_TIMEOUT_MS = 10_000;
export const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;
export const MAX_ZOHO_RESPONSE_BYTES = 5 * 1024 * 1024;
/**
 * Fields a blueprint owns, per module: `update()`/`upsert()` refuse to write them (D45: a stage
 * change is a transition, never a field write). The Leads rung field's real API name belongs to
 * `zoho/leads/fields.json`, which has not been exported yet — pass it in `blueprintOwnedFields`.
 */
export const DEFAULT_BLUEPRINT_OWNED_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  Leads: Object.freeze(["Lead_Status"]),
  Deals: Object.freeze(["Stage"]),
});

/** The background work D53 allows a service token for. Nothing on this list serves a screen. */
export type ServiceJob = "audit-archive" | "cover-window-share" | "invariant-check" | "provider-callback";
const SERVICE_JOBS: ReadonlySet<string> = new Set(["audit-archive", "cover-window-share", "invariant-check", "provider-callback"]);

declare const apiDomainBrand: unique symbol;
declare const userBrand: unique symbol;
declare const serviceBrand: unique symbol;

/** An https Zoho API origin, taken from a token response's `api_domain`. */
export type ApiDomain = string & { readonly [apiDomainBrand]: true };

interface CredentialBase {
  readonly apiDomain: ApiDomain;
  /** Non-enumerable at runtime and redacted by toJSON. */
  readonly accessToken: string;
  readonly expiresAt: number | null;
}
/** The signed-in human's own token. Private sharing, the role hierarchy and field-level security apply. */
export interface UserCredential extends CredentialBase {
  readonly kind: "user";
  readonly userId: string;
  readonly [userBrand]: true;
}
/** A background job's token, on a profile with identity fields hidden (D53). Never serves a screen. */
export interface ServiceCredential extends CredentialBase {
  readonly kind: "service";
  readonly job: ServiceJob;
  readonly [serviceBrand]: true;
}
export type Credential = UserCredential | ServiceCredential;

export type ZohoFieldValue = string | number | boolean | null | readonly ZohoFieldValue[] | { readonly [field: string]: ZohoFieldValue };
export type ZohoFields = { readonly [field: string]: ZohoFieldValue };
export type ZohoRecord = { readonly id: string; readonly [field: string]: unknown };
export interface ZohoPage {
  readonly records: readonly ZohoRecord[];
  readonly moreRecords: boolean;
  /** Present only when Zoho returned a row without a lossless string id. */
  readonly invalidRecordIds?: true;
}
export interface WriteAck {
  readonly id: string;
  /** Zoho's new Modified_Time: the value to send as If-Unmodified-Since on the next write. */
  readonly modifiedTime: string | null;
}
export type DeletionCheck =
  | {
      readonly deleted: true;
      readonly deletedBy: { readonly id: string; readonly name: string } | null;
      readonly deletedTime: string | null;
    }
  /** Not in the recycle bin. `exhaustive: false` means the bin had more pages than were searched.
   *  The bin keeps 60 days; "not deleted" still does not prove "never existed" or "visible to you". */
  | { readonly deleted: false; readonly exhaustive: boolean };
export type SearchQuery =
  | { readonly criteria: string }
  | { readonly email: string }
  | { readonly phone: string }
  | { readonly word: string };

export type ZohoResult<T> =
  | { readonly ok: true; readonly value: T; readonly status: number; readonly creditsRemaining: number | null }
  | { readonly ok: false; readonly error: ZohoFailure; readonly creditsRemaining: number | null };

export interface CallOptions {
  readonly signal?: AbortSignal;
}
export interface PageOptions extends CallOptions {
  readonly page?: number;
  readonly perPage?: number;
  readonly fields?: readonly string[];
}
export interface UpdateOptions extends CallOptions {
  /** The record's Modified_Time as the screen loaded it, or an explicit null to write without the
   *  check. There is no default: under a D44 cover window, forgetting it is the silent overwrite. */
  readonly ifUnmodifiedSince: string | null;
}

export interface ZohoApi<C extends Credential> {
  /** `null`: Zoho returned nothing — deleted, never existed, or not visible to this person. `wasDeleted()` tells the first apart. */
  getRecord(as: C, module: string, id: string, options?: CallOptions & { readonly fields?: readonly string[] }): Promise<ZohoResult<ZohoRecord | null>>;
  getRelated(as: C, module: string, id: string, relatedList: string, options: PageOptions & { readonly fields: readonly string[] }): Promise<ZohoResult<ZohoPage>>;
  search(as: C, module: string, query: SearchQuery, options?: PageOptions): Promise<ZohoResult<ZohoPage>>;
  coql(as: C, selectQuery: string, options?: CallOptions): Promise<ZohoResult<ZohoPage>>;
  /** Create records without update-on-duplicate semantics. The caller owns any natural-key
   *  idempotency check before retrying an ambiguous response. */
  insert(as: C, module: string, records: readonly ZohoFields[], options?: CallOptions): Promise<ZohoResult<readonly RecordOutcome[]>>;
  update(as: C, module: string, id: string, fields: ZohoFields, options: UpdateOptions): Promise<ZohoResult<WriteAck>>;
  upsert(as: C, module: string, records: readonly ZohoFields[], duplicateCheckFields: readonly string[], options?: CallOptions): Promise<ZohoResult<readonly RecordOutcome[]>>;
  blueprintTransition(as: C, module: string, id: string, transitionId: string, data: ZohoFields, options?: CallOptions): Promise<ZohoResult<{ readonly transitioned: true }>>;
  wasDeleted(as: C, module: string, id: string, options?: CallOptions & { readonly maxPages?: number }): Promise<ZohoResult<DeletionCheck>>;
  /** Share Records API: a record-level share for one user (D44 cover windows). Related records are never shared. */
  share(as: C, module: string, id: string, userId: string, permission: "read" | "read_write", options?: CallOptions): Promise<ZohoResult<{ readonly shared: true }>>;
  /** Revokes that user's share. */
  unshare(as: C, module: string, id: string, userId: string, options?: CallOptions): Promise<ZohoResult<{ readonly revoked: true }>>;
}
export type ZohoClient = ZohoApi<UserCredential>;
export type ZohoServiceClient = ZohoApi<ServiceCredential>;

export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  /** A bounded reader is mandatory; non-streaming injected transports are refused fail-closed. */
  readonly body: {
    getReader(): {
      read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
      cancel(reason?: unknown): Promise<void>;
      releaseLock?(): void;
    };
  } | null;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: HttpMethod; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface ZohoClientOptions {
  readonly gate: Gate;
  readonly log: OpsLog;
  /** Stable numeric prefix shared by this CRM org's record, attachment and user ids; Plane B drops every other id. */
  readonly recordIdPrefix: string;
  readonly fetch?: FetchLike;
  readonly clock?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** A hard cap over every class's own policy. 1 disables retries. */
  readonly maxAttempts?: number;
  readonly blueprintOwnedFields?: Readonly<Record<string, readonly string[]>>;
}

/* ===== CREDENTIALS ======================================================================== */

/** Explicit service API hosts published for Zoho data centres. Never accept a lookalike TLD. */
const ZOHO_API_HOSTS: ReadonlySet<string> = new Set([
  "www.zohoapis.com",
  "www.zohoapis.eu",
  "www.zohoapis.in",
  "www.zohoapis.com.au",
  "www.zohoapis.jp",
  "www.zohoapis.ca",
  "www.zohoapis.sa",
  "www.zohoapis.com.cn",
  "www.zohoapis.uk",
  "www.zohoapis.ae",
]);
const mintedCredentials = new WeakSet<object>();

/** Validates a token response's `api_domain`: https, a Zoho API host, nothing else in the URL. */
export function apiDomainOf(raw: unknown): ApiDomain {
  if (typeof raw !== "string" || raw === "") throw new TypeError("The token response carried no api_domain, and the client never guesses one.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`api_domain ${JSON.stringify(raw)} is not a URL.`);
  }
  const bare = !url.username && !url.password && !url.port && !url.search && !url.hash && (url.pathname === "/" || url.pathname === "");
  if (url.protocol !== "https:" || !bare || !ZOHO_API_HOSTS.has(url.hostname.toLowerCase())) {
    throw new TypeError(`Refusing api_domain ${JSON.stringify(raw)}: not an https Zoho API host. A token is never sent anywhere else.`);
  }
  return url.origin as ApiDomain;
}

type Grant = { readonly accessToken: string; readonly apiDomain: ApiDomain; readonly expiresInMs: number | null };

export type UserIdentityFetchLike = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Readonly<Record<string, string>>;
    readonly redirect: "error";
    readonly signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface UserCredentialOptions {
  /** Stable numeric prefix for this CRM org; the token-authenticated user id must belong to it. */
  readonly recordIdPrefix: string;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly fetch?: UserIdentityFetchLike;
  /** Sampled before the identity request, so network latency never extends token expiry. */
  readonly clock?: () => number;
  readonly signal?: AbortSignal;
}

function grantOf(tokenResponse: unknown, requireExpiry = false): Grant {
  const g = typeof tokenResponse === "object" && tokenResponse !== null ? (tokenResponse as Record<string, unknown>) : null;
  if (!g || typeof g.access_token !== "string" || g.access_token === "") throw new TypeError("A Zoho token response must carry access_token.");
  const expirySeconds = typeof g.expires_in === "number" && Number.isSafeInteger(g.expires_in)
    && g.expires_in > 0 && g.expires_in <= MAX_TOKEN_LIFETIME_SECONDS
    ? g.expires_in
    : null;
  if (requireExpiry && expirySeconds === null) {
    throw new TypeError("A Zoho token response must carry a bounded expires_in value.");
  }
  const expiresIn = expirySeconds === null ? null : expirySeconds * 1000;
  return { accessToken: g.access_token, apiDomain: apiDomainOf(g.api_domain), expiresInMs: expiresIn };
}

function mint(fields: { kind: "user"; userId: string } | { kind: "service"; job: ServiceJob }, grant: Grant, now: number): object {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Credential issue time must be a non-negative safe integer.");
  const expiresAt = grant.expiresInMs === null ? null : now + grant.expiresInMs;
  if (expiresAt !== null && !Number.isSafeInteger(expiresAt)) throw new TypeError("Credential expiry is outside the supported time range.");
  const visible = { ...fields, apiDomain: grant.apiDomain, expiresAt };
  const credential = { ...visible };
  Object.defineProperty(credential, "accessToken", { value: grant.accessToken, enumerable: false });
  Object.defineProperty(credential, "toJSON", { value: () => ({ ...visible, accessToken: "[redacted]" }), enumerable: false });
  Object.freeze(credential);
  mintedCredentials.add(credential);
  return credential;
}

/**
 * Mint the acting human's credential only after their token identifies itself to Zoho (D53).
 * The response body is never logged or returned; failure messages contain no token or identity.
 */
export async function userCredential(
  tokenResponse: unknown,
  options: UserCredentialOptions,
): Promise<UserCredential> {
  if (!options || typeof options !== "object"
    || typeof options.recordIdPrefix !== "string"
    || !/^\d{6,16}$/.test(options.recordIdPrefix)
    || !options.gate || typeof options.gate.acquire !== "function"
    || !options.log || typeof options.log.call !== "function") {
    throw new TypeError("User credential recordIdPrefix must be 6–16 digits from this CRM org.");
  }
  const recordIdPrefix = options.recordIdPrefix;
  const gate = options.gate;
  const log = options.log;
  const credentialClock = options.clock ?? Date.now;
  const callerSignal = options.signal;
  const grant = grantOf(tokenResponse, true);
  let issuedAt: number;
  try {
    issuedAt = credentialClock();
  } catch {
    throw new TypeError("User credential clock is unavailable.");
  }
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new TypeError("User credential clock must return a non-negative safe integer.");
  }
  const fetchIdentity: UserIdentityFetchLike = options.fetch
    ?? ((url, init) => fetch(url, init));
  const deadline = new AbortController();
  const abortFromCaller = () => deadline.abort();
  if (callerSignal?.aborted) deadline.abort();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => deadline.abort(), USER_IDENTITY_TIMEOUT_MS);
  timer.unref?.();
  const finish = () => {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  };
  const sampledClock = (): number => {
    try {
      const value = credentialClock();
      return Number.isSafeInteger(value) && value >= 0 ? value : issuedAt;
    } catch {
      return issuedAt;
    }
  };
  let lease: GateLease;
  try {
    lease = await gate.acquire("simple", deadline.signal);
  } catch (error) {
    const errorClass: ZohoFailureKind = error instanceof GateQueueFullError ? "busy" : "aborted";
    log.call({
      at: issuedAt,
      actor: { kind: "user", userId: "unrecognised" },
      op: "currentUser",
      method: "GET",
      endpoint: "/users",
      callClass: "simple",
      status: null,
      durationMs: 0,
      gateWaitMs: Math.max(0, sampledClock() - issuedAt),
      attempt: 1,
      creditsRemaining: null,
      errorClass,
      recordIds: [],
    });
    finish();
    throw new TypeError("Zoho CurrentUser verification failed.");
  }
  const startedAt = sampledClock();
  let status: number | null = null;
  let creditsRemaining: number | null = null;
  let errorClass: ZohoFailureKind | null = null;
  let userId: string | null = null;
  try {
    let response: FetchResponseLike;
    try {
      response = await fetchIdentity(`${grant.apiDomain}/crm/${API_VERSION}/users?type=CurrentUser`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${grant.accessToken}` },
        redirect: "error",
        signal: deadline.signal,
      });
      status = response.status;
      creditsRemaining = parseCreditsRemaining(response.headers.get(CREDITS_HEADER));
    } catch {
      errorClass = deadline.signal.aborted ? "aborted" : "network";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    const read = await readBoundedResponse(response, 65_536, deadline.signal);
    if (!read.ok) {
      errorClass = read.reason === "aborted" ? "aborted"
        : read.reason === "read-failed" ? "network"
          : "unexpected";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    const text = read.text;
    if (status !== 200) {
      const classified = classifyResponse({ status, body: null });
      errorClass = isFailure(classified) ? classified.kind : "unexpected";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    if (text.length === 0) {
      errorClass = "unexpected";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      errorClass = "unexpected";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    const root = typeof body === "object" && body !== null && !Array.isArray(body)
      ? body as Readonly<Record<string, unknown>>
      : null;
    const users = root?.users;
    const current = Array.isArray(users) && users.length === 1
      && typeof users[0] === "object" && users[0] !== null && !Array.isArray(users[0])
      ? users[0] as Readonly<Record<string, unknown>>
      : null;
    const candidate = current?.id;
    if (typeof candidate !== "string" || !RECORD_ID.test(candidate) || !candidate.startsWith(recordIdPrefix)
      || current?.status !== "active") {
      errorClass = "unexpected";
      throw new TypeError("Zoho CurrentUser verification failed.");
    }
    userId = candidate;
  } catch {
    throw new TypeError("Zoho CurrentUser verification failed.");
  } finally {
    lease.release();
    log.call({
      at: startedAt,
      actor: { kind: "user", userId: userId ?? "unrecognised" },
      op: "currentUser",
      method: "GET",
      endpoint: "/users",
      callClass: "simple",
      status,
      durationMs: Math.max(0, sampledClock() - startedAt),
      gateWaitMs: lease.waitedMs,
      attempt: 1,
      creditsRemaining,
      errorClass,
      recordIds: [],
    });
    finish();
  }
  if (userId === null) throw new TypeError("Zoho CurrentUser verification failed.");
  return mint({ kind: "user", userId }, grant, issuedAt) as UserCredential;
}

/** A background job's credential (D53's list). There is no job called "admin". */
export function serviceCredential(job: ServiceJob, tokenResponse: unknown, now: number = Date.now()): ServiceCredential {
  if (!SERVICE_JOBS.has(job)) throw new TypeError(`"${String(job)}" is not a background job D53 allows a service token for.`);
  return mint({ kind: "service", job }, grantOf(tokenResponse, true), now) as ServiceCredential;
}

function assertCredential(credential: unknown, kind: Credential["kind"]): asserts credential is Credential {
  if (typeof credential !== "object" || credential === null || !mintedCredentials.has(credential)) {
    throw new TypeError("Every Zoho call needs a credential minted by userCredential() or serviceCredential(); there is no admin or global token (D52, D53).");
  }
  if ((credential as Credential).kind !== kind) {
    throw new TypeError(kind === "user" ? "A service credential never serves a screen (D53)." : "A person's token is not a background job's (D53).");
  }
}

/** Runtime provenance check for a signed-in person's credential at server-domain boundaries. */
export function isUserCredential(credential: unknown): credential is UserCredential {
  return typeof credential === "object"
    && credential !== null
    && mintedCredentials.has(credential)
    && (credential as Credential).kind === "user";
}

/** Runtime provenance check for server integrations that operate outside the CRM executor. */
export function assertServiceCredential(
  credential: unknown,
  job?: ServiceJob,
): asserts credential is ServiceCredential {
  assertCredential(credential, "service");
  if (credential.kind !== "service") throw new TypeError("A person's token is not a background job's (D53).");
  if (job !== undefined && credential.job !== job) {
    throw new TypeError(`This integration requires the ${job} service credential.`);
  }
}

/* ===== VALIDATION ========================================================================= */

const MODULE = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const RECORD = /^\d{1,25}$/;
const FIELD = /^[A-Za-z$][A-Za-z0-9_$]{0,99}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/;

function checkModule(module: string, what = "module"): string {
  if (typeof module !== "string" || !MODULE.test(module)) throw new TypeError(`Invalid ${what} API name ${JSON.stringify(module)}.`);
  return module;
}
function checkId(id: string, what = "record id"): string {
  if (typeof id !== "string" || !RECORD.test(id)) throw new TypeError(`Invalid ${what} ${JSON.stringify(id)}: Zoho ids are digits.`);
  return id;
}
function checkFields(fields: ZohoFields, allowId: boolean): ZohoFields {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) throw new TypeError("Fields are an object of API name → value.");
  for (const name of Object.keys(fields)) {
    if (!FIELD.test(name)) throw new TypeError(`Invalid field API name ${JSON.stringify(name)}.`);
    if (name === "id" && !allowId) throw new TypeError("The record id goes in the path, not the fields.");
  }
  return fields;
}
function fieldsParam(fields: readonly string[] | undefined): string | null {
  if (fields === undefined) return null;
  if (!Array.isArray(fields) || fields.length === 0 || fields.length > MAX_FIELDS) throw new TypeError(`fields must list 1–${MAX_FIELDS} API names.`);
  for (const f of fields) if (typeof f !== "string" || !FIELD.test(f)) throw new TypeError(`Invalid field API name ${JSON.stringify(f)}.`);
  return fields.join(",");
}
function pageQuery(options: PageOptions): [string, string][] {
  const q: [string, string][] = [];
  if (options.page !== undefined) {
    if (!Number.isInteger(options.page) || options.page < 1) throw new RangeError("page starts at 1.");
    q.push(["page", String(options.page)]);
  }
  if (options.perPage !== undefined) {
    if (!Number.isInteger(options.perPage) || options.perPage < 1 || options.perPage > 200) throw new RangeError("perPage is 1–200.");
    q.push(["per_page", String(options.perPage)]);
  }
  const fields = fieldsParam(options.fields);
  if (fields) q.push(["fields", fields]);
  return q;
}

/* ===== RESPONSE READING =================================================================== */

type Obj = Readonly<Record<string, unknown>>;
const obj = (x: unknown): Obj | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Obj) : null);

function recordsIn(body: unknown): ZohoRecord[] {
  const data = obj(body)?.data;
  if (!Array.isArray(data)) return [];
  const out: ZohoRecord[] = [];
  for (const raw of data) {
    const r = obj(raw);
    // IDs are source identifiers, not quantities. Never accept a JSON number:
    // 18/19-digit Zoho ids lose precision before they can be stringified.
    const id = r && typeof r.id === "string" && RECORD.test(r.id) ? r.id : null;
    if (r && id !== null) out.push(Object.freeze({ ...r, id }));
  }
  return out;
}
function invalidRecordIdsIn(body: unknown): boolean {
  const data = obj(body)?.data;
  if (!Array.isArray(data)) return false;
  return data.some((raw) => {
    const record = obj(raw);
    return record === null || typeof record.id !== "string" || !RECORD.test(record.id);
  });
}
const moreRecords = (body: unknown): boolean => obj(obj(body)?.info)?.more_records === true;
const pageOf = (result: ZohoSuccess): ZohoPage => {
  if (result.kind === "empty") return { records: [], moreRecords: false };
  const invalidRecordIds = invalidRecordIdsIn(result.body);
  return {
    records: recordsIn(result.body),
    moreRecords: moreRecords(result.body),
    ...(invalidRecordIds ? { invalidRecordIds: true as const } : {}),
  };
};

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type BoundedResponseText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: "aborted" | "too-large" | "invalid-utf8" | "malformed" | "read-failed" };

function declaredContentLength(response: FetchResponseLike): number | null {
  const raw = response.headers.get("Content-Length");
  if (raw === null || !/^(?:0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Read while the gate lease is held, refusing before more than maxBytes enters application memory. */
async function readBoundedResponse(
  response: FetchResponseLike,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedResponseText> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return { ok: false, reason: "malformed" };
  const declared = declaredContentLength(response);
  if (declared !== null && declared > maxBytes) {
    if (response.body) {
      try {
        const reader = response.body.getReader();
        await reader.cancel("response-too-large");
        reader.releaseLock?.();
      } catch {
        // The refusal is already determined; cancellation is best-effort.
      }
    }
    return { ok: false, reason: "too-large" };
  }

  if (response.body) {
    let reader: ReturnType<NonNullable<FetchResponseLike["body"]>["getReader"]>;
    try {
      reader = response.body.getReader();
    } catch {
      return { ok: false, reason: "malformed" };
    }
    let aborted = signal?.aborted === true;
    const cancel = (reason: unknown): Promise<void> => reader.cancel(reason).catch(() => undefined);
    const abort = () => {
      aborted = true;
      void cancel(signal?.reason);
    };
    if (!aborted) signal?.addEventListener("abort", abort, { once: true });
    try {
      if (aborted) {
        await cancel(signal?.reason);
        return { ok: false, reason: "aborted" };
      }
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      let text = "";
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch {
          await cancel(aborted ? signal?.reason : "response-read-failed");
          return { ok: false, reason: aborted ? "aborted" : "read-failed" };
        }
        if (aborted) {
          await cancel(signal?.reason);
          return { ok: false, reason: "aborted" };
        }
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          await cancel("malformed-response");
          return { ok: false, reason: "malformed" };
        }
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await cancel("response-too-large");
          return { ok: false, reason: "too-large" };
        }
        try {
          text += decoder.decode(chunk.value, { stream: true });
        } catch {
          await cancel("malformed-response");
          return { ok: false, reason: "invalid-utf8" };
        }
      }
      try {
        text += decoder.decode();
      } catch {
        await cancel("malformed-response");
        return { ok: false, reason: "invalid-utf8" };
      }
      return { ok: true, text };
    } finally {
      signal?.removeEventListener("abort", abort);
      reader.releaseLock?.();
    }
  }

  return { ok: false, reason: signal?.aborted ? "aborted" : "malformed" };
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

/* ===== THE EXECUTOR ======================================================================= */

type Spec = {
  readonly op: string;
  readonly method: HttpMethod;
  readonly path: string;
  /** For the log: a template, never the URL. */
  readonly endpoint: string;
  readonly query?: readonly (readonly [string, string])[];
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly shape: CallShape;
  readonly idempotent: boolean;
  readonly perRecord: boolean;
  /** Successful CRM responses must prove their envelope; missing page metadata is not "empty". */
  readonly responseShape?: "data" | "page";
  /** Refuse a response before any per-record classification or returned-id logging can enumerate it. */
  readonly maxRows?: number;
  readonly recordIds: readonly string[];
  /** List reads log the ids they returned: who read what is Plane B's to know (D47). */
  readonly logReturnedIds: boolean;
  readonly signal?: AbortSignal;
};
type Outcome =
  | { readonly ok: true; readonly result: ZohoSuccess; readonly creditsRemaining: number | null }
  | { readonly ok: false; readonly error: ZohoFailure; readonly creditsRemaining: number | null };

function createExecutor(kind: Credential["kind"], options: ZohoClientOptions) {
  const { gate, log } = options;
  if (typeof options.recordIdPrefix !== "string" || !/^\d{6,16}$/.test(options.recordIdPrefix)) {
    throw new TypeError("Zoho client recordIdPrefix must be 6–16 digits from this CRM org.");
  }
  const recordIdPrefix = options.recordIdPrefix;
  const visibleRecordId = (value: unknown): value is string =>
    typeof value === "string" && RECORD_ID.test(value) && value.startsWith(recordIdPrefix);
  const fetchImpl: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) throw new RangeError(`maxAttempts is 1–${MAX_ATTEMPTS}.`);

  const actorOf = (c: Credential): LogActor => (c.kind === "user" ? { kind: "user", userId: c.userId } : { kind: "service", job: c.job });
  const assertConfiguredActor = (credential: Credential): void => {
    assertCredential(credential, kind);
    if (credential.kind === "user" && !visibleRecordId(credential.userId)) {
      throw new TypeError("The user credential does not belong to this configured CRM org.");
    }
  };

  const refuse = (as: Credential, action: string, reason: string, recordIds: readonly string[]): Outcome => {
    assertConfiguredActor(as);
    log.refusal({ at: clock(), actor: actorOf(as), action, reason, recordIds: recordIds.filter(visibleRecordId) });
    return { ok: false, error: { kind: "refused", status: null, reason }, creditsRemaining: null };
  };

  const idsFor = (spec: Spec, outcome: ZohoClassified): string[] => {
    const ids = [...spec.recordIds];
    const records = outcome.kind === "ok" || outcome.kind === "partial" || outcome.kind === "invalid-data" ? outcome.records : null;
    for (const r of records ?? []) if (r.id) ids.push(r.id);
    if (spec.logReturnedIds && outcome.kind === "ok") for (const r of recordsIn(outcome.body)) ids.push(r.id);
    return ids.filter(visibleRecordId);
  };

  const execute = async (as: Credential, spec: Spec): Promise<Outcome> => {
    assertConfiguredActor(as);
    const actor = actorOf(as);
    if (as.expiresAt !== null && clock() >= as.expiresAt) {
      log.refusal({
        at: clock(), actor, action: spec.op, reason: "token-expired", recordIds: spec.recordIds.filter(visibleRecordId),
      });
      return { ok: false, error: { kind: "auth-expired", status: null, code: "TOKEN_EXPIRED" }, creditsRemaining: null };
    }
    const callClass: CallClass = classOf(spec.shape);
    const qs = spec.query && spec.query.length ? `?${new URLSearchParams(spec.query.map(([k, v]) => [k, v])).toString()}` : "";
    const url = `${as.apiDomain}/crm/${API_VERSION}${spec.path}${qs}`;
    const headers: Record<string, string> = { Accept: "application/json", ...spec.headers, Authorization: `Zoho-oauthtoken ${as.accessToken}` };
    const body = spec.body === undefined ? undefined : JSON.stringify(spec.body);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const line = (at: number, status: number | null, durationMs: number, gateWaitMs: number, attempt: number, credits: number | null, outcome: ZohoClassified) =>
      log.call({
        at, actor, op: spec.op, method: spec.method, endpoint: spec.endpoint, callClass, status, durationMs, gateWaitMs, attempt,
        creditsRemaining: credits, errorClass: isFailure(outcome) ? outcome.kind : null, recordIds: idsFor(spec, outcome),
      });

    let lastCredits: number | null = null;
    for (let attempt = 1; ; attempt++) {
      const queuedAt = clock();
      if (as.expiresAt !== null && queuedAt >= as.expiresAt) {
        log.refusal({
          at: queuedAt, actor, action: spec.op, reason: "token-expired", recordIds: spec.recordIds.filter(visibleRecordId),
        });
        return { ok: false, error: { kind: "auth-expired", status: null, code: "TOKEN_EXPIRED" }, creditsRemaining: lastCredits };
      }
      let lease: GateLease;
      try {
        lease = await gate.acquire(callClass, spec.signal);
      } catch (error) {
        const failure: ZohoFailure = error instanceof GateQueueFullError ? { kind: "busy", status: null } : { kind: "aborted", status: null };
        line(queuedAt, null, 0, clock() - queuedAt, attempt, null, failure);
        return { ok: false, error: failure, creditsRemaining: lastCredits };
      }
      const startedAt = clock();
      if (as.expiresAt !== null && startedAt >= as.expiresAt) {
        lease.release();
        log.refusal({
          at: startedAt, actor, action: spec.op, reason: "token-expired", recordIds: spec.recordIds.filter(visibleRecordId),
        });
        return { ok: false, error: { kind: "auth-expired", status: null, code: "TOKEN_EXPIRED" }, creditsRemaining: lastCredits };
      }
      let status: number | null = null;
      let credits: number | null = null;
      let outcome: ZohoClassified = { kind: "unexpected", status: 0, code: "INTERNAL_RESPONSE_STATE" };
      try {
        const response = await fetchImpl(url, { method: spec.method, headers, body, signal: spec.signal });
        status = response.status;
        credits = parseCreditsRemaining(response.headers.get(CREDITS_HEADER));
        let parsed: unknown = null;
        let malformedRead = false;
        if (status !== 204 && status !== 304) {
          const read = await readBoundedResponse(response, MAX_ZOHO_RESPONSE_BYTES, spec.signal);
          if (!read.ok) {
            outcome = read.reason === "aborted"
              ? { kind: "aborted", status: null }
              : read.reason === "read-failed"
                ? { kind: "network", status: null }
                : { kind: "unexpected", status, code: "MALFORMED_RESPONSE" };
            malformedRead = true;
          } else {
            parsed = parseJson(read.text);
          }
        }
        if (!malformedRead) {
          const root = obj(parsed);
          const data = root?.data;
          if (spec.maxRows !== undefined && Array.isArray(data) && data.length > spec.maxRows) {
            outcome = { kind: "unexpected", status, code: "MALFORMED_RESPONSE" };
          } else {
            outcome = classifyResponse({ status, body: parsed, retryAfter: response.headers.get("Retry-After"), perRecord: spec.perRecord });
            if (outcome.kind === "ok" && spec.responseShape) {
              const info = obj(root?.info);
              const malformed = !root
                || !Array.isArray(data)
                || (spec.responseShape === "page" && typeof info?.more_records !== "boolean");
              if (malformed) outcome = { kind: "unexpected", status, code: "MALFORMED_RESPONSE" };
            }
          }
        }
      } catch (error) {
        outcome = classifyThrown(error, spec.signal);
      } finally {
        lease.release(); // held until the body is read: Zoho counts the call active until then
      }
      if (credits !== null) lastCredits = credits;
      const completed = outcome;
      line(startedAt, status, clock() - startedAt, startedAt - queuedAt, attempt, credits, completed);
      if (!isFailure(completed)) return { ok: true, result: completed, creditsRemaining: lastCredits };
      const policy = retryPolicy(completed, { idempotent: spec.idempotent });
      if (!policy.retry || attempt >= Math.min(policy.maxAttempts, maxAttempts)) return { ok: false, error: completed, creditsRemaining: lastCredits };
      try {
        await sleep(backoffDelay(attempt, policy, retryAfterOf(completed), random), spec.signal);
      } catch {
        return { ok: false, error: { kind: "aborted", status: null }, creditsRemaining: lastCredits };
      }
    }
  };

  return { execute, refuse };
}

const done = <T>(value: T, out: { readonly result: ZohoSuccess; readonly creditsRemaining: number | null }): ZohoResult<T> => ({
  ok: true,
  value,
  status: out.result.status,
  creditsRemaining: out.creditsRemaining,
});

/* ===== THE API ============================================================================ */

function buildApi<C extends Credential>(kind: C["kind"], options: ZohoClientOptions): ZohoApi<C> {
  const recordIdPrefix = options.recordIdPrefix;
  const { execute, refuse } = createExecutor(kind, options);
  const checkScopedId = (id: string, what = "record id"): string => {
    checkId(id, what);
    if (!RECORD_ID.test(id) || !id.startsWith(recordIdPrefix)) {
      throw new TypeError(`Invalid ${what}: it does not belong to this configured CRM org.`);
    }
    return id;
  };
  const owned = options.blueprintOwnedFields ?? DEFAULT_BLUEPRINT_OWNED_FIELDS;
  const ownedIn = (module: string, fields: ZohoFields): string[] =>
    (owned[module] ?? []).filter((f) => Object.prototype.hasOwnProperty.call(fields, f));

  return {
    async getRecord(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const fields = fieldsParam(opts.fields);
      const out = await execute(as, {
        op: "getRecord", method: "GET", path: `/${module}/${id}`, endpoint: `/${module}/{id}`,
        query: fields ? [["fields", fields]] : undefined, shape: { op: "read" }, idempotent: true, perRecord: false,
        responseShape: "data", maxRows: 1, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      return done(out.result.kind === "empty" ? null : recordsIn(out.result.body)[0] ?? null, out);
    },

    async getRelated(as, module, id, relatedList, opts) {
      checkModule(module);
      checkScopedId(id);
      checkModule(relatedList, "related list");
      if (!opts || opts.fields === undefined) throw new TypeError("v8 related reads need an explicit fields list — which is also the projection (D46).");
      const out = await execute(as, {
        op: "getRelated", method: "GET", path: `/${module}/${id}/${relatedList}`, endpoint: `/${module}/{id}/${relatedList}`,
        query: pageQuery(opts), shape: { op: "read" }, idempotent: true, perRecord: false,
        responseShape: "page", maxRows: opts.perPage ?? 200, recordIds: [id], logReturnedIds: true, signal: opts.signal,
      });
      return out.ok ? done(pageOf(out.result), out) : out;
    },

    async search(as, module, query, opts = {}) {
      checkModule(module);
      const given = (["criteria", "email", "phone", "word"] as const).filter((k) => Object.prototype.hasOwnProperty.call(query, k));
      if (given.length !== 1) throw new TypeError("search() takes exactly one of criteria, email, phone or word.");
      const param = given[0];
      const value = (query as Record<string, unknown>)[param];
      if (typeof value !== "string" || value.trim() === "" || value.length > 2_000) throw new TypeError(`search ${param} must be a non-empty string.`);
      const out = await execute(as, {
        op: "search", method: "GET", path: `/${module}/search`, endpoint: `/${module}/search`,
        query: [[param, value], ...pageQuery(opts)], shape: { op: "read" }, idempotent: true, perRecord: false,
        responseShape: "page", maxRows: opts.perPage ?? 200, recordIds: [], logReturnedIds: true, signal: opts.signal,
      });
      return out.ok ? done(pageOf(out.result), out) : out;
    },

    async coql(as, selectQuery, opts = {}) {
      if (typeof selectQuery !== "string" || !/^\s*select\s/i.test(selectQuery) || selectQuery.length > 20_000) {
        throw new TypeError("coql() takes one SELECT statement. Values interpolated into it are the caller's to escape.");
      }
      const out = await execute(as, {
        op: "coql", method: "POST", path: "/coql", endpoint: "/coql", body: { select_query: selectQuery },
        shape: { op: "coql" }, idempotent: true, perRecord: false, responseShape: "page", maxRows: 2_000,
        recordIds: [], logReturnedIds: true, signal: opts.signal,
      });
      return out.ok ? done(pageOf(out.result), out) : out;
    },

    async insert(as, module, records, opts = {}) {
      checkModule(module);
      if (!Array.isArray(records) || records.length < 1 || records.length > MAX_UPSERT_RECORDS) {
        throw new RangeError(`insert() takes 1–${MAX_UPSERT_RECORDS} records.`);
      }
      for (const r of records) checkFields(r, false);
      if (records.some((r) => ownedIn(module, r).length)) return refuse(as, "insert", "stage-field-write", []) as ZohoResult<readonly RecordOutcome[]>;
      const out = await execute(as, {
        op: "insert", method: "POST", path: `/${module}`, endpoint: `/${module}`, body: { data: records },
        // A lost response is ambiguous: unlike upsert, a generic insert has no duplicate key.
        // Callers with a natural unique key re-read it before deciding whether to retry.
        shape: { op: "write", records: records.length }, idempotent: false, perRecord: true,
        responseShape: "data", maxRows: records.length, recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      return done(out.result.kind === "ok" ? out.result.records ?? [] : [], out);
    },

    async update(as, module, id, fields, opts) {
      checkModule(module);
      checkScopedId(id);
      checkFields(fields, false);
      if (!opts || (opts.ifUnmodifiedSince !== null && (typeof opts.ifUnmodifiedSince !== "string" || !ZOHO_DATETIME.test(opts.ifUnmodifiedSince)))) {
        throw new TypeError("update() needs ifUnmodifiedSince: the record's Modified_Time (e.g. 2026-09-23T10:00:00+05:30), or an explicit null.");
      }
      if (ownedIn(module, fields).length) return refuse(as, "update", "stage-field-write", [id]) as ZohoResult<WriteAck>;
      const out = await execute(as, {
        op: "update", method: "PUT", path: `/${module}/${id}`, endpoint: `/${module}/{id}`, body: { data: [{ ...fields }] },
        headers: opts.ifUnmodifiedSince === null ? undefined : { "If-Unmodified-Since": opts.ifUnmodifiedSince },
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? out.result.records?.[0] : undefined;
      return done({ id: first?.id ?? id, modifiedTime: first?.modifiedTime ?? null }, out);
    },

    async upsert(as, module, records, duplicateCheckFields, opts = {}) {
      checkModule(module);
      if (!Array.isArray(records) || records.length < 1 || records.length > MAX_UPSERT_RECORDS) {
        throw new RangeError(`upsert() takes 1–${MAX_UPSERT_RECORDS} records.`);
      }
      for (const r of records) {
        checkFields(r, true);
        if (Object.prototype.hasOwnProperty.call(r, "id")) checkScopedId(r.id as string);
      }
      if (!Array.isArray(duplicateCheckFields)) throw new TypeError("duplicateCheckFields is a list of field API names.");
      for (const f of duplicateCheckFields) if (typeof f !== "string" || !FIELD.test(f)) throw new TypeError(`Invalid duplicate-check field ${JSON.stringify(f)}.`);
      if (records.some((r) => ownedIn(module, r).length)) return refuse(as, "upsert", "stage-field-write", []) as ZohoResult<readonly RecordOutcome[]>;
      const out = await execute(as, {
        op: "upsert", method: "POST", path: `/${module}/upsert`, endpoint: `/${module}/upsert`,
        body: duplicateCheckFields.length ? { data: records, duplicate_check_fields: duplicateCheckFields } : { data: records },
        // Idempotent by construction: a resend matches the duplicate-check fields and updates in place.
        shape: { op: "write", records: records.length }, idempotent: true, perRecord: true, responseShape: "data", maxRows: records.length,
        recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      return done(out.result.kind === "ok" ? out.result.records ?? [] : [], out);
    },

    async blueprintTransition(as, module, id, transitionId, data, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(transitionId, "transition id");
      checkFields(data, false);
      const out = await execute(as, {
        op: "blueprintTransition", method: "PUT", path: `/${module}/${id}/actions/blueprint`, endpoint: `/${module}/{id}/actions/blueprint`,
        body: { blueprint: [{ transition_id: transitionId, data: { ...data } }] },
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ transitioned: true } as const, out) : out;
    },

    async share(as, module, id, userId, permission, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(userId, "user id");
      if (permission !== "read" && permission !== "read_write") throw new TypeError('permission is "read" or "read_write".');
      const out = await execute(as, {
        op: "share", method: "POST", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
        body: { share: [{ share_related_records: false, user: { id: userId }, permission }] },
        // Re-sharing the same user replaces the permission in place.
        shape: { op: "write", records: 1 }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ shared: true } as const, out) : out;
    },

    // ponytail: the per-user revoke body is from the docs, unproven until M02-S09-T01 runs on the sandbox.
    async unshare(as, module, id, userId, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(userId, "user id");
      const out = await execute(as, {
        op: "unshare", method: "DELETE", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
        body: { share: [{ user: { id: userId } }] },
        shape: { op: "write", records: 1 }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ revoked: true } as const, out) : out;
    },

    async wasDeleted(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const maxPages = opts.maxPages ?? DEFAULT_DELETED_PAGES;
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) throw new RangeError("maxPages is 1–50.");
      let last: Outcome | null = null;
      for (let page = 1; page <= maxPages; page++) {
        const out = await execute(as, {
          op: "wasDeleted", method: "GET", path: `/${module}/deleted`, endpoint: `/${module}/deleted`,
          query: [["type", "recycle"], ["page", String(page)], ["per_page", String(DELETED_PAGE_SIZE)]],
          shape: { op: "read" }, idempotent: true, perRecord: false, responseShape: "page", maxRows: DELETED_PAGE_SIZE,
          recordIds: [id], logReturnedIds: false, signal: opts.signal,
        });
        if (!out.ok) return out;
        last = out;
        if (out.result.kind === "empty") return done({ deleted: false, exhaustive: true }, out);
        const data = obj(out.result.body)?.data;
        const hit = Array.isArray(data) ? data.map(obj).find((d) => d !== null && String(d.id) === id) : undefined;
        if (hit) {
          const by = obj(hit.deleted_by);
          const byId = by && (typeof by.id === "string" || typeof by.id === "number") ? String(by.id) : null;
          return done(
            {
              deleted: true,
              deletedBy: by && byId !== null ? { id: byId, name: typeof by.name === "string" ? by.name : "" } : null,
              deletedTime: typeof hit.deleted_time === "string" ? hit.deleted_time : null,
            },
            out,
          );
        }
        if (!moreRecords(out.result.body)) return done({ deleted: false, exhaustive: true }, out);
      }
      return last && last.ok ? done({ deleted: false, exhaustive: false }, last) : { ok: false, error: { kind: "unexpected", status: 0, code: "" }, creditsRemaining: null };
    },
  };
}

/** The client every screen's server code uses: user credentials only. */
export function createZohoClient(options: ZohoClientOptions): ZohoClient {
  return buildApi<UserCredential>("user", options);
}

/** The client background jobs use: service credentials only. Never handed to a request path. */
export function createZohoServiceClient(options: ZohoClientOptions): ZohoServiceClient {
  return buildApi<ServiceCredential>("service", options);
}
