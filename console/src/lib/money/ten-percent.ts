/* D137 (owner rulings, 9 Oct 2026) — the 10% and the balance, as one trail both sides read.

   Ruling 2(a): a Part payment DOES count toward the 10%. The 10% is reached when the SUM of Finance-matched inbound receipts
   (Advance, Part, Balance, Full) minus matched refunds reaches 10% of the committed amount. Each receipt in the trail carries its
   date-time in Asia/Kolkata, its amount, its reference masked to the last four (never the full UTR), who matched it, and the
   running total against the 10% threshold. Ruling 3: the same trail says when the committed amount is fully in (matched total >=
   committed) — that is when the allotment converts in full.

   Values only — no Zoho, no server import — so a client component may import this file (the unlock card, the lead's Money view)
   and the server (server/investors/unlock, server/investors/convert, server/money/match) decides with the same arithmetic. */

/** Inbound kinds that count toward the 10% and the balance. Part is the live name of D70's Balance. */
export const COUNTING_KINDS: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
export const REFUND_KIND = "Refund";
/** 10% of the committed amount, rounded UP to the whole rupee (₹1,00,001 committed needs ₹10,001, never ₹10,000). */
export const tenPercentOf = (committed: number): number => Math.ceil(committed / 10);

/** One receipt as the trail reads it. `at`: Matched_At when Zoho has it, else Received_On (then `atIsReceived`). */
export interface TrailReceipt {
  readonly id: string;
  readonly kind: string;
  readonly amount: number;
  readonly state: string;
  readonly at: string | null;
  readonly atIsReceived?: boolean;
  /** the raw reference as Zoho holds it — masked here, never passed on */
  readonly ref?: string | null;
  readonly matchedById?: string | null;
}

export interface TrailRow {
  readonly receiptId: string;
  readonly kind: string;
  /** signed: a refund is negative */
  readonly amount: number;
  readonly at: string | null;
  /** "9 Oct 2026, 14:05 IST" (or the received day, "9 Oct 2026 (received)") */
  readonly atIst: string;
  readonly refMasked: string;
  readonly matchedById: string | null;
  readonly runningTotal: number;
  /** this receipt took the running total to the 10% */
  readonly reachedTen: boolean;
  /** this receipt took the running total to the committed amount */
  readonly reachedFull: boolean;
}

export interface TenPercentTrail {
  /** null: not known yet (no farm/units chosen, or the allotment's price unread) — then nothing is "reached" */
  readonly committed: number | null;
  readonly threshold: number | null;
  readonly matched: number;
  readonly rows: readonly TrailRow[];
  readonly reached: boolean;
  readonly reachedAt: string | null;
  readonly reachedBy: string | null;
  readonly fullyPaid: boolean;
  readonly fullAt: string | null;
  readonly fullBy: string | null;
  /** committed − matched, never below zero; null when committed is unknown */
  readonly balanceDue: number | null;
  /** receipts recorded and not yet matched (Pending / Claimed): they count for nothing until Finance matches them */
  readonly unmatched: number;
}

/** "••• 1234": the last four and no more (rule 7; lib/format maskRef is the same rule). */
export function maskReference(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return !s ? "—" : s.length <= 4 ? "••••" : "••• " + s.slice(-4);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A Zoho datetime or day as the trail prints it, in Asia/Kolkata (rule 9). */
export function istWhen(at: string | null, receivedDay = false): string {
  if (!at) return "date not recorded";
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(at);
  const t = Date.parse(dayOnly ? at + "T00:00:00+05:30" : at);
  if (Number.isNaN(t)) return "date not recorded";
  const d = new Date(t + 5.5 * 3_600_000);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (dayOnly || receivedDay) return day + " (received)";
  return `${day}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} IST`;
}

const sortKey = (r: TrailReceipt): number => {
  if (!r.at) return Number.MAX_SAFE_INTEGER;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(r.at) ? r.at + "T00:00:00+05:30" : r.at);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

/** The trail: matched receipts oldest first with the running total; pending ones only counted in `unmatched`. */
export function tenPercentTrail(committed: number | null, receipts: readonly TrailReceipt[]): TenPercentTrail {
  const known = typeof committed === "number" && Number.isSafeInteger(committed) && committed > 0 ? committed : null;
  const threshold = known === null ? null : tenPercentOf(known);
  const matched = receipts.filter((r) => r.state === "Matched" && Number.isSafeInteger(r.amount) && r.amount > 0
    && (COUNTING_KINDS.has(r.kind) || r.kind === REFUND_KIND));
  const unmatched = receipts.filter((r) => (r.state === "Pending" || r.state === "Claimed") && COUNTING_KINDS.has(r.kind))
    .reduce((t, r) => t + (Number.isSafeInteger(r.amount) && r.amount > 0 ? r.amount : 0), 0);
  const ordered = [...matched].sort((a, b) => sortKey(a) - sortKey(b) || a.id.localeCompare(b.id));
  let run = 0, reachedAt: string | null = null, reachedBy: string | null = null, fullAt: string | null = null, fullBy: string | null = null;
  let tenDone = false, fullDone = false;
  const rows = ordered.map((r): TrailRow => {
    const signed = r.kind === REFUND_KIND ? -r.amount : r.amount;
    run += signed;
    const hitTen = threshold !== null && !tenDone && run >= threshold;
    const hitFull = known !== null && !fullDone && run >= known;
    if (hitTen) { tenDone = true; reachedAt = r.at; reachedBy = r.matchedById ?? null; }
    if (hitFull) { fullDone = true; fullAt = r.at; fullBy = r.matchedById ?? null; }
    /* a refund that takes the total back under a line re-opens it: the line is crossed again by a later receipt */
    if (threshold !== null && run < threshold) tenDone = false;
    if (known !== null && run < known) fullDone = false;
    return Object.freeze({
      receiptId: r.id, kind: r.kind, amount: signed, at: r.at, atIst: istWhen(r.at, !!r.atIsReceived),
      refMasked: maskReference(r.ref), matchedById: r.matchedById ?? null, runningTotal: run, reachedTen: hitTen, reachedFull: hitFull,
    });
  });
  const reached = threshold !== null && run >= threshold;
  const fullyPaid = known !== null && run >= known;
  return Object.freeze({
    committed: known, threshold, matched: run, rows: Object.freeze(rows),
    reached, reachedAt: reached ? reachedAt : null, reachedBy: reached ? reachedBy : null,
    fullyPaid, fullAt: fullyPaid ? fullAt : null, fullBy: fullyPaid ? fullBy : null,
    balanceDue: known === null ? null : Math.max(0, known - run), unmatched,
  });
}

const inr = (n: number): string => "₹" + n.toLocaleString("en-IN");
/** One line for the gate's explanation: "₹60,000 of ₹1,00,000 (10% of ₹10,00,000) matched — ₹40,000 to go". */
export function trailSummary(t: TenPercentTrail): string {
  if (t.committed === null || t.threshold === null) return `${inr(t.matched)} matched — the committed amount is not known yet, so the 10% cannot be worked out.`;
  if (t.fullyPaid) return `${inr(t.matched)} matched of ${inr(t.committed)} committed — fully paid.`;
  if (t.reached) return `${inr(t.matched)} matched — the 10% (${inr(t.threshold)}) is in; ${inr(t.balanceDue ?? 0)} balance due.`;
  return `${inr(t.matched)} of ${inr(t.threshold)} (10% of ${inr(t.committed)}) matched — ${inr(t.threshold - t.matched)} to go.`
    + (t.unmatched ? ` ${inr(t.unmatched)} recorded and waiting for Finance to match it.` : "");
}
