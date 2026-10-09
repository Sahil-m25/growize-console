/* ── im/dates.ts — one clock, fixed (imx.js lines 130–159, 413) ──────────────────────────────
   The prototype's clock is `TODAY = new Date(2026,8,2)` (local midnight) and `stamp()` borrowed the
   wall clock's time of day. Here the clock is `data.NOW`, a naive ISO string ("2026-09-02T00:00"),
   read as wall time. Day arithmetic uses NOW's midnight, exactly as the prototype's NOW was a
   midnight; `stamp` uses NOW's own time of day. All arithmetic is on UTC epoch numbers so the host
   time zone can never move a date. Dates are epoch milliseconds (`number`), never `Date` objects.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { DAY, MON, MONI } from "./constants";

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** NOW as epoch ms, time of day included. */
export function nowFull(NOW: string): number {
  const m = ISO.exec(NOW);
  if (!m) throw new Error("im: NOW must be an ISO date, got " + NOW);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
/** NOW's midnight — the prototype's `NOW`/`TODAY`. */
export function nowDay(NOW: string): number {
  const f = nowFull(NOW);
  return f - (((f % DAY) + DAY) % DAY);
}
const pad2 = (n: number) => String(n).padStart(2, "0");
/** "02 Sep" */
export function fmtDay(ms: number): string {
  const d = new Date(ms);
  return pad2(d.getUTCDate()) + " " + MON[d.getUTCMonth()];
}
/** "02 Sep 14:20" */
export function fmtStamp(ms: number): string {
  const d = new Date(ms);
  return fmtDay(ms) + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}

const IST_MS = 5.5 * 3_600_000;
/** A live ISO / Zoho datetime ("2026-10-05T04:15" naive IST, or "…:00+05:30" / "…Z") as IST wall time in epoch ms (rule 9), else null. */
export function isoWall(t: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(String(t ?? "").trim());
  if (!m) return null;
  if (m[6]) {
    const off = m[6].length === 5 ? m[6].slice(0, 3) + ":" + m[6].slice(3) : m[6];
    const ms = Date.parse(m[1] + "-" + m[2] + "-" + m[3] + "T" + (m[4] || "00") + ":" + (m[5] || "00") + ":00" + off);
    return Number.isFinite(ms) ? ms + IST_MS : null;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
/** Parse "04 Jan" or "04 Jan 10:30" (or a live ISO datetime) to the nearest such date around NOW (±200 days). */
export function when(NOW: string, t: string | null | undefined): number | null {
  if (!t) return null;
  const iso = isoWall(t);
  if (iso != null) return iso;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{2}):(\d{2}))?$/.exec(String(t).trim());
  if (!m) return null;
  const mo = MONI[m[2][0].toUpperCase() + m[2].slice(1, 3).toLowerCase()];
  if (mo == null) return null;
  const T = nowDay(NOW);
  const y = new Date(T).getUTCFullYear();
  const at = (yy: number) => Date.UTC(yy, mo, +m[1], +(m[3] || 0), +(m[4] || 0));
  let d = at(y);
  if (d - T > 200 * DAY) d = at(y - 1);
  if (T - d > 200 * DAY) d = at(y + 1);
  return d;
}
export const gap = (a: number | null, b: number | null): number | null =>
  a != null && b != null ? Math.round((b - a) / DAY) : null;
/** days since t, floored at zero */
export function aged(NOW: string, t: string | null | undefined): number | null {
  const d = when(NOW, t);
  return d == null ? null : Math.max(0, Math.round((nowDay(NOW) - d) / DAY));
}
export function ago(NOW: string, t: string | null | undefined): string {
  const n = aged(NOW, t);
  return n == null ? "—" : n <= 0 ? "today" : n + "d ago";
}
/** the write stamp: NOW's day and NOW's time of day */
export const stamp = (NOW: string): string => fmtStamp(nowFull(NOW));
export const day6 = (t: string | null | undefined): string => { const ms = isoWall(t); return ms != null ? fmtDay(ms) : String(t || "").slice(0, 6); };
export const plusDays = (NOW: string, n: number): string => fmtDay(nowDay(NOW) + n * DAY);
/** floor to midnight */
export const mid = (d: number | null): number | null => (d == null ? null : d - (((d % DAY) + DAY) % DAY));

/* ---- money ---- */
export const inr = (n: number | null | undefined): string => "₹" + Math.round(n || 0).toLocaleString("en-IN");
export const money = (v: number): string =>
  v >= 1e7 ? "₹" + (v / 1e7).toFixed(v % 1e7 ? 2 : 0) + " Cr"
    : v >= 1e5 ? "₹" + (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + " L" : inr(v);

/* ── THE hold clock (rule 9): days from today's Asia/Kolkata calendar day to the hold's last day ───────────────
   The server (holds/rules daysLeft: Finance's Today, the holds read, the record banner) and the screens that count it
   themselves (the IR's lead alert) all call this one function, so one hold end is one number. */
const DAY_MS = 86_400_000;
/** The Asia/Kolkata calendar day ("YYYY-MM-DD") of an instant. */
export const istDayOf = (ms: number): string => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** Days from today (IST) to `holdDay` ("YYYY-MM-DD"); 0 on the last day, negative once the hold has run out. */
export function holdDaysLeft(holdDay: string, nowMs: number): number {
  return Math.round((Date.parse(`${holdDay.slice(0, 10)}T00:00:00Z`) - Date.parse(`${istDayOf(nowMs)}T00:00:00Z`)) / DAY_MS);
}
