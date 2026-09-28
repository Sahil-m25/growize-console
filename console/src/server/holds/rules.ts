/**
 * M08-S04-T02 / T04, M05-S06-T01 — THE HOLD AND MONEY RULES the holds reads, the lapse, the extension and the
 * Investors-side headline share, so each number has one rule (CLAUDE.md rule 1) and one clock (rule 9).
 *
 *   clock       holdUntilFrom / istDay from ../money/match (the one IST hold function: "the calendar day n days
 *               after the IST day of the moment"). Days left = hold day − today's IST day; negative once run out.
 *               The hold is running through its last day (lapse-release: hold >= today is running).
 *   money       the money/register + money/allotment-receipts rule: inbound kinds (Advance, Part, Balance, Full)
 *               minus Refund, MATCHED receipts only (D21 — recording is free, only matched money counts);
 *               committed = units × Unit_Price (Reserved_Units while Reserved, Issued_Units once Issued).
 *   forfeit     ₹50,000 a unit (lib/im FORFEIT); refund on a lapse = max(0, matched net − forfeit).
 */

import type { AggregateRow } from "../../lib/zoho/client";
import { FORFEIT } from "../../lib/im/constants";
import { factEventId, holdUntilFrom, istDay, istIso } from "../money/match";

export { holdUntilFrom, istDay } from "../money/match";
export const FORFEIT_PER_UNIT = FORFEIT;
/** Holds on Today: deadline on or before today + 21 (M08-S04-T04). */
export const HOLD_WINDOW_DAYS = 21;
/** Three days or fewer is urgent (red). */
export const URGENT_DAYS = 3;
/** Kinds that bring money in; Part is the live name of D70's Balance (register.ts, allotment-receipts.ts). */
export const INBOUND_KINDS: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
export const REFUND_KIND = "Refund";

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" of a Zoho date/datetime, or null. */
export const dayOf = (v: unknown): string | null => (typeof v === "string" && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null);

/** Days from today (IST) to the hold's last day; 0 on the last day, negative once it has run out. */
export function daysLeft(holdDay: string, nowMs: number): number {
  return Math.round((Date.parse(`${holdDay}T00:00:00Z`) - Date.parse(`${istDay(nowMs)}T00:00:00Z`)) / DAY_MS);
}

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
  /** allotment id → its matched inbound − refunds. */
  readonly byAllotment: ReadonlyMap<string, number>;
}

/**
 * Rows of `select Allotment, Kind, SUM(Amount) from Receipts where Match_State = 'Matched' … group by Allotment, Kind`
 * → matched money. A row without an allotment still counts toward the total (it is banked money).
 */
export function matchedMoneyOf(rows: readonly AggregateRow[]): MatchedMoney {
  let inbound = 0, refunded = 0;
  const by = new Map<string, number>();
  for (const r of rows) {
    const amount = r["SUM(Amount)"];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
    const kind = typeof r.Kind === "string" ? r.Kind : "";
    const sign = INBOUND_KINDS.has(kind) ? 1 : kind === REFUND_KIND ? -1 : 0;
    if (!sign) continue;
    if (sign > 0) inbound += amount; else refunded += amount;
    const a = typeof r.Allotment === "string" ? r.Allotment : null;
    if (a) by.set(a, (by.get(a) ?? 0) + sign * amount);
  }
  return Object.freeze({ inbound, refunded, net: inbound - refunded, byAllotment: by });
}

/** The matched-money aggregate over a set of allotments (ids already checked; ≤ 100 per IN). */
export const matchedByAllotmentQuery = (inClause: string | null): string =>
  `select Allotment, Kind, SUM(Amount) from Receipts where Match_State = 'Matched'${inClause ? ` and ${inClause}` : ""} group by Allotment, Kind limit 0, 2000`;

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
