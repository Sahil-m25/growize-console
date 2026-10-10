/* D138 G4 (owner ruling, 10 Oct 2026) — the 30-day balance deadline, and the date it counts from.

   The clock starts when Finance matches the 10% (confirms the payment): Hold_Until is written as the IST calendar day 30 days
   after that confirmation — server/investors/convert (holdFrom, the conversion at Finance's 10%) and server/money/match
   (holdUntilFrom, the first matched Advance of an allotment made before D137). Both keep that anchor; this file only reads it back,
   so every screen says which date the balance is counted from:
     "Balance due 9 Nov — 30 days from Finance confirming the 10% on 10 Oct"
   An APPROVED hold extension moves Hold_Until by its days (server/holds/extend: old deadline + days), so the start is
   Hold_Until − 30 − those days and the sentence says "extended by N days". A requested or declined extension does not move it.

   Day arithmetic is on the IST calendar day Zoho holds (Hold_Until is a date, already Asia/Kolkata — rule 9): UTC epoch numbers
   on "YYYY-MM-DD", so the host time zone never moves a day. Values only — no Zoho, no server import — so a client component may
   import it (the IR's chase list, the holds card, the investor record's hold banner) and the server's tests pin it to the writers. */

/** The balance window after Finance confirms the 10% (= server/money/match HOLD_DAYS = server/investors/convert HOLD_DAYS). */
export const BALANCE_DAYS = 30;

const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const epochOf = (d: string): number | null => {
  const m = DAY.exec(d);
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  return Number.isFinite(ms) ? ms : null;
};
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** "9 Nov" — the day without a leading zero, the month in three letters. */
export function shortDay(d: string): string {
  const m = DAY.exec(d);
  return m ? `${+m[3]!} ${MONTHS[+m[2]! - 1]}` : d;
}

export interface HoldExtension {
  readonly state: string | null;
  readonly days: number | null;
}

export interface BalanceClock {
  /** the last day the balance may arrive (Hold_Until, IST) */
  readonly dueDay: string;
  /** the IST day Finance confirmed the 10% — where the 30 days start */
  readonly fromDay: string;
  /** days added by an approved extension, else 0 */
  readonly extendedBy: number;
}

/** The deadline and the day it counts from; null when the hold day is not a date. */
export function balanceClock(holdUntil: string | null | undefined, ext?: HoldExtension | null): BalanceClock | null {
  const due = holdUntil ? epochOf(holdUntil) : null;
  if (due === null) return null;
  const days = ext && ext.state === "Approved" && typeof ext.days === "number" && Number.isSafeInteger(ext.days) && ext.days > 0 ? ext.days : 0;
  return Object.freeze({ dueDay: isoOf(due), fromDay: isoOf(due - (BALANCE_DAYS + days) * DAY_MS), extendedBy: days });
}

/** "Balance due 9 Nov — 30 days from Finance confirming the 10% on 10 Oct" (+ ", extended by 7 days"). */
export function balanceDueText(c: BalanceClock): string {
  return `Balance due ${shortDay(c.dueDay)} — ${BALANCE_DAYS} days from Finance confirming the 10% on ${shortDay(c.fromDay)}`
    + (c.extendedBy ? `, extended by ${c.extendedBy} day${c.extendedBy === 1 ? "" : "s"}` : "");
}

/** The sentence straight from a hold day; "" when there is none. */
export const balanceDueFor = (holdUntil: string | null | undefined, ext?: HoldExtension | null): string => {
  const c = balanceClock(holdUntil, ext);
  return c ? balanceDueText(c) : "";
};
