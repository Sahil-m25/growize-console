/* ── features/add/csv.ts — reading a lead file, and the split it deals rows round ────────────
   Ports `ref/03-app.js` (redesigned) 7788–7793 (`irsOf`/`evIRs`), 7795–7807 (`dealTo`, `splitOf`,
   `splitNames`, `splitLine`), 7841–7859 (`phoneOK`, `emailOK`, `phoneKey`), 7975–8070 (`CSVFIELDS`,
   `csvRows`, `csvRead`, `csvGood`).

   `evIRs`/`dealTo`/`splitNames`/`splitLine` read only `assignees()` and an event's own `staff`, so
   they are pure and belong wherever an event is dealt round its IRs — Events will want the same
   four functions for its own sheet-load preview line (03-app.js 8590–8622). They are kept here,
   under their prototype names, because vAddBulk is what this file ports; see crossOwnerRequests.

   The phone/email checks are the one grammar the draft field and a file's cell are both judged
   by — asked once here, so the form and the import can never disagree about the same number. */

import type { EventRec, Lead, PersonKey } from "@/domain";
import type { Ctx } from "@/lib/selectors";
import { assignees, openable, P } from "@/lib/selectors";

/* ---- one number, one person -------------------------------------------------------------- */

/* 03-app.js:7841 (redesigned) — ten Indian digits, an 0-prefixed eleven or a bare +country code. */
export const phoneOK = (t: unknown): boolean => {
  const value = String(t ?? "").trim().replace(/[\s()-]/g, "");
  if (value.indexOf("+91") === 0) return /^\+91\d{10}$/.test(value);
  return value[0] === "+" ? /^\+[1-9]\d{7,14}$/.test(value) : /^(?:\d{10}|0\d{10}|91\d{10})$/.test(value);
};

/* 03-app.js:7849 */
export const emailOK = (t: unknown): boolean =>
  !String(t ?? "").trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(t).trim());

/* 03-app.js:7856 — the ten digits a number is matched on, whatever prefix it was typed with. */
export const phoneKey = (t: unknown): string => {
  const digits = String(t ?? "").replace(/\D/g, "");
  return (digits.length === 12 && digits.indexOf("91") === 0) || (digits.length === 11 && digits[0] === "0")
    ? digits.slice(-10)
    : digits;
};

export const dupeOf = (LEADS: Lead[], t: string): Lead | null =>
  phoneOK(t) ? LEADS.find(l => phoneKey(l.ph) === phoneKey(t)) ?? null : null;

/* ---- who a file's rows are dealt to ------------------------------------------------------- */

/* 03-app.js:7788 (redesigned) */
export const irsOf = (ctx: Ctx, staff: readonly PersonKey[] | undefined): PersonKey[] =>
  (staff || []).filter(k => assignees(ctx).includes(k));
export const evIRs = (ctx: Ctx, e: EventRec | null | undefined): PersonKey[] => irsOf(ctx, e?.staff);
export const dealTo = (ctx: Ctx, e: EventRec, i: number): PersonKey | null => {
  const r = evIRs(ctx, e);
  return r.length ? r[i % r.length]! : null;
};

function splitOf(n: number, own: (i: number) => PersonKey | null): { k: PersonKey; n: number }[] {
  const t: Record<string, number> = {}, o: PersonKey[] = [];
  for (let i = 0; i < n; i++) {
    const k = own(i);
    if (!k) continue;
    if (t[k] == null) { t[k] = 0; o.push(k); }
    t[k]++;
  }
  return o.map(k => ({ k, n: t[k]! }));
}
/** `splitNames` with the name of each person given, not looked up — an event page that holds the staff by the route's answer
 *  (M14-S03-W2) deals and words its preview with the same arithmetic. */
export const splitNamesBy = (n: number, own: (i: number) => PersonKey | null, nameOf: (k: PersonKey) => string): string => {
  const s = splitOf(n, own), had = s.reduce((a, x) => a + x.n, 0);
  return s.length
    ? s.map(x => nameOf(x.k).split(" ")[0] + " " + x.n).join(", ") + (had < n ? ", " + (n - had) + " with no owner" : "")
    : "";
};
export const splitLineBy = (n: number, own: (i: number) => PersonKey | null, nameOf: (k: PersonKey) => string): string =>
  n + " lead" + (n === 1 ? "" : "s") + " — "
  + (splitNamesBy(n, own, nameOf) || "nobody named, so " + (n === 1 ? "it waits" : "they wait") + " for an owner");
export const splitNames = (ctx: Ctx, n: number, own: (i: number) => PersonKey | null): string =>
  splitNamesBy(n, own, k => P(ctx.PEOPLE, k).n);
export const splitLine = (ctx: Ctx, n: number, own: (i: number) => PersonKey | null): string =>
  splitLineBy(n, own, k => P(ctx.PEOPLE, k).n);

/* ---- reading the file itself --------------------------------------------------------------- */

export type CsvFieldKey = "n" | "ph" | "em" | "city" | "units" | "note";
export type CsvField = { k: CsvFieldKey; t: string; req: boolean; hdr: readonly string[] };

/* 03-app.js:7980 (redesigned) */
export const CSVFIELDS: readonly CsvField[] = [
  { k: "n", t: "Full name", req: true, hdr: ["name", "fullname", "leadname", "contactname", "investorname", "firstname"] },
  { k: "ph", t: "Mobile", req: true, hdr: ["mobile", "phone", "mobileno", "mobilenumber", "phonenumber", "contactnumber", "whatsapp"] },
  { k: "em", t: "Email", req: false, hdr: ["email", "emailaddress", "emailid", "mail"] },
  { k: "city", t: "City", req: false, hdr: ["city", "town", "location"] },
  { k: "units", t: "Units", req: false, hdr: ["units", "unit", "noofunits", "quantity", "qty"] },
  { k: "note", t: "Note", req: false, hdr: ["note", "notes", "remark", "remarks", "comment", "comments", "description"] },
];

/* header text with the case and punctuation taken out. 03-app.js:7978 */
const CSVKEY = (h: unknown): string => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* a spreadsheet's comma grammar — a quoted field may carry one, and a quote inside it is doubled.
   03-app.js:7992 */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  const t = String(text).replace(/^﻿/, "");
  const endRow = () => {
    row.push(f); f = "";
    if (row.some(x => String(x).trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === "\"") { if (t[i + 1] === "\"") { f += "\""; i++; } else q = false; } else f += c; continue; }
    if (c === "\"") { q = true; continue; }
    if (c === ",") { row.push(f); f = ""; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; endRow(); continue; }
    f += c;
  }
  endRow();
  return rows;
}

export type CsvRow = {
  i: number; n: string; ph: string; em: string; city: string; units: number; note: string;
  bad: string | null; dupe: string | null;
};
export type CsvState = {
  file: string;
  err?: string;
  head?: string[];
  col?: Partial<Record<CsvFieldKey, number>>;
  rows?: CsvRow[];
  missing?: CsvField[];
  ignored?: string[];
};

/* 03-app.js:8009 (redesigned) — every row carries the sentence that says why it cannot be
   written; a count of refusals nobody can act on is worse than no count. */
export function csvRead(ctx: Ctx, file: string, text: string): CsvState {
  const rows = csvRows(text);
  if (rows.length < 2) {
    return { file, err: rows.length ? "There is a header row and nothing under it." : "There is nothing in this file." };
  }
  const head = rows[0]!.map(h => String(h).trim());
  const col: Partial<Record<CsvFieldKey, number>> = {}, used: Record<number, boolean> = {};
  CSVFIELDS.forEach(f => {
    const ix = head.findIndex((h, i) => !used[i] && f.hdr.includes(CSVKEY(h)));
    if (ix >= 0) { col[f.k] = ix; used[ix] = true; }
  });
  const seen: Record<string, number> = {};
  const out: CsvRow[] = rows.slice(1).map((r, ix) => {
    const g = (k: CsvFieldKey) => (col[k] == null ? "" : String(r[col[k]!] ?? "").trim());
    const row: CsvRow = {
      i: ix + 2, n: g("n"), ph: g("ph"), em: g("em"), city: g("city"),
      units: 0, note: g("note"), bad: null, dupe: null,
    };
    const u = g("units");
    if ((row.n || "").length < 2) row.bad = row.n ? "the name is one character" : "no name";
    else if (!phoneOK(row.ph)) row.bad = row.ph ? "invalid mobile — use ten Indian digits or + and country code" : "no mobile number";
    else if (!emailOK(row.em)) row.bad = "“" + row.em + "” will not send";
    else if (u && !(Number.isInteger(Number(u)) && Number(u) >= 1)) row.bad = "“" + u + "” is not a whole number of units";
    else {
      row.units = u ? Number(u) : 0;
      const d = dupeOf(ctx.LEADS, row.ph);
      if (d) {
        row.dupe = openable(ctx).some(l => l.id === d.id)
          ? (d.own ? P(ctx.PEOPLE, d.own).n + " already carries " + d.n : d.n + " is already waiting for an owner")
          : "This mobile number is already registered. Ask your manager to review the duplicate.";
      } else if (seen[phoneKey(row.ph)]) row.dupe = "the same number is on row " + seen[phoneKey(row.ph)];
      else seen[phoneKey(row.ph)] = row.i;
    }
    return row;
  });
  return {
    file, head, col, rows: out,
    missing: CSVFIELDS.filter(f => f.req && col[f.k] == null),
    ignored: head.filter((h, i) => !used[i] && h),
  };
}

export const csvGood = (csv: CsvState | null | undefined): CsvRow[] =>
  csv && csv.rows ? csv.rows.filter(r => !r.bad && !r.dupe) : [];
