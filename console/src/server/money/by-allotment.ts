/**
 * M10-S08-T01 — MONEY GROUPED BY ALLOTMENT (D48, D70): one block per allotment (so per farm LLP), the
 * receipts linked to that allotment under it, paid / due / Payment_Status per block, and a total.
 *
 * The money rules are the ones the Investors list (investors/finance-list), the investor record
 * (investors/record) and the Payments register (money/register) already apply, restated here as pure
 * functions so every screen's number comes from the same arithmetic (the tests replay one set of receipts
 * through the register and through these functions and require the same totals):
 *   a receipt stands unless Reversed / Not found / Claimed
 *   paid        = inbound receipts (Advance, Part/Balance, Full) that stand
 *   standing    = paid − Refunds that stand
 *   due         = on a Reserved allotment, units × unit price − standing, never below 0 (0 once Issued)
 *   status      = money/allotment-receipts expectedPaymentStatus over MATCHED inbound − matched refunds
 * The total sums the blocks that count on the Investors row (Cancelled allotments do not), so it equals
 * that row; it is offered only when there is more than one block (AC4).
 *
 * The read itself is ./investors/allotments byContact (one Contact admission, one related-list read of the
 * allotments, one Receipts read by allotment id) — this module only groups. Money is a Finance-side
 * section: a seat whose record has no Money (a KAM, an IR) is refused before anything is read.
 * Nothing is cached; rows live for one response (D45).
 */

import type { UserCredential } from "../../lib/zoho/client";
import type { ReceiptRow } from "../data/adapters";
import type { AllotmentReader, AllotmentLine } from "../investors/allotments";
import { expectedPaymentStatus, type PaymentStatus } from "./allotment-receipts";

const NOT_STANDING: ReadonlySet<string> = new Set(["Reversed", "Not found", "Claimed"]);
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);

export interface MoneyAllotment {
  readonly id: string;
  readonly status: "Reserved" | "Issued" | "Cancelled";
  /** Units the amount is over: max(issued, reserved) — the Investors list's committed units. */
  readonly units: number;
  /** Unit_Price as recorded on the allotment (never today's LLP price). */
  readonly unitPrice: number;
}

export interface AllotmentMoney {
  readonly paid: number;
  readonly standing: number;
  readonly matchedNet: number;
  readonly amount: number;
  readonly due: number;
  readonly paymentStatus: PaymentStatus;
}

const refundOf = (r: ReceiptRow) => r.kind === "Refund" || !!r.reversalOf;
const inboundOf = (r: ReceiptRow) => !refundOf(r) && !!r.kind && INBOUND.has(r.kind);

/** The money of one allotment from the receipts linked to it (receipts of other allotments are ignored). */
export function moneyOf(a: MoneyAllotment, receipts: readonly ReceiptRow[]): AllotmentMoney {
  let paid = 0, standing = 0, matchedIn = 0, matchedOut = 0;
  for (const r of receipts) {
    if (r.allotmentId !== a.id) continue;
    const isIn = inboundOf(r), isOut = refundOf(r);
    if (r.matched) { if (isIn) matchedIn += r.amount; else if (isOut) matchedOut += r.amount; }
    if (r.matchState && NOT_STANDING.has(r.matchState)) continue;
    if (isIn) paid += r.amount;
    standing += isIn ? r.amount : isOut ? -r.amount : 0;
  }
  const amount = a.units * a.unitPrice;
  const due = a.status === "Reserved" ? Math.max(0, amount - standing) : 0;
  const matchedNet = Math.max(0, matchedIn - matchedOut);
  return Object.freeze({ paid, standing, matchedNet, amount, due, paymentStatus: expectedPaymentStatus(matchedNet, amount) });
}

export interface MoneyBlock {
  readonly allotmentId: string;
  readonly llp: { readonly id: string | null; readonly name: string | null };
  readonly status: MoneyAllotment["status"];
  readonly units: number;
  readonly issuedUnits: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly paid: number;
  readonly due: number;
  readonly paymentStatus: PaymentStatus;
  /** false for a Cancelled allotment: shown, but not in the total (the Investors row leaves it out too). */
  readonly countsInTotal: boolean;
  readonly receipts: readonly ReceiptRow[];
}

export interface MoneyByAllotment {
  readonly contactId: string;
  readonly blocks: readonly MoneyBlock[];
  /** Sum of paid / due over the blocks that count; null with fewer than two blocks (AC4). */
  readonly total: { readonly paid: number; readonly due: number } | null;
  /** The same sums whatever the block count — what the Investors row shows. */
  readonly investorRow: { readonly paid: number; readonly due: number };
  /** Receipts read for this investor that name no allotment of theirs (none expected; shown, never summed). */
  readonly unlinked: readonly ReceiptRow[];
}

/** Group receipts under their allotments. Pure: no read, no clock. */
export function groupByAllotment(contactId: string, rows: readonly AllotmentLine[], receipts: readonly ReceiptRow[]): MoneyByAllotment {
  const ids = new Set(rows.map((a) => a.id));
  const blocks = rows.map((a): MoneyBlock => {
    const m = moneyOf({ id: a.id, status: a.status, units: a.committedUnits, unitPrice: a.unitPrice ?? 0 }, receipts);
    return Object.freeze({
      allotmentId: a.id, llp: a.llp, status: a.status, units: a.committedUnits, issuedUnits: a.issuedUnits, unitPrice: a.unitPrice ?? 0,
      amount: m.amount, paid: m.paid, due: m.due, paymentStatus: m.paymentStatus, countsInTotal: a.status !== "Cancelled",
      receipts: Object.freeze(receipts.filter((r) => r.allotmentId === a.id)),
    });
  });
  const counted = blocks.filter((b) => b.countsInTotal);
  const investorRow = Object.freeze({ paid: counted.reduce((t, b) => t + b.paid, 0), due: counted.reduce((t, b) => t + b.due, 0) });
  return Object.freeze({
    contactId, blocks: Object.freeze(blocks), total: blocks.length > 1 ? investorRow : null, investorRow,
    unlinked: Object.freeze(receipts.filter((r) => !r.allotmentId || !ids.has(r.allotmentId))),
  });
}

export type MoneyByAllotmentResult =
  | { readonly ok: true; readonly money: MoneyByAllotment }
  | Exclude<Awaited<ReturnType<AllotmentReader["byContact"]>>, { readonly ok: true }>;

/** The Money section of one investor, per allotment. Only a seat whose record has Money gets one. */
export function createMoneyByAllotment(deps: { readonly allotments: AllotmentReader }) {
  return Object.freeze({
    async read(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal): Promise<MoneyByAllotmentResult> {
      const r = await deps.allotments.byContact(cred, seat, contactId, signal, { requireMoney: true });
      if (!r.ok) return r;
      return { ok: true, money: groupByAllotment(contactId, r.rows, r.receipts ?? []) };
    },
  });
}
