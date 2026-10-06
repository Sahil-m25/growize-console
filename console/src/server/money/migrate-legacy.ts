/**
 * M10-S01-T02 + M18-S12-T01 — move the old flattened payment columns into Receipts. ONE module for both.
 *
 * The org as found (23 Sep) keeps payments in ten fixed column triplets (`Amount_1..10`, `UTR, UTR_2..10`,
 * `Date_1..10`) on LLP_UnitAllocation_Module; M18-S12 describes the same triplets on Contacts. D54/A-24
 * moves each filled triplet into one Receipt linked to its allotment (and through it to the Contact and
 * the LLP, D70); the old columns are kept as history and are never written again (see
 * `retireLegacyPaymentColumns`).
 *
 * The run, on the acting human's own token (Sahil's; D53 — no service or admin token):
 *   1. read every source record that has any triplet filled, and (Contacts) its one live allotment;
 *   2. plan: validate every triplet, infer Kind, look up Mode from the Finance-supplied list, and
 *      reconcile each investor's legacy total against the allotments' Total_Amount_Received;
 *   3. idempotency: UTR is unique on Receipts, so a triplet whose UTR already sits on the same
 *      allotment with the same amount is skipped; the same UTR anywhere else halts;
 *   4. only if the whole plan is clean, write investor by investor and re-read the written receipts;
 *      each investor's migrated total must equal the old columns before the next investor is written.
 * Any problem halts the run before anything further is written and names the record ids involved.
 * Nothing here keeps a copy (D45); the run log and every ops-log line carry record ids and reason
 * codes only — never an amount, a UTR or a name.
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import { coqlAny } from "../../lib/zoho/coql";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";

export const RECEIPTS_MODULE = "Receipts";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
export const CONTACTS_MODULE = "Contacts";
export const COQL_IN_LIMIT = 100;
export const COQL_PAGE = 2_000;
const MAX_ROWS = 10_000;

const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export const MIGRATION_MODES = ["NEFT", "RTGS", "IMPS", "SWIFT", "UPI", "Cheque"] as const;
export type MigrationMode = (typeof MIGRATION_MODES)[number];
const MODES: ReadonlySet<string> = new Set(MIGRATION_MODES);

export interface LegacySlot { readonly amount: string; readonly utr: string; readonly date: string }
export type LegacySource = "allotments" | "contacts";

/** The as-found column names (docs/zoho-org-as-found-2026-09-23.md): Amount_1..10, UTR, UTR_2..10, Date_1..10. */
export const DEFAULT_LEGACY_SLOTS: readonly LegacySlot[] = Object.freeze(Array.from({ length: 10 }, (_, i) => Object.freeze({
  amount: `Amount_${i + 1}`, utr: i === 0 ? "UTR" : `UTR_${i + 1}`, date: `Date_${i + 1}`,
})));

/** Every legacy column name, for the write guard. */
export function legacyColumns(slots: readonly LegacySlot[] = DEFAULT_LEGACY_SLOTS): readonly string[] {
  return slots.flatMap((s) => [s.amount, s.utr, s.date]);
}

export type HaltReason =
  | "malformed-slot"          // a triplet with an amount but no UTR/date, a bad UTR, a non-integer amount…
  | "duplicate-utr"           // the same UTR twice in the old columns
  | "mode-unknown"            // Finance's mode list does not name this UTR (PROVISIONAL, jev: halt and ask)
  | "ambiguous-allotment"     // a Contact with zero or several live allotments
  | "cancelled-allotment"     // money sitting on a cancelled allotment: Finance decides, not the script
  | "allotment-invalid"       // the allotment lacks Customer/LLP/units/price
  | "total-mismatch"          // old columns ≠ Total_Amount_Received (the tampered Amount_2 of TC-IM12-017)
  | "utr-conflict"            // the UTR already sits on a Receipt for another allotment or amount
  | "write-failed"            // Zoho refused or lost part of a write
  | "verify-mismatch";        // after writing, the investor's migrated receipts do not add up

export interface MigrationLogLine {
  readonly event: "read" | "planned" | "skipped" | "created" | "verified" | "halted";
  readonly recordIds: readonly string[];
  readonly reason?: HaltReason;
}
export interface InvestorReconciliation { readonly investorId: string; readonly allotmentIds: readonly string[]; readonly agreed: boolean }
export interface MigrationReport {
  readonly mode: "dry-run" | "commit";
  readonly status: "done" | "halted";
  readonly halt: { readonly reason: HaltReason; readonly recordIds: readonly string[] } | null;
  /** Receipts the plan would create (dry run) or was about to create (commit). */
  readonly planned: number;
  readonly created: readonly string[];
  readonly skipped: number;
  readonly investors: readonly InvestorReconciliation[];
  readonly log: readonly MigrationLogLine[];
}
export type MigrationResult =
  | { readonly ok: true; readonly value: MigrationReport }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" };

export interface MigrationDependencies {
  readonly crm: Pick<ZohoClient, "coql" | "insert">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}
export interface MigrationOptions {
  readonly source: LegacySource;
  /** false (the default) plans and reconciles without writing. */
  readonly commit?: boolean;
  /** UTR → Mode, supplied by Finance. The old columns carry no mode. */
  readonly modes: Readonly<Record<string, string>>;
  readonly slots?: readonly LegacySlot[];
}

interface Allotment { id: string; customerId: string; llpId: string; status: string; units: number; unitPrice: number; token: number | null; received: number | null }
interface Planned { sourceId: string; slot: number; allotmentId: string; amount: number; utr: string; receivedOn: string; mode: MigrationMode; kind: "Advance" | "Part" | "Full" }
class Halt { constructor(readonly reason: HaltReason, readonly recordIds: readonly string[]) {} }
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }

const lookupId = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const blank = (v: unknown): boolean => v === null || v === undefined || v === "";

export function createLegacyPaymentMigration(deps: MigrationDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The legacy-payment migration needs crm.coql, crm.insert, the ops log and the CRM record-id prefix.");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const orgId = (v: unknown): string | null => { const id = typeof v === "string" ? v : lookupId(v); return id && id.startsWith(deps.recordIdPrefix) ? id : null; };

  const all = async (cred: UserCredential, q: string): Promise<ZohoRecord[]> => {
    const rows: ZohoRecord[] = [];
    for (let off = 0; off < MAX_ROWS; off += COQL_PAGE) {
      const r = await crm.coql(cred, `${q} limit ${off}, ${COQL_PAGE}`);
      if (!r.ok) throw new SourceFail(r.error.kind);
      if (r.value.invalidRecordIds) throw new SourceFail("unexpected");
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    throw new SourceFail("unexpected");
  };
  const inChunks = async (cred: UserCredential, values: readonly string[], q: (list: string) => string): Promise<ZohoRecord[]> => {
    const out: ZohoRecord[] = [];
    for (let i = 0; i < values.length; i += COQL_IN_LIMIT) out.push(...await all(cred, q(values.slice(i, i + COQL_IN_LIMIT).map((v) => `'${v}'`).join(", "))));
    return out;
  };

  const ALLOT_FIELDS = "id, Customer, LLP, Allocation_Status, Issued_Units, Reserved_Units, Unit_Price, Token_Advance_Amount, Total_Amount_Received";
  const parseAllotment = (r: ZohoRecord): Allotment | null => {
    const customerId = orgId(r.Customer), llpId = orgId(r.LLP), status = typeof r.Allocation_Status === "string" ? r.Allocation_Status : "";
    const issued = int(r.Issued_Units), reserved = int(r.Reserved_Units), price = int(r.Unit_Price);
    if (!orgId(r.id) || !customerId || !llpId || !status || price === null || price <= 0) return null;
    const units = status === "Issued" ? issued : reserved;
    if (units === null || units < 0) return null;
    return { id: r.id, customerId, llpId, status, units, unitPrice: price, token: int(r.Token_Advance_Amount),
      received: blank(r.Total_Amount_Received) ? 0 : int(r.Total_Amount_Received) };
  };

  return Object.freeze({
    async run(credential: UserCredential, options: MigrationOptions): Promise<MigrationResult> {
      const slots = options?.slots ?? DEFAULT_LEGACY_SLOTS;
      if (!isUserCredential(credential) || !options || (options.source !== "allotments" && options.source !== "contacts")
        || !options.modes || typeof options.modes !== "object" || !Array.isArray(slots) || slots.length < 1 || slots.length > 15
        || slots.some((s) => ![s?.amount, s?.utr, s?.date].every((f) => typeof f === "string" && FIELD.test(f)))) {
        return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      }
      const commit = options.commit === true;
      const lines: MigrationLogLine[] = [];
      const line = (l: MigrationLogLine) => lines.push(Object.freeze({ ...l, recordIds: Object.freeze(l.recordIds.filter((id) => RECORD_ID.test(id))) }));
      const actor = { kind: "user" as const, userId: credential.userId };
      const created: string[] = [];
      let skipped = 0, planned = 0;
      const investors: InvestorReconciliation[] = [];
      const finish = (halt: Halt | null): MigrationResult => {
        if (halt) {
          line({ event: "halted", recordIds: [...halt.recordIds], reason: halt.reason });
          log.refusal({ at: clock(), actor, action: "legacy-payment-migration", reason: halt.reason, recordIds: halt.recordIds.filter((id) => RECORD_ID.test(id)) });
        }
        return { ok: true, value: Object.freeze({ mode: commit ? "commit" as const : "dry-run" as const, status: halt ? "halted" as const : "done" as const,
          halt: halt ? Object.freeze({ reason: halt.reason, recordIds: Object.freeze([...halt.recordIds]) }) : null,
          planned, created: Object.freeze([...created]), skipped, investors: Object.freeze([...investors]), log: Object.freeze([...lines]) }) };
      };

      try {
        // 1 · Read the source rows that carry any legacy value.
        const cols = legacyColumns(slots);
        const anyFilled = coqlAny(slots.map((s) => `${s.amount} is not null`));
        const sourceModule = options.source === "allotments" ? ALLOTMENTS_MODULE : CONTACTS_MODULE;
        const extra = options.source === "allotments" ? `${ALLOT_FIELDS.replace(/^id, /, "")}, ` : "";
        const sourceRows = await all(credential, `select id, ${extra}${cols.join(", ")} from ${sourceModule} where ${anyFilled} order by id asc`);
        if (sourceRows.some((r) => !orgId(r.id))) throw new SourceFail("unexpected");
        line({ event: "read", recordIds: sourceRows.map((r) => r.id) });

        // 2 · The allotment each source row pays for.
        const allotmentOf = new Map<string, Allotment>();
        if (options.source === "allotments") {
          for (const r of sourceRows) {
            const a = parseAllotment(r);
            if (!a) return finish(new Halt("allotment-invalid", [r.id]));
            allotmentOf.set(r.id, a);
          }
        } else {
          const rows = await inChunks(credential, sourceRows.map((r) => r.id),
            (list) => `select ${ALLOT_FIELDS} from ${ALLOTMENTS_MODULE} where Customer in (${list}) order by id asc`);
          const byContact = new Map<string, ZohoRecord[]>();
          for (const r of rows) { const c = orgId(r.Customer); if (c) byContact.set(c, [...(byContact.get(c) ?? []), r]); }
          for (const s of sourceRows) {
            const live = (byContact.get(s.id) ?? []).filter((r) => r.Allocation_Status !== "Cancelled");
            if (live.length !== 1) return finish(new Halt("ambiguous-allotment", [s.id, ...live.map((r) => r.id)]));
            const a = parseAllotment(live[0]);
            if (!a) return finish(new Halt("allotment-invalid", [s.id, live[0].id]));
            allotmentOf.set(s.id, a);
          }
        }

        // 3 · Plan every triplet; nothing is written unless the whole plan is clean.
        const plan: Planned[] = [];
        const seenUtr = new Map<string, string>();
        for (const s of sourceRows) {
          const a = allotmentOf.get(s.id) as Allotment;
          if (a.status === "Cancelled") return finish(new Halt("cancelled-allotment", [s.id, a.id]));
          const mine: Omit<Planned, "kind">[] = [];
          for (let i = 0; i < slots.length; i++) {
            const sl = slots[i], amt = s[sl.amount], rawUtr = s[sl.utr], rawDate = s[sl.date];
            if (blank(amt) && blank(rawUtr) && blank(rawDate)) continue;
            const amount = int(amt);
            const utr = typeof rawUtr === "string" ? rawUtr.trim().toUpperCase() : "";
            const receivedOn = typeof rawDate === "string" && DATE.test(rawDate) ? `${rawDate}T00:00:00+05:30`
              : typeof rawDate === "string" && DATETIME.test(rawDate) ? rawDate : "";
            if (amount === null || amount <= 0 || !UTR.test(utr) || !receivedOn) return finish(new Halt("malformed-slot", [s.id]));
            if (seenUtr.has(utr)) return finish(new Halt("duplicate-utr", [seenUtr.get(utr) as string, s.id]));
            seenUtr.set(utr, s.id);
            const mode = options.modes[utr];
            if (typeof mode !== "string" || !MODES.has(mode)) return finish(new Halt("mode-unknown", [s.id]));
            mine.push({ sourceId: s.id, slot: i + 1, allotmentId: a.id, amount, utr, receivedOn, mode: mode as MigrationMode });
          }
          // Kind (PROVISIONAL, jev 0.78): the payment that brings the allotment up to units × price is
          // Full; a first payment equal to the token/advance is Advance; everything else is Part.
          mine.sort((x, y) => (x.receivedOn < y.receivedOn ? -1 : x.receivedOn > y.receivedOn ? 1 : x.slot - y.slot));
          const commitment = a.units * a.unitPrice;
          let running = 0;
          mine.forEach((p, idx) => {
            const before = running; running += p.amount;
            const kind = before < commitment && running >= commitment ? "Full" : idx === 0 && a.token !== null && p.amount === a.token ? "Advance" : "Part";
            plan.push({ ...p, kind });
          });
        }

        // Reconcile per investor: the old columns must equal what the allotments say was received.
        const byInvestor = new Map<string, { sources: Set<string>; allotments: Map<string, Allotment>; legacy: number }>();
        for (const s of sourceRows) {
          const a = allotmentOf.get(s.id) as Allotment;
          const g = byInvestor.get(a.customerId) ?? { sources: new Set<string>(), allotments: new Map<string, Allotment>(), legacy: 0 };
          g.sources.add(s.id); g.allotments.set(a.id, a);
          byInvestor.set(a.customerId, g);
        }
        for (const p of plan) byInvestor.get((allotmentOf.get(p.sourceId) as Allotment).customerId)!.legacy += p.amount;
        const investorIds = [...byInvestor.keys()].sort();
        for (const inv of investorIds) {
          const g = byInvestor.get(inv)!;
          const received = [...g.allotments.values()].reduce<number | null>((t, a) => (t === null || a.received === null ? null : t + a.received), 0);
          if (received === null || received !== g.legacy) return finish(new Halt("total-mismatch", [...g.sources, ...g.allotments.keys()]));
        }

        // Idempotency: UTR is unique on Receipts.
        const existingByUtr = async (utrs: readonly string[]) => {
          const rows = await inChunks(credential, utrs, (list) => `select id, Allotment, Amount, UTR from ${RECEIPTS_MODULE} where UTR in (${list}) order by id asc`);
          const m = new Map<string, ZohoRecord>();
          for (const r of rows) if (typeof r.UTR === "string") m.set(r.UTR.trim().toUpperCase(), r);
          return m;
        };
        const existing = await existingByUtr(plan.map((p) => p.utr));
        const todo: Planned[] = [];
        for (const p of plan) {
          const e = existing.get(p.utr);
          if (!e) { todo.push(p); continue; }
          if (lookupId(e.Allotment) !== p.allotmentId || int(e.Amount) !== p.amount) return finish(new Halt("utr-conflict", [p.sourceId, e.id]));
          skipped++;
          line({ event: "skipped", recordIds: [p.sourceId, e.id] });
        }
        planned = todo.length;
        line({ event: "planned", recordIds: [...new Set(todo.map((p) => p.sourceId))] });
        if (!commit) {
          for (const inv of investorIds) investors.push(Object.freeze({ investorId: inv, allotmentIds: Object.freeze([...byInvestor.get(inv)!.allotments.keys()]), agreed: true }));
          return finish(null);
        }

        // 4 · Write investor by investor; verify before moving on.
        for (const inv of investorIds) {
          const g = byInvestor.get(inv)!;
          const mine = todo.filter((p) => g.allotments.has(p.allotmentId));
          for (let i = 0; i < mine.length; i += 100) {
            const batch = mine.slice(i, i + 100);
            const records: ZohoFields[] = batch.map((p) => ({
              Name: `Legacy ${p.sourceId}-${p.slot}`,
              Allotment: { id: p.allotmentId }, Kind: p.kind, Amount: p.amount, Mode: p.mode, UTR: p.utr, Received_On: p.receivedOn,
              // PROVISIONAL (jev 0.69): the money was banked and the units issued before the move.
              Match_State: "Matched",
              Note: `Moved from ${sourceModule} ${p.sourceId} slot ${p.slot} (M18-S12).`,
            }));
            const res = await crm.insert(credential, RECEIPTS_MODULE, records);
            if (!res.ok) {
              const partial = res.error.kind === "partial" || res.error.kind === "invalid-data" ? res.error.records ?? [] : [];
              for (const o of partial) if (o.ok && o.id && RECORD_ID.test(o.id)) created.push(o.id);
              if (partial.some((o) => o.ok)) line({ event: "created", recordIds: partial.filter((o) => o.ok && o.id).map((o) => o.id as string) });
              return finish(new Halt("write-failed", [inv, ...batch.map((p) => p.sourceId)]));
            }
            const bad = res.value.length !== batch.length || res.value.some((o) => !o.ok || !o.id || !RECORD_ID.test(o.id));
            for (const o of res.value) if (o.ok && o.id && RECORD_ID.test(o.id)) created.push(o.id);
            line({ event: "created", recordIds: res.value.filter((o) => o.ok && o.id).map((o) => o.id as string) });
            if (bad) return finish(new Halt("write-failed", [inv, ...batch.map((p) => p.sourceId)]));
          }
          const mineAll = plan.filter((p) => g.allotments.has(p.allotmentId));
          const after = await existingByUtr(mineAll.map((p) => p.utr));
          const ok = mineAll.every((p) => { const e = after.get(p.utr); return e && lookupId(e.Allotment) === p.allotmentId && int(e.Amount) === p.amount; })
            && mineAll.reduce((t, p) => t + (int(after.get(p.utr)?.Amount) ?? 0), 0) === g.legacy;
          investors.push(Object.freeze({ investorId: inv, allotmentIds: Object.freeze([...g.allotments.keys()]), agreed: ok }));
          if (!ok) return finish(new Halt("verify-mismatch", [inv, ...g.allotments.keys()]));
          line({ event: "verified", recordIds: [inv] });
        }
        return finish(null);
      } catch (e) {
        if (e instanceof SourceFail) {
          log.refusal({ at: clock(), actor, action: "legacy-payment-migration", reason: `source-${e.kind}`.slice(0, 64), recordIds: [] });
          return { ok: false, kind: "source-error", errorKind: e.kind };
        }
        throw e;
      }
    },
  });
}

/**
 * "Stop writing those columns" (A-24, M18-S12 AC5): wrap the CRM client so any insert, update or
 * upsert that names a legacy payment column on the allotments or Contacts is refused before it
 * leaves. Nothing in the app writes them today; the composition root wraps its client with this.
 */
export function retireLegacyPaymentColumns<C extends Pick<ZohoClient, "insert" | "update" | "upsert">>(
  crm: C, log: OpsLog, slots: readonly LegacySlot[] = DEFAULT_LEGACY_SLOTS,
): C {
  const retired = new Set(legacyColumns(slots));
  const guarded = new Set([ALLOTMENTS_MODULE, CONTACTS_MODULE]);
  const touches = (module: string, fields: readonly ZohoFields[]) => guarded.has(module) && fields.some((f) => Object.keys(f ?? {}).some((k) => retired.has(k)));
  const refuse = (as: UserCredential, action: string, ids: string[]) => {
    log.refusal({ at: Date.now(), actor: { kind: "user", userId: as.userId }, action, reason: "legacy-payment-column", recordIds: ids.filter((id) => RECORD_ID.test(id)) });
    return Promise.resolve({ ok: false as const, error: { kind: "refused" as const, status: null, reason: "legacy-payment-column" }, creditsRemaining: null });
  };
  return Object.freeze({
    ...crm,
    insert: (as: UserCredential, module: string, records: readonly ZohoFields[], o?: Parameters<C["insert"]>[3]) =>
      touches(module, records) ? refuse(as, "insert", []) : crm.insert(as, module, records, o),
    update: (as: UserCredential, module: string, id: string, fields: ZohoFields, o: Parameters<C["update"]>[4]) =>
      touches(module, [fields]) ? refuse(as, "update", [id]) : crm.update(as, module, id, fields, o),
    upsert: (as: UserCredential, module: string, records: readonly ZohoFields[], dup: readonly string[], o?: Parameters<C["upsert"]>[4]) =>
      touches(module, records) ? refuse(as, "upsert", []) : crm.upsert(as, module, records, dup, o),
  }) as unknown as C;
}
