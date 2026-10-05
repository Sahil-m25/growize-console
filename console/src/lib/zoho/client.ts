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
import { createFlights } from "./coalesce";
import { anySignal, currentDeadline, zohoAttemptTimeoutMs } from "./deadline";
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

/** D121: one entry of a record's share list. `targetId` is a user, role or group id. */
export type SharePermission = "read_only" | "read_write" | "full_access";
export interface ShareEntry {
  readonly kind: "users" | "roles" | "groups";
  readonly targetId: string;
  readonly permission: SharePermission;
}
/** As read back: `inherited` = shared through another record's related-records share (not this record's own list);
 *  `sharedBy` = the user who made it, when Zoho says (it does only for callers with full access). */
export interface RecordShare extends ShareEntry {
  readonly inherited: boolean;
  readonly sharedBy: string | null;
}
/** Zoho's per-record share limit (Kaizen #49: "10 users"). */
export const MAX_RECORD_SHARES = 10;

/** The background work D53 allows a service token for. Nothing on this list serves a screen. */
/* D123: "cover-window-share" and "handoff-share" are retired — Zoho field sharing (Cover_By, Originating_IR, IR_Access) does that access. "cover-expiry" only clears lapsed Cover_By/Cover_Until. */
/** "kam-pool-return" (M03-S04-T02): the org-scope read of a moved KAM's book; its writes stay on the person's own token. */
export type ServiceJob = "audit-archive" | "cover-expiry" | "invariant-check" | "provider-callback" | "kam-pool-return";
const SERVICE_JOBS: ReadonlySet<string> = new Set(["audit-archive", "cover-expiry", "invariant-check", "provider-callback", "kam-pool-return"]);

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

/** One line of a record's Zoho timeline (Plane A, D47). Only WHICH fields changed is kept: the
 *  old and new values are dropped at the parse, so no value (an identity field included) can leave. */
export interface TimelineEntry {
  readonly at: string;
  readonly action: string;
  readonly byId: string | null;
  readonly fields: readonly string[];
}
export interface TimelinePage {
  readonly entries: readonly TimelineEntry[];
  readonly moreRecords: boolean;
}

/** One row of a COQL aggregate (COUNT/SUM … GROUP BY): the group keys as text or a lookup id, and
 *  the aggregates as numbers. No other value survives the parse — it is counts, not records (D52). */
export type AggregateRow = Readonly<Record<string, string | number | null>>;

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
  /** M11-S05: GET /{module}/{id}/actions/blueprint — the record's blueprint state and the transitions open to this
   *  person now (id, name, target value, whether Zoho's conditions match). `null`: the record is in no blueprint
   *  (204). Discovery only: the transition is then made with `blueprintTransition()`. Criteria text is never logged. */
  blueprint(as: C, module: string, id: string, options?: CallOptions): Promise<ZohoResult<BlueprintState | null>>;
  wasDeleted(as: C, module: string, id: string, options?: CallOptions & { readonly maxPages?: number }): Promise<ZohoResult<DeletionCheck>>;
  /** Share Records API (v8 POST, additive): a record-level share for one user (D44 cover windows, D74 hand-off).
   *  Body `shared_with: { id, type: "users" }`. Related records are never shared. */
  share(as: C, module: string, id: string, userId: string, permission: "read_only" | "read_write", options?: CallOptions): Promise<ZohoResult<{ readonly shared: true }>>;
  /** Revokes ONLY that user's direct share: reads the share list and PUTs it back without them (`shares` + `setShares`).
   *  Zoho's DELETE revokes every share on the record, so it is sent only when nobody else is left. No share = no write. */
  unshare(as: C, module: string, id: string, userId: string, options?: CallOptions): Promise<ZohoResult<{ readonly revoked: true }>>;
  /** D121: GET /{module}/{id}/actions/share — the record's share list as ids and permissions (names and zuids dropped). */
  shares(as: C, module: string, id: string, options?: CallOptions): Promise<ZohoResult<readonly RecordShare[]>>;
  /** D121: PUT /{module}/{id}/actions/share with the record's WHOLE direct share list (Zoho revokes whoever is left out);
   *  an empty list is DELETE, which revokes every share on the record. Related records are never shared. */
  setShares(as: C, module: string, id: string, list: readonly ShareEntry[], options?: CallOptions): Promise<ZohoResult<{ readonly set: true }>>;
  /** Deletes one record the person may delete (moves it to Zoho's recycle bin). Never retried: a
   *  lost reply is checked with `wasDeleted()`. Used to take back a write inside its Undo window. */
  deleteRecord(as: C, module: string, id: string, options?: CallOptions): Promise<ZohoResult<{ readonly deleted: true }>>;
  /** PUT /users/{id} for the signed-in person's own user: only full name and mobile (M17-S05). */
  updateOwnUser(as: C, fields: { readonly first_name?: string; readonly last_name: string; readonly mobile?: string | null }, options?: CallOptions): Promise<ZohoResult<{ readonly updated: true }>>;
  /** PUT /users/{id} (M03-S04-T02): another user's role and profile — a seat change, on the changer's own
   *  user token only (D53; a service credential is refused). Never retried: a lost reply is re-read. */
  updateUserSeat(as: C, userId: string, seat: UserSeatWrite, options?: CallOptions): Promise<ZohoResult<{ readonly updated: true }>>;
  /** A COQL aggregate query (must use COUNT/SUM/MIN/MAX/AVG). Rows carry only group keys and numbers. */
  aggregate(as: C, selectQuery: string, options?: CallOptions): Promise<ZohoResult<readonly AggregateRow[]>>;
  /** GET /{module}/{id}/__timeline — who changed which fields when, newest first; values dropped. */
  timeline(as: C, module: string, id: string, options?: CallOptions & { readonly perPage?: number }): Promise<ZohoResult<TimelinePage>>;
  /** POST /{module}/{id}/actions/send_mail (M07-S05) — sent from the caller's own mailbox, filed on the
   *  record's Emails list. To addresses only (no cc/bcc), plain text or HTML. Never retried: a mail may have left. */
  sendMail(as: C, module: string, id: string, mail: SendMailRequest, options?: CallOptions): Promise<ZohoResult<{ readonly sent: true; readonly messageId: string | null }>>;
  /** GET /settings/emails/actions/from_addresses — the addresses the caller may send from. */
  fromAddresses(as: C, options?: CallOptions): Promise<ZohoResult<readonly FromAddress[]>>;
  /** GET /users?type=… (M17-S01): one page of Zoho users as Zoho returns them (the caller projects; nothing
   *  here is logged but the call line). `AllUsers` includes deactivated users, so a leaver can be shown as left. */
  listUsers(as: C, options?: CallOptions & { readonly type?: UsersListType; readonly page?: number; readonly perPage?: number }): Promise<ZohoResult<UsersPage>>;
  /** GET /settings/roles (M17-S01): the org's roles — id, name, reporting_to id only. */
  settingsRoles(as: C, options?: CallOptions): Promise<ZohoResult<readonly ZohoRoleRow[]>>;
  /** GET /settings/profiles (M17-S01): the org's profiles — id and name only. */
  settingsProfiles(as: C, options?: CallOptions): Promise<ZohoResult<readonly ZohoProfileRow[]>>;
  /** M12-S02: POST /{module}/{id}/Attachments (multipart "file"). Not idempotent; the caller guards double presses. */
  uploadAttachment(as: C, module: string, id: string, file: UploadFile, options?: CallOptions): Promise<ZohoResult<{ readonly attachmentId: string }>>;
  /** M12-S02: POST /files (ZFS) for a file-upload field; the returned id is then written to the field. */
  uploadFile(as: C, file: UploadFile, options?: CallOptions): Promise<ZohoResult<{ readonly fileId: string }>>;
  /** M12-S06 (additive): DELETE /{module}/{id}/Attachments/{attachment_id} — the compensating step when a filing half-fails. */
  deleteAttachment(as: C, module: string, id: string, attachmentId: string, options?: CallOptions): Promise<ZohoResult<{ readonly deleted: true }>>;
  /** M12-S09: GET /{module}/{id}/Emails — metadata only (no body). `index` is Zoho's next_index. */
  listEmails(as: C, module: string, id: string, options?: CallOptions & { readonly index?: string }): Promise<ZohoResult<EmailPage>>;
  /** M12-S09: GET /{module}/{id}/Emails/{message_id} — one email with its content. `null` when Zoho returns nothing. */
  getEmail(as: C, module: string, id: string, messageId: string, options?: CallOptions & { readonly ownerId?: string }): Promise<ZohoResult<EmailContent | null>>;
  /** M13-S04: PUT /{module}/{id}/actions/change_owner — hand one record to another user on the caller's own
   *  token (Zoho writes the Owner change to field history). Re-sending the same owner is harmless. */
  changeOwner(as: C, module: string, id: string, ownerId: string, options?: CallOptions & { readonly notify?: boolean }): Promise<ZohoResult<{ readonly changed: true }>>;
  /** M17-S02: PUT /users/{id} Reporting_To — another user's manager (null: nobody), on the changer's own user
   *  token only (D53). Never retried: a lost reply is re-read. PROVISIONAL body until the sandbox proves it. */
  updateUserManager(as: C, userId: string, managerId: string | null, options?: CallOptions): Promise<ZohoResult<{ readonly updated: true }>>;
}
/** M11-S05: one transition Zoho offers on a record now. `fields`: the api names the transition's During form asks for. */
export interface BlueprintTransitionInfo {
  readonly id: string;
  readonly name: string;
  readonly nextFieldValue: string | null;
  /** false: Zoho says the transition's conditions are not met for this record now. */
  readonly criteriaMatched: boolean;
  readonly criteriaMessage: string | null;
  readonly fields: readonly string[];
}
export interface BlueprintState {
  readonly processName: string | null;
  /** The blueprint field's api name (e.g. Allocation_Status) and its current value. */
  readonly fieldApiName: string | null;
  readonly fieldValue: string | null;
  readonly transitions: readonly BlueprintTransitionInfo[];
}
export type UsersListType = "AllUsers" | "ActiveUsers" | "DeactiveUsers";
export interface UsersPage { readonly users: readonly Readonly<Record<string, unknown>>[]; readonly moreRecords: boolean }
export interface ZohoRoleRow { readonly id: string; readonly name: string; readonly reportingTo: string | null }
export interface ZohoProfileRow { readonly id: string; readonly name: string }
/** The role and profile a seat change writes; ids pinned from the settings export, names exactly as Zoho has them. */
export interface UserSeatWrite { readonly roleId: string; readonly roleName: string; readonly profileId: string; readonly profileName: string }
export interface MailAddress { readonly email: string; readonly userName?: string }
export interface SendMailRequest {
  readonly from: MailAddress;
  readonly to: readonly MailAddress[];
  readonly subject: string;
  readonly content: string;
  readonly format: "text" | "html";
  /** Files already in Zoho File Storage (POST /files → uploadFile()), attached by their id. Zoho caps the total at 10 MB. */
  readonly attachmentFileIds?: readonly string[];
}
/** Zoho's send_mail attachment ids are opaque encrypted strings; we accept a conservative character set and bound the count. */
export const SEND_MAIL_MAX_ATTACHMENTS = 5;
const MAIL_FILE_ID = /^[A-Za-z0-9_-]{16,300}$/;
export interface FromAddress { readonly email: string; readonly type: string; readonly userName: string | null; readonly isDefault: boolean }
/** send_mail's own ceilings, below Zoho's; the product's tighter limits live with the caller. */
export const SEND_MAIL_MAX_TO = 10;
export const SEND_MAIL_MAX_SUBJECT = 500;
export const SEND_MAIL_MAX_CONTENT = 100_000;
const MAIL_ADDRESS = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

/* ----- M12-S02 uploads / M12-S09 record emails (additive) ----- */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** PDF/JPEG/PNG for papers (M12-S02); text/csv for bank statements (server/money). Each caller keeps its own allowlist. */
export type UploadMime = "application/pdf" | "image/jpeg" | "image/png" | "text/csv";
export const UPLOAD_MIMES: readonly UploadMime[] = Object.freeze(["application/pdf", "image/jpeg", "image/png", "text/csv"]);
export interface UploadFile { readonly fileName: string; readonly contentType: UploadMime; readonly bytes: Uint8Array }
export interface EmailParty { readonly email: string; readonly name: string | null }
export interface EmailLine {
  readonly messageId: string;
  readonly subject: string;
  readonly from: EmailParty | null;
  readonly to: readonly EmailParty[];
  readonly sentTime: string | null;
  /** true: sent from CRM; false: received */
  readonly sent: boolean;
  readonly hasAttachment: boolean;
  readonly ownerId: string | null;
}
export interface EmailPage { readonly emails: readonly EmailLine[]; readonly nextIndex: string | null }
export interface EmailContent extends EmailLine {
  readonly cc: readonly EmailParty[];
  /** Zoho's content as given (HTML or text). Never logged, never cached. */
  readonly content: string;
  readonly attachments: readonly { readonly id: string; readonly name: string; readonly size: number | null }[];
}
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const EMAIL_INDEX = /^[A-Za-z0-9_-]{1,200}$/;
const FILE_ID = /^[A-Za-z0-9._~+\/=-]{8,1024}$/;
const MAX_EMAIL_ROWS = 200;
const MAX_EMAIL_CONTENT = 2 * 1024 * 1024;

/** A file name safe inside a multipart header: printable ASCII, no quotes or path, the type's own extension. */
export function uploadFileName(name: string, type: UploadMime): string {
  const ext = type === "application/pdf" ? ".pdf" : type === "image/png" ? ".png" : type === "text/csv" ? ".csv" : ".jpg";
  const base = String(name ?? "").replace(/^.*[\\/]/, "").replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9 ._()-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
  return base + ext;
}

/** One multipart/form-data body with a single "file" part, built in memory (never written to disk). */
function multipartOf(file: UploadFile, random: () => number): { bytes: Uint8Array; contentType: string } {
  if (!file || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength < 1 || file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new RangeError(`An upload is 1 byte to ${MAX_UPLOAD_BYTES} bytes.`);
  }
  if (!UPLOAD_MIMES.includes(file.contentType)) throw new TypeError("An upload is a PDF, JPEG, PNG or CSV.");
  let boundary = "----gz";
  for (let i = 0; i < 24; i++) boundary += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36) % 36];
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadFileName(file.fileName, file.contentType)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const bytes = new Uint8Array(head.byteLength + file.bytes.byteLength + tail.byteLength);
  bytes.set(head, 0); bytes.set(file.bytes, head.byteLength); bytes.set(tail, head.byteLength + file.bytes.byteLength);
  return { bytes, contentType: `multipart/form-data; boundary=${boundary}` };
}

const partyOf = (raw: unknown): EmailParty | null => {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || typeof o.email !== "string" || !MAIL_ADDRESS.test(o.email)) return null;
  return Object.freeze({ email: o.email, name: typeof o.user_name === "string" ? o.user_name.slice(0, 200) : null });
};
const partiesOf = (raw: unknown): readonly EmailParty[] =>
  Object.freeze((Array.isArray(raw) ? raw : []).slice(0, 100).map(partyOf).filter((x): x is EmailParty => x !== null));
function emailLineOf(raw: unknown): EmailLine | null {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || typeof o.message_id !== "string" || !MESSAGE_ID.test(o.message_id)) return null;
  const owner = o.owner && typeof o.owner === "object" ? (o.owner as Record<string, unknown>).id : null;
  return Object.freeze({
    messageId: o.message_id,
    subject: typeof o.subject === "string" ? o.subject.slice(0, 500) : "",
    from: partyOf(o.from),
    to: partiesOf(o.to),
    sentTime: typeof o.sent_time === "string" ? o.sent_time.slice(0, 40) : null,
    sent: o.sent === true,
    hasAttachment: o.has_attachment === true,
    ownerId: typeof owner === "string" && /^\d{1,25}$/.test(owner) ? owner : null,
  });
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
  init: { method: HttpMethod; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal },
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
  /** M18-S01-T02: share one Zoho call among identical in-flight reads by the same person (default true). */
  readonly coalesceReads?: boolean;
  /** M18-S09-NOTE-3: one attempt (send + read the body) is abandoned after this (default ZOHO_ATTEMPT_TIMEOUT_MS, 10 s).
   *  An abandoned attempt is a "network" failure: an idempotent read retries within the request deadline; a write does not. */
  readonly attemptTimeoutMs?: number;
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
  /**
   * Receives the decoded CurrentUser body once the token has identified itself, so the OAuth
   * callback resolves the seat from this one request (M01-S02, seat.ts) instead of asking twice.
   * Never called on failure; the body is never logged.
   */
  readonly onCurrentUser?: (body: unknown) => void;
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
  let currentUser: unknown = null;
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
    currentUser = body;
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
  const credential = mint({ kind: "user", userId }, grant, issuedAt) as UserCredential;
  options.onCurrentUser?.(currentUser);
  return credential;
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

/**
 * D121: a GET share list as ids and permissions. v8 answers `shared_with: { id, type, name, zuid }`; the older shape
 * `user: { id, name }` is read too. Names and zuids are dropped here, so nothing past this line can log them. An entry
 * whose `shared_through` points at another record is a related-records share of that record (`inherited`).
 */
export function parseShares(raw: readonly unknown[], recordId: string): readonly RecordShare[] {
  const out: RecordShare[] = [];
  for (const e of raw.slice(0, 100).map(obj)) {
    if (!e) continue;
    const w = obj(e.shared_with) ?? obj(e.user);
    const targetId = w && typeof w.id === "string" && RECORD.test(w.id) ? w.id : null;
    const kind = w && (w.type === "roles" || w.type === "groups") ? w.type : "users";
    const permission = e.permission === "read_write" || e.permission === "full_access" ? e.permission
      : e.permission === "read_only" || e.permission === "read" ? "read_only" : null;
    if (!targetId || !permission) continue;
    const through = obj(e.shared_through);
    const inherited = !!through && typeof through.id === "string" && through.id !== recordId;
    const by = obj(e.shared_by);
    const sharedBy = by && typeof by.id === "string" && RECORD.test(by.id) ? by.id : null;
    out.push(Object.freeze({ kind, targetId, permission, inherited, sharedBy }));
  }
  return Object.freeze(out);
}

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
  /** M12-S02: a non-JSON body sent as-is (multipart upload). Never logged; the log line carries ids only. */
  readonly raw?: { readonly bytes: Uint8Array; readonly contentType: string };
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
  const attemptMs = (): number => options.attemptTimeoutMs ?? zohoAttemptTimeoutMs();
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

  const executeOnce = async (as: Credential, spec0: Spec): Promise<Outcome> => {
    assertConfiguredActor(as);
    /* M18-S09-NOTE-3: the caller's signal and the request deadline (a call made without a signal is still bound by it) */
    const deadline = currentDeadline();
    const spec: Spec = { ...spec0, signal: anySignal(spec0.signal, deadline?.signal) };
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
    const body: string | Uint8Array | undefined = spec.raw ? spec.raw.bytes : spec.body === undefined ? undefined : JSON.stringify(spec.body);
    if (spec.raw) headers["Content-Type"] = spec.raw.contentType;
    else if (body !== undefined) headers["Content-Type"] = "application/json";
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
      const attemptTimer = AbortSignal.timeout(attemptMs());
      const attemptSignal = anySignal(spec.signal, attemptTimer)!;
      /* the attempt's own timer, not the caller or the deadline: the attempt failed like a dropped connection */
      const timedOut = () => attemptTimer.aborted && !spec.signal?.aborted;
      try {
        const response = await fetchImpl(url, { method: spec.method, headers, body, signal: attemptSignal });
        status = response.status;
        credits = parseCreditsRemaining(response.headers.get(CREDITS_HEADER));
        let parsed: unknown = null;
        let malformedRead = false;
        if (status !== 204 && status !== 304) {
          const read = await readBoundedResponse(response, MAX_ZOHO_RESPONSE_BYTES, attemptSignal);
          if (!read.ok) {
            outcome = read.reason === "aborted"
              ? timedOut() ? { kind: "network", status: null } : { kind: "aborted", status: null }
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
        outcome = timedOut() ? { kind: "network", status: null } : classifyThrown(error, spec.signal);
      } finally {
        lease.release(); // held until the body is read: Zoho counts the call active until then
      }
      if (credits !== null) lastCredits = credits;
      const completed = outcome;
      line(startedAt, status, clock() - startedAt, startedAt - queuedAt, attempt, credits, completed);
      if (!isFailure(completed)) return { ok: true, result: completed, creditsRemaining: lastCredits };
      const policy = retryPolicy(completed, { idempotent: spec.idempotent });
      if (!policy.retry || attempt >= Math.min(policy.maxAttempts, maxAttempts)) return { ok: false, error: completed, creditsRemaining: lastCredits };
      const wait = backoffDelay(attempt, policy, retryAfterOf(completed), random);
      /* never retry past the request deadline: a wait that ends after it (or leaves no time to try) answers now */
      if (deadline && Date.now() + wait >= deadline.at) return { ok: false, error: completed, creditsRemaining: lastCredits };
      try {
        await sleep(wait, spec.signal);
      } catch {
        return { ok: false, error: { kind: "aborted", status: null }, creditsRemaining: lastCredits };
      }
    }
  };

  // M18-S01-T02: identical reads by the same person while one is in flight share it (./coalesce).
  const coalesce = options.coalesceReads !== false;
  const flights = createFlights<Outcome>();
  const readShape = (spec: Spec) => !spec.raw && (spec.shape.op === "read" || spec.shape.op === "list" || spec.shape.op === "coql");
  const flightKey = (as: Credential, spec: Spec): string => JSON.stringify([
    as.kind === "user" ? `u:${as.userId}` : `s:${as.job}`, as.apiDomain, spec.op, spec.method, spec.path, spec.query ?? null, spec.body ?? null,
    spec.headers ?? null, spec.responseShape ?? null, spec.maxRows ?? null, spec.perRecord, spec.recordIds, spec.logReturnedIds,
  ]);
  const execute = async (as: Credential, spec: Spec): Promise<Outcome> => {
    assertConfiguredActor(as);
    if (!coalesce || !readShape(spec)) return executeOnce(as, spec);
    return flights.run(flightKey(as, spec), () => executeOnce(as, spec), {
      signal: anySignal(spec.signal, currentDeadline()?.signal),
      wasAborted: (o) => !o.ok && o.error.kind === "aborted",
      retryAlone: () => executeOnce(as, spec),
      onJoinAborted: () => ({ ok: false, error: { kind: "aborted", status: null }, creditsRemaining: null }),
    });
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

  const api: ZohoApi<C> = {
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

    async updateOwnUser(as, fields, opts = {}) {
      const userId = (as as { userId?: unknown }).userId;
      if (typeof userId !== "string" || !RECORD.test(userId)) throw new TypeError("updateOwnUser() needs a user credential.");
      const allowed = ["first_name", "last_name", "mobile"];
      if (!fields || typeof fields !== "object" || Object.keys(fields).some((k) => !allowed.includes(k)) || typeof fields.last_name !== "string") {
        throw new TypeError("updateOwnUser() changes first_name, last_name and mobile only.");
      }
      const out = await execute(as, {
        op: "updateOwnUser", method: "PUT", path: `/users/${userId}`, endpoint: "/users/{id}",
        body: { users: [{ ...fields }] }, shape: { op: "write", records: 1 }, idempotent: false, perRecord: false,
        recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? obj((obj(out.result.body)?.users as unknown[] | undefined)?.[0]) : null;
      if (!first || first.status !== "success") {
        return { ok: false, error: { kind: "invalid-data", status: out.result.status, code: typeof first?.code === "string" ? first.code : "INVALID_DATA", field: null, records: null }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly updated: true }>;
      }
      return done({ updated: true } as const, out);
    },

    async updateUserSeat(as, userId, seat, opts = {}) {
      if ((as as { kind?: unknown }).kind !== "user") throw new TypeError("A seat change is written on the changer's own user token (D53).");
      if (typeof userId !== "string" || !RECORD.test(userId) || userId === (as as { userId?: unknown }).userId) throw new TypeError("updateUserSeat() takes another user's id.");
      const ok = (v: unknown, n: number) => typeof v === "string" && v.length > 0 && v.length <= n && !/[\r\n\0]/.test(v);
      if (!seat || !RECORD.test(seat.roleId) || !RECORD.test(seat.profileId) || !ok(seat.roleName, 200) || !ok(seat.profileName, 50)) {
        throw new TypeError("updateUserSeat() writes a pinned role and profile id with their names.");
      }
      const out = await execute(as, {
        op: "updateUserSeat", method: "PUT", path: `/users/${userId}`, endpoint: "/users/{id}",
        body: { users: [{ id: userId, role: { id: seat.roleId, name: seat.roleName }, profile: { id: seat.profileId, name: seat.profileName } }] },
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: false,
        recordIds: [userId], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? obj((obj(out.result.body)?.users as unknown[] | undefined)?.[0]) : null;
      if (!first || first.status !== "success") {
        return { ok: false, error: { kind: "invalid-data", status: out.result.status, code: typeof first?.code === "string" ? first.code : "INVALID_DATA", field: null, records: null }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly updated: true }>;
      }
      return done({ updated: true } as const, out);
    },

    async aggregate(as, selectQuery, opts = {}) {
      if (typeof selectQuery !== "string" || !/^\s*select\s/i.test(selectQuery) || !/\b(count|sum|min|max|avg)\s*\(/i.test(selectQuery) || selectQuery.length > 20_000) {
        throw new TypeError("aggregate() takes one SELECT with COUNT/SUM/MIN/MAX/AVG.");
      }
      const out = await execute(as, {
        op: "coql-aggregate", method: "POST", path: "/coql", endpoint: "/coql", body: { select_query: selectQuery },
        shape: { op: "coql" }, idempotent: true, perRecord: false, maxRows: 2_000,
        recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done([], out);
      const data = obj(out.result.body)?.data;
      if (!Array.isArray(data)) return done([], out);
      const rows: AggregateRow[] = [];
      for (const raw of data) {
        const r = obj(raw);
        if (!r) continue;
        const row: Record<string, string | number | null> = {};
        for (const [k, v] of Object.entries(r)) {
          if (typeof v === "number" && Number.isFinite(v)) row[k] = v;
          else if (typeof v === "string") row[k] = /^\d+(\.\d+)?$/.test(v) && /\(/.test(k) ? Number(v) : v.slice(0, 120);
          else if (v === null) row[k] = null;
          else { const id = obj(v)?.id; row[k] = typeof id === "string" && RECORD.test(id) ? id : null; }
        }
        rows.push(Object.freeze(row));
      }
      return done(Object.freeze(rows), out);
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

    async blueprint(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const out = await execute(as, {
        op: "blueprint", method: "GET", path: `/${module}/${id}/actions/blueprint`, endpoint: `/${module}/{id}/actions/blueprint`,
        shape: { op: "read" }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done(null as BlueprintState | null, out);
      const bp = obj(obj(out.result.body)?.blueprint);
      const rawT = bp?.transitions;
      if (!bp || !Array.isArray(rawT)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<BlueprintState | null>;
      const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length <= max ? v : null);
      const pi = obj(bp.process_info);
      const transitions: BlueprintTransitionInfo[] = [];
      for (const t of rawT.slice(0, 50).map(obj)) {
        if (!t || typeof t.id !== "string" || !RECORD.test(t.id) || typeof t.name !== "string" || t.name.length > 200) continue;
        const fields = (Array.isArray(t.fields) ? t.fields : []).slice(0, 100).map(obj)
          .map((f) => (f && typeof f.api_name === "string" && f.api_name.length <= 100 ? f.api_name : null)).filter((f): f is string => f !== null);
        transitions.push(Object.freeze({
          id: t.id, name: t.name, nextFieldValue: text(t.next_field_value), criteriaMatched: t.criteria_matched !== false,
          criteriaMessage: text(t.criteria_message, 1_000), fields: Object.freeze(fields),
        }));
      }
      return done(Object.freeze({
        processName: text(pi?.name), fieldApiName: text(pi?.api_name ?? pi?.field_name, 100), fieldValue: text(pi?.field_value),
        transitions: Object.freeze(transitions),
      }) as BlueprintState | null, out);
    },

    async share(as, module, id, userId, permission, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(userId, "user id");
      if (permission !== "read_only" && permission !== "read_write") throw new TypeError('permission is "read_only" or "read_write".');
      const out = await execute(as, {
        // v8 share-record: POST adds to the record's share list; re-sharing the same user replaces the permission in place.
        op: "share", method: "POST", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
        body: { share: [{ shared_with: { id: userId, type: "users" }, permission, share_related_records: false, type: "private" }], notify_shared_members: false },
        shape: { op: "write", records: 1 }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const items = out.result.kind === "ok" ? obj(out.result.body)?.share : undefined;
      const first = Array.isArray(items) ? obj(items[0]) : obj(items);
      if (first && typeof first.status === "string" && first.status !== "success") {
        return { ok: false, error: { kind: "unexpected", status: out.result.status, code: typeof first.code === "string" ? first.code.slice(0, 40) : "SHARE_REFUSED" }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly shared: true }>;
      }
      return done({ shared: true } as const, out);
    },

    // v8 revoke-shared-record DELETE has no body and revokes EVERY share on the record (verified 5 Oct 2026), so a
    // per-user revoke is read-modify-write: GET the list, PUT it back without the user (DELETE only when nobody is left).
    async unshare(as, module, id, userId, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(userId, "user id");
      const cur = await api.shares(as, module, id, opts);
      if (!cur.ok) return cur;
      const isUser = (s: ShareEntry) => s.kind === "users" && s.targetId === userId;
      if (!cur.value.some(isUser)) return { ok: true, value: { revoked: true } as const, status: cur.status, creditsRemaining: cur.creditsRemaining };
      const rank = (p: SharePermission) => (p === "full_access" ? 3 : p === "read_write" ? 2 : 1);
      const rest = new Map<string, ShareEntry>();
      for (const s of cur.value) {
        if (isUser(s)) continue;
        const k = `${s.kind}:${s.targetId}`;
        const prev = rest.get(k);
        if (!prev || rank(s.permission) > rank(prev.permission)) rest.set(k, { kind: s.kind, targetId: s.targetId, permission: s.permission });
      }
      if (rest.size > MAX_RECORD_SHARES) return { ok: false, error: { kind: "unexpected", status: 0, code: "SHARE_LIMIT" }, creditsRemaining: cur.creditsRemaining };
      const w = await api.setShares(as, module, id, [...rest.values()], opts);
      return w.ok ? { ok: true, value: { revoked: true } as const, status: w.status, creditsRemaining: w.creditsRemaining } : w;
    },

    async shares(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const out = await execute(as, {
        op: "shares", method: "GET", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
        shape: { op: "read" }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done(Object.freeze([]) as readonly RecordShare[], out);
      const raw = obj(out.result.body)?.share;
      if (!Array.isArray(raw)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<readonly RecordShare[]>;
      return done(parseShares(raw, id), out);
    },

    async setShares(as, module, id, list, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      if (!Array.isArray(list) || list.length > MAX_RECORD_SHARES) throw new RangeError(`setShares() takes at most ${MAX_RECORD_SHARES} entries.`);
      for (const s of list) {
        checkScopedId(s.targetId, "share target id");
        if (s.kind !== "users" && s.kind !== "roles" && s.kind !== "groups") throw new TypeError('share kind is "users", "roles" or "groups".');
        if (s.permission !== "read_only" && s.permission !== "read_write" && s.permission !== "full_access") throw new TypeError("share permission is read_only, read_write or full_access.");
      }
      // Nothing left to share: DELETE revokes every share on the record (v8 revoke-shared-record: no body, all users).
      const out = list.length === 0
        ? await execute(as, {
          op: "unshareAll", method: "DELETE", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
          shape: { op: "write", records: 1 }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
        })
        : await execute(as, {
          // PUT replaces the record's whole share list: "access is revoked for the users not mentioned" (v8 update-share-permissions).
          op: "setShares", method: "PUT", path: `/${module}/${id}/actions/share`, endpoint: `/${module}/{id}/actions/share`,
          body: {
            share: list.map((s) => ({ shared_with: { id: s.targetId, type: s.kind }, permission: s.permission, share_related_records: false, type: "private" })),
            notify_shared_members: false,
          },
          shape: { op: "write", records: 1 }, idempotent: true, perRecord: false, recordIds: [id], logReturnedIds: false, signal: opts.signal,
        });
      if (!out.ok) return out;
      const items = out.result.kind === "ok" ? obj(out.result.body)?.share : undefined;
      const first = Array.isArray(items) ? obj(items[0]) : obj(items);
      if (first && typeof first.status === "string" && first.status !== "success") {
        return { ok: false, error: { kind: "unexpected", status: out.result.status, code: typeof first.code === "string" ? first.code.slice(0, 40) : "SHARE_REFUSED" }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly set: true }>;
      }
      return done({ set: true } as const, out);
    },

    async timeline(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const perPage = opts.perPage ?? 100;
      if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) throw new RangeError("timeline perPage is 1–100.");
      const out = await execute(as, {
        op: "timeline", method: "GET", path: `/${module}/${id}/__timeline`, endpoint: `/${module}/{id}/__timeline`,
        query: [["per_page", String(perPage)]], shape: { op: "read" }, idempotent: true, perRecord: false,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done({ entries: [], moreRecords: false }, out);
      const root = obj(out.result.body);
      const raw = root?.__timeline;
      if (!Array.isArray(raw)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<TimelinePage>;
      const entries: TimelineEntry[] = [];
      for (const e of raw) {
        const r = obj(e);
        const at = r && typeof r.audited_time === "string" ? r.audited_time : null;
        const action = r && typeof r.action === "string" ? r.action.slice(0, 40) : null;
        if (!at || !action) continue;
        const by = obj(r!.done_by);
        const byId = by && typeof by.id === "string" && RECORD.test(by.id) ? by.id : null;
        const fields = Array.isArray(r!.field_history)
          ? (r!.field_history as unknown[]).map((f) => obj(f)?.api_name).filter((n): n is string => typeof n === "string" && FIELD.test(n))
          : [];
        entries.push(Object.freeze({ at, action, byId, fields: Object.freeze(fields) }));
      }
      return done({ entries: Object.freeze(entries), moreRecords: obj(root?.info)?.more_records === true }, out);
    },

    // ponytail: body and response per the v8 send_mail docs; unproven until TC-E07-024 runs on the sandbox.
    // Attachments: "attachments": [{"id": "<encrypted file id from the Files API>"}], total <= 10 MB, per
    // https://www.zoho.com/crm/developer/docs/api/v8/send-mail.html (read 4 Oct 2026).
    // PROVISIONAL: the file-id attach path is as documented but unproven on the sandbox (TC-E07-024).
    async sendMail(as, module, id, mail, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const addr = (a: MailAddress | undefined): { email: string; user_name?: string } => {
        if (!a || typeof a.email !== "string" || !MAIL_ADDRESS.test(a.email)) throw new TypeError("sendMail() needs valid email addresses.");
        if (a.userName !== undefined && (typeof a.userName !== "string" || a.userName.length > 200)) throw new TypeError("sendMail() user names are text up to 200.");
        return a.userName ? { user_name: a.userName, email: a.email } : { email: a.email };
      };
      if (!mail || !Array.isArray(mail.to) || mail.to.length < 1 || mail.to.length > SEND_MAIL_MAX_TO) throw new TypeError(`sendMail() sends to 1–${SEND_MAIL_MAX_TO} addresses.`);
      if (typeof mail.subject !== "string" || !mail.subject.trim() || mail.subject.length > SEND_MAIL_MAX_SUBJECT) throw new TypeError("sendMail() needs a subject.");
      if (typeof mail.content !== "string" || !mail.content.trim() || mail.content.length > SEND_MAIL_MAX_CONTENT) throw new TypeError("sendMail() needs content.");
      if (mail.format !== "text" && mail.format !== "html") throw new TypeError('sendMail() format is "text" or "html".');
      const ids = mail.attachmentFileIds;
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > SEND_MAIL_MAX_ATTACHMENTS || !ids.every((f) => typeof f === "string" && MAIL_FILE_ID.test(f)))) {
        throw new TypeError(`sendMail() attaches up to ${SEND_MAIL_MAX_ATTACHMENTS} files by file id.`);
      }
      const out = await execute(as, {
        op: "sendMail", method: "POST", path: `/${module}/${id}/actions/send_mail`, endpoint: `/${module}/{id}/actions/send_mail`,
        body: { data: [{ from: addr(mail.from), to: mail.to.map(addr), subject: mail.subject, content: mail.content, mail_format: mail.format, consent_email: false,
          ...(ids && ids.length ? { attachments: ids.map((id) => ({ id })) } : {}) }] },
        shape: { op: "send-mail" }, idempotent: false, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? obj((obj(out.result.body)?.data as unknown[] | undefined)?.[0]) : null;
      if (!first || (first.status !== "success" && first.code !== "SUCCESS")) {
        return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly sent: true; readonly messageId: string | null }>;
      }
      const mid = obj(first.details)?.message_id;
      return done({ sent: true as const, messageId: typeof mid === "string" && mid.length <= 200 ? mid : null }, out);
    },

    async fromAddresses(as, opts = {}) {
      const out = await execute(as, {
        op: "fromAddresses", method: "GET", path: "/settings/emails/actions/from_addresses", endpoint: "/settings/emails/actions/from_addresses",
        shape: { op: "read" }, idempotent: true, perRecord: false, recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done([] as readonly FromAddress[], out);
      const raw = obj(out.result.body)?.from_addresses;
      if (!Array.isArray(raw)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<readonly FromAddress[]>;
      const list: FromAddress[] = [];
      for (const r of raw.slice(0, 100).map(obj)) {
        if (!r || typeof r.email !== "string" || !MAIL_ADDRESS.test(r.email)) continue;
        list.push(Object.freeze({ email: r.email, type: typeof r.type === "string" ? r.type.slice(0, 40) : "",
          userName: typeof r.user_name === "string" ? r.user_name.slice(0, 200) : null, isDefault: r.default === true }));
      }
      return done(Object.freeze(list) as readonly FromAddress[], out);
    },

    async changeOwner(as, module, id, ownerId, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(ownerId, "owner id");
      const out = await execute(as, {
        op: "changeOwner", method: "PUT", path: `/${module}/${id}/actions/change_owner`, endpoint: `/${module}/{id}/actions/change_owner`,
        body: { owner: { id: ownerId }, notify: opts.notify !== false },
        shape: { op: "write", records: 1 }, idempotent: true, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ changed: true } as const, out) : out;
    },

    async updateUserManager(as, userId, managerId, opts = {}) {
      if ((as as { kind?: unknown }).kind !== "user") throw new TypeError("A manager change is written on the changer's own user token (D53).");
      if (typeof userId !== "string" || !RECORD.test(userId) || userId === (as as { userId?: unknown }).userId) throw new TypeError("updateUserManager() takes another user's id.");
      if (managerId !== null && (typeof managerId !== "string" || !RECORD.test(managerId) || managerId === userId)) throw new TypeError("updateUserManager() takes a manager id other than the user's own, or null.");
      const out = await execute(as, {
        op: "updateUserManager", method: "PUT", path: `/users/${userId}`, endpoint: "/users/{id}",
        body: { users: [{ id: userId, Reporting_To: managerId === null ? null : { id: managerId } }] },
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: false,
        recordIds: managerId ? [userId, managerId] : [userId], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? obj((obj(out.result.body)?.users as unknown[] | undefined)?.[0]) : null;
      if (!first || first.status !== "success") {
        return { ok: false, error: { kind: "invalid-data", status: out.result.status, code: typeof first?.code === "string" ? first.code : "INVALID_DATA", field: null, records: null }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly updated: true }>;
      }
      return done({ updated: true } as const, out);
    },

    async listUsers(as, opts = {}) {
      const type = opts.type ?? "AllUsers";
      if (!["AllUsers", "ActiveUsers", "DeactiveUsers"].includes(type)) throw new TypeError("listUsers() type is AllUsers, ActiveUsers or DeactiveUsers.");
      const page = opts.page ?? 1;
      const perPage = opts.perPage ?? 200;
      if (!Number.isInteger(page) || page < 1 || page > 50) throw new RangeError("listUsers() page is 1–50.");
      if (!Number.isInteger(perPage) || perPage < 1 || perPage > 200) throw new RangeError("listUsers() perPage is 1–200.");
      const out = await execute(as, {
        op: "listUsers", method: "GET", path: "/users", endpoint: "/users",
        query: [["type", type], ["page", String(page)], ["per_page", String(perPage)]], shape: { op: "read" }, idempotent: true, perRecord: false,
        recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done({ users: [], moreRecords: false } as UsersPage, out);
      const root = obj(out.result.body);
      const raw = root?.users;
      if (!Array.isArray(raw) || raw.length > perPage) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<UsersPage>;
      const users = raw.map(obj).filter((u): u is Obj => u !== null && typeof u.id === "string" && RECORD.test(u.id)).map((u) => Object.freeze({ ...u }));
      return done(Object.freeze({ users: Object.freeze(users), moreRecords: obj(root?.info)?.more_records === true }) as UsersPage, out);
    },

    async settingsRoles(as, opts = {}) {
      const out = await execute(as, {
        op: "settingsRoles", method: "GET", path: "/settings/roles", endpoint: "/settings/roles",
        shape: { op: "read" }, idempotent: true, perRecord: false, recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done([] as readonly ZohoRoleRow[], out);
      const raw = obj(out.result.body)?.roles;
      if (!Array.isArray(raw)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<readonly ZohoRoleRow[]>;
      const list: ZohoRoleRow[] = [];
      for (const r of raw.slice(0, 500).map(obj)) {
        if (!r || typeof r.id !== "string" || !RECORD.test(r.id) || typeof r.name !== "string" || r.name.length > 200) continue;
        const up = obj(r.reporting_to)?.id;
        list.push(Object.freeze({ id: r.id, name: r.name, reportingTo: typeof up === "string" && RECORD.test(up) ? up : null }));
      }
      return done(Object.freeze(list) as readonly ZohoRoleRow[], out);
    },

    async settingsProfiles(as, opts = {}) {
      const out = await execute(as, {
        op: "settingsProfiles", method: "GET", path: "/settings/profiles", endpoint: "/settings/profiles",
        shape: { op: "read" }, idempotent: true, perRecord: false, recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done([] as readonly ZohoProfileRow[], out);
      const raw = obj(out.result.body)?.profiles;
      if (!Array.isArray(raw)) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<readonly ZohoProfileRow[]>;
      const list: ZohoProfileRow[] = [];
      for (const r of raw.slice(0, 500).map(obj)) {
        if (!r || typeof r.id !== "string" || !RECORD.test(r.id) || typeof r.name !== "string" || r.name.length > 200) continue;
        list.push(Object.freeze({ id: r.id, name: r.name }));
      }
      return done(Object.freeze(list) as readonly ZohoProfileRow[], out);
    },

    async uploadAttachment(as, module, id, file, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const raw = multipartOf(file, options.random ?? Math.random);
      const out = await execute(as, {
        op: "uploadAttachment", method: "POST", path: `/${module}/${id}/Attachments`, endpoint: `/${module}/{id}/Attachments`,
        raw, shape: { op: "write", records: 1 }, idempotent: false, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? out.result.records?.[0] : undefined;
      if (!first || !first.ok || !first.id || !RECORD.test(first.id)) {
        return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly attachmentId: string }>;
      }
      return done({ attachmentId: first.id }, out);
    },

    async deleteAttachment(as, module, id, attachmentId, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      checkScopedId(attachmentId, "attachment id");
      const out = await execute(as, {
        op: "deleteAttachment", method: "DELETE", path: `/${module}/${id}/Attachments/${attachmentId}`, endpoint: `/${module}/{id}/Attachments/{id}`,
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id, attachmentId], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ deleted: true } as const, out) : out;
    },

    async uploadFile(as, file, opts = {}) {
      const raw = multipartOf(file, options.random ?? Math.random);
      const out = await execute(as, {
        op: "uploadFile", method: "POST", path: "/files", endpoint: "/files",
        raw, shape: { op: "write", records: 1 }, idempotent: false, perRecord: false, responseShape: "data", maxRows: 1,
        recordIds: [], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      const first = out.result.kind === "ok" ? obj((obj(out.result.body)?.data as unknown[] | undefined)?.[0]) : null;
      const fid = obj(first?.details)?.id;
      if (!first || (first.status !== "success" && first.code !== "SUCCESS") || typeof fid !== "string" || !FILE_ID.test(fid)) {
        return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<{ readonly fileId: string }>;
      }
      return done({ fileId: fid }, out);
    },

    async listEmails(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      if (opts.index !== undefined && (typeof opts.index !== "string" || !EMAIL_INDEX.test(opts.index))) throw new TypeError("listEmails() index is Zoho's next_index.");
      const out = await execute(as, {
        op: "listEmails", method: "GET", path: `/${module}/${id}/Emails`, endpoint: `/${module}/{id}/Emails`,
        query: opts.index ? [["index", opts.index]] : undefined, shape: { op: "read" }, idempotent: true, perRecord: false,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done({ emails: [], nextIndex: null } as EmailPage, out);
      const root = obj(out.result.body);
      const list = root?.email_related_list;
      if (!Array.isArray(list) || list.length > MAX_EMAIL_ROWS) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<EmailPage>;
      const next = obj(root?.info)?.next_index;
      return done(Object.freeze({
        emails: Object.freeze(list.map(emailLineOf).filter((x): x is EmailLine => x !== null)),
        nextIndex: typeof next === "string" && EMAIL_INDEX.test(next) ? next : null,
      }) as EmailPage, out);
    },

    async getEmail(as, module, id, messageId, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      if (typeof messageId !== "string" || !MESSAGE_ID.test(messageId)) throw new TypeError("getEmail() needs Zoho's message_id.");
      if (opts.ownerId !== undefined) checkScopedId(opts.ownerId, "user id");
      const out = await execute(as, {
        op: "getEmail", method: "GET", path: `/${module}/${id}/Emails/${messageId}`, endpoint: `/${module}/{id}/Emails/{message_id}`,
        query: opts.ownerId ? [["user_id", opts.ownerId]] : undefined, shape: { op: "read" }, idempotent: true, perRecord: false,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      if (!out.ok) return out;
      if (out.result.kind === "empty") return done(null, out);
      const list = obj(out.result.body)?.Emails;
      if (!Array.isArray(list) || list.length > 1) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<EmailContent | null>;
      const e = obj(list[0]);
      if (!e) return done(null, out);
      const line = emailLineOf({ ...e, message_id: typeof e.message_id === "string" ? e.message_id : messageId });
      if (!line || line.messageId !== messageId) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<EmailContent | null>;
      const content = typeof e.content === "string" ? e.content : "";
      if (content.length > MAX_EMAIL_CONTENT) return { ok: false, error: { kind: "unexpected", status: out.result.status, code: "MALFORMED_RESPONSE" }, creditsRemaining: out.creditsRemaining } as ZohoResult<EmailContent | null>;
      const attachments = (Array.isArray(e.attachments) ? e.attachments : []).slice(0, 50).map(obj)
        .filter((a): a is Obj => a !== null && typeof a.id === "string" && a.id.length <= 200 && typeof a.name === "string")
        .map((a) => Object.freeze({ id: a.id as string, name: (a.name as string).slice(0, 255), size: typeof a.size === "number" ? a.size : typeof a.size === "string" && /^\d{1,12}$/.test(a.size) ? Number(a.size) : null }));
      return done(Object.freeze({ ...line, cc: partiesOf(e.cc), content, attachments: Object.freeze(attachments) }) as EmailContent, out);
    },

    async deleteRecord(as, module, id, opts = {}) {
      checkModule(module);
      checkScopedId(id);
      const out = await execute(as, {
        op: "delete", method: "DELETE", path: `/${module}/${id}`, endpoint: `/${module}/{id}`,
        shape: { op: "write", records: 1 }, idempotent: false, perRecord: true, responseShape: "data", maxRows: 1,
        recordIds: [id], logReturnedIds: false, signal: opts.signal,
      });
      return out.ok ? done({ deleted: true } as const, out) : out;
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
  return api;
}

/** The client every screen's server code uses: user credentials only. */
export function createZohoClient(options: ZohoClientOptions): ZohoClient {
  return buildApi<UserCredential>("user", options);
}

/** The client background jobs use: service credentials only. Never handed to a request path. */
export function createZohoServiceClient(options: ZohoClientOptions): ZohoServiceClient {
  return buildApi<ServiceCredential>("service", options);
}

/* ---- M11-S04 / M11-S07: a Zoho guard's refusal, named (additive) -------------------------------------------------
 * Two business rules live IN Zoho as Deluge validation-rule functions (zoho/deluge/*.dg, attached by Sahil), so they
 * hold whichever door writes — this console, the Zoho UI, an import, another integration:
 *   oversell     LLP_UnitAllocation_Module: an allotment insert/update whose units exceed the LLP's free units;
 *   units-held   LLP_Creation_Module: Units_Released lowered below the units investors hold (take-back).
 * A validation rule's refusal reaches the API as a record-level error blaming the field the rule is attached to
 * (classified `invalid-data` with `field`). This names it; the caller re-counts to put numbers in the in-page
 * message. Codes that are plainly not a rule (a missing mandatory field, a duplicate) are never read as one. The
 * exact code Zoho sends for a function rule is confirmed on the sandbox (M11-S07-T02) — tighten here if it differs.
 * Nothing of Zoho's message is kept or logged: the name, the code and the field only. */
export type GuardRefusalName = "oversell" | "units-held";
export interface GuardRule { readonly name: GuardRefusalName; readonly module: string; readonly fields: readonly string[] }
export const ZOHO_GUARD_RULES: readonly GuardRule[] = Object.freeze([
  Object.freeze({ name: "oversell" as const, module: "LLP_UnitAllocation_Module", fields: Object.freeze(["Reserved_Units", "Issued_Units", "Allocation_Status", "LLP"]) }),
  Object.freeze({ name: "units-held" as const, module: "LLP_Creation_Module", fields: Object.freeze(["Units_Released"]) }),
]);
const NOT_A_RULE: ReadonlySet<string> = new Set(["MANDATORY_NOT_FOUND", "DUPLICATE_DATA", "INVALID_MODULE", "INVALID_URL_PATTERN", "AMBIGUITY_DURING_PROCESSING", "LIMIT_EXCEEDED"]);

export interface GuardRefusal { readonly name: GuardRefusalName; readonly code: string; readonly field: string }

/** The named guard behind a failed write on `module`, or null when the failure is anything else. */
export function guardRefusalOf(module: string, failure: ZohoFailure): GuardRefusal | null {
  const rule = ZOHO_GUARD_RULES.find((r) => r.module === module);
  if (!rule) return null;
  const blamed: { code: string; field: string | null }[] = [];
  if (failure.kind === "invalid-data") {
    blamed.push({ code: failure.code, field: failure.field });
    for (const r of failure.records ?? []) if (!r.ok) blamed.push({ code: r.code, field: r.field });
  } else if (failure.kind === "partial") {
    for (const r of failure.records) if (!r.ok) blamed.push({ code: r.code, field: r.field });
  } else return null;
  const hit = blamed.find((b) => b.field !== null && rule.fields.includes(b.field) && !NOT_A_RULE.has(b.code));
  return hit ? Object.freeze({ name: rule.name, code: hit.code || "INVALID_DATA", field: hit.field! }) : null;
}
