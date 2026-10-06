/**
 * Cluster C2 saveContactPermission / saveProfileDetails (ir-write-map.md) — the investor-details drawer, written to the
 * Lead on the person's own token (D53), guarded by the Modified_Time the page loaded (D44). History is Zoho's own field
 * history (J10), so nothing here keeps a second copy of the old values.
 *
 * Permission: Consent_WhatsApp / Consent_Email / Consent_Call (booleans), Consent_How (the org's picklist, mapped by
 * capture.ts CONSENT_HOW), Consent_At (when it was given, IST, never in the future), Consent_By (the recorder).
 * Clearing every channel is the withdrawal: the three are false and How/At are cleared. There is no Consent_Visit in the
 * org and none is written — visit permission is intentionally absent (M12-S11-NOTE-5); a visit flag sent is ignored.
 *
 * Profile: standard Lead fields only — First_Name / Last_Name (capture.ts splitName), Mobile (E.164, Zoho's duplicate
 * check on Mobile is the hard stop), Email, City — plus Units_Interested before Reserved, and Preferred_Communication
 * (Email / WhatsApp / Phone) for the contact preference. Introduced_By and Contact_Preference do not exist in Zoho
 * (J11, MISSING): an introducer change answers `field-missing`, and a preference that is not one of the three channels
 * answers `preference-unsupported` (write it as a note instead). Only the fields sent are written.
 */

import type { ZohoClient, ZohoFieldValue, ZohoFields } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { FollowupAccessAuthority } from "./followup";
import { CONSENT_HOW, isDuplicateMobile, LEADS_MODULE, mobileToE164, splitName } from "./capture";
import { createAdmit, RECORD_PREFIX, rejectedField, zohoError, zohoTime, type AdmitRefusal, type Principal, type Refused, type SourceError } from "./record-access";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Leads.Preferred_Communication picklist (production metadata, 6 Oct 2026). */
export const PREFERRED_COMMUNICATION: readonly string[] = Object.freeze(["Email", "WhatsApp", "Phone"]);

export type DetailsRefusal = AdmitRefusal | "lead-closed" | "how-needed" | "given-at-invalid" | "email-needed" | "name-needed" | "mobile-invalid"
  | "email-invalid" | "units-invalid" | "units-locked" | "preference-unsupported" | "duplicate-mobile" | "nothing-changed" | "field-missing";
export type DetailsResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly modifiedTime: string | null; readonly fields: readonly string[] } }
  | Refused<DetailsRefusal>
  | SourceError;

export interface PermissionCommand {
  readonly con: { readonly msg?: unknown; readonly email?: unknown; readonly call?: unknown; readonly visit?: unknown };
  /** The console's word for how it was given (features/add/state CONHOW keys: person, call, msg, form, event). */
  readonly how?: unknown;
  /** IST calendar date and time it was given. */
  readonly date?: unknown;
  readonly time?: unknown;
}
/** Only what changed; an absent key is left as Zoho holds it. */
export interface ProfileCommand {
  readonly name?: unknown;
  readonly mobile?: unknown;
  readonly email?: unknown;
  readonly city?: unknown;
  readonly units?: unknown;
  readonly contactPreference?: unknown;
  readonly introducedBy?: unknown;
}

export interface DetailsDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

/** The free-text preference the drawer collects → the picklist value, when it names one channel; null for blank. */
export function preferenceOf(raw: string): string | null | undefined {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (/^(whats ?app|msg|message)$/.test(t)) return "WhatsApp";
  if (/^(e-?mail|mail)$/.test(t)) return "Email";
  if (/^(phone|call|calls|phone call)$/.test(t)) return "Phone";
  return undefined;
}

export function createLeadDetails(deps: DetailsDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Details need crm.getRecord/update, the access authority, the ops log and the CRM record-id prefix.");
  }
  const clock = deps.clock ?? Date.now;
  const { admit, refuse } = createAdmit({ crm: deps.crm, access: deps.access, log: deps.log, recordIdPrefix: deps.recordIdPrefix, clock, action: "lead-details" });

  async function write(principal: Principal, me: string, leadId: string, expected: string, fields: ZohoFields, signal?: AbortSignal): Promise<DetailsResult> {
    let put: Awaited<ReturnType<typeof deps.crm.update>>;
    try { put = await deps.crm.update(principal.credential, LEADS_MODULE, leadId, fields, { ifUnmodifiedSince: expected, signal }); } catch { return zohoError("unexpected"); }
    if (!put.ok) {
      if (put.error.kind === "conflict") return refuse(me, "lead-changed", "Not saved — the lead changed in Zoho since it was opened. Reload it and try again.", [leadId]);
      if (isDuplicateMobile(put.error)) return refuse(me, "duplicate-mobile", "Not saved — that mobile number is already on another lead.", [leadId]);
      const f = rejectedField(put.error);
      if (f && Object.prototype.hasOwnProperty.call(fields, f)) return refuse(me, "field-missing", `Not saved — Zoho rejected Leads.${f}; the owner checks the field exists.`, [leadId], f);
      return zohoError(put.error.kind);
    }
    return { ok: true, value: { leadId, modifiedTime: put.value.modifiedTime, fields: Object.keys(fields) } };
  }

  return Object.freeze({
    /** Record or withdraw per-channel permission and how it was given. */
    async permission(principal: Principal, leadId: unknown, expected: unknown, c: PermissionCommand, signal?: AbortSignal): Promise<DetailsResult> {
      const o = await admit(principal, leadId, expected, ["Email"], signal);
      if (!("L" in o)) return o;
      const { me, L } = o;
      const id = leadId as string;
      if (!c || typeof c !== "object" || !c.con || typeof c.con !== "object") return refuse(me, "invalid-request", "Not saved — the request is incomplete.", [id]);
      const on = { msg: c.con.msg === true, email: c.con.email === true, call: c.con.call === true };
      const any = on.msg || on.email || on.call;
      const fields: Record<string, ZohoFieldValue> = { Consent_WhatsApp: on.msg, Consent_Email: on.email, Consent_Call: on.call, Consent_By: { id: me } };
      if (any) {
        const how = typeof c.how === "string" ? CONSENT_HOW[c.how] : undefined;
        if (!how) return refuse(me, "how-needed", "Say how the permission was given.", [id]);
        if (typeof c.date !== "string" || !DATE.test(c.date) || typeof c.time !== "string" || !TIME.test(c.time)) {
          return refuse(me, "given-at-invalid", "Give the date and time the permission was given.", [id]);
        }
        const at = `${c.date}T${c.time}:00+05:30`, ms = Date.parse(at);
        if (!Number.isFinite(ms) || zohoTime(ms).slice(0, 10) !== c.date || ms > clock() + 60_000) {
          return refuse(me, "given-at-invalid", "The permission cannot be given in the future.", [id]);
        }
        if (on.email && !(typeof L.Email === "string" && L.Email)) return refuse(me, "email-needed", "Record an email address before email permission.", [id]);
        Object.assign(fields, { Consent_How: how, Consent_At: at });
      } else {
        Object.assign(fields, { Consent_How: null, Consent_At: null });
      }
      return write(principal, me, id, expected as string, fields, signal);
    },

    /** Correct the investor's details: only the keys sent are written. */
    async profile(principal: Principal, leadId: unknown, expected: unknown, p: ProfileCommand, signal?: AbortSignal): Promise<DetailsResult> {
      const o = await admit(principal, leadId, expected, ["Reserved_At"], signal);
      if (!("L" in o)) return o;
      const { me, L } = o;
      const id = leadId as string;
      if (!p || typeof p !== "object") return refuse(me, "invalid-request", "Not saved — the request is incomplete.", [id]);
      if (L.Lost_At) return refuse(me, "lead-closed", "Not saved — this lead is closed. Re-open it first.", [id]);
      const has = (k: keyof ProfileCommand) => Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined;
      const fields: Record<string, ZohoFieldValue> = {};
      if (has("introducedBy")) return refuse(me, "field-missing", "Not saved — Zoho has no introducer field on the lead yet (Leads.Introduced_By). Write it as a note.", [id], "Introduced_By");
      if (has("name")) {
        const n = typeof p.name === "string" ? splitName(p.name) : null;
        if (!n) return refuse(me, "name-needed", "Give the investor's name.", [id]);
        fields.First_Name = n.First_Name ?? null;
        fields.Last_Name = n.Last_Name;
      }
      if (has("mobile")) {
        const m = mobileToE164(p.mobile);
        if (!m) return refuse(me, "mobile-invalid", "That mobile number is not valid.", [id]);
        fields.Mobile = m;
      }
      if (has("email")) {
        const e = typeof p.email === "string" ? p.email.trim() : null;
        if (e === null || (e && (!EMAIL.test(e) || e.length > 100))) return refuse(me, "email-invalid", "That email address is not valid.", [id]);
        fields.Email = e || null;
      }
      if (has("city")) {
        const ct = typeof p.city === "string" ? p.city.trim() : null;
        if (ct === null || ct.length > 100) return refuse(me, "invalid-request", "Not saved — the city is too long.", [id]);
        fields.City = ct || null;
      }
      if (has("units")) {
        if (L.Reserved_At) return refuse(me, "units-locked", "The unit count is fixed once the lead is reserved; Finance holds it now.", [id]);
        const u = p.units === "" || p.units === null ? null : Number(p.units);
        if (u !== null && !(Number.isSafeInteger(u) && u >= 1 && u <= 10_000)) return refuse(me, "units-invalid", "Units are a whole number, 1 or more.", [id]);
        fields.Units_Interested = u;
      }
      if (has("contactPreference")) {
        const v = typeof p.contactPreference === "string" ? preferenceOf(p.contactPreference) : undefined;
        if (v === undefined) return refuse(me, "preference-unsupported", "Zoho keeps the preference as Email, WhatsApp or Phone only. Write anything more as a note.", [id]);
        fields.Preferred_Communication = v;
      }
      if (!Object.keys(fields).length) return refuse(me, "nothing-changed", "No details changed.", [id]);
      return write(principal, me, id, expected as string, fields, signal);
    },
  });
}
export type LeadDetails = ReturnType<typeof createLeadDetails>;
