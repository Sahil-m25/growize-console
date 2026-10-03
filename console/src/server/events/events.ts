/**
 * M14-S01-T02 — EVENTS: the list, one event, and what each event produced (D45, D53, D59, D69, D84/D85).
 *
 * Records: Lead_Events (Name, Starts_On, Ends_On, Event_City, Event_Type, Event_Channel, Event_State
 * Planned/Done/Cancelled, Event_Cost, Names_Taken) and its staff through the linking module
 * Lead_Events_X_Users (Event_Staff → the event, userlookup221_3 → the user) — the multi-user lookup
 * Event_Staff cannot be selected on Lead_Events itself. Leads point at an event with Leads.Lead_Event
 * (a lookup; the org has no Leads.Event_Name — the story's name for it).
 *
 * Stats: ONE COQL group-by, Leads by Lead_Event and Lead_Status, on the person's own token, cached as
 * count buckets under the person's leads scope (server/data/scope; D52/D53). Rows are never cached.
 *   tagged    — leads carrying the event (every status)
 *   qualified — Lead_Status at Qualified or beyond; reserved — at "Reserved - 10% in" or beyond
 *   captured  — the event's own Names_Taken (names taken at the stall); null when not recorded
 * Cost per qualified is given only when every captured name is tagged (tagged ≥ captured, D59); else null
 * with the reason code, so the page hides the column and says why.
 *
 * One event: the leads the viewer may open (the shared owner predicate, ../cases/predicate) are named;
 * the rest of the event's tagged leads are only counted ("in somebody else's book"). Investors are never
 * read here — no Contacts query exists in this file (D69: counts only).
 */

import type { CacheError, CacheFresh, CacheStale, CountBucket, ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";
import { day, idOf, inClause, nameOf, num, ownerWhere, pagedSelect, RECORD_ID, str } from "../cases/predicate";

export const EVENTS_MODULE = "Lead_Events";
export const STAFF_MODULE = "Lead_Events_X_Users";
export const STAFF_EVENT = "Event_Staff";
export const STAFF_USER = "userlookup221_3";
export const EVENT_FIELDS = Object.freeze(["id", "Name", "Starts_On", "Ends_On", "Event_City", "Event_Type", "Event_Channel", "Event_State", "Event_Cost", "Names_Taken",
  // the event's version: PATCH /api/events/[id] sends it back as modifiedTime (409 conflict when stale, M14-S02)
  "Modified_Time"]);

const QUALIFIED_OR_BEYOND: ReadonlySet<string> = new Set(["Qualified", "Engagement done", "Investor said yes", "Reserved - 10% in", "Fully paid", "Allocated", "Onboarded", "Converted"]);
const RESERVED_OR_BEYOND: ReadonlySet<string> = new Set(["Reserved - 10% in", "Fully paid", "Allocated", "Onboarded", "Converted"]);

export type EventState = "planned" | "done" | "cancelled" | "unknown";
export interface EventStats {
  readonly captured: number | null;
  readonly tagged: number;
  readonly qualified: number;
  readonly reserved: number;
  readonly costPerQualified: number | null;
  /** Why cost per qualified is not given: "untagged" (captured names not all tagged), "no-cost", "no-qualified", "no-capture". */
  readonly costHiddenWhy: "untagged" | "no-cost" | "no-qualified" | "no-capture" | null;
}
export interface EventRow {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly city: string | null;
  readonly type: string | null;
  readonly channel: string | null;
  readonly state: EventState;
  readonly cost: number | null;
  readonly staff: readonly { readonly id: string; readonly name: string | null }[];
  readonly stats: EventStats;
  /** Lead_Events.Modified_Time as read — the correction (PATCH) sends it back as `modifiedTime`. */
  readonly modifiedTime: string | null;
}
export interface EventLead { readonly id: string; readonly name: string; readonly status: string | null }

export type StatsRead = CacheFresh<readonly CountBucket[]> | CacheStale<readonly CountBucket[]> | CacheError<readonly CountBucket[]>;
export interface EventsPrincipal { readonly credential: UserCredential; readonly seat: string }
export type EventsRefusal = { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "invalid-request" | "source-invalid" };
export type EventsFailure = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface EventsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  /** An IR Manager's reports; absent/null → their own token under Zoho's role hierarchy (PROVISIONAL, as live.ts). */
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
  readonly maxPages?: number;
}

const STATE: Readonly<Record<string, EventState>> = Object.freeze({ Planned: "planned", Done: "done", Cancelled: "cancelled" });

/** Group-by rows → buckets "<eventId>|t|q|r" (tagged, qualified, reserved). Pure: exported for tests. */
export function stageBuckets(rows: readonly Readonly<Record<string, string | number | null>>[]): CountBucket[] {
  const m = new Map<string, number>();
  const add = (k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  for (const r of rows) {
    const ev = typeof r.Lead_Event === "string" && RECORD_ID.test(r.Lead_Event) ? r.Lead_Event : null;
    const n = typeof r["COUNT(id)"] === "number" ? (r["COUNT(id)"] as number) : 0;
    if (!ev || n <= 0) continue;
    const st = typeof r.Lead_Status === "string" ? r.Lead_Status : "";
    add(`${ev}|t`, n);
    if (QUALIFIED_OR_BEYOND.has(st)) add(`${ev}|q`, n);
    if (RESERVED_OR_BEYOND.has(st)) add(`${ev}|r`, n);
  }
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, count]) => ({ key, count }));
}

export function statsOf(eventId: string, captured: number | null, cost: number | null, buckets: readonly CountBucket[] | null): EventStats {
  const get = (s: string) => buckets?.find((b) => b.key === `${eventId}|${s}`)?.count ?? 0;
  const tagged = get("t"), qualified = get("q"), reserved = get("r");
  const why: EventStats["costHiddenWhy"] =
    captured === null ? "no-capture" : tagged < captured ? "untagged" : cost === null || cost <= 0 ? "no-cost" : qualified === 0 ? "no-qualified" : null;
  return Object.freeze({ captured, tagged, qualified, reserved, costPerQualified: why === null ? Math.round(cost! / qualified) : null, costHiddenWhy: why });
}

const eventOf = (r: ZohoRecord, staff: ReadonlyMap<string, readonly { id: string; name: string | null }[]>, buckets: readonly CountBucket[] | null): EventRow | null => {
  if (!idOf(r.id)) return null;
  const state = STATE[str(r, "Event_State", 20) ?? ""] ?? "unknown";
  const cost = num(r, "Event_Cost"), captured = num(r, "Names_Taken");
  return Object.freeze({
    id: r.id, name: str(r, "Name", 120) ?? "", startsOn: day(str(r, "Starts_On", 20)), endsOn: day(str(r, "Ends_On", 20)),
    city: str(r, "Event_City", 80), type: str(r, "Event_Type", 30), channel: str(r, "Event_Channel", 30), state, cost,
    staff: Object.freeze([...(staff.get(r.id) ?? [])]), stats: statsOf(r.id, captured, cost, buckets),
    modifiedTime: str(r, "Modified_Time", 40),
  });
};
const bySoonest = (a: EventRow, b: EventRow) => (a.startsOn ?? "9999") < (b.startsOn ?? "9999") ? -1 : (a.startsOn ?? "9999") > (b.startsOn ?? "9999") ? 1 : a.name.localeCompare(b.name);

export function createEventsService(deps: EventsDeps) {
  const scopeOf = (p: EventsPrincipal): BookScope => scopesFor(p.seat, p.credential.userId).leads;
  const noBook = (p: EventsPrincipal, action: string): EventsRefusal => {
    deps.events.refusal(p.credential.userId, action, "seat-denied");
    return { ok: false, kind: "refused", reason: "no-book" };
  };

  const stats = (p: EventsPrincipal, scope: BookScope, signal?: AbortSignal): Promise<StatsRead> =>
    deps.cache.readSettled<readonly CountBucket[]>(scopedKey<readonly CountBucket[]>(scope, "events.stages"), async () => {
      const r = await deps.crm.aggregate(p.credential,
        "select Lead_Event, Lead_Status, COUNT(id) from Leads where Lead_Event is not null group by Lead_Event, Lead_Status limit 0, 2000", { signal });
      if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
      return stageBuckets(r.value);
    });

  const staffOf = async (p: EventsPrincipal, ids: readonly string[], signal?: AbortSignal) => {
    const out = new Map<string, { id: string; name: string | null }[]>();
    const where = inClause(STAFF_EVENT, ids);
    if (!where) return { ok: true as const, staff: out };
    const r = await pagedSelect(deps.crm, p.credential, ["id", STAFF_EVENT, STAFF_USER], STAFF_MODULE, where, "id asc", signal, deps.maxPages);
    if (!r.ok) return r;
    for (const x of r.rows) {
      const ev = idOf(x[STAFF_EVENT]), user = idOf(x[STAFF_USER]);
      if (!ev || !user || !ids.includes(ev)) continue;
      const list = out.get(ev) ?? [];
      if (!list.some((s) => s.id === user)) list.push(Object.freeze({ id: user, name: nameOf(x[STAFF_USER]) }));
      out.set(ev, list);
    }
    return { ok: true as const, staff: out };
  };

  const failed = (r: { kind: "source-error"; errorKind: string; retryable: boolean } | { kind: "refused"; reason: "source-invalid" }): EventsRefusal | EventsFailure =>
    r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : { ok: false, kind: "source-error", errorKind: r.errorKind, retryable: r.retryable };

  return Object.freeze({
    /** Upcoming (Planned, soonest first) and Completed (Done, latest first), each with its stats. */
    async list(p: EventsPrincipal, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly upcoming: readonly EventRow[]; readonly completed: readonly EventRow[]; readonly truncated: boolean; readonly stats: StatsRead } | EventsRefusal | EventsFailure
    > {
      const scope = scopeOf(p);
      if (scope.kind === "none") return noBook(p, "events-list");
      const r = await pagedSelect(deps.crm, p.credential, EVENT_FIELDS, EVENTS_MODULE, "id is not null", "Starts_On asc", signal, deps.maxPages);
      if (!r.ok) return failed(r);
      const s = await staffOf(p, r.rows.map((x) => x.id), signal);
      if (!s.ok) return failed(s);
      const st = await stats(p, scope, signal);
      const buckets = st.state === "error" ? null : st.value;
      const rows = r.rows.map((x) => eventOf(x, s.staff, buckets)).filter((x): x is EventRow => x !== null);
      return {
        ok: true, truncated: r.truncated, stats: st,
        upcoming: Object.freeze(rows.filter((e) => e.state === "planned").sort(bySoonest)),
        completed: Object.freeze(rows.filter((e) => e.state === "done").sort((a, b) => bySoonest(b, a))),
      };
    },

    /** One event: its row, the leads the viewer may open (named), and how many more are in somebody else's book. */
    async one(p: EventsPrincipal, id: string, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly event: EventRow; readonly leads: readonly EventLead[]; readonly othersCount: number | null; readonly truncated: boolean } | EventsRefusal | EventsFailure
    > {
      const scope = scopeOf(p);
      if (scope.kind === "none") return noBook(p, "events-open");
      if (typeof id !== "string" || !RECORD_ID.test(id)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const r = await pagedSelect(deps.crm, p.credential, EVENT_FIELDS, EVENTS_MODULE, `id = '${id}'`, "id asc", signal, 1);
      if (!r.ok) return failed(r);
      const rec = r.rows.find((x) => x.id === id);
      if (!rec) {
        deps.events.refusal(p.credential.userId, "events-open", "not-visible", [id]);
        return { ok: false, kind: "refused", reason: "not-found" };
      }
      const team = scope.kind === "subtree" && deps.subtreeOf ? await deps.subtreeOf(scope.managerId, signal) : null;
      const mine = ownerWhere(scope, { secondaryOwner: true, team });
      if (!mine) return noBook(p, "events-open");
      const [s, leads, st] = [await staffOf(p, [id], signal),
        await pagedSelect(deps.crm, p.credential, ["id", "First_Name", "Last_Name", "Lead_Status"], "Leads", `Lead_Event = '${id}' and ${mine}`, "id asc", signal, deps.maxPages),
        await stats(p, scope, signal)];
      if (!s.ok) return failed(s);
      if (!leads.ok) return failed(leads);
      const buckets = st.state === "error" ? null : st.value;
      const event = eventOf(rec, s.staff, buckets)!;
      const named = leads.rows.filter((x) => idOf(x.id)).map((x): EventLead => Object.freeze({
        id: x.id, name: [str(x, "First_Name", 80), str(x, "Last_Name", 80)].filter(Boolean).join(" "), status: str(x, "Lead_Status", 40),
      }));
      // Others = the event's tagged count (the cached group-by) less the named. Unknown when the count failed.
      const othersCount = buckets === null ? null : Math.max(0, event.stats.tagged - named.length);
      return { ok: true, event, leads: Object.freeze(named), othersCount, truncated: leads.truncated };
    },
  });
}
export type EventsService = ReturnType<typeof createEventsService>;
