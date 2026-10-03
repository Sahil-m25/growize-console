/**
 * M14-S02-T01 — EVENTS: add, correct and remove one (D45, D48, D53, D59, D68, D84/D85).
 *
 * Every write is the signed-in person's own (D53), after the seat is re-read (`events · edit`: the IR
 * Manager and the super user; an IR is refused). Every field is validated here, in the order the
 * drawer lists its gaps (prototype evGaps): name, dates (end on or after start), city, kind, channel,
 * run status (a run event never goes back to planned), non-negative cost and tablet count, eligible staff.
 *
 * Real names (Zoho, read-only getFields 2026-09-28): Lead_Events (Name, Starts_On, Ends_On, Event_City,
 * Event_Type Society/Club/Partner, Event_Channel MyGate/Direct/Partner, Event_State Planned/Done/Cancelled,
 * Event_Cost, Names_Taken) with its staff on the multi-user lookup Event_Staff, whose rows live in the
 * linking module Lead_Events_X_Users (userlookup221_3 = the user; read side ./events.ts). Leads point at
 * an event with the lookup Leads.Lead_Event — the org has no Leads.Event_Name (the story's wording).
 *
 * A correction is re-read first and written with If-Unmodified-Since, and answers exactly what moved
 * (prototype saveEvent) for the page's "Changed the event" line; Zoho's own audit (Plane A) keeps the
 * record, and Plane B (the client's call line) keeps ids and status only — never a name or a value.
 *
 * Removal (prototype dropEvent) is one job: every tagged lead's Lead_Event is cleared first, each with
 * If-Unmodified-Since, then the event is deleted. If any lead could not be cleared the event is NOT
 * deleted and the answer says how many are left, so a retry finishes the job (a cleared lead no longer
 * matches). The leads keep their owner, stage, source and history; they lose only the event.
 */

import type { ScopedCache } from "../../lib/zoho/cache";
import { isUserCredential, type UserCredential, type ZohoClient, type ZohoFields, type ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { day, idOf, num, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { EVENT_FIELDS, EVENTS_MODULE, STAFF_EVENT, STAFF_MODULE, STAFF_USER } from "./events";

export const EVENT_KINDS = Object.freeze(["Society", "Club", "Partner"] as const);
export const EVENT_CHANNELS = Object.freeze(["MyGate", "Direct", "Partner"] as const);
/** The multi-user lookup on Lead_Events; each entry names the user under the linking module's user field. */
export const STAFF_FIELD = "Event_Staff";
export const MAX_STAFF = 20;
const MAX_COST = 999_999_999;

export interface EventDraft {
  readonly name: string;
  /** YYYY-MM-DD */
  readonly startsOn: string;
  readonly endsOn: string;
  readonly city: string;
  readonly kind: string;
  readonly channel: string;
  readonly state: "planned" | "done";
  /** Whole rupees, ≥ 0. */
  readonly cost: number;
  /** Names taken on the night (the tablet count); only kept once the event has run. */
  readonly namesTaken?: number;
  /** Zoho user ids, in the order they are named (the round-robin order of a sheet load). */
  readonly staffIds: readonly string[];
}

/** Re-derived from the live session on every write (never from the request). */
export interface EventsWriteAccess {
  readonly userId: string;
  /** `events · edit` — the IR Manager and the super user (D68). */
  readonly mayEdit: boolean;
  /** `events · load` — the lead operators (IR, IR Manager) and whoever the policy grants it. */
  readonly mayLoad: boolean;
  /** Users who carry a book and may be named to work an event; null = no roster reader wired (format check only). */
  readonly eligibleStaffIds: readonly string[] | null;
  /** The "Needs an owner" queue user; null = not set up. */
  readonly unassignedQueueUserId: string | null;
}
export interface EventsWriteAuthority {
  recheck(credential: UserCredential, signal?: AbortSignal): Promise<EventsWriteAccess | null>;
}

export type EventGap =
  | "event name" | "valid start date" | "valid end date" | "end date on or after start" | "city" | "event kind"
  | "event channel" | "valid run status" | "non-negative cost" | "non-negative tablet count" | "eligible staff";

export type EventWriteRefusal =
  | "invalid-request" | "session-changed" | "capability-missing" | "not-found" | "gaps" | "conflict" | "confirm-needed" | "source-invalid";

export type Refused = {
  readonly ok: false; readonly kind: "refused"; readonly reasonCode: EventWriteRefusal; readonly reason: string;
  readonly gaps?: readonly EventGap[]; readonly taggedLeads?: number; readonly eventName?: string;
};
export type SourceError = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };
export interface Moved { readonly field: "name" | "kind" | "channel" | "dates" | "city" | "cost" | "staff" | "state" | "namesTaken"; readonly from: string | number | readonly string[] | null; readonly to: string | number | readonly string[] | null }

const REASON: Readonly<Record<EventWriteRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "your seat cannot add or change events (it needs edit on Events)",
  "not-found": "that event is gone, or not yours to open",
  gaps: "the event is not complete",
  conflict: "somebody changed this event since you opened it; reopen it and try again",
  "confirm-needed": "removing an event is confirmed on the page first",
  "source-invalid": "Zoho returned a record this console cannot read",
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const STATE_TO_ZOHO = Object.freeze({ planned: "Planned", done: "Done" } as const);
const STATE_OF: Readonly<Record<string, "planned" | "done" | "cancelled">> = Object.freeze({ Planned: "planned", Done: "done", Cancelled: "cancelled" });

/** A real calendar day (2026-02-30 is not). */
export function isoDay(v: unknown): string | null {
  if (typeof v !== "string" || !DATE.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null;
}
const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const wholeNonNeg = (v: unknown, max = MAX_COST): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

export interface ExistingEvent {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly city: string | null;
  readonly kind: string | null;
  readonly channel: string | null;
  readonly state: "planned" | "done" | "cancelled" | "unknown";
  readonly cost: number | null;
  readonly namesTaken: number | null;
  readonly modifiedTime: string | null;
  /** Staff in named order, with the linking row that holds each. */
  readonly staff: readonly { readonly userId: string; readonly linkId: string }[];
}

/** The drawer's gaps, pure (prototype evGaps). `existing` = the record being corrected, null for a new one. */
export function eventGaps(d: EventDraft, existing: Pick<ExistingEvent, "state" | "staff"> | null, eligible: readonly string[] | null): EventGap[] {
  const g: EventGap[] = [];
  const name = text(d?.name);
  if (name.length < 2 || name.length > 120) g.push("event name");
  const f = isoDay(d?.startsOn), t = isoDay(d?.endsOn);
  if (!f) g.push("valid start date");
  if (!t) g.push("valid end date");
  if (f && t && f > t) g.push("end date on or after start");
  const city = text(d?.city);
  if (!city || city.length > 80) g.push("city");
  if (!(EVENT_KINDS as readonly string[]).includes(d?.kind)) g.push("event kind");
  if (!(EVENT_CHANNELS as readonly string[]).includes(d?.channel)) g.push("event channel");
  if (!(d?.state === "planned" || d?.state === "done") || (existing?.state === "done" && d.state !== "done")) g.push("valid run status");
  if (!wholeNonNeg(d?.cost)) g.push("non-negative cost");
  if (d?.namesTaken !== undefined && !wholeNonNeg(d.namesTaken, 99_999)) g.push("non-negative tablet count");
  const staff = Array.isArray(d?.staffIds) ? d.staffIds : null;
  const already = new Set((existing?.staff ?? []).map((s) => s.userId));
  if (!staff || staff.length > MAX_STAFF || new Set(staff).size !== staff.length
    || staff.some((k) => typeof k !== "string" || !RECORD_ID.test(k) || (eligible !== null && !eligible.includes(k) && !already.has(k)))) {
    g.push("eligible staff");
  }
  return g;
}

/** What moved between the record and the draft, in the order the log line names them (prototype saveEvent). */
export function movedFields(e: ExistingEvent, d: EventDraft, namesTaken: number | null): Moved[] {
  const m: Moved[] = [];
  const name = text(d.name), city = text(d.city);
  if (e.name !== name) m.push({ field: "name", from: e.name, to: name });
  if (e.kind !== d.kind) m.push({ field: "kind", from: e.kind, to: d.kind });
  if (e.channel !== d.channel) m.push({ field: "channel", from: e.channel, to: d.channel });
  if (e.startsOn !== d.startsOn || e.endsOn !== d.endsOn) m.push({ field: "dates", from: `${e.startsOn ?? ""}/${e.endsOn ?? ""}`, to: `${d.startsOn}/${d.endsOn}` });
  if (e.city !== city) m.push({ field: "city", from: e.city, to: city });
  if ((e.cost ?? 0) !== d.cost) m.push({ field: "cost", from: e.cost, to: d.cost });
  const before = e.staff.map((s) => s.userId);
  if (before.join() !== d.staffIds.join()) m.push({ field: "staff", from: Object.freeze(before), to: Object.freeze([...d.staffIds]) });
  if (e.state === "planned" && d.state === "done") m.push({ field: "state", from: "planned", to: "done" });
  if (namesTaken !== null && (e.namesTaken ?? 0) !== namesTaken) m.push({ field: "namesTaken", from: e.namesTaken ?? 0, to: namesTaken });
  return m;
}

export interface EventWriteDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate" | "insert" | "update" | "deleteRecord">;
  readonly authority: EventsWriteAuthority;
  readonly events: InvestorEvents;
  readonly recordIdPrefix: string;
  readonly cache?: Pick<ScopedCache, "invalidate">;
  readonly maxPages?: number;
}

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";

export function createEventWrites(deps: EventWriteDeps) {
  if (!deps || typeof deps.crm?.insert !== "function" || typeof deps.authority?.recheck !== "function" || !/^\d{6,16}$/.test(deps.recordIdPrefix ?? "")) {
    throw new TypeError("Event writes need the Zoho client, the write authority and the CRM record-id prefix.");
  }
  const { crm, authority, events } = deps;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);

  const refuse = (userId: string, action: string, reasonCode: EventWriteRefusal, extra: Partial<Refused> = {}, ids: readonly string[] = []): Refused => {
    events.refusal(userId, action, reasonCode, ids);
    return { ok: false, kind: "refused", reasonCode, reason: REASON[reasonCode], ...extra };
  };
  const srcErr = (errorKind: string): SourceError => ({ ok: false, kind: "source-error", errorKind, retryable: retryable(errorKind) });

  /** Credential check and the live seat: the access, or the answer to send instead. */
  const gate = async (cred: UserCredential, action: string, signal?: AbortSignal): Promise<EventsWriteAccess | Refused | SourceError> => {
    if (!isUserCredential(cred) || !validId(cred.userId)) return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", action, "invalid-request");
    let a: EventsWriteAccess | null;
    try { a = await authority.recheck(cred, signal); } catch { return srcErr("unexpected"); }
    if (!a || a.userId !== cred.userId) return refuse(cred.userId, action, "session-changed");
    if (!a.mayEdit) return refuse(cred.userId, action, "capability-missing");
    return a;
  };
  const isAccess = (v: EventsWriteAccess | Refused | SourceError): v is EventsWriteAccess => "mayEdit" in v;

  /** The event as it stands now, with Modified_Time and its staff links; null = not visible. */
  const readEvent = async (cred: UserCredential, id: string, signal?: AbortSignal): Promise<{ ok: true; event: ExistingEvent | null } | SourceError | Refused> => {
    const r = await pagedSelect(crm, cred, EVENT_FIELDS, EVENTS_MODULE, `id = '${id}'`, "id asc", signal, 1);
    if (!r.ok) return r.kind === "refused" ? refuse(cred.userId, "events-read", "source-invalid", {}, [id]) : srcErr(r.errorKind);
    const rec = r.rows.find((x) => x.id === id);
    if (!rec) return { ok: true, event: null };
    const s = await pagedSelect(crm, cred, ["id", STAFF_EVENT, STAFF_USER], STAFF_MODULE, `${STAFF_EVENT} = '${id}'`, "id asc", signal, deps.maxPages);
    if (!s.ok) return s.kind === "refused" ? refuse(cred.userId, "events-read", "source-invalid", {}, [id]) : srcErr(s.errorKind);
    const staff: { userId: string; linkId: string }[] = [];
    for (const x of s.rows) {
      const user = idOf(x[STAFF_USER]);
      if (idOf(x[STAFF_EVENT]) === id && user && idOf(x.id) && !staff.some((y) => y.userId === user)) staff.push({ userId: user, linkId: x.id });
    }
    return { ok: true, event: toExisting(rec, staff) };
  };

  const taggedCount = async (cred: UserCredential, id: string, signal?: AbortSignal): Promise<number | null> => {
    try {
      const r = await crm.aggregate(cred, `select COUNT(id) from Leads where Lead_Event = '${id}' limit 0, 1`, { signal });
      if (!r.ok) return null;
      const n = r.value[0]?.["COUNT(id)"];
      return typeof n === "number" && n >= 0 ? n : 0;
    } catch { return null; }
  };

  const fieldsOf = (d: EventDraft, staff: ZohoFields[string] | undefined, namesTaken: number | null): ZohoFields => ({
    Name: text(d.name), Starts_On: d.startsOn, Ends_On: d.endsOn, Event_City: text(d.city), Event_Type: d.kind,
    Event_Channel: d.channel, Event_State: STATE_TO_ZOHO[d.state], Event_Cost: d.cost,
    ...(namesTaken !== null ? { Names_Taken: namesTaken } : {}),
    ...(staff !== undefined ? { [STAFF_FIELD]: staff } : {}),
  });

  return Object.freeze({
    /** Add an event to the diary. */
    async create(cred: UserCredential, draft: EventDraft, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly value: { readonly eventId: string; readonly name: string; readonly startsOn: string; readonly endsOn: string; readonly city: string; readonly staffIds: readonly string[]; readonly state: "planned" | "done" } } | Refused | SourceError
    > {
      const a = await gate(cred, "event-add", signal);
      if (!isAccess(a)) return a;
      if (!draft || typeof draft !== "object") return refuse(cred.userId, "event-add", "invalid-request");
      const gaps = eventGaps(draft, null, a.eligibleStaffIds);
      if (gaps.length) return refuse(cred.userId, "event-add", "gaps", { gaps: Object.freeze(gaps) });
      const staff = draft.staffIds.map((u) => ({ [STAFF_USER]: { id: u } }));
      const namesTaken = draft.state === "done" ? draft.namesTaken ?? 0 : null;
      let res: Awaited<ReturnType<typeof crm.insert>>;
      try { res = await crm.insert(cred, EVENTS_MODULE, [fieldsOf(draft, staff, namesTaken)], { signal }); } catch { return srcErr("unexpected"); }
      // A create is never retried: a lost reply may have landed.
      if (!res.ok) return { ok: false, kind: "source-error", errorKind: res.error.kind, retryable: false };
      const out = res.value[0];
      if (!out?.ok || !validId(out.id)) return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: false };
      return { ok: true, value: Object.freeze({ eventId: out.id, name: text(draft.name), startsOn: draft.startsOn, endsOn: draft.endsOn, city: text(draft.city), staffIds: Object.freeze([...draft.staffIds]), state: draft.state }) };
    },

    /** Correct an event: exactly what moved, never run → planned. `seenModifiedTime` = what the page loaded (optional). */
    async update(cred: UserCredential, id: string, draft: EventDraft, seenModifiedTime?: string | null, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly value: { readonly eventId: string; readonly name: string; readonly moved: readonly Moved[]; readonly taggedStay: number | null; readonly modifiedTime: string | null } } | Refused | SourceError
    > {
      const a = await gate(cred, "event-change", signal);
      if (!isAccess(a)) return a;
      if (!validId(id) || !draft || typeof draft !== "object" || (seenModifiedTime != null && !ZDT.test(seenModifiedTime))) return refuse(cred.userId, "event-change", "invalid-request");
      const r = await readEvent(cred, id, signal);
      if (!r.ok) return r;
      const e = r.event;
      if (!e) return refuse(cred.userId, "event-change", "not-found", {}, [id]);
      if (seenModifiedTime && e.modifiedTime && seenModifiedTime !== e.modifiedTime) {
        events.conflict(cred.userId, "event-change", id);
        return { ok: false, kind: "refused", reasonCode: "conflict", reason: REASON.conflict };
      }
      const gaps = eventGaps(draft, e, a.eligibleStaffIds);
      if (gaps.length) return refuse(cred.userId, "event-change", "gaps", { gaps: Object.freeze(gaps) }, [id]);
      const tagged = await taggedCount(cred, id, signal);
      const ran = e.state === "done" || draft.state === "done";
      // The names taken on the night are never fewer than the leads tagged to it (prototype: max(off, tag)).
      const namesTaken = ran ? Math.max(draft.namesTaken ?? e.namesTaken ?? 0, tagged ?? 0) : null;
      const moved = movedFields(e, draft, namesTaken);
      if (!moved.length) return { ok: true, value: { eventId: id, name: e.name, moved: Object.freeze([]), taggedStay: tagged, modifiedTime: e.modifiedTime } };
      let staff: ZohoFields[string] | undefined;
      if (moved.some((m) => m.field === "staff")) {
        const now = new Set(draft.staffIds), had = new Set(e.staff.map((s) => s.userId));
        staff = [
          ...draft.staffIds.filter((u) => !had.has(u)).map((u) => ({ [STAFF_USER]: { id: u } })),
          ...e.staff.filter((s) => !now.has(s.userId)).map((s) => ({ id: s.linkId, _delete: null })),
        ];
      }
      let res: Awaited<ReturnType<typeof crm.update>>;
      try { res = await crm.update(cred, EVENTS_MODULE, id, fieldsOf(draft, staff, namesTaken), { ifUnmodifiedSince: e.modifiedTime, signal }); } catch { return srcErr("unexpected"); }
      if (!res.ok) {
        if (res.error.kind === "conflict") {
          events.conflict(cred.userId, "event-change", id);
          return { ok: false, kind: "refused", reasonCode: "conflict", reason: REASON.conflict };
        }
        return srcErr(res.error.kind);
      }
      return { ok: true, value: { eventId: id, name: text(draft.name), moved: Object.freeze(moved), taggedStay: tagged, modifiedTime: res.value.modifiedTime } };
    },

    /** Take an event out of the diary. Without `confirmed: true` nothing is written; the answer carries the tagged count for the in-page confirmation. */
    async remove(cred: UserCredential, id: string, confirmed: boolean, signal?: AbortSignal): Promise<
      | { readonly ok: true; readonly value: { readonly eventId: string; readonly name: string; readonly leadsUntagged: number } }
      | { readonly ok: false; readonly kind: "incomplete"; readonly eventId: string; readonly cleared: number; readonly left: number; readonly reason: string }
      | Refused | SourceError
    > {
      const a = await gate(cred, "event-remove", signal);
      if (!isAccess(a)) return a;
      if (!validId(id)) return refuse(cred.userId, "event-remove", "invalid-request");
      const r = await readEvent(cred, id, signal);
      if (!r.ok) return r;
      if (!r.event) return refuse(cred.userId, "event-remove", "not-found", {}, [id]);
      const leads = await pagedSelect(crm, cred, ["id", "Modified_Time"], "Leads", `Lead_Event = '${id}'`, "id asc", signal, deps.maxPages);
      if (!leads.ok) return leads.kind === "refused" ? refuse(cred.userId, "event-remove", "source-invalid", {}, [id]) : srcErr(leads.errorKind);
      const ids = leads.rows.filter((x) => validId(x.id));
      if (confirmed !== true) {
        return { ok: false, kind: "refused", reasonCode: "confirm-needed", reason: REASON["confirm-needed"], taggedLeads: ids.length, eventName: r.event.name };
      }
      // The same job: clear the pointer on every tagged lead, then delete the event (prototype commit()).
      let cleared = 0;
      for (const l of ids) {
        const mt = typeof l.Modified_Time === "string" && ZDT.test(l.Modified_Time) ? l.Modified_Time : null;
        let u: Awaited<ReturnType<typeof crm.update>> | null = null;
        try { u = await crm.update(cred, "Leads", l.id, { Lead_Event: null }, { ifUnmodifiedSince: mt, signal }); } catch { u = null; }
        if (u?.ok) cleared++;
      }
      if (cleared < ids.length || leads.truncated) {
        events.refusal(cred.userId, "event-remove", "leads-not-cleared", [id]);
        return { ok: false, kind: "incomplete", eventId: id, cleared, left: ids.length - cleared, reason: "some leads still name this event; the event was not removed — try again" };
      }
      let d: Awaited<ReturnType<typeof crm.deleteRecord>>;
      try { d = await crm.deleteRecord(cred, EVENTS_MODULE, id, { signal }); } catch { return srcErr("unexpected"); }
      if (!d.ok) return srcErr(d.error.kind);
      if (deps.cache) await deps.cache.invalidate({ scope: { kind: "user", userId: cred.userId } }).catch(() => 0);
      return { ok: true, value: { eventId: id, name: r.event.name, leadsUntagged: cleared } };
    },
  });
}
export type EventWrites = ReturnType<typeof createEventWrites>;

function toExisting(r: ZohoRecord, staff: readonly { userId: string; linkId: string }[]): ExistingEvent {
  const mt = typeof r.Modified_Time === "string" && ZDT.test(r.Modified_Time) ? r.Modified_Time : null;
  return Object.freeze({
    id: r.id, name: str(r, "Name", 120) ?? "", startsOn: day(str(r, "Starts_On", 20)), endsOn: day(str(r, "Ends_On", 20)),
    city: str(r, "Event_City", 80), kind: str(r, "Event_Type", 30), channel: str(r, "Event_Channel", 30),
    state: STATE_OF[str(r, "Event_State", 20) ?? ""] ?? "unknown", cost: num(r, "Event_Cost"), namesTaken: num(r, "Names_Taken"),
    modifiedTime: mt, staff: Object.freeze(staff.map((s) => Object.freeze({ ...s }))),
  });
}
