/**
 * M07-S03 — save a follow-up on the last tap, recorded once, with a 10-second Undo.
 *
 * One save is: the Lead's next-step and touch stamps (written FIRST, with If-Unmodified-Since, so a
 * record changed since the form read it is refused before anything is created — nothing is ever
 * written twice), then one Touch (D76: the contact log), then the scheduled Task closed when this
 * contact completed it, then the next step as a Task, Call or Meeting (D58). Zoho has no
 * transaction, so a failure after the Lead write takes back what was written; if even that fails
 * the refusal names every record id in Plane B for a person to repair.
 *
 * Undo is a signed token, not server state: it names exactly what this save created and the Lead
 * values it replaced, for this person and this sign-in, and it dies ten seconds after the save.
 * Every write is the person's own (D53); Zoho's record audit (Plane A) holds the history (D47).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";
import { LEADS_MODULE } from "./capture";

export const UNDO_WINDOW_MS = 10_000;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export type ContactChannel = "msg" | "email" | "call" | "visit" | "reply" | "other";
export type NextChannel = "msg" | "email" | "call" | "visit" | "other";
const TOUCH_CHANNEL: Readonly<Record<string, string>> = { msg: "WhatsApp", email: "Email", call: "Call", visit: "Farm visit" };
const NEXT_CHANNEL: Readonly<Record<string, string | null>> = { msg: "WhatsApp", email: "Email", call: "Call", visit: "Farm visit", other: null };
const CONSENT: Readonly<Record<string, string>> = { msg: "Consent_WhatsApp", email: "Consent_Email", call: "Consent_Call", visit: "Consent_Visit" };
const ACTIVITY_MODULES: ReadonlySet<string> = new Set(["Tasks", "Calls", "Events"]);
/** The Lead fields a follow-up may change, and so the ones Undo restores. */
const STAMPS = ["Next_Step", "Next_Step_At", "Next_Step_Channel", "Last_Reply_At", "First_Touch_At", "Lost_At", "Lost_Reason"] as const;
const GUARD_FIELDS = [...STAMPS, "Modified_Time", "Created_Time", "Lost_At", "Onboarded_At", "Owner", "Secondary_Owner",
  "Cover_By", "Cover_Until", "Consent_WhatsApp", "Consent_Email", "Consent_Call", "Consent_Visit", "Reserved_At", "Fully_Paid_At"];
/** The eight reasons (prototype LOSTWHY) and the value Zoho's Lost_Reason picklist holds for each. */
export const LOST_REASONS: Readonly<Record<string, string>> = Object.freeze({
  "Price too high": "Price too high", "Went cold — no reply": "Went cold - no reply", "Lock-in too long": "Lock-in too long",
  "Timing — not now": "Timing - not now", "Yield not convincing": "Yield not convincing", "KYC / FEMA blocked": "KYC / FEMA blocked",
  "Bought somewhere else": "Bought somewhere else", "Never a real prospect": "Never a real prospect",
});
/** Only these answers lead to "Why are they out?" (D57). */
const LOSS_OUTCOMES: ReadonlySet<string> = new Set(["Not interested", "Wrong number"]);

/** D58: which Zoho record a next step becomes, by the action picked (the prototype's NEXTS). */
export function activityFor(next: { readonly text: string; readonly at: string }, leadId: string): { readonly module: "Calls" | "Events" | "Tasks"; readonly row: ZohoFields } {
  const subject = next.text.trim();
  const what = { What_Id: { id: leadId }, $se_module: LEADS_MODULE };
  if (/^(call back|onboarding call)/i.test(subject)) {
    // A scheduled call with the 15-minute reminder D58 asks for; Zoho's call reporting counts it.
    return { module: "Calls", row: { Subject: subject, Call_Type: "Outbound", Call_Start_Time: next.at, Reminder: "15 mins", ...what } };
  }
  if (/^(office meeting|farm visit)/i.test(subject)) {
    // Meetings are the only activity Zoho Calendar syncs (once the org admin turns the sync on).
    return { module: "Events", row: { Event_Title: subject, Start_DateTime: next.at,
      End_DateTime: zohoTime(Date.parse(next.at) + 3_600_000), Participants: [{ type: "lead", participant: leadId }], ...what } };
  }
  // Everything else saves on the day, with no time.
  return { module: "Tasks", row: { Subject: subject, Due_Date: zohoTime(Date.parse(next.at)).slice(0, 10), Status: "Not Started", ...what } };
}

export interface FollowupAccess {
  readonly actor: SeatedZohoUser;
  readonly mayRecordFollowup: boolean;
  /** Owners whose leads this person may work as a manager; empty for an IR. */
  readonly teamOwnerIds: readonly string[];
}
export interface FollowupAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<FollowupAccess | null>;
}

export interface FollowupCommand {
  readonly leadId: string;
  readonly expectedModifiedTime: string;
  readonly contact: {
    readonly channel: ContactChannel;
    /** What happened, in the flow's words ("Reply received", "No answer"…). */
    readonly outcome: string;
    readonly occurredAt: string;
    /** Call answered / visit held: only a reached contact is a touch. */
    readonly reached: boolean;
    readonly note?: string;
  };
  /** The open next-step activity the form showed, or null. */
  readonly scheduled: { readonly module: "Tasks" | "Calls" | "Events"; readonly id: string } | null;
  readonly complete: boolean;
  readonly keep: boolean;
  readonly next: { readonly text: string; readonly at: string; readonly channel: NextChannel } | null;
  /** Close as lost in the same save (one of LOST_REASONS). */
  readonly lost?: { readonly reason: string } | null;
}

export type FollowupRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "not-in-book"
  | "lead-changed" | "no-consent" | "contact-in-future" | "contact-before-capture" | "choose-complete-or-keep"
  | "nothing-to-keep" | "scheduled-changed" | "next-step-needed" | "next-step-in-past" | "undo-expired" | "undo-invalid"
  | "source-invalid" | "followup-partial" | "lead-lost" | "money-in" | "loss-not-offered" | "not-lost" | "nothing-to-reschedule";
export type FollowupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: FollowupRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON: Readonly<Record<FollowupRefusal, string>> = Object.freeze({
  "invalid-request": "the follow-up is incomplete",
  "session-changed": "the sign-in session changed",
  "capability-missing": "this seat cannot record follow-ups",
  "not-visible": "the lead is unavailable",
  "not-in-book": "this lead is not in your book",
  "lead-changed": "the lead changed in Zoho since it was opened — review it and save again",
  "no-consent": "there is no contact permission for that channel",
  "contact-in-future": "record contact after it happens; the contact time cannot be in the future",
  "contact-before-capture": "the contact cannot be earlier than this investor was captured",
  "choose-complete-or-keep": "choose whether this follow-up completed the scheduled task, or keep the appointment",
  "nothing-to-keep": "the appointment is no longer on this investor",
  "scheduled-changed": "the scheduled task changed while this form was open",
  "next-step-needed": "active investors need a dated next step; keep the appointment or set the next step",
  "next-step-in-past": "the next step needs a time that is still ahead",
  "undo-expired": "Undo is no longer offered",
  "undo-invalid": "this Undo does not match a save of yours",
  "source-invalid": "Zoho returned an invalid record",
  "followup-partial": "the follow-up could not be completed and could not be fully taken back; it has been reported",
  "lead-lost": "this lead is closed as lost; only Re-open is available",
  "money-in": "money has come in on this lead, so it is not a loss but a refund or forfeit with Finance",
  "loss-not-offered": "closing as lost follows only 'Not interested' or 'Wrong number', with one of the eight reasons",
  "not-lost": "this lead is not closed as lost",
  "nothing-to-reschedule": "this lead has no dated next step to move",
});

export interface FollowupDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert" | "deleteRecord">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** HMAC key for Undo tokens, at least 32 characters, from the server's secret store. */
  readonly undoSecret: string;
  readonly clock?: () => number;
}

type Snapshot = Readonly<Record<(typeof STAMPS)[number], string | null>>;
interface UndoClaims {
  readonly v: 1; readonly actor: string; readonly session: string; readonly lead: string; readonly exp: number;
  readonly leadModified: string; readonly snapshot: Snapshot;
  readonly created: readonly { readonly module: string; readonly id: string }[];
  readonly reopened: string | null;
  /** Activity fields a reschedule moved, put back by Undo. */
  readonly restore?: readonly { readonly module: string; readonly id: string; readonly fields: Readonly<Record<string, string>> }[];
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);

export function createFollowups(deps: FollowupDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.deleteRecord !== "function" || typeof deps.access?.recheck !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)
    || typeof deps.undoSecret !== "string" || deps.undoSecret.length < 32) {
    throw new TypeError("Follow-ups need crm get/update/insert/delete, the access authority, the ops log, the record-id prefix and a 32+ character Undo secret.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = <T>(userId: string, code: FollowupRefusal, ids: readonly string[] = []): FollowupResult<T> => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-followup", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  const zoho = <T>(k: ZohoFailureKind | "unexpected"): FollowupResult<T> => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: false });
  const sign = (c: UndoClaims): string => {
    const body = Buffer.from(JSON.stringify(c)).toString("base64url");
    return `${body}.${createHmac("sha256", deps.undoSecret).update(body).digest("base64url")}`;
  };
  const verify = (token: unknown): UndoClaims | null => {
    if (typeof token !== "string" || token.length > 8_000) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac) return null;
    const want = createHmac("sha256", deps.undoSecret).update(body).digest();
    const got = Buffer.from(mac, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UndoClaims; } catch { return null; }
  };

  const principalOk = (p: { credential: UserCredential; sessionId: string } | undefined): p is { credential: UserCredential; sessionId: string } =>
    !!p && isUserCredential(p.credential) && validId(p.credential.userId) && typeof p.sessionId === "string" && SESSION_ID.test(p.sessionId);
  const recheck = async (p: { credential: UserCredential; sessionId: string }, signal?: AbortSignal): Promise<FollowupAccess | FollowupResult<never>> => {
    try {
      const a = await access.recheck(p.credential, p.sessionId, signal);
      if (!a || a.actor?.userId !== p.credential.userId) return refuse(p.credential.userId, "session-changed");
      if (!a.mayRecordFollowup) return refuse(p.credential.userId, "capability-missing");
      return a;
    } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
    }
  };

  /** Takes back what a save wrote, newest first. Returns the ids it could not take back. */
  const takeBack = async (cred: UserCredential, lead: string, leadModified: string | null, snapshot: Snapshot | null,
    created: readonly { module: string; id: string }[], reopened: string | null, signal?: AbortSignal): Promise<string[]> => {
    const failed: string[] = [];
    for (const c of [...created].reverse()) {
      try { const r = await crm.deleteRecord(cred, c.module, c.id, { signal }); if (!r.ok) failed.push(c.id); } catch { failed.push(c.id); }
    }
    if (reopened) {
      try { const r = await crm.update(cred, "Tasks", reopened, { Status: "Not Started" }, { ifUnmodifiedSince: null, signal }); if (!r.ok) failed.push(reopened); } catch { failed.push(reopened); }
    }
    if (snapshot && leadModified) {
      try {
        const r = await crm.update(cred, LEADS_MODULE, lead, { ...snapshot }, { ifUnmodifiedSince: leadModified, signal });
        if (!r.ok) failed.push(lead);
      } catch { failed.push(lead); }
    }
    return failed;
  };

  return Object.freeze({
    async save(principal: { credential: UserCredential; sessionId: string }, c: FollowupCommand, signal?: AbortSignal)
      : Promise<FollowupResult<{ readonly touchId: string | null; readonly nextId: string | null; readonly undoToken: string; readonly undoUntil: number }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      // ---- shape
      const ch = c?.contact?.channel;
      const outcome = text(c?.contact?.outcome, 80);
      const note = c?.contact?.note === undefined || c.contact.note === "" ? null : text(c.contact.note, 1_800);
      if (!c || !validId(c.leadId) || typeof c.expectedModifiedTime !== "string" || !DATETIME.test(c.expectedModifiedTime)
        || !["msg", "email", "call", "visit", "reply", "other"].includes(ch as string) || !outcome
        || typeof c.contact.occurredAt !== "string" || !DATETIME.test(c.contact.occurredAt) || typeof c.contact.reached !== "boolean"
        || (c.contact.note !== undefined && c.contact.note !== "" && !note) || typeof c.complete !== "boolean" || typeof c.keep !== "boolean"
        || (c.scheduled !== null && (!c.scheduled || !ACTIVITY_MODULES.has(c.scheduled.module) || !validId(c.scheduled.id)))
        || (c.next !== null && (!c.next || !text(c.next.text, 200) || typeof c.next.at !== "string" || !DATETIME.test(c.next.at)
          || !(c.next.channel in NEXT_CHANNEL)))
        || (c.keep && c.next !== null) || (c.complete && !c.scheduled)
        || (c.lost !== undefined && c.lost !== null && (typeof c.lost !== "object" || c.next !== null || c.keep))) {
        return refuse(me, "invalid-request", validId(c?.leadId) ? [c.leadId] : []);
      }
      const now = clock();
      const occurred = Date.parse(c.contact.occurredAt);
      if (occurred > now) return refuse(me, "contact-in-future", [c.leadId]);
      if (c.next && Date.parse(c.next.at) <= now) return refuse(me, "next-step-in-past", [c.leadId]);

      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;

      // ---- the lead as it is now
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, c.leadId, { fields: GUARD_FIELDS, signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [c.leadId]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== c.leadId) return refuse(me, "not-visible", [c.leadId]);
      const L = got.value as ZohoRecord;
      if (L.Modified_Time !== c.expectedModifiedTime) return refuse(me, "lead-changed", [c.leadId]);
      const owner = idOf(L.Owner), today = zohoTime(now).slice(0, 10);
      const inBook = owner === me /* D44: a named secondary is dormant; only a live cover admits (server/leads/cover.ts) */
        || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
        || (owner !== null && a.teamOwnerIds.includes(owner));
      if (!inBook) return refuse(me, "not-in-book", [c.leadId]);
      if (typeof L.Created_Time === "string" && occurred < Date.parse(L.Created_Time)) return refuse(me, "contact-before-capture", [c.leadId]);
      const consentFor = (k: string) => !CONSENT[k] || L[CONSENT[k]] === true;
      if (!consentFor(ch) || (c.next && c.next.channel !== "other" && !consentFor(c.next.channel))) return refuse(me, "no-consent", [c.leadId]);
      const hasNext = L.Next_Step_At !== null && L.Next_Step_At !== undefined;
      if (c.scheduled && !c.keep && !c.complete) return refuse(me, "choose-complete-or-keep", [c.leadId]);
      if (c.keep && !hasNext) return refuse(me, "nothing-to-keep", [c.leadId]);
      if (L.Lost_At) return refuse(me, "lead-lost", [c.leadId]);
      const losing = !!c.lost;
      if (losing) {
        if (!LOSS_OUTCOMES.has(outcome) || !LOST_REASONS[c.lost!.reason]) return refuse(me, "loss-not-offered", [c.leadId]);
        if (L.Reserved_At || L.Fully_Paid_At) return refuse(me, "money-in", [c.leadId]);
      }
      const active = !L.Onboarded_At && !losing;
      if (active && !c.keep && !c.next) return refuse(me, "next-step-needed", [c.leadId]);
      if (c.scheduled) {
        let s: Awaited<ReturnType<typeof crm.getRecord>>;
        try { s = await crm.getRecord(cred, c.scheduled.module, c.scheduled.id, { fields: ["What_Id"], signal }); } catch { return zoho("unexpected"); }
        if (!s.ok || !s.value || idOf(s.value.What_Id) !== c.leadId) return refuse(me, "scheduled-changed", [c.leadId, c.scheduled.id]);
      }

      // ---- what changes on the lead
      const snapshot = Object.fromEntries(STAMPS.map((k) => [k, typeof L[k] === "string" ? L[k] as string : null])) as Snapshot;
      const inbound = ch === "reply" || outcome === "Reply received";
      const humanTouch = !inbound && (ch === "msg" || ch === "email" || ((ch === "call" || ch === "visit") && c.contact.reached));
      const leadFields: Record<string, ZohoFields[string]> = { Next_Step: snapshot.Next_Step };
      if (c.next) Object.assign(leadFields, { Next_Step: c.next.text.trim(), Next_Step_At: c.next.at, Next_Step_Channel: NEXT_CHANNEL[c.next.channel] });
      else if (!c.keep && c.complete) Object.assign(leadFields, { Next_Step: null, Next_Step_At: null, Next_Step_Channel: null });
      if (losing) Object.assign(leadFields, { Next_Step: null, Next_Step_At: null, Next_Step_Channel: null,
        Lost_At: zohoTime(now), Lost_Reason: LOST_REASONS[c.lost!.reason] });
      if (inbound) leadFields.Last_Reply_At = c.contact.occurredAt;
      if (humanTouch && !snapshot.First_Touch_At) leadFields.First_Touch_At = c.contact.occurredAt;

      const b = await recheck(principal, signal);
      if (!("actor" in b)) return b;

      // ---- 1. the lead, guarded: a 412 here means nothing has been written
      let put: Awaited<ReturnType<typeof crm.update>>;
      try { put = await crm.update(cred, LEADS_MODULE, c.leadId, leadFields, { ifUnmodifiedSince: c.expectedModifiedTime, signal }); } catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [c.leadId]) : zoho(put.error.kind);
      let leadModified = put.value.modifiedTime;

      const created: { module: string; id: string }[] = [];
      let reopened: string | null = null;
      const fail = async (): Promise<FollowupResult<never>> => {
        const left = await takeBack(cred, c.leadId, leadModified, snapshot, created, reopened, signal);
        if (left.length) return refuse(me, "followup-partial", [c.leadId, ...left]);
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false };
      };
      const insertOne = async (module: string, row: ZohoFields): Promise<string | null> => {
        try {
          const r = await crm.insert(cred, module, [row], { signal });
          const o = r.ok && r.value.length === 1 ? r.value[0] : null;
          if (!o || !o.ok || !validId(o.id)) return null;
          created.push({ module, id: o.id });
          return o.id;
        } catch { return null; }
      };

      // ---- 2. the touch (a completed task with no contact is not one)
      let touchId: string | null = null;
      if (ch !== "other") {
        touchId = await insertOne("Touches", {
          Name: `${TOUCH_CHANNEL[ch] ?? "Reply"} ${c.contact.occurredAt}`,
          Lead: { id: c.leadId },
          ...(TOUCH_CHANNEL[ch] ? { Channel: TOUCH_CHANNEL[ch] } : {}),
          Occurred_At: c.contact.occurredAt,
          Is_Reply: inbound,
          Note: note ? `${outcome} — ${note}` : outcome,
        });
        if (!touchId) return fail();
      }
      // ---- 3. the scheduled task this contact completed
      if (c.complete && c.scheduled?.module === "Tasks") {
        try {
          const r = await crm.update(cred, "Tasks", c.scheduled.id, { Status: "Completed" }, { ifUnmodifiedSince: null, signal });
          if (!r.ok) return fail();
          reopened = c.scheduled.id;
        } catch { return fail(); }
      }
      // ---- 4. the next step as the Zoho record D58 names
      let nextId: string | null = null;
      if (c.next) {
        const act = activityFor(c.next, c.leadId);
        nextId = await insertOne(act.module, act.row);
        if (!nextId) return fail();
      }
      if (!leadModified || !DATETIME.test(leadModified)) leadModified = null;
      const undoUntil = clock() + UNDO_WINDOW_MS;
      const undoToken = sign({ v: 1, actor: me, session: principal.sessionId, lead: c.leadId, exp: undoUntil,
        leadModified: leadModified ?? "", snapshot, created, reopened });
      return { ok: true, value: { touchId, nextId, undoToken, undoUntil } };
    },

    /** Re-open a lead closed as lost. The close stays in the record's history (Zoho's audit keeps
     *  the Lost_At and Lost_Reason it had); a next step comes back only if one is given and ahead. */
    async reopen(principal: { credential: UserCredential; sessionId: string }, leadId: string, expectedModifiedTime: string,
      next: FollowupCommand["next"], signal?: AbortSignal): Promise<FollowupResult<{ readonly modifiedTime: string | null }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      if (!validId(leadId) || typeof expectedModifiedTime !== "string" || !DATETIME.test(expectedModifiedTime)
        || (next !== null && (!next || !text(next.text, 200) || typeof next.at !== "string" || !DATETIME.test(next.at) || !(next.channel in NEXT_CHANNEL)))) {
        return refuse(me, "invalid-request", validId(leadId) ? [leadId] : []);
      }
      if (next && Date.parse(next.at) <= clock()) return refuse(me, "next-step-in-past", [leadId]);
      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: GUARD_FIELDS, signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", [leadId]);
      const L = got.value as ZohoRecord;
      if (L.Modified_Time !== expectedModifiedTime) return refuse(me, "lead-changed", [leadId]);
      if (!L.Lost_At) return refuse(me, "not-lost", [leadId]);
      const owner = idOf(L.Owner), today = zohoTime(clock()).slice(0, 10);
      const inBook = owner === me /* D44: a named secondary is dormant; only a live cover admits (server/leads/cover.ts) */
        || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
        || (owner !== null && a.teamOwnerIds.includes(owner));
      if (!inBook) return refuse(me, "not-in-book", [leadId]);
      if (next && next.channel !== "other" && L[CONSENT[next.channel]] !== true) return refuse(me, "no-consent", [leadId]);
      const fields: Record<string, ZohoFields[string]> = { Lost_At: null, Lost_Reason: null };
      if (next) Object.assign(fields, { Next_Step: next.text.trim(), Next_Step_At: next.at, Next_Step_Channel: NEXT_CHANNEL[next.channel] });
      let put: Awaited<ReturnType<typeof crm.update>>;
      try { put = await crm.update(cred, LEADS_MODULE, leadId, fields, { ifUnmodifiedSince: expectedModifiedTime, signal }); } catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [leadId]) : zoho(put.error.kind);
      return { ok: true, value: { modifiedTime: put.value.modifiedTime } };
    },

    /** Move the dated next step by whole days, keeping its time, on the Lead and on the Zoho record
     *  D58 made for it (a Call's start moves with its reminder; a Meeting's start and end; a Task's
     *  due date). Undo puts both back for ten seconds. */
    async reschedule(principal: { credential: UserCredential; sessionId: string }, leadId: string, expectedModifiedTime: string,
      activity: { readonly module: "Tasks" | "Calls" | "Events"; readonly id: string } | null, days: number, signal?: AbortSignal)
      : Promise<FollowupResult<{ readonly nextStepAt: string; readonly undoToken: string; readonly undoUntil: number }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const cred = principal.credential, me = cred.userId;
      if (!validId(leadId) || typeof expectedModifiedTime !== "string" || !DATETIME.test(expectedModifiedTime)
        || !Number.isSafeInteger(days) || days < 1 || days > 366
        || (activity !== null && (!activity || !ACTIVITY_MODULES.has(activity.module) || !validId(activity.id)))) {
        return refuse(me, "invalid-request", validId(leadId) ? [leadId] : []);
      }
      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: GUARD_FIELDS, signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", [leadId]);
      const L = got.value as ZohoRecord;
      if (L.Modified_Time !== expectedModifiedTime) return refuse(me, "lead-changed", [leadId]);
      if (L.Lost_At) return refuse(me, "lead-lost", [leadId]);
      const owner = idOf(L.Owner), today = zohoTime(clock()).slice(0, 10);
      const inBook = owner === me /* D44: a named secondary is dormant; only a live cover admits (server/leads/cover.ts) */
        || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
        || (owner !== null && a.teamOwnerIds.includes(owner));
      if (!inBook) return refuse(me, "not-in-book", [leadId]);
      if (typeof L.Next_Step_At !== "string" || !DATETIME.test(L.Next_Step_At)) return refuse(me, "nothing-to-reschedule", [leadId]);
      const shift = (t: string) => zohoTime(Date.parse(t) + days * 86_400_000);
      const moved = shift(L.Next_Step_At);

      // The activity, as it is now, and the fields that move.
      let restore: { module: string; id: string; fields: Record<string, string> }[] = [];
      let change: Record<string, string> | null = null;
      if (activity) {
        const fields = activity.module === "Calls" ? ["Call_Start_Time", "What_Id"] : activity.module === "Events" ? ["Start_DateTime", "End_DateTime", "What_Id"] : ["Due_Date", "What_Id"];
        let act: Awaited<ReturnType<typeof crm.getRecord>>;
        try { act = await crm.getRecord(cred, activity.module, activity.id, { fields, signal }); } catch { return zoho("unexpected"); }
        if (!act.ok || !act.value || idOf(act.value.What_Id) !== leadId) return refuse(me, "scheduled-changed", [leadId, activity.id]);
        const v = act.value;
        const was: Record<string, string> = {};
        change = {};
        for (const f of fields.filter((f) => f !== "What_Id")) {
          const cur = v[f];
          if (typeof cur !== "string") return refuse(me, "source-invalid", [activity.id]);
          was[f] = cur;
          change[f] = f === "Due_Date" ? zohoTime(Date.parse(`${cur}T12:00:00+05:30`) + days * 86_400_000).slice(0, 10) : shift(cur);
        }
        restore = [{ module: activity.module, id: activity.id, fields: was }];
      }
      const snapshot = Object.fromEntries(STAMPS.map((k) => [k, typeof L[k] === "string" ? L[k] as string : null])) as Snapshot;
      let put: Awaited<ReturnType<typeof crm.update>>;
      try { put = await crm.update(cred, LEADS_MODULE, leadId, { Next_Step_At: moved }, { ifUnmodifiedSince: expectedModifiedTime, signal }); } catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [leadId]) : zoho(put.error.kind);
      if (activity && change) {
        let ok = false;
        try { ok = (await crm.update(cred, activity.module, activity.id, change, { ifUnmodifiedSince: null, signal })).ok; } catch { ok = false; }
        if (!ok) {
          const left = await takeBack(cred, leadId, put.value.modifiedTime, snapshot, [], null, signal);
          if (left.length) return refuse(me, "followup-partial", [leadId, ...left]);
          return zoho("unexpected");
        }
      }
      const undoUntil = clock() + UNDO_WINDOW_MS;
      const undoToken = sign({ v: 1, actor: me, session: principal.sessionId, lead: leadId, exp: undoUntil,
        leadModified: put.value.modifiedTime ?? "", snapshot, created: [], reopened: null, restore });
      return { ok: true, value: { nextStepAt: moved, undoToken, undoUntil } };
    },

    async undo(principal: { credential: UserCredential; sessionId: string }, token: string, signal?: AbortSignal): Promise<FollowupResult<{ readonly undone: true }>> {
      if (!principalOk(principal)) return refuse("unrecognised", "invalid-request");
      const me = principal.credential.userId;
      const claims = verify(token);
      if (!claims || claims.v !== 1 || claims.actor !== me || claims.session !== principal.sessionId || !validId(claims.lead)) {
        return refuse(me, "undo-invalid");
      }
      if (clock() > claims.exp) return refuse(me, "undo-expired", [claims.lead]);
      const a = await recheck(principal, signal);
      if (!("actor" in a)) return a;
      if (!claims.leadModified) return refuse(me, "lead-changed", [claims.lead]);
      // The lead is restored first and only if nobody touched it since the save.
      let put: Awaited<ReturnType<typeof crm.update>>;
      try {
        put = await crm.update(principal.credential, LEADS_MODULE, claims.lead, { ...claims.snapshot }, { ifUnmodifiedSince: claims.leadModified, signal });
      } catch { return zoho("unexpected"); }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [claims.lead]) : zoho(put.error.kind);
      const left = await takeBack(principal.credential, claims.lead, null, null, claims.created, claims.reopened, signal);
      for (const r of claims.restore ?? []) {
        if (!ACTIVITY_MODULES.has(r.module) || !validId(r.id)) { left.push(String(r.id)); continue; }
        try {
          const back = await crm.update(principal.credential, r.module, r.id, { ...r.fields }, { ifUnmodifiedSince: null, signal });
          if (!back.ok) left.push(r.id);
        } catch { left.push(r.id); }
      }
      if (left.length) return refuse(me, "followup-partial", [claims.lead, ...left]);
      return { ok: true, value: { undone: true } };
    },
  });
}
