/**
 * D132 — THE INVESTORS-SIDE CARE WRITES that used to change only the browser's copy (client-only saves):
 *   logContact   a KAM's conversation       → one Touch (D76: the one contact log, linked to Contacts.Origin_Lead)
 *                                              + Contacts.KAM_Intro_At the first time the account's own KAM logs one
 *   saveDetails  the investor's own details → Contacts.Mobile / Email / Mailing_City / Nominee_Name / Nominee_Relation
 *   decideKyc    Compliance passes or fails → Contacts.KYC ("Completed" | "Failed") + KYC_Completed_On;
 *                                              a failure's reason as a Note on the Contact (there is no reason field)
 *
 * Every write is on the signed-in person's own token (D53); Zoho's sharing and field-level security still scope it
 * (KYC and KYC_Completed_On are writable only by the Compliance profile — zoho/access/spec.json "identity" group).
 * One guarded write unit per press, as server/investors/kam-assign:
 *   1. the right is re-derived from the live session before anything is read (`authority.allow`: the Investors-side
 *      capability — care / details / kyc — and whether the seat is held to its own book, i.e. a KAM);
 *   2. the command's shape;
 *   3. the Contact as it is now (id, KAM, Origin_Lead, KAM_Intro_At, Residency, Modified_Time), which must still carry
 *      the version the person saw (409 otherwise); a KAM only on an account whose Contacts.KAM is them (prototype
 *      mayCare / mayDetails / logContactGate);
 *   4. the write, with If-Unmodified-Since on every Contact update (D44: a newer change is never overwritten).
 * Not written, and why (no field in the sandbox schema; D132 lists them for an owner decision): the "next contact"
 * override (no Contacts next-contact field), the conversation's mood as its own field (no verified Touches.Mood: it
 * rides in the Note, as objections do in C1), the name (a name change also opens a bank re-match ticket the owner has
 * not routed), the address (six Mailing_* fields; one free-text line cannot be split back without inventing a parse).
 * Identity values are never read: the KYC preconditions (a PAN, and an Aadhaar reference unless non-resident) are
 * asked as COQL presence tests (`is not null`), so no PAN or Aadhaar value reaches this process, a log or an answer
 * (rule 7). Refusals are logged by id and code only (Plane B, InvestorEvents.refusal).
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { idOf, str } from "../data/contact-row";
import { recordConflict, type RecordConflict } from "./record";

export type CareCap = "care" | "details" | "kyc";
export interface CareGrant {
  /** The console seat token (kam, comp, amlead, di …). */
  readonly seat: string;
  /** The seat is held to its own book (a KAM): it may write only on an account whose Contacts.KAM is the person. */
  readonly ownBook: boolean;
}
export interface CareAuthority {
  /** The grant when the live session holds `cap` on the Investors side, else null. */
  allow(credential: UserCredential, sessionId: string, cap: CareCap, signal?: AbortSignal): Promise<CareGrant | null>;
}
export interface CarePrincipal { readonly credential: UserCredential; readonly sessionId: string }

export type CareRefusal =
  | "invalid-request" | "seat-denied" | "not-visible" | "not-yours" | "not-allotted" | "no-origin-lead"
  | "no-pan" | "no-aadhaar" | "nothing-to-change";
/** HTTP status per refusal (the route answers with these; a refusal is never "not found" — the guard's rule). */
export const CARE_STATUS: Readonly<Record<CareRefusal, number>> = Object.freeze({
  "invalid-request": 400, "seat-denied": 403, "not-visible": 403, "not-yours": 403, "not-allotted": 422,
  "no-origin-lead": 422, "no-pan": 422, "no-aadhaar": 422, "nothing-to-change": 422,
});
export const CARE_TEXT: Readonly<Record<CareRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved — the request is incomplete.",
  "seat-denied": "Not saved — this seat does not do that.",
  "not-visible": "This investor is not part of your book.",
  "not-yours": "Not saved — this is another manager's account. Details and conversations are recorded by whoever holds the account.",
  "not-allotted": "Not saved — only an allotted account is under care.",
  "no-origin-lead": "Not saved — this investor has no origin lead, so the conversation has nowhere to be filed.",
  "no-pan": "There is no PAN on this record. KYC cannot pass without one.",
  "no-aadhaar": "No Aadhaar verification reference on this record.",
  "nothing-to-change": "Nothing to save — no detail was changed.",
});

export type CareResult<V> =
  | { readonly ok: true; readonly value: V }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: CareRefusal }
  | RecordConflict
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export const CARE_CONTACT_FIELDS = Object.freeze(["id", "KAM", "Origin_Lead", "KAM_Intro_At", "Residency", "Modified_Time"]);
export const CARE_CHANNELS = Object.freeze({ call: "Call", visit: "Farm visit", email: "Email", msg: "WhatsApp" } as const);
export const CARE_MOODS = Object.freeze({ good: "Warm", ok: "Fine", concern: "A concern" } as const);
/** What a details save may write, by the drawer's key (DETF), and the Contacts field it goes to. */
export const DETAIL_FIELDS = Object.freeze({ ph: "Mobile", em: "Email", city: "Mailing_City", nominee: "Nominee_Name" } as const);
export type DetailKey = keyof typeof DETAIL_FIELDS;

const RECORD_ID = /^\d{15,22}$/;
const ZOHO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ()-]{6,24}$/;
const IST_MS = 5.5 * 3_600_000;
/** A Zoho datetime in Asia/Kolkata (rule 9). */
export const istStamp = (ms: number): string => new Date(ms + IST_MS).toISOString().slice(0, 19) + "+05:30";
const istDay = (ms: number): string => new Date(ms + IST_MS).toISOString().slice(0, 10);
const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return t.length <= max ? t : null;
};
const objectBody = (b: unknown): Record<string, unknown> | null => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null);
/** Non-resident, read the way the record reads it (server/data/live investorOf). Residency is not an identity field. */
const nonResident = (r: ZohoRecord): boolean => { const v = str(r, "Residency", 40); return !!v && /non|nri/i.test(v); };

/* ---- commands ------------------------------------------------------------------------------------------------- */
export interface ContactCommand {
  readonly contactId: string; readonly expectedModifiedTime: string;
  readonly channel: keyof typeof CARE_CHANNELS; readonly mood: keyof typeof CARE_MOODS; readonly note: string;
}
export interface DetailsCommand {
  readonly contactId: string; readonly expectedModifiedTime: string;
  readonly changes: Readonly<Partial<Record<DetailKey, string>>>;
}
export interface KycCommand {
  readonly contactId: string; readonly expectedModifiedTime: string;
  readonly result: "passed" | "failed"; readonly why: string | null;
}

const only = (b: Record<string, unknown>, keys: readonly string[]) => Object.keys(b).every((k) => keys.includes(k));
const version = (v: unknown): v is string => typeof v === "string" && ZOHO_DT.test(v) && !Number.isNaN(Date.parse(v));

export function parseContactCommand(contactId: unknown, body: unknown): ContactCommand | null {
  const b = objectBody(body);
  if (typeof contactId !== "string" || !RECORD_ID.test(contactId) || !b || !only(b, ["expectedModifiedTime", "channel", "mood", "note"])) return null;
  const note = b.note === undefined ? "" : clean(b.note, 1_800);
  if (!version(b.expectedModifiedTime) || typeof b.channel !== "string" || !Object.hasOwn(CARE_CHANNELS, b.channel)
    || typeof b.mood !== "string" || !Object.hasOwn(CARE_MOODS, b.mood) || note === null) return null;
  return Object.freeze({ contactId, expectedModifiedTime: b.expectedModifiedTime, channel: b.channel as ContactCommand["channel"], mood: b.mood as ContactCommand["mood"], note });
}

export function parseDetailsCommand(contactId: unknown, body: unknown): DetailsCommand | null {
  const b = objectBody(body);
  if (typeof contactId !== "string" || !RECORD_ID.test(contactId) || !b || !only(b, ["expectedModifiedTime", "changes"])) return null;
  const ch = objectBody(b.changes);
  if (!version(b.expectedModifiedTime) || !ch || !Object.keys(ch).length || !Object.keys(ch).every((k) => Object.hasOwn(DETAIL_FIELDS, k))) return null;
  const out: Partial<Record<DetailKey, string>> = {};
  for (const [k, v] of Object.entries(ch)) {
    const t = clean(v, k === "em" ? 254 : 120);
    if (t === null) return null;
    if (k !== "nominee" && !t) return null;                   /* the prototype: only the nominee may be cleared */
    if (k === "em" && !EMAIL.test(t)) return null;
    if (k === "ph" && !PHONE.test(t)) return null;
    out[k as DetailKey] = t;
  }
  return Object.freeze({ contactId, expectedModifiedTime: b.expectedModifiedTime, changes: Object.freeze(out) });
}

export function parseKycCommand(contactId: unknown, body: unknown): KycCommand | null {
  const b = objectBody(body);
  if (typeof contactId !== "string" || !RECORD_ID.test(contactId) || !b || !only(b, ["expectedModifiedTime", "result", "why"])) return null;
  if (!version(b.expectedModifiedTime) || (b.result !== "passed" && b.result !== "failed")) return null;
  const why = b.why === undefined || b.why === null ? null : clean(b.why, 200);
  if (b.why !== undefined && b.why !== null && !why) return null;
  return Object.freeze({ contactId, expectedModifiedTime: b.expectedModifiedTime, result: b.result, why: b.result === "failed" ? why || "Documents do not match" : null });
}

/** "Name (Relation)" — the record's own display of the nominee (server/data/contact-row) — back to its two fields. */
export function nomineeFields(v: string): { Nominee_Name: string | null; Nominee_Relation?: string | null } {
  if (!v) return { Nominee_Name: null, Nominee_Relation: null };
  const m = /^(.*\S)\s*\(([^()]{1,60})\)$/.exec(v);
  return m ? { Nominee_Name: m[1]!, Nominee_Relation: m[2]!.trim() } : { Nominee_Name: v };
}

/* ---- results ---------------------------------------------------------------------------------------------------- */
export interface ContactLogged { readonly contactId: string; readonly touchId: string; readonly introduced: boolean; readonly modifiedTime: string | null }
export interface DetailsSaved { readonly contactId: string; readonly fields: readonly string[]; readonly modifiedTime: string | null }
export interface KycDecided { readonly contactId: string; readonly kyc: "passed" | "failed"; readonly on: string; readonly noteId: string | null; readonly modifiedTime: string | null }

export interface CareDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert" | "coql">;
  readonly authority: CareAuthority;
  readonly events: InvestorEvents;
  readonly clock?: () => number;
}

export function createInvestorCare(deps: CareDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.coql !== "function" || typeof deps.authority?.allow !== "function" || typeof deps.events?.refusal !== "function") {
    throw new TypeError("Investor care needs crm get/update/insert/coql, the care authority and the investor events.");
  }
  const { crm, events } = deps;
  const clock = deps.clock ?? Date.now;
  const refuse = <V>(me: string, action: string, reason: CareRefusal, ids: readonly string[]): CareResult<V> => {
    events.refusal(me, action, reason, ids.filter((x) => RECORD_ID.test(x)));
    return Object.freeze({ ok: false as const, kind: "refused" as const, reason });
  };
  const source = <V>(errorKind: string): CareResult<V> => Object.freeze({ ok: false as const, kind: "source-error" as const, errorKind });

  /** Steps 1–3, shared: the grant, the shape, the Contact as it is now and the version the person saw. */
  async function admit<V>(p: CarePrincipal, action: string, cap: CareCap, cmd: { contactId: string; expectedModifiedTime: string } | null,
    rawId: unknown, signal?: AbortSignal): Promise<{ ok: true; me: string; grant: CareGrant; rec: ZohoRecord; version: string } | { ok: false; r: CareResult<V> }> {
    const me = p.credential.userId;
    const id = typeof rawId === "string" ? rawId : "";
    let grant: CareGrant | null;
    try { grant = await deps.authority.allow(p.credential, p.sessionId, cap, signal); } catch { return { ok: false, r: source("unexpected") }; }
    if (!grant) return { ok: false, r: refuse(me, action, "seat-denied", [id]) };
    if (!cmd) return { ok: false, r: refuse(me, action, "invalid-request", [id]) };
    let got: Awaited<ReturnType<typeof crm.getRecord>>;
    try { got = await crm.getRecord(p.credential, "Contacts", cmd.contactId, { fields: CARE_CONTACT_FIELDS, signal }); } catch { return { ok: false, r: source("unexpected") }; }
    if (!got.ok) {
      if (got.error.kind === "not-found" || got.error.kind === "forbidden") return { ok: false, r: refuse(me, action, "not-visible", [cmd.contactId]) };
      return { ok: false, r: source(got.error.kind) };
    }
    const rec = got.value && got.value.id === cmd.contactId ? got.value : null;
    const v = rec ? str(rec, "Modified_Time", 40) : null;
    if (!rec || !v) return { ok: false, r: refuse(me, action, "not-visible", [cmd.contactId]) };
    if (grant.ownBook && idOf(rec.KAM) !== me) return { ok: false, r: refuse(me, action, "not-yours", [cmd.contactId]) };
    if (v !== cmd.expectedModifiedTime) {
      return { ok: false, r: recordConflict(events, me, action, { kind: "conflict", status: 412, code: "ALREADY_MODIFIED", recordId: cmd.contactId })! };
    }
    return { ok: true, me, grant, rec, version: v };
  }

  /** A guarded Contact update: a 412 is the in-page conflict, anything else a source error. */
  async function guardedUpdate<V>(p: CarePrincipal, me: string, action: string, id: string, fields: ZohoFields, since: string, signal?: AbortSignal)
    : Promise<{ ok: true; modifiedTime: string | null } | { ok: false; r: CareResult<V> }> {
    let w: Awaited<ReturnType<typeof crm.update>>;
    try { w = await crm.update(p.credential, "Contacts", id, fields, { ifUnmodifiedSince: since, signal }); } catch { return { ok: false, r: source("unexpected") }; }
    if (!w.ok) {
      const c = recordConflict(events, me, action, w.error);
      return { ok: false, r: c ?? source(w.error.kind) };
    }
    if (w.value.id !== id) return { ok: false, r: refuse(me, action, "not-visible", [id]) };
    return { ok: true, modifiedTime: w.value.modifiedTime };
  }

  /** COQL presence test on this one Contact: true when `cond` holds. Only the id is selected, never the field's value. */
  async function holds(p: CarePrincipal, id: string, cond: string, signal?: AbortSignal): Promise<boolean | { errorKind: string }> {
    let r: Awaited<ReturnType<typeof crm.coql>>;
    try { r = await crm.coql(p.credential, `select id from Contacts where (id = '${id}' and ${cond}) limit 0, 1`, { signal }); } catch { return { errorKind: "unexpected" }; }
    if (!r.ok) return { errorKind: r.error.kind };
    return r.value.records.some((x) => x.id === id);
  }

  return Object.freeze({
    /** logContact: one Touch on the investor's origin lead; the first one the account's own KAM logs stamps KAM_Intro_At. */
    async logContact(p: CarePrincipal, rawId: unknown, body: unknown, signal?: AbortSignal): Promise<CareResult<ContactLogged>> {
      const action = "investor-contact";
      const cmd = parseContactCommand(rawId, body);
      const a = await admit<ContactLogged>(p, action, "care", cmd, rawId, signal);
      if (!a.ok) return a.r;
      const { me, rec } = a; const c = cmd!;
      const lead = idOf(rec.Origin_Lead);
      if (!lead || !RECORD_ID.test(lead)) return refuse(me, action, "no-origin-lead", [c.contactId]);
      // D12 (prototype cared()): only an allotted account is under care — the AM book's rule, as kam-assign asks it.
      let al: Awaited<ReturnType<typeof crm.coql>>;
      try {
        al = await crm.coql(p.credential,
          `select id, Customer from LLP_UnitAllocation_Module where (Customer = '${c.contactId}' and Allocation_Status = 'Issued') limit 0, 1`, { signal });
      } catch { return source("unexpected"); }
      if (!al.ok) return source(al.error.kind);
      if (!al.value.records.some((x) => idOf(x.Customer) === c.contactId)) return refuse(me, action, "not-allotted", [c.contactId]);

      const at = istStamp(clock());
      // 1. the introduction, guarded, BEFORE the insert: a 412 here means nothing has been written
      const introduce = idOf(rec.KAM) === me && !str(rec, "KAM_Intro_At", 40);
      let modifiedTime: string | null = a.version;
      if (introduce) {
        const u = await guardedUpdate<ContactLogged>(p, me, action, c.contactId, { KAM_Intro_At: at }, a.version, signal);
        if (!u.ok) return u.r;
        modifiedTime = u.modifiedTime;
      }
      // 2. the touch (D76): channel, when, and the words — the mood rides in the Note (no verified Touches.Mood field)
      const words = CARE_MOODS[c.mood] + (c.note ? " — " + c.note : "");
      let touchId: string | null = null; let failKind = "unexpected";
      try {
        const r = await crm.insert(p.credential, "Touches", [{
          Name: `${CARE_CHANNELS[c.channel]} ${at}`, Lead: { id: lead }, Channel: CARE_CHANNELS[c.channel], Occurred_At: at, Is_Reply: false, Note: words,
        }], { signal });
        if (!r.ok) failKind = r.error.kind;
        const o = r.ok && r.value.length === 1 ? r.value[0] : null;
        touchId = o && o.ok && typeof o.id === "string" && RECORD_ID.test(o.id) ? o.id : null;
      } catch { touchId = null; }
      if (!touchId) {
        // take the introduction back (an update: a human token holds no Delete); nothing else was written
        if (introduce && modifiedTime) {
          try { await crm.update(p.credential, "Contacts", c.contactId, { KAM_Intro_At: null }, { ifUnmodifiedSince: modifiedTime, signal }); } catch { /* the failure is reported below */ }
        }
        return source(failKind);
      }
      return { ok: true, value: Object.freeze({ contactId: c.contactId, touchId, introduced: introduce, modifiedTime }) };
    },

    /** saveDetails: the fields the investor asked to change, in one guarded update. */
    async saveDetails(p: CarePrincipal, rawId: unknown, body: unknown, signal?: AbortSignal): Promise<CareResult<DetailsSaved>> {
      const action = "investor-details";
      const cmd = parseDetailsCommand(rawId, body);
      const a = await admit<DetailsSaved>(p, action, "details", cmd, rawId, signal);
      if (!a.ok) return a.r;
      const c = cmd!;
      let fields: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(c.changes) as [DetailKey, string][]) {
        if (k === "nominee") fields = { ...fields, ...nomineeFields(v) };
        else fields[DETAIL_FIELDS[k]] = v;
      }
      if (!Object.keys(fields).length) return refuse(a.me, action, "nothing-to-change", [c.contactId]);
      const u = await guardedUpdate<DetailsSaved>(p, a.me, action, c.contactId, fields, a.version, signal);
      if (!u.ok) return u.r;
      return { ok: true, value: Object.freeze({ contactId: c.contactId, fields: Object.freeze(Object.keys(fields)), modifiedTime: u.modifiedTime }) };
    },

    /** passKyc / failKyc: Contacts.KYC and KYC_Completed_On (Compliance's own fields); a failure's reason as a Note. */
    async decideKyc(p: CarePrincipal, rawId: unknown, body: unknown, signal?: AbortSignal): Promise<CareResult<KycDecided>> {
      const action = "investor-kyc";
      const cmd = parseKycCommand(rawId, body);
      const a = await admit<KycDecided>(p, action, "kyc", cmd, rawId, signal);
      if (!a.ok) return a.r;
      const c = cmd!, me = a.me;
      if (c.result === "passed") {
        // presence tests only — no PAN or Aadhaar value is ever selected (rule 7)
        const pan = await holds(p, c.contactId, "PAN_Number is not null", signal);
        if (typeof pan === "object") return source(pan.errorKind);
        if (!pan) return refuse(me, action, "no-pan", [c.contactId]);
        if (!nonResident(a.rec)) {
          const ref = await holds(p, c.contactId, "Aadhaar_Ref is not null", signal);
          if (typeof ref === "object") return source(ref.errorKind);
          if (!ref) return refuse(me, action, "no-aadhaar", [c.contactId]);
        }
      }
      const on = istDay(clock());
      const u = await guardedUpdate<KycDecided>(p, me, action, c.contactId,
        { KYC: c.result === "passed" ? "Completed" : "Failed", KYC_Completed_On: on }, a.version, signal);
      if (!u.ok) return u.r;
      let noteId: string | null = null;
      if (c.result === "failed" && c.why) {
        try {
          const r = await crm.insert(p.credential, "Notes", [{
            Note_Title: "KYC failed", Note_Content: c.why, Parent_Id: { module: { api_name: "Contacts" }, id: c.contactId },
          }], { signal });
          const o = r.ok && r.value.length === 1 ? r.value[0] : null;
          noteId = o && o.ok && typeof o.id === "string" ? o.id : null;
        } catch { noteId = null; }
      }
      return { ok: true, value: Object.freeze({ contactId: c.contactId, kyc: c.result, on, noteId, modifiedTime: u.modifiedTime }) };
    },
  });
}
export type InvestorCare = ReturnType<typeof createInvestorCare>;
