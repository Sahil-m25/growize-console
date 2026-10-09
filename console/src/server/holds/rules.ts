/**
 * M08-S04-T02 / T04, M05-S06-T01 — THE HOLD AND MONEY RULES the holds reads, the lapse, the extension and the
 * Investors-side headline share, so each number has one rule (CLAUDE.md rule 1) and one clock (rule 9).
 *
 *   clock       holdUntilFrom / istDay from ../money/match (the one IST hold function: "the calendar day n days
 *               after the IST day of the moment"). Days left = hold day − today's IST day; negative once run out.
 *               The hold is running through its last day (lapse-release: hold >= today is running).
 *   money       ../money/ledger ledgerOf — the one signed ledger the Payments register, the Money section and the receipt
 *               replay use (M01-S08-NOTE-3): inbound kinds (Advance, Part, Balance, Full) minus Refund, MATCHED receipts
 *               only (D21), a matched reversal (Reversal_Of) cancelling the receipt it names once; a Forfeit is kept
 *               money, never money in. committed = units × Unit_Price (Reserved_Units while Reserved, Issued_Units once Issued).
 *               The ledger needs ROWS (an aggregate cannot see Reversal_Of): `readLedgerReceipts` reads id, Allotment, Kind,
 *               Amount, Match_State, Reversal_Of — no UTR, no identity — one COQL call per 2,000 receipts (per IN chunk
 *               of ≤ 100 allotments for a hold read; the whole book for Today / Numbers). At today's book (≈ 200
 *               investors, a few receipts each) that is the same one call the aggregate cost; rows are never cached.
 *   forfeit     ₹50,000 a unit (lib/im FORFEIT); refund on a lapse = max(0, matched net − forfeit).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { FORFEIT } from "../../lib/im/constants";
import { holdDaysLeft } from "../../lib/im/dates";
import { factEventId, holdUntilFrom, istDay, istIso } from "../money/match";
import { INBOUND_KINDS as LEDGER_INBOUND, ledgerOf, LEDGER_KINDS, REFUND_KIND as LEDGER_REFUND, signedOf, standingOf, type LedgerEntry } from "../money/ledger";

export { holdUntilFrom, istDay } from "../money/match";
export const FORFEIT_PER_UNIT = FORFEIT;
/** Holds on Today: deadline on or before today + 21 (M08-S04-T04). */
export const HOLD_WINDOW_DAYS = 21;
/** Three days or fewer is urgent (red). */
export const URGENT_DAYS = 3;
/** Kinds that bring money in; Part is the live name of D70's Balance — the ledger's own sets (../money/ledger). */
export const INBOUND_KINDS: ReadonlySet<string> = LEDGER_INBOUND;
export const REFUND_KIND = LEDGER_REFUND;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" of a Zoho date/datetime, or null. */
export const dayOf = (v: unknown): string | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** Days from today (IST) to the hold's last day; 0 on the last day, negative once it has run out. */
export const daysLeft = (holdDay: string, nowMs: number): number => holdDaysLeft(holdDay, nowMs);

/** The deadline as the contract carries it: the end of the hold's last day in Asia/Kolkata. */
export const deadlineIso = (holdDay: string): string => `${holdDay}T23:59:59+05:30`;

/** The extension's new last day: the old deadline + days, never today + days (prototype decideExt). */
export function extendedDeadline(currentHoldDay: string, days: number): string {
  return holdUntilFrom(Date.parse(`${currentHoldDay}T00:00:00+05:30`), days);
}

/** units × unit price, the register's commitment; null when unreadable. */
export function commitmentOf(units: unknown, price: unknown): number | null {
  if (typeof units !== "number" || typeof price !== "number" || !Number.isSafeInteger(units) || !Number.isSafeInteger(price) || units < 0 || price < 0) return null;
  const c = units * price;
  return Number.isSafeInteger(c) ? c : null;
}

export interface MatchedMoney {
  readonly inbound: number;
  readonly refunded: number;
  /** inbound − refunded over everything read. */
  readonly net: number;
  /** allotment id → its matched inbound − refunds (the ledger's standing). */
  readonly byAllotment: ReadonlyMap<string, number>;
  /** Reversal rows that break the ledger's convention (../money/ledger); they change no figure. */
  readonly anomalies: readonly string[];
}

const RECEIPT_ID = /^\d{15,22}$/;
const lookup = (v: unknown): string | null => {
  if (typeof v === "string" && RECEIPT_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECEIPT_ID.test(id) ? id : null;
};

/** The Receipts fields the ledger reads — no UTR, no identity, no free text. */
export const LEDGER_RECEIPT_FIELDS: readonly string[] = Object.freeze(["id", "Allotment", "Kind", "Amount", "Match_State", "Reversal_Of"]);
export const LEDGER_PAGE = 2_000;
export const LEDGER_MAX_PAGES = 5;

/** A Receipts row as a ledger entry; null when it cannot be one (no id, an unknown kind, a non-positive amount). */
export function ledgerEntryOf(r: ZohoRecord): LedgerEntry | null {
  const id = lookup(r.id), amount = r.Amount;
  if (!id || typeof r.Kind !== "string" || !LEDGER_KINDS.has(r.Kind) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null;
  return { id, allotmentId: lookup(r.Allotment), kind: r.Kind, amount, matchState: typeof r.Match_State === "string" ? r.Match_State : null, reversalOf: lookup(r.Reversal_Of) };
}

export type LedgerRead =
  | { readonly ok: true; readonly rows: readonly ZohoRecord[]; readonly entries: readonly LedgerEntry[] }
  | { readonly ok: false; readonly errorKind: string };

/**
 * Every Receipts row matching `where` (every Match_State: a matched reversal's target may already be flipped to
 * Reversed), paged 2,000 a call, on the person's own token. More than `maxPages` pages is `truncated` — money is
 * never summed over part of a ledger. `extra` adds fields a caller needs alongside (Received_On, Allotment.LLP).
 */
export async function readLedgerReceipts(
  crm: Pick<ZohoClient, "coql">, cred: UserCredential, where: string,
  o: { readonly signal?: AbortSignal; readonly maxPages?: number; readonly extra?: readonly string[] } = {},
): Promise<LedgerRead> {
  const fields = [...LEDGER_RECEIPT_FIELDS, ...(o.extra ?? [])].join(", ");
  const rows: ZohoRecord[] = [];
  for (let page = 0; page < (o.maxPages ?? LEDGER_MAX_PAGES); page++) {
    let r: Awaited<ReturnType<typeof crm.coql>>;
    try {
      r = await crm.coql(cred, `select ${fields} from Receipts where (${where}) order by id asc limit ${page * LEDGER_PAGE}, ${LEDGER_PAGE}`, { signal: o.signal });
    } catch { return { ok: false, errorKind: "unexpected" }; }
    if (!r.ok) return { ok: false, errorKind: r.error.kind };
    rows.push(...r.value.records);
    if (!r.value.moreRecords) {
      const entries: LedgerEntry[] = [];
      for (const x of rows) { const e = ledgerEntryOf(x); if (e) entries.push(e); }
      return { ok: true, rows, entries };
    }
  }
  return { ok: false, errorKind: "truncated" };
}

/**
 * Receipt rows (ledger entries) → matched money, through ../money/ledger: a matched reversal cancels its target once,
 * a refund is money out, Pending never counts (D21), a Forfeit adds nothing. A matched row without an allotment still
 * counts toward the total (it is banked money), never toward an allotment.
 */
export function matchedMoneyOf(entries: readonly LedgerEntry[]): MatchedMoney {
  const l = ledgerOf(entries);
  let inbound = 0, refunded = 0;
  const by = new Map<string, number>();
  for (const [id, s] of l.byAllotment) { inbound += s.matchedIn; refunded += s.matchedOut; by.set(id, standingOf(s)); }
  for (const e of entries) {
    if (e.allotmentId || e.reversalOf !== null || e.matchState !== "Matched") continue;
    const v = signedOf(e);
    if (v > 0) inbound += v; else refunded -= v;
  }
  return Object.freeze({ inbound, refunded, net: inbound - refunded, byAllotment: by, anomalies: l.anomalies });
}

/** Balance still due on a reservation: committed − matched net, never below 0. */
export const dueOf = (committed: number, matchedNet: number): number => Math.max(0, committed - Math.max(0, matchedNet));
/** What a lapse keeps and returns (prototype lapseHold): forfeit a unit, refund the rest of the matched money. */
export function lapseMoney(units: number, matchedNet: number): { readonly forfeit: number; readonly refund: number } {
  const forfeit = FORFEIT_PER_UNIT * Math.max(0, units);
  return Object.freeze({ forfeit, refund: Math.max(0, Math.max(0, matchedNet) - forfeit) });
}

export type HoldState = "open" | "extended" | "lapsed" | "released";

/** hold.changed (contracts/hold.changed.json): ids carry the investor; the event id is derived from the fact. */
export function holdChangedEvent(e: {
  readonly allotmentId: string; readonly investorId: string; readonly holdDay: string; readonly state: HoldState;
  readonly at: number; readonly by?: string | null; readonly reason?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { deadline: deadlineIso(e.holdDay), state: e.state };
  if (e.reason) payload.reason = e.reason.slice(0, 200);
  if (e.by) payload.by = e.by;
  return {
    event_id: factEventId(`hold.changed:${e.allotmentId}:${e.state}:${e.holdDay}`), type: "hold.changed", schema_version: 1,
    occurred_at: istIso(e.at), actor: e.by ? { kind: "user", zoho_user_id: e.by } : { kind: "system" },
    ids: { investor_contact_id: e.investorId }, payload, origin: "console",
  };
}
