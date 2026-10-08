/**
 * M05-S01 — the Lead side of Today, read live from Zoho with the person's own token.
 *
 * Returns the person's open leads (the Leads book in their scope, lost and onboarded left out) and
 * the open Tasks, Calls and Meetings on them. Which group a row sits in and what it says next
 * (nextUp / workGroup) are computed once, by the ported rule in features/today/work.ts, when the
 * data interface feeds it these rows — not a second copy here (PROVISIONAL in BLOCKED.md; rule 1).
 *
 * Nothing is cached: these are records (D52). The activity field names are Zoho's standard ones and
 * are proved on staging (BLOCKED.md); the console's connector cannot read those modules yet.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { BookResult, LeadRow, LeadScope, createLeadsBook } from "./book";

/** Two thousand open leads is ten pages; a book past that is refused, never shown in part. */
export const TODAY_MAX_PAGES = 10;
const RECORD_ID = /^\d{15,22}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/** Zoho's standard activity modules and fields (D58: callbacks are Calls, visits and office meetings
 *  are Meetings — API module "Events" — everything else a Task). */
export const ACTIVITY_QUERIES = Object.freeze({
  task: { module: "Tasks", fields: ["id", "Subject", "Due_Date", "Status", "What_Id"], open: "Status != 'Completed'" },
  call: { module: "Calls", fields: ["id", "Subject", "Call_Start_Time", "Outgoing_Call_Status", "What_Id"], open: "Outgoing_Call_Status = 'Scheduled'" },
  // HUMAN (B-01): follow-up Meetings are now linked to the lead by Participants, not What_Id (v8 Events take no Leads
  // What_Id). This reader is not wired today; before it is, match Events on their lead participant (followup.ts linkedTo).
  meeting: { module: "Events", fields: ["id", "Event_Title", "Start_DateTime", "End_DateTime", "What_Id"], open: null },
} as const);
type ActivityKind = keyof typeof ACTIVITY_QUERIES;

export interface OpenActivity {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly leadId: string;
  readonly subject: string | null;
  /** Due date (task) or start time (call, meeting). */
  readonly when: string | null;
}

export type TodayResult =
  | { readonly ok: true; readonly value: { readonly scope: LeadScope; readonly leads: readonly LeadRow[]; readonly activities: readonly OpenActivity[] } }
  | Extract<BookResult, { ok: false }>
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface TodayDependencies {
  readonly book: ReturnType<typeof createLeadsBook>;
  readonly crm: Pick<ZohoClient, "coql">;
  readonly clock?: () => number;
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export function createTodayRead(deps: TodayDependencies) {
  const { book, crm } = deps;
  const clock = deps.clock ?? Date.now;

  const activities = async (cred: UserCredential, leadIds: readonly string[], signal?: AbortSignal)
    : Promise<readonly OpenActivity[] | Extract<TodayResult, { ok: false }>> => {
    const want = new Set(leadIds);
    const out: OpenActivity[] = [];
    for (const [kind, q] of Object.entries(ACTIVITY_QUERIES) as [ActivityKind, (typeof ACTIVITY_QUERIES)[ActivityKind]][]) {
      for (let i = 0; i < leadIds.length; i += 100) {
        const ids = leadIds.slice(i, i + 100);
        const open = q.open ?? `End_DateTime >= '${zohoTime(clock())}'`;
        const query = `select ${q.fields.join(", ")} from ${q.module} where (What_Id in (${ids.map((id) => `'${id}'`).join(", ")}) and ${open}) order by id asc limit 0, 2000`;
        let res: Awaited<ReturnType<typeof crm.coql>>;
        try {
          res = await crm.coql(cred, query, { signal });
        } catch {
          return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
        }
        if (!res.ok) {
          const k = res.error.kind;
          return { ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" };
        }
        if (res.value.invalidRecordIds || res.value.moreRecords) return { ok: false, kind: "refused", reasonCode: res.value.moreRecords ? "book-too-large" : "source-invalid" };
        for (const r of res.value.records as readonly ZohoRecord[]) {
          const lead = (r.What_Id as { id?: unknown } | null)?.id;
          const subject = (kind === "meeting" ? r.Event_Title : r.Subject) ?? null;
          const when = (kind === "task" ? r.Due_Date : kind === "call" ? r.Call_Start_Time : r.Start_DateTime) ?? null;
          if (!RECORD_ID.test(String(r.id)) || typeof lead !== "string" || !want.has(lead)
            || (subject !== null && (typeof subject !== "string" || subject.length > 255))
            || (when !== null && (typeof when !== "string" || !(kind === "task" ? DATE : DATETIME).test(when)))) {
            return { ok: false, kind: "refused", reasonCode: "scope-drift" };
          }
          out.push(Object.freeze({ id: r.id, kind, leadId: lead, subject: subject as string | null, when: when as string | null }));
        }
      }
    }
    return out;
  };

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, scope: LeadScope, signal?: AbortSignal): Promise<TodayResult> {
      const leads: LeadRow[] = [];
      for (let page = 0, offset: number | null = 0; offset !== null; page++) {
        if (page === TODAY_MAX_PAGES) return { ok: false, kind: "refused", reasonCode: "book-too-large" };
        const res = await book.list(principal, scope, offset, signal);
        if (!res.ok) return res;
        leads.push(...res.value.rows);
        offset = res.value.nextOffset;
      }
      const open = leads.filter((l) => l.lostAt === null && l.onboardedAt === null);
      const acts = await activities(principal.credential, open.map((l) => l.id), signal);
      if (!Array.isArray(acts)) return acts as Extract<TodayResult, { ok: false }>;
      return { ok: true, value: { scope, leads: Object.freeze(open), activities: Object.freeze(acts) } };
    },
  });
}
