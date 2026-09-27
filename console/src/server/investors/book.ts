/**
 * M03-S07 — the server boundary for a KAM's book.
 *
 * Contacts and allotments are always read with the signed-in human's own Zoho credential. The
 * query is still checked row by row: a stale record share must not turn into a console leak. No
 * record is cached, no identity field is selected, and response objects are rebuilt from an
 * allow-list instead of spreading Zoho data.
 *
 * The session layer owns `KamBookAccessAuthority`. It must re-resolve the actor from the live
 * session and Zoho seat; role/seat/user ids never come from request JSON. Head-AM snapshots also
 * carry the current KAM user ids so a departed/non-KAM assignee is treated as pool rather than
 * disappearing from the only list that can repair it.
 */

import type {
  UserCredential,
  ZohoClient,
  ZohoFields,
  ZohoPage,
  ZohoRecord,
  ZohoResult,
} from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { RecordOutcome, ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser, ZohoSeat } from "../oauth/seat";

export const CONTACTS_MODULE = "Contacts";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
export const TOUCHES_MODULE = "Touches";
export const BOOK_LIMIT = 200;
export const COQL_IN_LIMIT = 100;

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const ALLOWED_SEATS: ReadonlySet<ZohoSeat> = new Set([
  "key-account-manager",
  "head-of-account-management",
]);

const BOOK_FIELDS = Object.freeze([
  "id",
  "ARL_ID",
  "First_Name",
  "Last_Name",
  "Mobile",
  "Email",
  "Mailing_City",
  "Mailing_Street",
  "Mailing_Flat_House_No_Building_Apartment_Name",
  "Mailing_Zip",
  "Mailing_State",
  "Mailing_Country",
  "Residency",
  "Nominee_Name",
  "Nominee_Relation",
  "KAM",
  "KAM_Since",
  "KAM_Intro_At",
  "Origin_Lead",
  "Said_Yes_At",
  "Modified_Time",
] as const);

const CONTACT_GUARD_FIELDS = Object.freeze([
  "KAM",
  "Origin_Lead",
  "Modified_Time",
] as const);

const ALLOTMENT_FIELDS = Object.freeze([
  "id",
  "Customer",
  "Allocation_Status",
  "Issued_Units",
] as const);

export const DETAIL_FIELDS = Object.freeze([
  "First_Name",
  "Last_Name",
  "Mobile",
  "Email",
  "Mailing_City",
  "Mailing_Street",
  "Mailing_Flat_House_No_Building_Apartment_Name",
  "Mailing_Zip",
  "Mailing_State",
  "Mailing_Country",
  "Nominee_Name",
  "Nominee_Relation",
] as const);
export type DetailField = (typeof DETAIL_FIELDS)[number];

/** Actual CRM API names, not the stale aliases in identity.ts. Unknown fields are refused too. */
export const SENSITIVE_CONTACT_FIELDS: ReadonlySet<string> = new Set([
  "PAN_Number",
  "PAN_Proof",
  "PAN_Proof_Verified_By",
  "PAN_Proof_Verified_At",
  "Aadhaar_Number",
  "Aadhaar_Last4",
  "Aadhaar_Ref",
  "KYC",
  "KYC_Completed_On",
  "FEMA_Applicable",
  "FEMA_Declaration",
  "FEMA_Sign_Req_Id",
  "FEMA_Signed_Via",
  "FEMA_Verified_At",
  "FEMA_Verified_By",
  "Bank_Account_Number",
  "ISFC_Code",
  "Account_Holder_Full_name",
  "Bank_Name",
  "Bank_Branch",
  "Bank_Address",
  "Account_Type",
  "Bank_Proof",
  "Bank_Proof_Verified_By",
  "Bank_Proof_Verified_At",
  "Bank_Verification",
]);

const DETAIL_LIMITS: Readonly<Record<DetailField, number>> = Object.freeze({
  // Lengths are the live Contacts field lengths (GET /settings/fields, 27 Sep 2026).
  First_Name: 40,
  Last_Name: 80,
  Mobile: 30,
  Email: 100,
  Mailing_City: 120,
  Mailing_Street: 250,
  Mailing_Flat_House_No_Building_Apartment_Name: 250,
  Mailing_Zip: 30,
  Mailing_State: 120,
  Mailing_Country: 120,
  Nominee_Name: 120,
  Nominee_Relation: 40,
});
const DETAIL_FIELD_SET: ReadonlySet<string> = new Set(DETAIL_FIELDS);
const NOMINEE_RELATIONS: ReadonlySet<string> = new Set(["Spouse", "Child", "Parent", "Sibling", "Other"]);
const CHANNELS: ReadonlySet<string> = new Set(["WhatsApp", "Email", "Call", "Farm visit", "Meeting"]);
const MOODS: ReadonlySet<string> = new Set(["Warm", "Fine", "A concern"]);

export interface KamBookPrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
}

export interface KamAccessSnapshot {
  readonly actor: SeatedZohoUser;
  /** Required for Head AM. Exact active users whose current authoritative seat is KAM. */
  readonly activeKamUserIds: readonly string[];
}

export interface KamBookAccessAuthority {
  recheck(
    credential: UserCredential,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<KamAccessSnapshot | null>;
}

export interface KamBookDependencies {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "update" | "insert">;
  readonly access: KamBookAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export interface KamIdentityWall {
  readonly pan: "finance-only";
  readonly aadhaar: "finance-only";
  readonly bank: "finance-only";
}

export interface KamBookEntry {
  readonly id: string;
  readonly investorCode: string;
  readonly firstName: string | null;
  readonly lastName: string;
  readonly mobile: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly street: string | null;
  readonly flatOrBuilding: string | null;
  readonly postalCode: string | null;
  readonly state: string | null;
  readonly country: string | null;
  readonly residency: string | null;
  readonly nomineeName: string | null;
  readonly nomineeRelation: string | null;
  readonly kamUserId: string | null;
  readonly kamSince: string | null;
  readonly introductionAt: string | null;
  readonly originLeadId: string | null;
  readonly saidYesAt: string | null;
  readonly modifiedTime: string;
  readonly issuedUnits: number;
  readonly scope: "own" | "team" | "pool";
  readonly mayCare: true;
  readonly mayDetails: true;
  readonly mayAssignManager: boolean;
  readonly identity: KamIdentityWall;
}

export type KamRefusalCode =
  | "invalid-request"
  | "session-changed"
  | "seat-denied"
  | "source-invalid"
  | "scope-drift"
  | "book-too-large"
  | "not-visible"
  | "contact-changed"
  | "details-not-editable"
  | "identity-field-write";

export type KamResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly reasonCode: KamRefusalCode;
      readonly reason: string;
      readonly retryable: false;
    }
  | {
      readonly ok: false;
      readonly kind: "source-error";
      readonly source: "access" | "zoho";
      readonly errorKind: ZohoFailureKind | "unexpected";
      readonly retryable: boolean;
    };

export interface ChangeDetailsCommand {
  readonly contactId: string;
  readonly expectedModifiedTime: string;
  readonly fields: Readonly<Partial<Record<DetailField, string | null>>>;
}

export interface CareTouch {
  readonly channel: "WhatsApp" | "Email" | "Call" | "Farm visit" | "Meeting";
  readonly occurredAt: string;
  readonly isReply: boolean;
  readonly mood: "Warm" | "Fine" | "A concern";
  readonly note: string;
}

export interface RecordCareCommand {
  readonly contactId: string;
  readonly expectedModifiedTime: string;
  readonly touch: CareTouch;
}

export interface KamBookService {
  list(principal: KamBookPrincipal, signal?: AbortSignal): Promise<KamResult<readonly KamBookEntry[]>>;
  changeDetails(
    principal: KamBookPrincipal,
    command: ChangeDetailsCommand,
    signal?: AbortSignal,
  ): Promise<KamResult<{ readonly contactId: string; readonly modifiedTime: string | null }>>;
  recordCare(
    principal: KamBookPrincipal,
    command: RecordCareCommand,
    signal?: AbortSignal,
  ): Promise<KamResult<{ readonly touchId: string }>>;
}

type ObjectRecord = Readonly<Record<string, unknown>>;
type ParsedContact = Omit<KamBookEntry, "issuedUnits" | "scope" | "mayCare" | "mayDetails" | "mayAssignManager" | "identity">;
type ContactGuard = { readonly id: string; readonly kamUserId: string | null; readonly originLeadId: string | null; readonly modifiedTime: string };
type AllotmentScope = Map<string, number>;
type AccessCheck = { readonly principal: KamBookPrincipal; readonly snapshot: KamAccessSnapshot; readonly activeKams: ReadonlySet<string> };
type KamError = Extract<KamResult<never>, { readonly ok: false }>;

const REFUSAL_TEXT: Readonly<Record<KamRefusalCode, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "seat-denied": "this seat does not hold an account-management book",
  "source-invalid": "Zoho returned an invalid account record",
  "scope-drift": "Zoho returned an account outside this person's book",
  "book-too-large": "the account book exceeds the bounded read",
  "not-visible": "the account is unavailable",
  "contact-changed": "the account changed after it was opened",
  "details-not-editable": "one or more details cannot be changed here",
  "identity-field-write": "identity details are Finance only",
});

const objectOf = (value: unknown): ObjectRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as ObjectRecord : null;

const ownData = (value: object, key: string): unknown | undefined => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
};

const optionalText = (record: ObjectRecord, key: string, maximum: number): string | null | undefined => {
  const value = ownData(record, key);
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && value.length <= maximum ? value : undefined;
};

const lookupId = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === "") return null;
  const lookup = objectOf(value);
  const id = lookup === null ? undefined : ownData(lookup, "id");
  return typeof id === "string" && RECORD_ID.test(id) ? id : undefined;
};

const safeInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d{1,15}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const retryableFailure = (kind: ZohoFailureKind): boolean =>
  kind === "network"
  || kind === "server"
  || kind === "busy"
  || kind === "concurrency-exceeded"
  || kind === "rate-limited-unclassified";

const chunksOf = <T>(values: readonly T[], size: number): readonly (readonly T[])[] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

const isParsedContactList = <T>(
  value: readonly ParsedContact[] | KamResult<T>,
): value is readonly ParsedContact[] => Array.isArray(value);

function normalizePatch(raw: unknown): { readonly ok: true; readonly fields: ZohoFields } | { readonly ok: false; readonly sensitive: boolean } {
  const source = objectOf(raw);
  if (source === null) return { ok: false, sensitive: false };
  let keys: string[];
  try {
    keys = Object.keys(source);
  } catch {
    return { ok: false, sensitive: false };
  }
  if (keys.length < 1 || keys.length > DETAIL_FIELDS.length) return { ok: false, sensitive: false };
  if (keys.some((key) => SENSITIVE_CONTACT_FIELDS.has(key))) return { ok: false, sensitive: true };
  if (keys.some((key) => !DETAIL_FIELD_SET.has(key))) return { ok: false, sensitive: false };

  const fields: Record<string, string | null> = {};
  for (const key of keys as DetailField[]) {
    const value = ownData(source, key);
    if (value !== null && typeof value !== "string") return { ok: false, sensitive: false };
    if (key === "Last_Name" && (value === null || value.trim() === "")) return { ok: false, sensitive: false };
    if (typeof value === "string" && (value.length > DETAIL_LIMITS[key] || value.includes("\0"))) {
      return { ok: false, sensitive: false };
    }
    if (key === "Email" && typeof value === "string" && value !== "" && (!value.includes("@") || /[\r\n]/.test(value))) {
      return { ok: false, sensitive: false };
    }
    if (key === "Nominee_Relation" && value !== null && value !== "" && !NOMINEE_RELATIONS.has(value)) {
      return { ok: false, sensitive: false };
    }
    fields[key] = value;
  }
  return { ok: true, fields: Object.freeze(fields) };
}

function normalizeTouch(raw: unknown): CareTouch | null {
  const touch = objectOf(raw);
  if (touch === null) return null;
  let keys: string[];
  try {
    keys = Object.keys(touch);
  } catch {
    return null;
  }
  if (keys.length !== 5 || keys.some((key) => !["channel", "occurredAt", "isReply", "mood", "note"].includes(key))) return null;
  const channel = ownData(touch, "channel");
  const occurredAt = ownData(touch, "occurredAt");
  const isReply = ownData(touch, "isReply");
  const mood = ownData(touch, "mood");
  const note = ownData(touch, "note");
  if (typeof channel !== "string" || !CHANNELS.has(channel)
    || typeof occurredAt !== "string" || !ZOHO_DATETIME.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))
    || typeof isReply !== "boolean"
    || typeof mood !== "string" || !MOODS.has(mood)
    || typeof note !== "string" || note.trim() === "" || note.length > 2_000 || note.includes("\0")) return null;
  return Object.freeze({ channel, occurredAt, isReply, mood, note }) as CareTouch;
}

function parseContact(record: ZohoRecord, validOrgId: (value: unknown) => value is string): ParsedContact | null {
  if (!validOrgId(record.id)) return null;
  const investorCode = optionalText(record, "ARL_ID", 40);
  const firstName = optionalText(record, "First_Name", 80);
  const lastName = optionalText(record, "Last_Name", 80);
  const mobile = optionalText(record, "Mobile", 40);
  const email = optionalText(record, "Email", 254);
  const city = optionalText(record, "Mailing_City", 120);
  const street = optionalText(record, "Mailing_Street", 250);
  const flatOrBuilding = optionalText(record, "Mailing_Flat_House_No_Building_Apartment_Name", 250);
  const postalCode = optionalText(record, "Mailing_Zip", 30);
  const state = optionalText(record, "Mailing_State", 120);
  const country = optionalText(record, "Mailing_Country", 120);
  const residency = optionalText(record, "Residency", 40);
  const nomineeName = optionalText(record, "Nominee_Name", 120);
  const nomineeRelation = optionalText(record, "Nominee_Relation", 40);
  const kamUserId = lookupId(ownData(record, "KAM"));
  const kamSince = optionalText(record, "KAM_Since", 20);
  const introductionAt = optionalText(record, "KAM_Intro_At", 40);
  const originLeadId = lookupId(ownData(record, "Origin_Lead"));
  const saidYesAt = optionalText(record, "Said_Yes_At", 40);
  const modifiedTime = optionalText(record, "Modified_Time", 40);
  if (typeof investorCode !== "string" || investorCode === ""
    || typeof lastName !== "string" || lastName === ""
    || firstName === undefined || mobile === undefined || email === undefined || city === undefined
    || street === undefined || flatOrBuilding === undefined || postalCode === undefined || state === undefined
    || country === undefined || residency === undefined || nomineeName === undefined || nomineeRelation === undefined
    || kamUserId === undefined || (kamUserId !== null && !validOrgId(kamUserId))
    || kamSince === undefined || introductionAt === undefined
    || originLeadId === undefined || (originLeadId !== null && !validOrgId(originLeadId))
    || saidYesAt === undefined
    || typeof modifiedTime !== "string" || !ZOHO_DATETIME.test(modifiedTime) || Number.isNaN(Date.parse(modifiedTime))) return null;
  return Object.freeze({
    id: record.id,
    investorCode,
    firstName,
    lastName,
    mobile,
    email,
    city,
    street,
    flatOrBuilding,
    postalCode,
    state,
    country,
    residency,
    nomineeName,
    nomineeRelation,
    kamUserId,
    kamSince,
    introductionAt,
    originLeadId,
    saidYesAt,
    modifiedTime,
  });
}

function parseGuard(record: ZohoRecord, validOrgId: (value: unknown) => value is string): ContactGuard | null {
  if (!validOrgId(record.id)) return null;
  const kamUserId = lookupId(ownData(record, "KAM"));
  const originLeadId = lookupId(ownData(record, "Origin_Lead"));
  const modifiedTime = optionalText(record, "Modified_Time", 40);
  if (kamUserId === undefined || (kamUserId !== null && !validOrgId(kamUserId))
    || originLeadId === undefined || (originLeadId !== null && !validOrgId(originLeadId))
    || typeof modifiedTime !== "string" || !ZOHO_DATETIME.test(modifiedTime) || Number.isNaN(Date.parse(modifiedTime))) return null;
  return Object.freeze({ id: record.id, kamUserId, originLeadId, modifiedTime });
}

export function createKamBookService(dependencies: KamBookDependencies): KamBookService {
  if (!dependencies || typeof dependencies !== "object"
    || !dependencies.crm || typeof dependencies.crm.coql !== "function"
    || typeof dependencies.crm.getRecord !== "function"
    || typeof dependencies.crm.update !== "function"
    || typeof dependencies.crm.insert !== "function"
    || !dependencies.access || typeof dependencies.access.recheck !== "function"
    || !dependencies.log || typeof dependencies.log.refusal !== "function"
    || typeof dependencies.recordIdPrefix !== "string" || !RECORD_PREFIX.test(dependencies.recordIdPrefix)) {
    throw new TypeError("KAM book dependencies and the CRM record-id prefix are required.");
  }
  const { crm, access, log } = dependencies;
  const prefix = dependencies.recordIdPrefix;
  const clock = dependencies.clock ?? Date.now;
  const validOrgId = (value: unknown): value is string => typeof value === "string" && RECORD_ID.test(value) && value.startsWith(prefix);
  const now = (): number => {
    try {
      const value = clock();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  };

  const trustedPrincipal = (value: unknown): KamBookPrincipal | null => {
    const candidate = objectOf(value);
    const credential = candidate && ownData(candidate, "credential");
    const sessionId = candidate && ownData(candidate, "sessionId");
    return isUserCredential(credential) && validOrgId(credential.userId)
      && typeof sessionId === "string" && SESSION_ID.test(sessionId)
      ? Object.freeze({ credential, sessionId })
      : null;
  };

  const refuse = <T>(
    principal: KamBookPrincipal | null,
    action: "kam-book" | "kam-details" | "kam-care",
    reasonCode: KamRefusalCode,
    recordIds: readonly string[] = [],
  ): KamResult<T> => {
    log.refusal({
      at: now(),
      actor: { kind: "user", userId: principal?.credential.userId ?? "unrecognised" },
      action,
      reason: reasonCode,
      recordIds: recordIds.filter(validOrgId),
    });
    return { ok: false, kind: "refused", reasonCode, reason: REFUSAL_TEXT[reasonCode], retryable: false };
  };

  const sourceError = <T>(
    source: "access" | "zoho",
    errorKind: ZohoFailureKind | "unexpected" = "unexpected",
  ): KamResult<T> => ({
    ok: false,
    kind: "source-error",
    source,
    errorKind,
    retryable: errorKind === "unexpected" || retryableFailure(errorKind),
  });

  const zohoFailure = <T>(result: Extract<ZohoResult<unknown>, { readonly ok: false }>): KamResult<T> =>
    sourceError("zoho", result.error.kind);

  const parseAccessSnapshot = (raw: unknown, principal: KamBookPrincipal): { readonly snapshot: KamAccessSnapshot; readonly activeKams: ReadonlySet<string> } | null => {
    const value = objectOf(raw);
    const actor = objectOf(value && ownData(value, "actor"));
    const active = value && ownData(value, "activeKamUserIds");
    const userId = actor && ownData(actor, "userId");
    const roleId = actor && ownData(actor, "roleId");
    const profileId = actor && ownData(actor, "profileId");
    const seat = actor && ownData(actor, "seat");
    if (!actor || userId !== principal.credential.userId || !validOrgId(userId)
      || !validOrgId(roleId) || !validOrgId(profileId)
      || typeof seat !== "string" || !ALLOWED_SEATS.has(seat as ZohoSeat)
      || !Array.isArray(active) || active.length > BOOK_LIMIT
      || active.some((id) => !validOrgId(id)) || new Set(active).size !== active.length) return null;
    if (seat === "key-account-manager" && !active.includes(userId)) return null;
    return {
      snapshot: Object.freeze({
        actor: Object.freeze({ userId, roleId, profileId, seat: seat as ZohoSeat }),
        activeKamUserIds: Object.freeze([...active]),
      }),
      activeKams: new Set(active),
    };
  };

  const checkAccess = async <T>(
    principal: KamBookPrincipal,
    action: "kam-book" | "kam-details" | "kam-care",
    signal?: AbortSignal,
  ): Promise<AccessCheck | KamResult<T>> => {
    let raw: KamAccessSnapshot | null;
    try {
      raw = await access.recheck(principal.credential, principal.sessionId, signal);
    } catch {
      return sourceError("access");
    }
    if (raw === null) return refuse(principal, action, "session-changed");
    const parsed = parseAccessSnapshot(raw, principal);
    if (parsed === null) return refuse(principal, action, "seat-denied");
    return { principal, snapshot: parsed.snapshot, activeKams: parsed.activeKams };
  };

  const sameAccess = (before: AccessCheck, after: AccessCheck): boolean =>
    before.snapshot.actor.userId === after.snapshot.actor.userId
    && before.snapshot.actor.seat === after.snapshot.actor.seat
    && before.snapshot.actor.roleId === after.snapshot.actor.roleId
    && before.snapshot.actor.profileId === after.snapshot.actor.profileId
    && sameSet(before.activeKams, after.activeKams);

  const queryPage = async <T>(
    principal: KamBookPrincipal,
    query: string,
    signal?: AbortSignal,
  ): Promise<ZohoPage | KamResult<T>> => {
    let result: Awaited<ReturnType<typeof crm.coql>>;
    try {
      result = await crm.coql(principal.credential, query, { signal });
    } catch {
      return sourceError("zoho");
    }
    if (!result.ok) return zohoFailure(result);
    return result.value;
  };

  const parseAllotmentPage = <T>(
    principal: KamBookPrincipal,
    page: ZohoPage,
    action: "kam-book" | "kam-details" | "kam-care",
    expectedContacts?: ReadonlySet<string>,
  ): AllotmentScope | KamResult<T> => {
    if (page.invalidRecordIds) return refuse(principal, action, "source-invalid");
    if (page.moreRecords) return refuse(principal, action, "book-too-large");
    const units = new Map<string, number>();
    for (const record of page.records) {
      if (!validOrgId(record.id)) return refuse(principal, action, "source-invalid");
      const customerId = lookupId(ownData(record, "Customer"));
      const status = ownData(record, "Allocation_Status");
      const issuedUnits = safeInteger(ownData(record, "Issued_Units"));
      if (customerId === undefined || customerId === null || !validOrgId(customerId)
        || status !== "Issued" || issuedUnits === null || issuedUnits < 1
        || (expectedContacts && !expectedContacts.has(customerId))) {
        return refuse(principal, action, "source-invalid", [record.id]);
      }
      const total = (units.get(customerId) ?? 0) + issuedUnits;
      if (!Number.isSafeInteger(total)) return refuse(principal, action, "source-invalid", [record.id]);
      units.set(customerId, total);
    }
    return units;
  };

  const issuedAllotments = async <T>(
    principal: KamBookPrincipal,
    action: "kam-book" | "kam-details" | "kam-care",
    contactIds: readonly string[] | null,
    signal?: AbortSignal,
  ): Promise<AllotmentScope | KamResult<T>> => {
    if (contactIds !== null && contactIds.length === 0) return new Map();
    const merged = new Map<string, number>();
    const groups = contactIds === null ? [null] : chunksOf([...new Set(contactIds)].sort(), COQL_IN_LIMIT);
    for (const group of groups) {
      const contactClause = group === null
        ? ""
        : ` and Customer in (${group.map((id) => `'${id}'`).join(", ")})`;
      const query = `select ${ALLOTMENT_FIELDS.join(", ")} from ${ALLOTMENTS_MODULE} where (Allocation_Status = 'Issued'${contactClause}) order by id asc limit 0, ${BOOK_LIMIT}`;
      const page = await queryPage<T>(principal, query, signal);
      if (!("records" in page)) return page;
      const parsed = parseAllotmentPage<T>(principal, page, action, group === null ? undefined : new Set(group));
      if (!(parsed instanceof Map)) return parsed;
      for (const [id, units] of parsed) {
        const total = (merged.get(id) ?? 0) + units;
        if (!Number.isSafeInteger(total)) return refuse(principal, action, "source-invalid", [id]);
        merged.set(id, total);
      }
    }
    return merged;
  };

  const contactsByIds = async <T>(
    accessCheck: AccessCheck,
    contactIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ParsedContact[] | KamResult<T>> => {
    const uniqueIds = [...new Set(contactIds)].sort();
    const contacts: ParsedContact[] = [];
    for (const group of chunksOf(uniqueIds, COQL_IN_LIMIT)) {
      const seatClause = accessCheck.snapshot.actor.seat === "key-account-manager"
        ? ` and KAM = '${accessCheck.principal.credential.userId}'`
        : "";
      const query = `select ${BOOK_FIELDS.join(", ")} from ${CONTACTS_MODULE} where (id in (${group.map((id) => `'${id}'`).join(", ")})${seatClause}) order by id asc limit 0, ${BOOK_LIMIT}`;
      const page = await queryPage<T>(accessCheck.principal, query, signal);
      if (!("records" in page)) return page;
      if (page.invalidRecordIds) return refuse(accessCheck.principal, "kam-book", "source-invalid");
      if (page.moreRecords) return refuse(accessCheck.principal, "kam-book", "book-too-large");
      const expected = new Set(group);
      for (const record of page.records) {
        const contact = parseContact(record, validOrgId);
        if (!contact || !expected.has(contact.id)) {
          return refuse(accessCheck.principal, "kam-book", "source-invalid", [record.id]);
        }
        if (accessCheck.snapshot.actor.seat === "key-account-manager"
          && contact.kamUserId !== accessCheck.principal.credential.userId) {
          return refuse(accessCheck.principal, "kam-book", "scope-drift", [record.id]);
        }
        contacts.push(contact);
      }
      const returned = new Set(contacts.filter((contact) => expected.has(contact.id)).map((contact) => contact.id));
      if (returned.size !== expected.size || [...expected].some((id) => !returned.has(id))) {
        return refuse(accessCheck.principal, "kam-book", "scope-drift", group);
      }
    }
    if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length) {
      return refuse(accessCheck.principal, "kam-book", "source-invalid", contacts.map((contact) => contact.id));
    }
    return contacts;
  };

  const readGuard = async <T>(
    principal: KamBookPrincipal,
    action: "kam-details" | "kam-care",
    contactId: string,
    signal?: AbortSignal,
  ): Promise<ContactGuard | KamResult<T>> => {
    let result: Awaited<ReturnType<typeof crm.getRecord>>;
    try {
      result = await crm.getRecord(principal.credential, CONTACTS_MODULE, contactId, { fields: CONTACT_GUARD_FIELDS, signal });
    } catch {
      return sourceError("zoho");
    }
    if (!result.ok) {
      if (result.error.kind === "not-found" || result.error.kind === "forbidden") return refuse(principal, action, "not-visible", [contactId]);
      return zohoFailure(result);
    }
    if (result.value === null) return refuse(principal, action, "not-visible", [contactId]);
    const parsed = parseGuard(result.value, validOrgId);
    return parsed ?? refuse(principal, action, "source-invalid", [contactId]);
  };

  const authorizeWrite = async <T>(
    accessCheck: AccessCheck,
    action: "kam-details" | "kam-care",
    contactId: string,
    expectedModifiedTime: string,
    signal?: AbortSignal,
  ): Promise<ContactGuard | KamResult<T>> => {
    const guard = await readGuard<T>(accessCheck.principal, action, contactId, signal);
    if (!("id" in guard)) return guard;
    if (guard.modifiedTime !== expectedModifiedTime) return refuse(accessCheck.principal, action, "contact-changed", [contactId]);
    if (accessCheck.snapshot.actor.seat === "key-account-manager" && guard.kamUserId !== accessCheck.principal.credential.userId) {
      return refuse(accessCheck.principal, action, "not-visible", [contactId]);
    }
    const allotted = await issuedAllotments<T>(accessCheck.principal, action, [contactId], signal);
    if (!(allotted instanceof Map)) return allotted;
    if (!allotted.has(contactId)) return refuse(accessCheck.principal, action, "not-visible", [contactId]);
    return guard;
  };

  const recheckUnchanged = async <T>(
    before: AccessCheck,
    action: "kam-book" | "kam-details" | "kam-care",
    signal?: AbortSignal,
  ): Promise<AccessCheck | KamResult<T>> => {
    const after = await checkAccess<T>(before.principal, action, signal);
    if (!("snapshot" in after)) return after;
    return sameAccess(before, after) ? after : refuse(before.principal, action, "session-changed");
  };

  const service: KamBookService = {
    async list(untrustedPrincipal: KamBookPrincipal, signal?: AbortSignal) {
      const principal = trustedPrincipal(untrustedPrincipal);
      if (principal === null) return refuse(null, "kam-book", "invalid-request");
      const checked = await checkAccess<readonly KamBookEntry[]>(principal, "kam-book", signal);
      if (!("snapshot" in checked)) return checked;

      let contactIds: readonly string[];
      let scope: AllotmentScope;
      if (checked.snapshot.actor.seat === "key-account-manager") {
        const query = `select ${BOOK_FIELDS.join(", ")} from ${CONTACTS_MODULE} where KAM = '${principal.credential.userId}' order by id asc limit 0, ${BOOK_LIMIT}`;
        const page = await queryPage<readonly KamBookEntry[]>(principal, query, signal);
        if (!("records" in page)) return page;
        if (page.invalidRecordIds) return refuse(principal, "kam-book", "source-invalid");
        if (page.moreRecords) return refuse(principal, "kam-book", "book-too-large");
        const contacts: ParsedContact[] = [];
        for (const record of page.records) {
          const contact = parseContact(record, validOrgId);
          if (!contact) return refuse(principal, "kam-book", "source-invalid", [record.id]);
          if (contact.kamUserId !== principal.credential.userId) return refuse(principal, "kam-book", "scope-drift", [record.id]);
          contacts.push(contact);
        }
        if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length) {
          return refuse(principal, "kam-book", "source-invalid", contacts.map((contact) => contact.id));
        }
        contactIds = contacts.map((contact) => contact.id);
        const allotted = await issuedAllotments<readonly KamBookEntry[]>(principal, "kam-book", contactIds, signal);
        if (!(allotted instanceof Map)) return allotted;
        // D12: a KAM is named at allotment. A KAM-held contact with no Issued allotment (e.g. a
        // reversed allotment) is left out of the book and logged; it must not blank the whole book.
        const unallotted = contactIds.filter((id) => !allotted.has(id));
        if (unallotted.length > 0) refuse(principal, "kam-book", "scope-drift", unallotted);
        const allottedContacts = contacts.filter((contact) => allotted.has(contact.id));
        scope = allotted;
        const finalAccess = await recheckUnchanged<readonly KamBookEntry[]>(checked, "kam-book", signal);
        if (!("snapshot" in finalAccess)) return finalAccess;
        const identity = Object.freeze({ pan: "finance-only", aadhaar: "finance-only", bank: "finance-only" } as const);
        return {
          ok: true,
          value: Object.freeze(allottedContacts.map((contact) => Object.freeze({
            ...contact,
            issuedUnits: scope.get(contact.id) ?? 0,
            scope: "own" as const,
            mayCare: true as const,
            mayDetails: true as const,
            mayAssignManager: false,
            identity,
          }))),
        };
      }

      const allotted = await issuedAllotments<readonly KamBookEntry[]>(principal, "kam-book", null, signal);
      if (!(allotted instanceof Map)) return allotted;
      scope = allotted;
      contactIds = [...allotted.keys()];
      const contacts = await contactsByIds<readonly KamBookEntry[]>(checked, contactIds, signal);
      if (!isParsedContactList(contacts)) return contacts;
      const finalAccess = await recheckUnchanged<readonly KamBookEntry[]>(checked, "kam-book", signal);
      if (!("snapshot" in finalAccess)) return finalAccess;
      const identity = Object.freeze({ pan: "finance-only", aadhaar: "finance-only", bank: "finance-only" } as const);
      return {
        ok: true,
        value: Object.freeze(contacts.map((contact) => {
          const pool = contact.kamUserId === null || !finalAccess.activeKams.has(contact.kamUserId);
          return Object.freeze({
            ...contact,
            issuedUnits: scope.get(contact.id) ?? 0,
            scope: pool ? "pool" as const : "team" as const,
            mayCare: true as const,
            mayDetails: true as const,
            mayAssignManager: true,
            identity,
          });
        })),
      };
    },

    async changeDetails(untrustedPrincipal: KamBookPrincipal, command: ChangeDetailsCommand, signal?: AbortSignal) {
      const principal = trustedPrincipal(untrustedPrincipal);
      if (principal === null) return refuse(null, "kam-details", "invalid-request");
      if (!command || typeof command !== "object" || !validOrgId(command.contactId)
        || typeof command.expectedModifiedTime !== "string" || !ZOHO_DATETIME.test(command.expectedModifiedTime)
        || Number.isNaN(Date.parse(command.expectedModifiedTime))) {
        return refuse(principal, "kam-details", "invalid-request");
      }
      const normalized = normalizePatch(command.fields);
      if (!normalized.ok) {
        return refuse(principal, "kam-details", normalized.sensitive ? "identity-field-write" : "details-not-editable", [command.contactId]);
      }
      const checked = await checkAccess<{ readonly contactId: string; readonly modifiedTime: string | null }>(principal, "kam-details", signal);
      if (!("snapshot" in checked)) return checked;
      const guard = await authorizeWrite<{ readonly contactId: string; readonly modifiedTime: string | null }>(
        checked,
        "kam-details",
        command.contactId,
        command.expectedModifiedTime,
        signal,
      );
      if (!("id" in guard)) return guard;
      const finalAccess = await recheckUnchanged<{ readonly contactId: string; readonly modifiedTime: string | null }>(checked, "kam-details", signal);
      if (!("snapshot" in finalAccess)) return finalAccess;

      let written: Awaited<ReturnType<typeof crm.update>>;
      try {
        written = await crm.update(principal.credential, CONTACTS_MODULE, command.contactId, normalized.fields, {
          ifUnmodifiedSince: guard.modifiedTime,
          signal,
        });
      } catch {
        return sourceError("zoho");
      }
      if (!written.ok) return zohoFailure(written);
      if (written.value.id !== command.contactId || !validOrgId(written.value.id)) {
        return refuse(principal, "kam-details", "source-invalid", [command.contactId]);
      }
      return { ok: true, value: Object.freeze({ contactId: command.contactId, modifiedTime: written.value.modifiedTime }) };
    },

    async recordCare(untrustedPrincipal: KamBookPrincipal, command: RecordCareCommand, signal?: AbortSignal) {
      const principal = trustedPrincipal(untrustedPrincipal);
      if (principal === null) return refuse(null, "kam-care", "invalid-request");
      if (!command || typeof command !== "object" || !validOrgId(command.contactId)
        || typeof command.expectedModifiedTime !== "string" || !ZOHO_DATETIME.test(command.expectedModifiedTime)
        || Number.isNaN(Date.parse(command.expectedModifiedTime))) {
        return refuse(principal, "kam-care", "invalid-request");
      }
      const touch = normalizeTouch(command.touch);
      if (touch === null) return refuse(principal, "kam-care", "invalid-request", [command.contactId]);
      const checked = await checkAccess<{ readonly touchId: string }>(principal, "kam-care", signal);
      if (!("snapshot" in checked)) return checked;
      const first = await authorizeWrite<{ readonly touchId: string }>(
        checked,
        "kam-care",
        command.contactId,
        command.expectedModifiedTime,
        signal,
      );
      if (!("id" in first)) return first;
      if (first.originLeadId === null) return refuse(principal, "kam-care", "source-invalid", [command.contactId]);
      const finalAccess = await recheckUnchanged<{ readonly touchId: string }>(checked, "kam-care", signal);
      if (!("snapshot" in finalAccess)) return finalAccess;
      // Re-read after the final seat check. If KAM or Contact changed, refuse before writing Touches.
      const second = await readGuard<{ readonly touchId: string }>(principal, "kam-care", command.contactId, signal);
      if (!("id" in second)) return second;
      if (second.modifiedTime !== first.modifiedTime || second.kamUserId !== first.kamUserId || second.originLeadId !== first.originLeadId) {
        return refuse(principal, "kam-care", "contact-changed", [command.contactId]);
      }

      let written: Awaited<ReturnType<typeof crm.insert>>;
      try {
        written = await crm.insert(principal.credential, TOUCHES_MODULE, [Object.freeze({
          // Name is system-mandatory on Touches. It carries no investor identity: channel + time only.
          Name: `${touch.channel} ${touch.occurredAt}`,
          Lead: Object.freeze({ id: first.originLeadId }),
          Channel: touch.channel,
          Occurred_At: touch.occurredAt,
          Is_Reply: touch.isReply,
          Mood: touch.mood,
          Note: touch.note,
        })], { signal });
      } catch {
        return sourceError("zoho");
      }
      if (!written.ok) return zohoFailure(written);
      const outcomes: readonly RecordOutcome[] = written.value;
      const outcome = outcomes.length === 1 ? outcomes[0] : null;
      if (!outcome || !outcome.ok || outcome.id === null || !validOrgId(outcome.id)) {
        return refuse(principal, "kam-care", "source-invalid", [command.contactId]);
      }
      return { ok: true, value: Object.freeze({ touchId: outcome.id }) };
    },
  };
  return Object.freeze(service);
}
