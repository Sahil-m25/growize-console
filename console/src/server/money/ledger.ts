/**
 * M01-S08-NOTE-5 / M10 — THE SIGNED RECEIPT LEDGER: the one function that turns an allotment's receipt rows into
 * money (CLAUDE.md rule 1). The Payments register (./register), the Money section (./by-allotment moneyOf, and so
 * the investor record) and the receipt replay writer (./receipt-replay) all call `ledgerOf`, so the register's
 * figures and what the replay seals are the same numbers.
 *
 * Convention (D21: recording is free, only matched money counts; D19: a gate closes on the reversal of its fact):
 *   - signed amount   inbound kinds (Advance, Part, Balance, Full) are +amount — Balance is D70's name for what the
 *                     org's picklist calls Part, read as the same inbound kind; a Refund is money out, −amount.
 *   - a Forfeit       money KEPT on a lapse or release (D22, D43: "forfeits do not add credit"), never money due and
 *                     never money in: the matched money it is kept from is already counted, and the rest goes out as
 *                     a Refund. It moves no standing money; a Matched, uncancelled Forfeit shows in `forfeited` only.
 *   - Matched         counts (matchedIn / matchedOut).
 *   - Pending         recorded, not yet matched: pendingIn / pendingOut — never in matched (D21).
 *   - Not found, Claimed, Reversed   count nowhere. Match_State "Reversed" on a receipt is that receipt cancelled.
 *   - a reversal      a row with Reversal_Of = X cancels X. It carries no money of its own (whatever its Kind):
 *                     Matched (approved — D22's second hand), X counts nowhere, exactly once even when X is also
 *                     flipped to "Reversed" (no double subtraction); Pending (awaiting approval), X still counts
 *                     where it stood and the reversal shows in pending as X's signed amount taken back;
 *                     Not found / Claimed / Reversed, the reversal itself is void.
 *
 * Anomalies — a reversal whose target is missing, on another allotment, itself a reversal, of a different amount,
 * or a second live reversal of a receipt already reversed — are reported by id. They change no figure (the first
 * three cancel nothing; a duplicate reversal cancels nothing twice), so a reader still shows the money; a WRITER
 * that seals a precondition from the ledger (the replay) refuses while any anomaly stands.
 *
 * Pure: no read, no clock, no cache.
 */

export const INBOUND_KINDS: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
export const REFUND_KIND = "Refund";
export const FORFEIT_KIND = "Forfeit";
/** Every Kind a receipt row may carry. A row of any other kind is not a ledger row (a reader refuses it). */
export const LEDGER_KINDS: ReadonlySet<string> = new Set([...INBOUND_KINDS, REFUND_KIND, FORFEIT_KIND]);

export interface LedgerEntry {
  readonly id: string;
  readonly allotmentId: string | null;
  readonly kind: string | null;
  /** Whole rupees, positive. */
  readonly amount: number;
  readonly matchState: string | null;
  readonly reversalOf: string | null;
}

export interface LedgerSums {
  readonly matchedIn: number;
  readonly matchedOut: number;
  readonly pendingIn: number;
  readonly pendingOut: number;
  /** Matched forfeits, not cancelled: money kept on a lapse/release. In no other figure (standing, due, recorded). */
  readonly forfeited: number;
}

export interface Ledger {
  /** allotment id → its sums. An allotment with no counting row may be absent: read it with `sumsOf`. */
  readonly byAllotment: ReadonlyMap<string, LedgerSums>;
  /** Receipt ids of reversal rows that break the convention (see the header). Empty on a clean ledger. */
  readonly anomalies: readonly string[];
}

const LIVE: ReadonlySet<string> = new Set(["Matched", "Pending"]);
const ZERO: LedgerSums = Object.freeze({ matchedIn: 0, matchedOut: 0, pendingIn: 0, pendingOut: 0, forfeited: 0 });

/** +amount for money in, −amount for a refund, 0 otherwise (a Forfeit included: it is kept, not moved). */
export const signedOf = (e: Pick<LedgerEntry, "kind" | "amount">): number =>
  e.kind && INBOUND_KINDS.has(e.kind) ? e.amount : e.kind === REFUND_KIND ? -e.amount : 0;

/** matched in − matched out (may be negative: an over-refund is still money and stays readable). */
export const standingOf = (s: LedgerSums): number => s.matchedIn - s.matchedOut;
/** recorded, not yet matched: pending in − pending out. */
export const recordedOf = (s: LedgerSums): number => s.pendingIn - s.pendingOut;
/** Still due on an allotment: on a Reserved allotment, commitment − matched net (never below 0); 0 otherwise. */
export const dueOf = (status: string, commitment: number, s: LedgerSums): number =>
  status === "Reserved" ? Math.max(0, commitment - Math.max(0, standingOf(s))) : 0;

export const sumsOf = (l: Ledger, allotmentId: string): LedgerSums => l.byAllotment.get(allotmentId) ?? ZERO;

/** The one signed-ledger function. Order of `rows` never changes the answer. */
export function ledgerOf(rows: readonly LedgerEntry[]): Ledger {
  const byId = new Map<string, LedgerEntry>();
  for (const r of rows) byId.set(r.id, r);
  const anomalies = new Set<string>();
  const cancelled = new Set<string>();
  const pendingReversal = new Map<string, string>();   // target id → the pending reversal that takes it back
  const approved = new Map<string, string>();          // target id → the matched reversal that cancelled it
  // Matched reversals first, so "a second live reversal" does not depend on row order.
  const reversals = rows.filter((r) => r.reversalOf !== null && r.matchState !== null && LIVE.has(r.matchState))
    .sort((a, b) => (a.matchState === b.matchState ? a.id.localeCompare(b.id) : a.matchState === "Matched" ? -1 : 1));
  for (const r of reversals) {
    const t = byId.get(r.reversalOf as string);
    if (!t || t.id === r.id || t.allotmentId !== r.allotmentId || t.reversalOf !== null || t.amount !== r.amount) { anomalies.add(r.id); continue; }
    if (approved.has(t.id) || pendingReversal.has(t.id)) { anomalies.add(r.id); continue; }
    if (r.matchState === "Matched") { approved.set(t.id, r.id); cancelled.add(t.id); }
    else pendingReversal.set(t.id, r.id);
  }

  const acc = new Map<string, { matchedIn: number; matchedOut: number; pendingIn: number; pendingOut: number; forfeited: number }>();
  const at = (id: string) => { let s = acc.get(id); if (!s) acc.set(id, (s = { matchedIn: 0, matchedOut: 0, pendingIn: 0, pendingOut: 0, forfeited: 0 })); return s; };
  for (const r of rows) {
    if (!r.allotmentId || r.reversalOf !== null || cancelled.has(r.id)) continue;
    if (r.kind === FORFEIT_KIND) { if (r.matchState === "Matched") at(r.allotmentId).forfeited += r.amount; continue; }
    const v = signedOf(r);
    if (v === 0) continue;
    const s = at(r.allotmentId);
    if (r.matchState === "Matched") { if (v > 0) s.matchedIn += v; else s.matchedOut -= v; }
    else if (r.matchState === "Pending") { if (v > 0) s.pendingIn += v; else s.pendingOut -= v; }
    else continue;
    // a pending reversal of this receipt: taken back in pending, never in matched (D21)
    if (pendingReversal.has(r.id)) { if (v > 0) s.pendingOut += v; else s.pendingIn -= v; }
  }
  const byAllotment = new Map<string, LedgerSums>();
  for (const [id, s] of acc) byAllotment.set(id, Object.freeze({ ...s }));
  return Object.freeze({ byAllotment, anomalies: Object.freeze([...anomalies].sort()) });
}
