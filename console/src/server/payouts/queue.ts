/**
 * M10-S20-T02 — PAYOUT READS (D45, D52, D53, D82): an allotment's schedule (the investor page's Payouts tab)
 * and the Finance due queue (Payments: "payouts due this month"), on the signed-in person's own token.
 *
 * Who reads: ./authority read (Head of Finance, Finance Operations) — anyone else is refused
 * before anything is read. Their money scope is org / all (../data/scope), so the queue spans every allotment
 * their token shows; a seat with a narrower money scope is refused rather than trimmed (none has read today).
 *
 * The due queue (lib/im/money payoutsDue): Payout_State Scheduled, Due_On in the month NOW falls in (IST),
 * sorted by Due_On then id. Scheduled payouts from earlier months are returned apart as `overdue` (same order).
 * One COQL on Investor_Payouts (≤2000 rows a page, LIMIT offset), then one on the allotments named (IN ≤100
 * a call) for the investor and farm names. Payout_UTR is never selected by the queue; the schedule returns it
 * masked to its last four characters. Payout_Note is not read. Nothing is cached (D45).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { thisMonth } from "../../lib/im/money";
import { checkProjection, MODULES } from "../data/projections";
import { dayOf, lookupId, numOf, PAYOUTS_MODULE, quoteIds } from "./schedule";

const RECORD_ID = /^\d{15,22}$/;
const MAX_PAGES = 5;

export const QUEUE_FIELDS = Object.freeze(["id", "Allotment", "Payout_Kind", "Instalment_No", "Period_Month", "Due_On",
  "Gross_Amount", "TDS_Amount", "Net_Amount", "Payout_State"]);
export const SCHEDULE_FIELDS = Object.freeze([...QUEUE_FIELDS, "Paid_On", "Payout_Mode", "Payout_UTR", "Paid_By", "Modified_Time"]);
export const QUEUE_ALLOTMENT_FIELDS = checkProjection(MODULES.allotments, ["id", "Customer", "LLP"]);

export type PayoutState = "Scheduled" | "Paid" | "Held" | "Failed" | "Cancelled";
const STATES: readonly PayoutState[] = ["Scheduled", "Paid", "Held", "Failed", "Cancelled"];

export interface PayoutLine {
  readonly id: string;
  readonly allotmentId: string;
  readonly kind: string | null;
  readonly instalment: number | null;
  /** "YYYY-MM" */
  readonly month: string | null;
  readonly dueOn: string | null;
  readonly gross: number;
  readonly tds: number;
  readonly net: number;
  readonly state: PayoutState | null;
}
export interface ScheduleLine extends PayoutLine {
  readonly paidOn: string | null;
  readonly mode: string | null;
  /** "••••1234" — the bank reference is never returned whole */
  readonly utrMasked: string | null;
  readonly paidBy: { readonly id: string | null; readonly name: string | null } | null;
  /** send back as the mark-paid write's If-Unmodified-Since */
  readonly modifiedTime: string | null;
}
export interface QueueLine extends PayoutLine {
  readonly investor: { readonly id: string | null; readonly name: string | null };
  readonly farm: { readonly id: string | null; readonly name: string | null };
}

export const maskUtr = (v: unknown): string | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim();
  return "••••" + t.slice(-4);
};
const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" && !Array.isArray(v) ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n !== "" ? n.slice(0, 120) : null;
};
const text = (v: unknown, max = 40): string | null => (typeof v === "string" && v !== "" && v !== "-None-" ? v.slice(0, max) : null);
const money = (v: unknown): number => { const x = numOf(v); return x === null ? 0 : Math.round(x); };

export function lineOf(r: ZohoRecord): PayoutLine | null {
  const allotmentId = lookupId(r.Allotment);
  if (!RECORD_ID.test(r.id) || !allotmentId) return null;
  const st = text(r.Payout_State);
  const gross = money(r.Gross_Amount), tds = money(r.TDS_Amount);
  const month = dayOf(r.Period_Month);
  return {
    id: r.id, allotmentId, kind: text(r.Payout_Kind), instalment: numOf(r.Instalment_No), month: month ? month.slice(0, 7) : null,
    dueOn: dayOf(r.Due_On), gross, tds, net: r.Net_Amount === null || r.Net_Amount === undefined ? gross - tds : money(r.Net_Amount),
    state: STATES.includes(st as PayoutState) ? (st as PayoutState) : null,
  };
}
export function scheduleLineOf(r: ZohoRecord): ScheduleLine | null {
  const l = lineOf(r);
  if (!l) return null;
  const by = r.Paid_By;
  return Object.freeze({
    ...l, paidOn: dayOf(r.Paid_On), mode: text(r.Payout_Mode), utrMasked: maskUtr(r.Payout_UTR),
    paidBy: by ? Object.freeze({ id: lookupId(by) ?? (typeof (by as { id?: unknown }).id === "string" ? (by as { id: string }).id : null), name: nameOf(by) }) : null,
    modifiedTime: typeof r.Modified_Time === "string" ? r.Modified_Time : null,
  });
}

const byDue = (x: PayoutLine, y: PayoutLine) => ((x.dueOn ?? "") < (y.dueOn ?? "") ? -1 : (x.dueOn ?? "") > (y.dueOn ?? "") ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

/** The month's first and last day, "YYYY-MM-DD". */
export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}
/** "YYYY-MM-DDTHH:MM" in IST for the front end's thisMonth (data.NOW is IST wall time). */
export const istNow = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 16);

export type ReadRefusal = { readonly ok: false; readonly kind: "refused"; readonly reason: "seat-denied" | "invalid-request" | "source-invalid" | "not-visible" };
export type ReadFailure = ReadRefusal | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface PayoutReadDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** Fresh check on the live session: does the seat read payouts? (./authority read) */
  readonly mayRead: (cred: UserCredential, signal?: AbortSignal) => Promise<boolean>;
  readonly clock?: () => number;
}

export function createPayoutReads(deps: PayoutReadDeps) {
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const valid = (id: unknown): id is string => typeof id === "string" && RECORD_ID.test(id) && id.startsWith(deps.recordIdPrefix);
  const refuse = (me: string, action: string, reason: ReadRefusal["reason"], ids: readonly string[] = []): ReadRefusal => {
    let at = 0; try { at = clock(); } catch { /* stands */ }
    log.refusal({ at, actor: { kind: "user", userId: me }, action, reason, recordIds: ids.filter(valid) });
    return { ok: false, kind: "refused", reason };
  };
  const may = async (cred: UserCredential, signal?: AbortSignal) => { try { return (await deps.mayRead(cred, signal)) === true; } catch { return false; } };

  async function pages(cred: UserCredential, q: string, signal?: AbortSignal): Promise<{ rows: ZohoRecord[]; truncated: boolean } | { errorKind: string }> {
    const rows: ZohoRecord[] = [];
    for (let p = 0; p < MAX_PAGES; p++) {
      let r: Awaited<ReturnType<typeof crm.coql>>;
      try { r = await crm.coql(cred, `${q} limit ${p * 2000}, 2000`, { signal }); } catch { return { errorKind: "unexpected" }; }
      if (!r.ok) return r.error.kind === "not-found" ? { rows, truncated: false } : { errorKind: r.error.kind };
      if (r.value.invalidRecordIds) return { errorKind: "source-invalid" };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  }
  const failOf = (me: string, action: string, e: { errorKind: string }): ReadFailure =>
    e.errorKind === "source-invalid" ? refuse(me, action, "source-invalid") : { ok: false, kind: "source-error", errorKind: e.errorKind };

  return Object.freeze({
    /** The Payouts tab of one allotment: its schedule in instalment order. */
    async scheduleOf(cred: UserCredential, allotmentId: unknown, signal?: AbortSignal)
      : Promise<{ ok: true; allotmentId: string; payouts: readonly ScheduleLine[] } | ReadFailure> {
      const me = cred.userId, action = "payout-schedule-read";
      if (!valid(allotmentId)) return refuse(me, action, "invalid-request");
      if (!(await may(cred, signal))) return refuse(me, action, "seat-denied", [allotmentId]);
      const got = await pages(cred, `select ${SCHEDULE_FIELDS.join(", ")} from ${PAYOUTS_MODULE} where Allotment = '${allotmentId}' order by Instalment_No asc, id asc`, signal);
      if ("errorKind" in got) return failOf(me, action, got);
      const lines = got.rows.map(scheduleLineOf).filter((x): x is ScheduleLine => x !== null);
      if (lines.some((l) => l.allotmentId !== allotmentId)) return refuse(me, action, "source-invalid", [allotmentId]);
      lines.sort((x, y) => (x.instalment ?? 0) - (y.instalment ?? 0) || (x.id < y.id ? -1 : 1));
      return { ok: true, allotmentId, payouts: Object.freeze(lines) };
    },

    /** Payments: Scheduled payouts due this month (and, apart, those overdue), across what the seat sees. */
    async dueQueue(cred: UserCredential, signal?: AbortSignal)
      : Promise<{ ok: true; month: string; due: readonly QueueLine[]; overdue: readonly QueueLine[]; truncated: boolean } | ReadFailure> {
      const me = cred.userId, action = "payout-queue-read";
      if (!(await may(cred, signal))) return refuse(me, action, "seat-denied");
      const month = thisMonth(istNow(clock()));
      const { last } = monthBounds(month);
      const got = await pages(cred, `select ${QUEUE_FIELDS.join(", ")} from ${PAYOUTS_MODULE} where Payout_State = 'Scheduled' and Due_On <= '${last}' order by Due_On asc, id asc`, signal);
      if ("errorKind" in got) return failOf(me, action, got);
      const lines = got.rows.map(lineOf).filter((x): x is PayoutLine => x !== null && x.state === "Scheduled" && !!x.dueOn && x.dueOn <= last);
      const ids = [...new Set(lines.map((l) => l.allotmentId))];
      const allots = new Map<string, ZohoRecord>();
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const a = await pages(cred, `select ${QUEUE_ALLOTMENT_FIELDS.join(", ")} from ${MODULES.allotments} where id in (${quoteIds(chunk)}) order by id asc`, signal);
        if ("errorKind" in a) return failOf(me, action, a);
        for (const r of a.rows) if (chunk.includes(r.id)) allots.set(r.id, r);
      }
      // A payout whose allotment the token does not show is not the seat's to see: left out, never guessed.
      const withNames = lines.filter((l) => allots.has(l.allotmentId)).map((l): QueueLine => {
        const a = allots.get(l.allotmentId)!;
        return Object.freeze({ ...l, investor: Object.freeze({ id: lookupId(a.Customer), name: nameOf(a.Customer) }), farm: Object.freeze({ id: lookupId(a.LLP), name: nameOf(a.LLP) }) });
      }).sort(byDue);
      return {
        ok: true, month, truncated: got.truncated,
        due: Object.freeze(withNames.filter((l) => l.dueOn!.slice(0, 7) === month)),
        overdue: Object.freeze(withNames.filter((l) => l.dueOn!.slice(0, 7) < month)),
      };
    },
  });
}
export type PayoutReads = ReturnType<typeof createPayoutReads>;
