/* ── format.ts — the console's clock, and its printers ──────────────────────────────────────
   Ported from `ref/03-app.js` (the prototype's `<script>`; line 1 there = line 791 of the HTML).

   THE CLOCK IS FROZEN. The prototype's `NOW`/`TODAY` are 28 Aug 2026 —

       const TODAY = new Date(2026,7,28);                       // 28 Aug 2026
       const NOW = TODAY;                        // the console's today, so the timeline is deterministic

   — and, in the prototype's own words, "every date in the product is measured from the console's
   own today, so a due date the user sets and the clock that reads it can never be on two different
   calendars". So every function here that reads "now" takes that clock as its LAST parameter
   rather than reaching for a global. STAGE-1 §1.4 forbids a second clock; a `new Date()` anywhere
   downstream would be exactly that.

   THE ONE EXCEPTION is `nowT`, which is the prototype's "fixed today with the real hour on it".
   It is the only place in this port that looks at the wall clock, it takes the frozen clock in and
   returns a Date, and nothing else may call `new Date()`.

   `esc()` IS DELIBERATELY NOT PORTED. The prototype built markup with template strings and had to
   escape every interpolation by hand. React escapes text children itself, so an `esc()` here would
   only ever double-escape — "Referral — investor" would render as "Referral — investor".
   Where the prototype wrote `esc(x)` into HTML, the port writes `{x}` into JSX; where it built
   `<mark>` runs by hand (`hl`), the port returns ReactNode. See PORT-GUIDE, "Ports of innerHTML
   template strings become JSX" and "No dangerouslySetInnerHTML".
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { MONFULL } from "@/domain";
import type { Stamp } from "@/domain";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY = 864e5;

/* ---- READING A STAMP ------------------------------------------------------------------------
   Stamps in the record are written the way a person writes them — "23 Aug 18:04" — and mostly
   without a year. Two readings of the same bare stamp are wanted in different places: `when` takes
   the reading NEAREST to today, which is what an overdue December date and a January due date both
   need; `whenFwd` takes the first reading on or after today, which is what a forecast date needs. */
const MONI: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export type WhenParts = { d: number; mo: number; y: number | null };

export function whenParts(t: string | null | undefined): WhenParts | null {
  if (!t) return null;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?/.exec(t.trim());
  return m && MONI[m[2]] !== undefined
    ? { d: +m[1], mo: MONI[m[2]], y: m[3] ? +m[3] : null }
    : null;
}

export function when(t: string | null | undefined, NOW: Date): Date | null {
  const p = whenParts(t);
  if (!p) return null;
  if (p.y) return new Date(p.y, p.mo, p.d);            /* a stamp that carries its year is not a guess */
  let best: Date | null = null, bd = Infinity;
  for (const y of [NOW.getFullYear() - 1, NOW.getFullYear(), NOW.getFullYear() + 1]) {
    const c = new Date(y, p.mo, p.d), gap = Math.abs(c.getTime() - NOW.getTime());
    if (gap < bd) { bd = gap; best = c; }
  }
  return best;
}

export function whenFwd(t: string | null | undefined, NOW: Date): Date | null {
  const p = whenParts(t);
  if (!p) return null;
  if (p.y) return new Date(p.y, p.mo, p.d);
  for (const y of [NOW.getFullYear(), NOW.getFullYear() + 1, NOW.getFullYear() + 2]) {
    const c = new Date(y, p.mo, p.d);
    if (c >= NOW) return c;
  }
  return null;
}

/* a stamp with a time — "12 Aug 09:14" — read into a date with its hour, in the console's year */
export function whenT(t: string | null | undefined, NOW: Date): Date | null {
  const d = when(t, NOW);
  if (!d) return null;
  const m = /(\d{2}):(\d{2})$/.exec(t || "");
  if (m) d.setHours(+m[1], +m[2], 0, 0);
  return d;
}

/* ---- PRINTING A DATE ----------------------------------------------------------------------- */

export const iso = (d: Date): string =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");

export const dISO = (d: Date): string => iso(d);

export const disp = (d: Date, h: number, m: number): string =>
  String(d.getDate()).padStart(2, "0") + " " + MON[d.getMonth()] + " " +
  String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

export const hhmm = (d: Date): string =>
  String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");

export const dLabel = (d: Date): string =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];

/* a date more than a few months out has to print its year, or reading it back guesses wrong */
export const dISOtoDisp = (s: string, NOW: Date): string => {
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return String(d.getDate()).padStart(2, "0") + " " + MON[d.getMonth()] +
    (d.getFullYear() !== NOW.getFullYear() ? " " + d.getFullYear() : "");
};

/* the plan's period label: a month names itself, anything else is a span */
export const pLabel = (a: Date, b: Date, g: string, NOW: Date): string =>
  g === "month"
    ? MONFULL[a.getMonth()] + (a.getFullYear() !== NOW.getFullYear() ? " " + a.getFullYear() : "")
    : MON[a.getMonth()] + " " + a.getDate() + " – " + MON[b.getMonth()] + " " + b.getDate() +
      (b.getFullYear() !== NOW.getFullYear() ? " " + b.getFullYear() : "");

/* ---- DAY ARITHMETIC -------------------------------------------------------------------------
   `dayOf` and `sod` are the prototype's two names for one thing — start of day. Both are kept
   because both are read at their own call sites and a reader looking for either should find it. */
export const isoDay = /^\d{4}-\d{2}-\d{2}$/;
export const dOf = (t: string | null | undefined): Date | null =>
  isoDay.test(t || "") ? new Date(t + "T00:00:00") : null;
export const dayOf = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sod = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* Access windows must reject missing, malformed and rolled-over dates instead of granting forever. */
export function accessDay(t: string | null | undefined, NOW: Date): Date | null {
  const value = (t || "").trim();
  if (isoDay.test(value)) {
    const d = dOf(value);
    return d && !isNaN(d.getTime()) && iso(d) === value ? d : null;
  }
  if (!/^\d{1,2}\s+[A-Za-z]{3}(?:\s+\d{4})?(?:\s+(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(value)) return null;
  const parts = whenParts(value), d = when(value, NOW);
  return parts && d && d.getDate() === parts.d && d.getMonth() === parts.mo ? d : null;
}

/* Legacy yearless windows are pinned once when loaded; new writes carry a year from the outset. */
export function pinAccessDate(t: string | null | undefined, NOW: Date): string {
  const d = accessDay(t, NOW);
  const time = /\s((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(t || "")?.[1];
  return d ? `${String(d.getDate()).padStart(2, "0")} ${MON[d.getMonth()]} ${d.getFullYear()}${time ? " " + time : ""}` : t || "";
}

export function accessMoment(t: string | null | undefined, NOW: Date): Date | null {
  const d = accessDay(t, NOW), time = /\s(\d{2}):(\d{2})$/.exec(t || "");
  if (d && time) d.setHours(+time[1], +time[2], 0, 0);
  return d;
}

export const plusD = (d: Date, n: number): Date => {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
};
export const dAdd = (d: Date, n: number): Date => {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
};

/* every date in the product is measured from the console's own today, so a due date the user
   sets and the clock that reads it can never be on two different calendars */
export function plusDays(n: number, NOW: Date): string {
  const d = new Date(NOW.getTime());
  d.setDate(d.getDate() + n);
  /* through the same printer as every other date, so a forecast six months out does not read as
     six months ago the moment it crosses a year boundary */
  return dISOtoDisp(iso(d), NOW);
}

export const sameDay = (a: Date | null | undefined, b: Date | null | undefined): boolean =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

export const monday = (d: Date): Date => {
  const x = sod(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

export const dayGap = (a: Date | null | undefined, b: Date | null | undefined): number | null =>
  a && b ? (b.getTime() - a.getTime()) / DAY : null;

/* ---- THE HOUR ON THE FROZEN DAY -------------------------------------------------------------
   the console's clock: its fixed today, with the real hour on it, so an age is honest.

   THIS IS THE ONLY `new Date()` IN THE PORT. Every other "now" is passed in. It takes the frozen
   clock in and hands a Date back, exactly as the prototype's `nowT()` did, so the whole product
   still has one calendar and one clock. Note that it is not referentially transparent within a
   minute boundary — callers that need a stable instant across a render should resolve it once and
   pass the result down (which is what `stamp` below expects). */
export const nowT = (NOW: Date): Date => {
  const n = new Date(), d = new Date(NOW.getTime());
  d.setHours(n.getHours(), n.getMinutes(), 0, 0);
  return d;
};

/* every write stamps a time: the console's own day, the real hour. The prototype's `stamp()`
   resolved the wall clock itself; here the resolved instant is handed in — call
   `stamp(nowT(state.NOW))` — so a reducer stamps a batch of writes with one instant. */
export const stamp = (now: Date): Stamp =>
  (String(now.getDate()).padStart(2, "0") + " " + MON[now.getMonth()] + " " +
   String(now.getHours()).padStart(2, "0") + ":" +
   String(now.getMinutes()).padStart(2, "0")) as Stamp;

export const ageH = (t: string | null | undefined, NOW: Date): number | null => {
  const d = whenT(t, NOW);
  return d == null ? null : (nowT(NOW).getTime() - d.getTime()) / 36e5;
};

export function agoStr(t: string | null | undefined, NOW: Date): string {
  const h = ageH(t, NOW);
  if (h == null) return "a while ago";
  if (h < 1) return Math.max(1, Math.round(h * 60)) + " minutes ago";
  if (h < 36) return Math.round(h) + " hour" + (Math.round(h) === 1 ? "" : "s") + " ago";
  return Math.round(h / 24) + " days ago";
}

/* ---- NUMBERS -------------------------------------------------------------------------------- */

/* ₹25L per unit is the atom, so anything that reads in lakhs reads in lakhs and anything past a
   crore reads in crores — never a nine-digit number with commas in it */
export const money = (v: number): string =>
  v >= 10000000
    ? "₹" + (v / 10000000).toFixed(v % 10000000 ? 1 : 0) + " Cr"
    : "₹" + (v / 100000) + " L";

export const pct = (a: number, b: number): number | null => (b ? Math.round(a / b * 100) : null);

/* maskRef(v) — ir-console-redesigned.html:11447-11448. Rule 7: a bank reference prints its last
   four characters and no more, everywhere it is printed, until a reader explicitly asks to see the
   rest through `showRef`. The canonical copy; `src/features/pay/common.tsx` carries its own for
   now (see crossOwnerRequests) — both must read identically. */
export function maskRef(v: string | null | undefined): string {
  const s = String(v ?? "").trim();
  return !s || s === "—" ? "—" : s.length <= 4 ? "••••" : "••• " + s.slice(-4);
}

export const norm = (s: unknown): string => String(s == null ? "" : s).toLowerCase();
