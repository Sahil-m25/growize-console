/**
 * M14-S03-T01 — THE EVENT SHEET LOADER: the tablet sheet of one run event, loaded once (D45, D53, D59, D60, D84).
 *
 * Rows come from the intake sheet through an injected reader (PROVISIONAL, jev decide 0.95: until a
 * Google/Zoho Sheet reader is wired, the page posts the rows it parsed, like the CSV import) and are
 * re-checked here with the import's own rules (../leads/import checkRows: name, mobile, email, units,
 * duplicate in the file). The intake form asks WhatsApp and Call; a row without both is refused.
 *
 * De-dupe: each number is asked of Zoho first on the loader's own token (COQL Mobile in (…), ≤100
 * values a call), and whatever that token cannot see is stopped at the write by Zoho's duplicate check
 * on Mobile (DUPLICATE_DATA) — both count as "skipped as duplicates"; which record holds a number is never
 * passed on. Rows land with Lead_Source Events, the event lookup Leads.Lead_Event (the org has no
 * Event_Name/Event_Date/Event_Channel on Leads: the date and channel are read through the lookup), the
 * consent the sheet recorded (Consent_How "Event sheet"), and an owner by the rule chosen:
 *   round-robin — across the event's staff in the order they are named (Lead_Events_X_Users, id order)
 *   me · one person (named; an IR's pick is the event's staff) · unassigned (the queue user)
 * Inserts go 100 per call on the person's own token.
 *
 * Once per event: Lead_Events.Load_State must be Ready. The loader claims the sheet first — Load_State
 * Loaded with Loaded_By/Loaded_At, written with If-Unmodified-Since so two loads racing cannot both pass —
 * then inserts, then writes Rows_In_File/Rows_Loaded/Rows_Duplicate/Rows_Refused. If nothing could be
 * inserted for a Zoho failure, the claim is handed back (Ready) so the sheet can be loaded again.
 */

import type { ScopedCache } from "../../lib/zoho/cache";
import { isUserCredential, MAX_UPSERT_RECORDS, type UserCredential, type ZohoClient, type ZohoFields } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { checkRows, MAX_IMPORT_ROWS, type ImportRow } from "../leads/import";
import { LEADS_MODULE } from "../leads/capture";
import { idOf, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { EVENTS_MODULE, STAFF_EVENT, STAFF_MODULE, STAFF_USER } from "./events";
import type { EventsWriteAuthority } from "./writes";

/** One intake row as the sheet holds it. */
export interface SheetRow extends ImportRow {
  readonly consent?: { readonly msg?: boolean; readonly call?: boolean; readonly email?: boolean };
}
export interface IntakeReader {
  rows(eventId: string, signal?: AbortSignal): Promise<readonly SheetRow[] | null>;
}
/** The rule the card offers. Round-robin staff are read from the event, never taken from the request. */
export type SheetRule =
  | { readonly kind: "round-robin" }
  | { readonly kind: "me" }
  | { readonly kind: "one"; readonly ownerId: string | null }
  | { readonly kind: "unassigned" };

export type LoadRefusal =
  | "invalid-request" | "session-changed" | "capability-missing" | "not-found" | "event-not-run" | "sheet-not-ready"
  | "already-loaded" | "owner-missing" | "owner-not-assignable" | "no-staff" | "unassigned-queue-missing" | "too-many-rows" | "no-rows" | "source-invalid";

export type LoadRowVerdict =
  | { readonly row: number; readonly status: "added"; readonly leadId: string; readonly ownerId: string | null }
  | { readonly row: number; readonly status: "duplicate" }
  | { readonly row: number; readonly status: "refused"; readonly reason: "name" | "mobile" | "email" | "units" | "consent" | "duplicate-in-file" | "zoho" };

export interface LoadSummary {
  readonly eventId: string;
  readonly rule: SheetRule["kind"];
  readonly inFile: number;
  readonly loaded: number;
  readonly duplicates: number;
  readonly refused: number;
  /** Who was dealt how many, in named order (round-robin) — the card's split and one "Assigned owner" line per lead. */
  readonly split: readonly { readonly ownerId: string | null; readonly count: number }[];
  readonly assigned: readonly { readonly leadId: string; readonly ownerId: string }[];
  readonly rows: readonly LoadRowVerdict[];
  /** false when the counts could not be written back to the event (the leads are in; the card may read stale counts). */
  readonly countsSaved: boolean;
}

export type LoadResult =
  | { readonly ok: true; readonly value: LoadSummary }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: LoadRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const REASON: Readonly<Record<LoadRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "Your seat does not load event sheets; the IR team or Marketing do.",
  "not-found": "that event is gone, or not yours to open",
  "event-not-run": "a sheet loads once the event has run",
  "sheet-not-ready": "the sheet is not ready to load",
  "already-loaded": "A sheet loads once.",
  "owner-missing": "choose who carries the new leads",
  "owner-not-assignable": "that person cannot be given these leads",
  "no-staff": "nobody is named to work this event, so there is no one to deal to",
  "unassigned-queue-missing": "the unassigned queue is not set up in Zoho yet",
  "too-many-rows": `a sheet holds at most ${MAX_IMPORT_ROWS} rows`,
  "no-rows": "the sheet could not be read",
  "source-invalid": "Zoho returned a record this console cannot read",
});

const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
/** The last ten digits of an Indian number, else the digits: the key a stored spelling is matched on. */
export const phoneKey = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const d = v.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d || null;
};
/** Spellings a stored number may carry (as duplicate.ts mobileClause), four per Indian number. */
export const spellings = (e164: string): string[] => {
  if (!e164.startsWith("+91")) return [e164, e164.slice(1)];
  const ten = e164.slice(3);
  return [e164, e164.slice(1), ten, "0" + ten];
};

export interface LoaderDeps {
  readonly crm: Pick<ZohoClient, "coql" | "insert" | "update">;
  readonly authority: EventsWriteAuthority;
  readonly events: InvestorEvents;
  readonly recordIdPrefix: string;
  readonly cache?: Pick<ScopedCache, "invalidate">;
  readonly clock?: () => number;
  readonly maxPages?: number;
}

export function createSheetLoader(deps: LoaderDeps) {
  if (!deps || typeof deps.crm?.insert !== "function" || typeof deps.authority?.recheck !== "function" || !/^\d{6,16}$/.test(deps.recordIdPrefix ?? "")) {
    throw new TypeError("The sheet loader needs the Zoho client, the write authority and the CRM record-id prefix.");
  }
  const { crm, authority, events } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: LoadRefusal, ids: readonly string[] = []): LoadResult => {
    events.refusal(userId, "event-sheet-load", reasonCode, ids);
    return { ok: false, kind: "refused", reasonCode, reason: REASON[reasonCode] };
  };
  const srcErr = (k: string): LoadResult => ({ ok: false, kind: "source-error", errorKind: k, retryable: retryable(k) });

  /** Which numbers the loader's own token already sees on the book (last-ten keys). */
  const onBook = async (cred: UserCredential, e164s: readonly string[], signal?: AbortSignal): Promise<Set<string> | LoadResult> => {
    const seen = new Set<string>();
    const PER = 25; // 4 spellings each → ≤100 values in one IN
    for (let i = 0; i < e164s.length; i += PER) {
      const values = e164s.slice(i, i + PER).flatMap(spellings);
      const r = await pagedSelect(crm, cred, ["id", "Mobile"], LEADS_MODULE, `Mobile in (${values.map((v) => `'${v}'`).join(", ")})`, "id asc", signal, deps.maxPages);
      if (!r.ok) return r.kind === "refused" ? refuse(cred.userId, "source-invalid") : srcErr(r.errorKind);
      for (const x of r.rows) { const k = phoneKey(x.Mobile); if (k) seen.add(k); }
    }
    return seen;
  };

  return Object.freeze({
    async load(cred: UserCredential, eventId: string, rule: SheetRule, intake: IntakeReader, signal?: AbortSignal): Promise<LoadResult> {
      if (!isUserCredential(cred) || !validId(cred.userId)) return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      const me = cred.userId;
      if (!validId(eventId) || !rule || typeof rule !== "object" || !["round-robin", "me", "one", "unassigned"].includes(rule.kind)) return refuse(me, "invalid-request");
      let a;
      try { a = await authority.recheck(cred, signal); } catch { return srcErr("unexpected"); }
      if (!a || a.userId !== me) return refuse(me, "session-changed");
      if (!a.mayLoad) return refuse(me, "capability-missing", [eventId]);
      // "All to one person" without the person: Load is disabled on the card, and refused here.
      if (rule.kind === "one" && !rule.ownerId) return refuse(me, "owner-missing");

      const ev = await pagedSelect(crm, cred, ["id", "Name", "Event_City", "Event_State", "Load_State", "Modified_Time"], EVENTS_MODULE, `id = '${eventId}'`, "id asc", signal, 1);
      if (!ev.ok) return ev.kind === "refused" ? refuse(me, "source-invalid", [eventId]) : srcErr(ev.errorKind);
      const rec = ev.rows.find((x) => x.id === eventId);
      if (!rec) return refuse(me, "not-found", [eventId]);
      if (str(rec, "Event_State", 20) !== "Done") return refuse(me, "event-not-run", [eventId]);
      const loadState = str(rec, "Load_State", 20);
      if (loadState === "Loaded") return refuse(me, "already-loaded", [eventId]);
      if (loadState !== "Ready") return refuse(me, "sheet-not-ready", [eventId]);
      const eventMt = typeof rec.Modified_Time === "string" && ZDT.test(rec.Modified_Time) ? rec.Modified_Time : null;
      const eventCity = str(rec, "Event_City", 80);

      const st = await pagedSelect(crm, cred, ["id", STAFF_EVENT, STAFF_USER], STAFF_MODULE, `${STAFF_EVENT} = '${eventId}'`, "id asc", signal, deps.maxPages);
      if (!st.ok) return st.kind === "refused" ? refuse(me, "source-invalid", [eventId]) : srcErr(st.errorKind);
      const staff: string[] = [];
      for (const x of st.rows) { const u = idOf(x[STAFF_USER]); if (u && idOf(x[STAFF_EVENT]) === eventId && !staff.includes(u)) staff.push(u); }

      let ownerFor: (i: number) => string | null;
      if (rule.kind === "me") ownerFor = () => me;
      else if (rule.kind === "one") {
        const to = rule.ownerId as string;
        let may = validId(to) && (to === me || staff.includes(to) || (a.eligibleStaffIds?.includes(to) ?? false));
        if (!may && validId(to) && authority.staffCheck) {
          // Not on the event's staff: a roster-eligible person (in today, carries a book) may still take the sheet (M14-S03-NOTE-1).
          const today = new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 10);
          let v: Awaited<ReturnType<NonNullable<typeof authority.staffCheck>>>;
          try { v = await authority.staffCheck(cred, [to], today, today, signal); } catch { return srcErr("unexpected"); }
          if (!v.ok) return srcErr(v.errorKind);
          may = v.refused.length === 0;
        }
        if (!may) return refuse(me, "owner-not-assignable", [eventId]);
        ownerFor = () => to;
      } else if (rule.kind === "round-robin") {
        if (!staff.length) return refuse(me, "no-staff", [eventId]);
        ownerFor = (i) => staff[i % staff.length];
      } else {
        if (!validId(a.unassignedQueueUserId)) return refuse(me, "unassigned-queue-missing", [eventId]);
        ownerFor = () => null;
      }

      let rows: readonly SheetRow[] | null;
      try { rows = await intake.rows(eventId, signal); } catch { rows = null; }
      if (!Array.isArray(rows)) return refuse(me, "no-rows", [eventId]);
      if (rows.length > MAX_IMPORT_ROWS) return refuse(me, "too-many-rows", [eventId]);

      const verdicts: LoadRowVerdict[] = [];
      const { good, refused } = checkRows(rows);
      for (const r of refused) if (r.status === "refused" && r.reason !== "duplicate-on-book" && r.reason !== "zoho") verdicts.push({ row: r.row, status: "refused", reason: r.reason });
      const consented = good.filter((g) => {
        const c = rows![g.row]?.consent;
        if (c?.msg === true && c?.call === true) return true;
        verdicts.push({ row: g.row, status: "refused", reason: "consent" });
        return false;
      });
      const seen = await onBook(cred, consented.map((g) => g.fields.Mobile as string), signal);
      if (!(seen instanceof Set)) return seen;
      const fresh = consented.filter((g) => {
        if (!seen.has(phoneKey(g.fields.Mobile) ?? "")) return true;
        verdicts.push({ row: g.row, status: "duplicate" });
        return false;
      });

      // Claim the sheet: only one load passes (If-Unmodified-Since on the event's Modified_Time).
      const at = zohoTime(clock());
      let claim: Awaited<ReturnType<typeof crm.update>>;
      try { claim = await crm.update(cred, EVENTS_MODULE, eventId, { Load_State: "Loaded", Loaded_By: { id: me }, Loaded_At: at }, { ifUnmodifiedSince: eventMt, signal }); } catch { return srcErr("unexpected"); }
      if (!claim.ok) {
        if (claim.error.kind === "conflict") { events.conflict(me, "event-sheet-load", eventId); return refuse(me, "already-loaded", [eventId]); }
        return srcErr(claim.error.kind);
      }

      const planned = fresh.map((g, i) => ({ ...g, ownerId: ownerFor(i) }));
      let zohoFailures = 0;
      for (let i = 0; i < planned.length; i += MAX_UPSERT_RECORDS) {
        const batch = planned.slice(i, i + MAX_UPSERT_RECORDS);
        const records: ZohoFields[] = batch.map((p) => ({
          ...p.fields, ...(p.fields.City === undefined && eventCity ? { City: eventCity } : {}),
          Lead_Source: "Events", Lead_Event: { id: eventId },
          Owner: { id: p.ownerId ?? (a!.unassignedQueueUserId as string) },
          ...(p.ownerId ? { Owner_Assigned_At: at } : {}),
          Consent_WhatsApp: true, Consent_Call: true,
          ...(rows![p.row]?.consent?.email === true && p.fields.Email ? { Consent_Email: true } : {}),
          Consent_How: "Event sheet", Consent_At: at, Consent_By: { id: me },
        }));
        let res: Awaited<ReturnType<typeof crm.insert>> | null = null;
        try { res = await crm.insert(cred, LEADS_MODULE, records, { signal }); } catch { res = null; }
        const outcomes = res && (res.ok ? res.value : res.error.kind === "partial" ? res.error.records : null);
        batch.forEach((p, k) => {
          const o = outcomes?.[k];
          if (o && o.ok && validId(o.id)) verdicts.push({ row: p.row, status: "added", leadId: o.id, ownerId: p.ownerId });
          else if (o && o.code === "DUPLICATE_DATA") verdicts.push({ row: p.row, status: "duplicate" });
          else { zohoFailures++; verdicts.push({ row: p.row, status: "refused", reason: "zoho" }); }
        });
      }
      verdicts.sort((x, y) => x.row - y.row);
      const added = verdicts.filter((v): v is Extract<LoadRowVerdict, { status: "added" }> => v.status === "added");
      const duplicates = verdicts.filter((v) => v.status === "duplicate").length;

      // Nothing landed because Zoho failed: hand the claim back so the sheet can be loaded again.
      const handBack = added.length === 0 && zohoFailures > 0;
      const counts: ZohoFields = handBack
        ? { Load_State: "Ready", Loaded_By: null, Loaded_At: null }
        : { Rows_In_File: rows.length, Rows_Loaded: added.length, Rows_Duplicate: duplicates, Rows_Refused: verdicts.length - added.length - duplicates };
      let saved = false;
      try { saved = (await crm.update(cred, EVENTS_MODULE, eventId, counts, { ifUnmodifiedSince: claim.value.modifiedTime, signal })).ok; } catch { saved = false; }
      if (handBack) return srcErr("insert-failed");

      if (deps.cache) {
        const owners = new Set<string>([me, ...added.map((v) => v.ownerId ?? (a!.unassignedQueueUserId as string))]);
        await Promise.all([...owners].map((userId) => deps.cache!.invalidate({ scope: { kind: "user", userId } }).catch(() => 0)));
      }
      const split = new Map<string | null, number>();
      if (rule.kind === "round-robin") for (const s of staff) split.set(s, 0);
      for (const v of added) split.set(v.ownerId, (split.get(v.ownerId) ?? 0) + 1);
      return {
        ok: true,
        value: Object.freeze({
          eventId, rule: rule.kind, inFile: rows.length, loaded: added.length, duplicates, refused: verdicts.length - added.length - duplicates,
          split: Object.freeze([...split.entries()].map(([ownerId, count]) => Object.freeze({ ownerId, count }))),
          // One "Assigned owner" line per dealt lead: only the round-robin picks an owner nobody chose by hand (prototype loadSheet).
          assigned: Object.freeze(rule.kind === "round-robin" ? added.filter((v) => v.ownerId).map((v) => Object.freeze({ leadId: v.leadId, ownerId: v.ownerId as string })) : []),
          rows: Object.freeze(verdicts), countsSaved: saved,
        }),
      };
    },
  });
}
export type SheetLoader = ReturnType<typeof createSheetLoader>;
