/* THE ONE CLOCK (CLAUDE.md rule 9). The wall clock in Asia/Kolkata, as a naive ISO string
   "YYYY-MM-DDTHH:mm" — the same shape the Investors side's `data.NOW` already uses — and its
   reading back into a Date whose local fields ARE that wall time, so every day boundary the
   console draws is Kolkata's whatever the host or browser zone. */

const TZ = "Asia/Kolkata";

/** The wall clock in Asia/Kolkata right now (or at `at`), "YYYY-MM-DDTHH:mm". */
export function kolkataNow(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/** "YYYY-MM-DD" of a naive clock string — its day. */
export const clockDay = (iso: string): string => iso.slice(0, 10) + "T00:00";

/** A naive clock string read back as a Date carrying that wall time in its local fields. */
export function reviveClock(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) throw new Error("data: clock must be an ISO wall time, got " + iso);
  return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] || 0), +(m[5] || 0));
}
