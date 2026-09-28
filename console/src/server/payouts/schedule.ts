/**
 * M10-S20-T02 — THE PAYOUTS SCHEDULE JOB (D81, D82, D84): each Issued allotment carries 60 monthly
 * Investor_Payouts records ("Rental yield"), created once and never duplicated.
 *
 * The rule is the front end's, imported, not re-ported (lib/im/money payoutSchedule): 60 instalments, the
 * first due on the 10th (PAYDAY) of the month after the allotment was issued; the monthly gross is
 * Issued_Units × Unit_Price × Annual_Rental_Yield ÷ 100 ÷ 12, rounded to whole rupees; TDS_Amount 0 and
 * Net_Amount = Gross_Amount (Finance types TDS when paying — the console never computes it, D84).
 * A Reserved or Cancelled allotment gets no schedule.
 *
 * The issue date: LLP_UnitAllocation_Module has no Issued_On field in the org (getFields, 28 Sep 2026); the
 * schedule anchors on Investment_Date (ISSUE_DATE_FIELD) — PROVISIONAL until an issue-date field exists.
 *
 * Idempotency (no unique key exists on Investor_Payouts, so Zoho cannot refuse a duplicate): before any
 * insert the allotment's existing payouts are read, and only the instalment numbers that are missing are
 * created (any state counts as present — a Paid, Held or Cancelled instalment is never re-created). A lost
 * insert response is never retried blindly: the run stops, and the next run re-reads and fills only the gaps.
 * One process runs one allotment at a time (in-process lock). Each record carries Name = "<allotment id>-NN",
 * a readable natural key for Finance and for a later unique rule.
 *
 * Runs on the acting person's own token (D53): Finance's, through /api/payouts/schedule, or the operator's in
 * scripts/payouts-schedule.cjs. Logs carry ids and codes only; nothing is cached (D45).
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { PAYOUT_MONTHS, payoutSchedule } from "../../lib/im/money";
import type { ImAllot } from "../../lib/im/types";
import { checkProjection, MODULES } from "../data/projections";

export const PAYOUTS_MODULE = "Investor_Payouts";
/** PROVISIONAL (see above): the allotment date the schedule starts from. */
export const ISSUE_DATE_FIELD = "Investment_Date";
export const RENTAL_YIELD = "Rental yield";

const RECORD_ID = /^\d{15,22}$/;
/** COQL IN takes ≤100 values; 60 rows per allotment keeps one read ≤2000 rows at 30 allotments. */
const ALLOTS_PER_PAYOUT_READ = 30;
const INSERT_BATCH = 100;

export const SCHEDULE_ALLOTMENT_FIELDS = checkProjection(MODULES.allotments, [
  "id", "Allocation_Status", "Issued_Units", "Unit_Price", "Annual_Rental_Yield", ISSUE_DATE_FIELD,
]);
export const EXISTING_PAYOUT_FIELDS = Object.freeze(["id", "Allotment", "Payout_Kind", "Instalment_No"]);

export interface ScheduleAllotment {
  readonly id: string;
  readonly status: "Reserved" | "Issued" | "Cancelled" | null;
  readonly issuedUnits: number;
  readonly unitPrice: number;
  /** % a year, from the "20%" picklist */
  readonly yieldPct: number;
  readonly issuedOn: string | null;
}

export const quoteIds = (ids: readonly string[]) => ids.map((x) => `'${x}'`).join(", ");
export const lookupId = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
export const numOf = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[%,\s]/g, "")) : NaN;
  return Number.isFinite(x) ? x : null;
};
export const dayOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function allotmentOf(r: ZohoRecord): ScheduleAllotment | null {
  if (!RECORD_ID.test(r.id)) return null;
  const st = r.Allocation_Status;
  return Object.freeze({
    id: r.id,
    status: st === "Reserved" || st === "Issued" || st === "Cancelled" ? st : null,
    issuedUnits: numOf(r.Issued_Units) ?? 0,
    unitPrice: numOf(r.Unit_Price) ?? 0,
    yieldPct: numOf(r.Annual_Rental_Yield) ?? 0,
    issuedOn: dayOf(r[ISSUE_DATE_FIELD]),
  });
}

/** Why an allotment gets no schedule, or null when it gets one. */
export function unschedulable(a: ScheduleAllotment): "not-issued" | "no-issue-date" | "no-amount" | null {
  if (a.status !== "Issued") return "not-issued";
  if (!a.issuedOn) return "no-issue-date";
  if (!(a.issuedUnits > 0) || !(a.unitPrice > 0) || !(a.yieldPct > 0)) return "no-amount";
  return null;
}

/** The 60 records as Zoho fields — the front end's payoutSchedule, mapped onto Investor_Payouts. Pure. */
export function scheduleRecords(a: ScheduleAllotment, n = PAYOUT_MONTHS): ZohoFields[] {
  if (unschedulable(a)) return [];
  const im: ImAllot = {
    id: a.id, Customer: "", LLP_Lookup: "", Committed_Units: a.issuedUnits, Issued_Units: a.issuedUnits,
    Unit_Price: a.unitPrice, Ticket_Snapshot: a.issuedUnits * a.unitPrice, Allocation_Status: "Issued",
    Issued_On: a.issuedOn, Annual_Rental_Yield: a.yieldPct,
  };
  return payoutSchedule(im, n).map((p) => {
    const gross = Math.round(p.Gross_Amount), tds = 0;
    return {
      Name: `${a.id}-${String(p.Instalment_No).padStart(2, "0")}`,
      Allotment: { id: a.id }, Payout_Kind: RENTAL_YIELD, Instalment_No: p.Instalment_No,
      Period_Month: `${p.Period_Month}-01`, Due_On: p.Due_On,
      Gross_Amount: gross, TDS_Amount: tds, Net_Amount: gross - tds, Payout_State: "Scheduled",
    };
  });
}

/** The instalment numbers an allotment already has (Rental yield, any state), and any number held twice. */
export function presentInstalments(allotmentId: string, rows: readonly ZohoRecord[]): { have: Set<number>; doubled: number[] } {
  const have = new Set<number>(), doubled: number[] = [];
  for (const r of rows) {
    if (lookupId(r.Allotment) !== allotmentId) continue;
    const kind = r.Payout_Kind;
    if (kind !== undefined && kind !== null && kind !== RENTAL_YIELD && kind !== "-None-") continue;
    const no = numOf(r.Instalment_No);
    if (no === null) continue;
    if (have.has(no)) doubled.push(no); else have.add(no);
  }
  return { have, doubled };
}

/** Only what is missing: the idempotency rule. Pure. */
export function missingRecords(a: ScheduleAllotment, existing: readonly ZohoRecord[]): { records: ZohoFields[]; present: number; doubled: number[] } {
  const all = scheduleRecords(a);
  const { have, doubled } = presentInstalments(a.id, existing);
  return { records: all.filter((r) => !have.has(r.Instalment_No as number)), present: have.size, doubled };
}

export type AllotmentOutcome =
  | { readonly allotmentId: string; readonly status: "created"; readonly created: number; readonly present: number; readonly doubled: readonly number[] }
  | { readonly allotmentId: string; readonly status: "complete"; readonly present: number; readonly doubled: readonly number[] }
  | { readonly allotmentId: string; readonly status: "planned"; readonly wouldCreate: number; readonly present: number; readonly doubled: readonly number[] }
  | { readonly allotmentId: string; readonly status: "skipped"; readonly reason: "not-issued" | "no-issue-date" | "no-amount" | "not-visible" | "busy" }
  | { readonly allotmentId: string; readonly status: "failed"; readonly created: number; readonly errorKind: string };

export type ScheduleRunResult =
  | { readonly ok: true; readonly outcomes: readonly AllotmentOutcome[] }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface ScheduleJobDeps {
  readonly crm: Pick<ZohoClient, "coql" | "insert">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export function createPayoutScheduleJob(deps: ScheduleJobDeps) {
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const running = new Set<string>();
  const valid = (id: unknown): id is string => typeof id === "string" && RECORD_ID.test(id) && id.startsWith(deps.recordIdPrefix);
  const note = (me: string, action: string, reason: string, ids: readonly string[]) => {
    let at = 0; try { at = clock(); } catch { /* the note stands */ }
    const e = { at, actor: { kind: "user" as const, userId: me }, action, reason, recordIds: ids.filter(valid) };
    if (action === "payout-schedule-refused") log.refusal(e); else log.event?.(e);
  };

  async function readAll(cred: UserCredential, q: string, signal?: AbortSignal): Promise<ZohoRecord[] | { errorKind: string }> {
    const rows: ZohoRecord[] = [];
    for (let offset = 0; offset < 10_000; offset += 2_000) {
      let r: Awaited<ReturnType<typeof crm.coql>>;
      try { r = await crm.coql(cred, `${q} limit ${offset}, 2000`, { signal }); } catch { return { errorKind: "unexpected" }; }
      if (!r.ok) return r.error.kind === "not-found" ? rows : { errorKind: r.error.kind };
      if (r.value.invalidRecordIds) return { errorKind: "source-invalid" };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    return rows;
  }

  return Object.freeze({
    /**
     * Fill the missing instalments of the given allotments. `commit: false` plans only (a dry run: reads, no write).
     * Returns per-allotment counts and codes — no amounts.
     */
    async run(cred: UserCredential, allotmentIds: readonly unknown[], opts: { readonly commit: boolean; readonly signal?: AbortSignal }): Promise<ScheduleRunResult> {
      const me = cred.userId;
      const ids = [...new Set(allotmentIds)];
      if (!ids.length || ids.length > 100 || !ids.every(valid)) { note(me, "payout-schedule-refused", "invalid-request", []); return { ok: false, kind: "refused", reason: "invalid-request" }; }
      const signal = opts.signal;

      const got = await readAll(cred, `select ${SCHEDULE_ALLOTMENT_FIELDS.join(", ")} from ${MODULES.allotments} where id in (${quoteIds(ids)}) order by id asc`, signal);
      if (!Array.isArray(got)) return { ok: false, kind: "source-error", errorKind: got.errorKind };
      const allots = new Map(got.map(allotmentOf).filter((a): a is ScheduleAllotment => !!a && ids.includes(a.id)).map((a) => [a.id, a]));

      const outcomes: AllotmentOutcome[] = [];
      const todo: ScheduleAllotment[] = [];
      for (const id of ids) {
        const a = allots.get(id);
        if (!a) { outcomes.push({ allotmentId: id, status: "skipped", reason: "not-visible" }); continue; }
        const why = unschedulable(a);
        if (why) { outcomes.push({ allotmentId: id, status: "skipped", reason: why }); continue; }
        if (running.has(id)) { outcomes.push({ allotmentId: id, status: "skipped", reason: "busy" }); continue; }
        todo.push(a);
      }
      for (const a of todo) running.add(a.id);
      try {
        for (let i = 0; i < todo.length; i += ALLOTS_PER_PAYOUT_READ) {
          const chunk = todo.slice(i, i + ALLOTS_PER_PAYOUT_READ);
          const existing = await readAll(cred, `select ${EXISTING_PAYOUT_FIELDS.join(", ")} from ${PAYOUTS_MODULE} where Allotment in (${quoteIds(chunk.map((a) => a.id))}) order by id asc`, signal);
          if (!Array.isArray(existing)) {
            for (const a of chunk) outcomes.push({ allotmentId: a.id, status: "failed", created: 0, errorKind: existing.errorKind });
            continue;
          }
          for (const a of chunk) {
            const m = missingRecords(a, existing);
            if (m.doubled.length) note(me, "payout-schedule", "instalment-doubled", [a.id]);
            if (!m.records.length) { outcomes.push({ allotmentId: a.id, status: "complete", present: m.present, doubled: m.doubled }); continue; }
            if (!opts.commit) { outcomes.push({ allotmentId: a.id, status: "planned", wouldCreate: m.records.length, present: m.present, doubled: m.doubled }); continue; }
            let created = 0, failed: string | null = null;
            for (let j = 0; j < m.records.length && !failed; j += INSERT_BATCH) {
              const batch = m.records.slice(j, j + INSERT_BATCH);
              let r: Awaited<ReturnType<typeof crm.insert>>;
              try { r = await crm.insert(cred, PAYOUTS_MODULE, batch, { signal }); } catch { failed = "unexpected"; break; }
              if (!r.ok) {
                // partial: count what landed; the next run fills the rest (it re-reads first)
                if (r.error.kind === "partial") created += r.error.records.filter((x) => x.ok).length;
                failed = r.error.kind; break;
              }
              created += r.value.filter((x) => x.ok).length;
              if (r.value.some((x) => !x.ok)) failed = "partial";
            }
            if (failed) { note(me, "payout-schedule", `failed-${failed}`, [a.id]); outcomes.push({ allotmentId: a.id, status: "failed", created, errorKind: failed }); }
            else { note(me, "payout-schedule", "created", [a.id]); outcomes.push({ allotmentId: a.id, status: "created", created, present: m.present, doubled: m.doubled }); }
          }
        }
      } finally { for (const a of todo) running.delete(a.id); }
      const order = new Map(ids.map((id, i) => [id, i]));
      outcomes.sort((x, y) => order.get(x.allotmentId)! - order.get(y.allotmentId)!);
      return { ok: true, outcomes: Object.freeze(outcomes) };
    },
  });
}
export type PayoutScheduleJob = ReturnType<typeof createPayoutScheduleJob>;
