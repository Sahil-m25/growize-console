/**
 * M04-S01 — capture one lead into Zoho as the signed-in person (D45, D53).
 *
 * The browser's form checks are a courtesy; this is the gate. Every field is re-validated here,
 * the seat and its `capture` capability are re-read from the session layer before and after the
 * checks, and the Lead is created with the person's own token, so Zoho records them as creator and
 * (for an IR) as owner. Owner, source and attribution are decided here from the seat, never taken
 * on trust from request JSON: an IR or Channel Partner always owns what they add, and only a seat
 * that may assign others can name an owner or leave the lead to the unassigned queue.
 *
 * Nothing is cached and no field value is logged: the client's Plane B line for the insert (op,
 * endpoint, status) is the capture log, and Zoho's own record audit (Plane A) holds the rest (D47).
 */

import type { UserCredential, ZohoClient, ZohoFields } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { ScopedCache } from "../../lib/zoho/cache";
import type { SeatedZohoUser } from "../oauth/seat";
import { SOURCES, SRCNEEDS } from "../../domain/plan";
import type { Source } from "../../domain/types";

export const LEADS_MODULE = "Leads";
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SOURCE_SET: ReadonlySet<string> = new Set(SOURCES);

/** The console's words for how permission was given (features/add/state.ts CONHOW). Zoho's
 *  Consent_How picklist must carry these exact labels (M04-S01-T01). */
export const CONSENT_HOW: Readonly<Record<string, string>> = Object.freeze({
  person: "In person", call: "On a call", msg: "In a WhatsApp reply", form: "On a web form", event: "On the event sheet",
});
const CONSENT_FIELDS = Object.freeze({ msg: "Consent_WhatsApp", call: "Consent_Call", email: "Consent_Email", visit: "Consent_Visit" } as const);
type ConsentChannel = keyof typeof CONSENT_FIELDS;

export interface CapturePrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
}

/** Re-resolved by the session layer from the live session and Zoho seat on every call. */
export interface CaptureAccess {
  readonly actor: SeatedZohoUser;
  /** The seat (or a page grant) carries the `capture` capability on Add. */
  readonly mayCapture: boolean;
  /** Users this actor may make the owner of a new lead. Empty for IRs and Channel Partners. */
  readonly assignableOwnerIds: readonly string[];
  /** The Zoho user the unassigned queue belongs to (PROVISIONAL, see BLOCKED.md); null = not set up. */
  readonly unassignedQueueUserId: string | null;
}

export interface CaptureAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<CaptureAccess | null>;
}

export interface CaptureDependencies {
  readonly crm: Pick<ZohoClient, "insert">;
  readonly access: CaptureAccessAuthority;
  readonly log: OpsLog;
  readonly cache?: Pick<ScopedCache, "invalidate">;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export interface CaptureCommand {
  readonly name: string;
  readonly mobile: string;
  readonly email?: string;
  readonly city?: string;
  readonly source: Source;
  /** Lead_Events record id, required when the source is Events. */
  readonly eventId?: string | null;
  /** Zoho user id of who introduced them (person sources, including a Channel Partner). */
  readonly introducedById?: string | null;
  /** Owner chosen by a seat that may assign; null or absent = the unassigned queue. */
  readonly ownerId?: string | null;
  readonly units?: number | null;
  readonly consent?: Readonly<Partial<Record<ConsentChannel, boolean>>>;
  readonly consentHow?: string | null;
}

export type CaptureRefusal =
  | "invalid-request" | "session-changed" | "capability-missing" | "invalid-name" | "invalid-mobile"
  | "invalid-email" | "invalid-source" | "event-missing" | "introducer-missing" | "owner-not-assignable"
  | "unassigned-queue-missing" | "invalid-units" | "consent-how-missing" | "email-consent-without-email"
  | "duplicate-mobile";

export type CaptureResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly ownerId: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: CaptureRefusal; readonly reason: string; readonly missingCapability?: "capture" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON: Readonly<Record<CaptureRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "this seat cannot add leads (it needs the capture permission on Add)",
  "invalid-name": "a name of at least two letters is needed",
  "invalid-mobile": "write the mobile as ten Indian digits, or + and the country code",
  "invalid-email": "the email is not valid; leave it empty if there is none",
  "invalid-source": "choose where the lead came from",
  "event-missing": "which event it came from",
  "introducer-missing": "who introduced them",
  "owner-not-assignable": "that person cannot be given this lead",
  "unassigned-queue-missing": "the unassigned queue is not set up in Zoho yet",
  "invalid-units": "units must be a whole number",
  "consent-how-missing": "how contact permission was given",
  "email-consent-without-email": "an email for email permission",
  "duplicate-mobile": "the book already has this number",
});

/** Zoho's duplicate check on Mobile is the hard stop (M04-S02): a second capture of the same number,
 *  even one racing the first, is refused by Zoho. Which record holds it is never passed on. */
export function isDuplicateMobile(error: unknown): boolean {
  const e = error as { kind?: string; code?: string; field?: string | null; records?: readonly { ok: boolean; code: string; field: string | null }[] } | null;
  if (!e) return false;
  if (e.kind === "invalid-data") return e.code === "DUPLICATE_DATA" && (e.field === "Mobile" || e.field == null);
  if (e.kind === "partial" && e.records?.length === 1) return !e.records[0].ok && e.records[0].code === "DUPLICATE_DATA" && e.records[0].field === "Mobile";
  return false;
}

/** Ten Indian digits, an 0- or 91-prefixed Indian number, or + and a country code (features/add/csv.ts phoneOK). */
export function mobileToE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/[\s()-]/g, "");
  if (v.startsWith("+91")) return /^\+91\d{10}$/.test(v) ? v : null;
  if (v.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
  if (/^\d{10}$/.test(v)) return "+91" + v;
  if (/^0\d{10}$/.test(v)) return "+91" + v.slice(1);
  if (/^91\d{10}$/.test(v)) return "+" + v;
  return null;
}

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Zoho's Last_Name is mandatory and 80 long, First_Name 40: the last word is the surname. */
export function splitName(full: string): { First_Name?: string; Last_Name: string } | null {
  const words = full.replace(/\s+/g, " ").trim().split(" ");
  if (words.join("").length < 2) return null;
  const last = words.pop() as string;
  const first = words.join(" ");
  if (last.length > 80 || first.length > 40) return null;
  return first ? { First_Name: first, Last_Name: last } : { Last_Name: last };
}

const zohoTime = (ms: number): string => {
  const ist = new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19);
  return `${ist}+05:30`;
};

export function createLeadCapture(deps: CaptureDependencies) {
  if (!deps || typeof deps.crm?.insert !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Lead capture needs crm.insert, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log, cache } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);

  const refuse = (userId: string, reasonCode: CaptureRefusal): CaptureResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "capture-lead", reason: reasonCode, recordIds: [] });
    return {
      ok: false, kind: "refused", reasonCode, reason: REASON[reasonCode],
      ...(reasonCode === "capability-missing" ? { missingCapability: "capture" as const } : {}),
    };
  };

  const readAccess = async (p: CapturePrincipal, signal?: AbortSignal): Promise<CaptureAccess | CaptureResult> => {
    let a: CaptureAccess | null;
    try {
      a = await access.recheck(p.credential, p.sessionId, signal);
    } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
    }
    if (!a || a.actor?.userId !== p.credential.userId) return refuse(p.credential.userId, "session-changed");
    return a;
  };
  const isAccess = (v: CaptureAccess | CaptureResult): v is CaptureAccess => "actor" in v;

  /** Builds the Zoho row, or names the first thing wrong, in the order the form asks for them. */
  const fieldsFor = (a: CaptureAccess, c: CaptureCommand): { fields: ZohoFields; ownerId: string | null } | CaptureRefusal => {
    const name = splitName(text(c.name));
    if (!name) return "invalid-name";
    const mobile = mobileToE164(c.mobile);
    if (!mobile) return "invalid-mobile";
    const email = text(c.email);
    if (email && (email.length > 100 || !EMAIL.test(email))) return "invalid-email";
    const city = text(c.city);
    if (city.length > 255) return "invalid-request";

    const seat = a.actor.seat;
    const keepsOwn = seat === "investor-relations" || seat === "channel-partner";
    const source: Source = seat === "channel-partner" ? "Channel partner" : c.source;
    if (!SOURCE_SET.has(source)) return "invalid-source";
    const need = SRCNEEDS[source];
    const eventId = need === "event" ? c.eventId : null;
    if (need === "event" && !validId(eventId)) return "event-missing";
    const introducer = seat === "channel-partner" ? a.actor.userId : need === "person" ? c.introducedById : null;
    if (need === "person" && !validId(introducer)) return "introducer-missing";

    let ownerId: string | null;
    if (keepsOwn) ownerId = a.actor.userId;
    else if (c.ownerId === null || c.ownerId === undefined || c.ownerId === "") ownerId = null;
    else if (validId(c.ownerId) && (c.ownerId === a.actor.userId || a.assignableOwnerIds.includes(c.ownerId))) ownerId = c.ownerId;
    else return "owner-not-assignable";
    if (ownerId === null && !validId(a.unassignedQueueUserId)) return "unassigned-queue-missing";

    const units = c.units ?? null;
    if (units !== null && (!Number.isSafeInteger(units) || units < 0 || units > 999_999_999)) return "invalid-units";

    const consent = c.consent ?? {};
    const given = (Object.keys(CONSENT_FIELDS) as ConsentChannel[]).filter((k) => consent[k] === true);
    if (Object.keys(consent).some((k) => !(k in CONSENT_FIELDS))) return "invalid-request";
    const how = given.length ? CONSENT_HOW[text(c.consentHow)] : undefined;
    if (given.length && !how) return "consent-how-missing";
    if (consent.email === true && !email) return "email-consent-without-email";

    const at = zohoTime(clock());
    const fields: Record<string, ZohoFields[string]> = { ...name, Mobile: mobile, Lead_Source: source };
    if (email) fields.Email = email;
    if (city) fields.City = city;
    if (eventId) fields.Lead_Event = { id: eventId };
    if (introducer) fields.Introduced_By = { id: introducer };
    if (units !== null) fields.Units_Interested = units;
    if (ownerId === null) fields.Owner = { id: a.unassignedQueueUserId as string };
    else {
      fields.Owner = { id: ownerId };
      fields.Owner_Assigned_At = at;
    }
    for (const k of given) fields[CONSENT_FIELDS[k]] = true;
    if (how) Object.assign(fields, { Consent_How: how, Consent_At: at, Consent_By: { id: a.actor.userId } });
    return { fields: Object.freeze(fields), ownerId };
  };

  return Object.freeze({
    async createLead(principal: CapturePrincipal, command: CaptureCommand, signal?: AbortSignal): Promise<CaptureResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const p: CapturePrincipal = { credential: cred, sessionId: principal.sessionId };
      if (!command || typeof command !== "object") return refuse(cred.userId, "invalid-request");

      const before = await readAccess(p, signal);
      if (!isAccess(before)) return before;
      if (!before.mayCapture) return refuse(cred.userId, "capability-missing");
      const built = fieldsFor(before, command);
      if (typeof built === "string") return refuse(cred.userId, built);

      // The seat is re-read right before the write: a capability or owner list revoked during the
      // checks must not still create the lead.
      const after = await readAccess(p, signal);
      if (!isAccess(after)) return after;
      if (!after.mayCapture) return refuse(cred.userId, "capability-missing");
      if (after.actor.seat !== before.actor.seat
        || (built.ownerId !== null && built.ownerId !== cred.userId && !after.assignableOwnerIds.includes(built.ownerId))
        || (built.ownerId === null && after.unassignedQueueUserId !== before.unassignedQueueUserId)) {
        return refuse(cred.userId, "session-changed");
      }

      let res: Awaited<ReturnType<typeof crm.insert>>;
      try {
        res = await crm.insert(cred, LEADS_MODULE, [built.fields], { signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false };
      }
      // A create is never retried here: a lost reply may have landed (the client does not resend either).
      if (!res.ok) {
        if (isDuplicateMobile(res.error)) return refuse(cred.userId, "duplicate-mobile");
        return { ok: false, kind: "source-error", source: "zoho", errorKind: res.error.kind, retryable: false };
      }
      const out = res.value.length === 1 ? res.value[0] : null;
      if (!out || !out.ok || !validId(out.id)) {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false };
      }
      if (cache) {
        const owners = new Set([cred.userId, built.ownerId ?? (after.unassignedQueueUserId as string)]);
        await Promise.all([...owners].map((userId) => cache.invalidate({ scope: { kind: "user", userId } }).catch(() => 0)));
      }
      return { ok: true, value: { leadId: out.id, ownerId: built.ownerId } };
    },
  });
}
