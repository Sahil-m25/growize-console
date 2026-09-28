/**
 * M10-S05-T02 — the weekly net-banking statement, parsed in memory (D21, D45, D71).
 *
 * Input: the uploaded CSV's bytes (or text). Nothing is written to disk and nothing here logs: a statement line,
 * its reference (UTR) and its narration never reach a log, a cache or a temp file. The caller holds the result
 * only for the one request that reconciles it.
 *
 * What is understood (Indian net-banking exports — HDFC, ICICI, Axis, SBI shapes):
 *   - a bank preamble (account header lines) before the table: the header row is the first row naming a date
 *     column and either debit/credit columns or an amount with a Dr/Cr column;
 *   - columns by name, case- and punctuation-insensitive: date (Txn/Transaction/Tran/Value date; the posting date
 *     wins over the value date), narration (Narration/Description/Particulars/Remarks/Details), reference
 *     (Chq./Ref.No./UTR/Reference/Cheque No), withdrawal/debit, deposit/credit, or amount + Dr/Cr;
 *   - dates dd/mm/yy, dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd-MMM-yyyy, dd MMM yyyy, yyyy-mm-dd (day first, as
 *     Indian banks print them);
 *   - amounts with Indian grouping, ₹/INR, "Cr"/"Dr" suffixes, parentheses: kept in whole paise (no floats);
 *   - footer rows (totals, "closing balance", blank) end nothing: a row without a date and an amount is skipped
 *     and counted, never guessed.
 * Debits are lines too (bank charges, refunds out): reconciliation lists them (acceptance: "debits included").
 *
 * References: the reference column when it holds a bank reference, then any UTR-shaped token in the narration
 * (NEFT 16-char, RTGS 22-char, IMPS/UPI 12-digit, bank refs like HDFC2909001). An IFSC (XXXX0YYYYYY) is not a UTR.
 */

export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;
export const MAX_STATEMENT_LINES = 5_000;

export type StatementDirection = "credit" | "debit";

export interface StatementLine {
  /** 1-based position among the statement's transaction lines (not the file's row number). */
  readonly line: number;
  /** YYYY-MM-DD, the posting (transaction) date as printed. */
  readonly date: string;
  readonly direction: StatementDirection;
  /** Whole paise, > 0. */
  readonly amountPaise: number;
  /** Candidate references, uppercase A-Z0-9, the reference column first. Never logged. */
  readonly refs: readonly string[];
  /** The narration as printed, trimmed to 200 characters. Never logged; shown to Finance for "needs an owner". */
  readonly narration: string;
}

export interface ParsedStatement {
  readonly lines: readonly StatementLine[];
  /** The first and last transaction date. */
  readonly from: string;
  readonly to: string;
  /** Rows after the header that were not a transaction (footers, totals, blanks). */
  readonly skipped: number;
}

export type StatementParseRefusal = "empty" | "too-large" | "not-text" | "no-header" | "no-lines" | "too-many-lines" | "bad-row";

export type StatementParseResult =
  | { readonly ok: true; readonly value: ParsedStatement }
  | { readonly ok: false; readonly reasonCode: StatementParseRefusal; readonly message: string; readonly row?: number };

const MESSAGE: Readonly<Record<StatementParseRefusal, string>> = Object.freeze({
  "empty": "The file is empty.",
  "too-large": "The statement is larger than 2 MB. Upload one week's CSV from net banking.",
  "not-text": "This is not a CSV file. Download the statement from net banking as CSV (not PDF or Excel).",
  "no-header": "The console could not find the statement's column headings (date, narration, withdrawal, deposit).",
  "no-lines": "The statement has no transactions.",
  "too-many-lines": "The statement has more than 5,000 lines. Upload one week at a time.",
  "bad-row": "A line has a date but its amount cannot be read. Nothing was stored — check the file and upload it again.",
});

const MONTHS: Readonly<Record<string, number>> = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 });

/** RFC 4180 CSV rows (quoted fields, doubled quotes, CRLF/LF, a quoted newline). Also accepts tab-separated. */
export function csvRows(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n/) >= 0 ? text.search(/\r?\n/) : text.length);
  const sep = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field.trim() === "") { quoted = true; field = ""; i++; continue; }
    if (ch === sep) { row.push(field); field = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1; continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

type Col = "date" | "valueDate" | "narration" | "ref" | "debit" | "credit" | "amount" | "drcr";
const HEADERS: readonly (readonly [Col, RegExp])[] = [
  ["valueDate", /^valuedt$|^valuedate$/],
  ["date", /^(txn|transaction|tran|posting|trans)?date$|^txndt$|^date$/],
  ["narration", /^(narration|description|particulars|remarks|details|transactiondetails|transactionremarks)$/],
  ["ref", /^(chqrefno|refno|referenceno|reference|utr|utrno|chequeno|chqno|refnochequeno|chequerefno|refchqno|chqrefnumber|transactionid|tranid)$/],
  ["debit", /^(withdrawalamt|withdrawalamount|withdrawal|withdrawals|debit|debitamount|debitamt|dramount|dr|withdrawalamtinr|withdrawalinr|debitinr)$/],
  ["credit", /^(depositamt|depositamount|deposit|deposits|credit|creditamount|creditamt|cramount|cr|depositamtinr|depositinr|creditinr)$/],
  ["amount", /^(amount|amountinr|transactionamount|txnamount|amt)$/],
  ["drcr", /^(drcr|crdr|type|debitcredit|creditdebit|transactiontype|drcrindicator)$/],
];

function headerOf(row: readonly string[]): Partial<Record<Col, number>> | null {
  const at: Partial<Record<Col, number>> = {};
  row.forEach((cell, i) => {
    const n = norm(cell);
    if (!n) return;
    for (const [col, re] of HEADERS) if (at[col] === undefined && re.test(n)) { at[col] = i; break; }
  });
  if (at.date === undefined && at.valueDate !== undefined) { at.date = at.valueDate; }
  if (at.date === undefined) return null;
  if ((at.debit !== undefined || at.credit !== undefined) || (at.amount !== undefined && at.drcr !== undefined)) return at;
  return null;
}

/** A printed date → YYYY-MM-DD, day first. null when it is not a date. */
export function dayOf(raw: string): string | null {
  const s = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i, "");
  let d: number, m: number, y: number;
  let x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (x) { y = +x[1]!; m = +x[2]!; d = +x[3]!; }
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) { d = +x[1]!; m = +x[2]!; y = +x[3]!; }
  else if ((x = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[\s/,-]*(\d{2}|\d{4})$/.exec(s))) {
    d = +x[1]!; const mm = MONTHS[x[2]!.toLowerCase()]; if (!mm) return null; m = mm; y = +x[3]!;
  } else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** A printed amount → { paise, sign } or null ("" and "0.00" are "no amount": paise 0). Whole paise, no floats. */
export function paiseOf(raw: string): { readonly paise: number; readonly negative: boolean; readonly suffix: "cr" | "dr" | null } | null {
  let s = raw.trim().replace(/₹|INR|Rs\.?/gi, "").replace(/\s+/g, "");
  if (s === "" || s === "-") return { paise: 0, negative: false, suffix: null };
  let suffix: "cr" | "dr" | null = null;
  const sx = /(cr|dr)\.?$/i.exec(s);
  if (sx) { suffix = sx[1]!.toLowerCase() as "cr" | "dr"; s = s.slice(0, sx.index); }
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/,/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? { paise, negative, suffix } : null;
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const REF_TOKEN = /(?<![A-Z0-9])([A-Z]{4}[A-Z0-9]?\d{6,20}|[A-Z]{4}R[A-Z0-9]{10,20}|\d{12,22})(?![A-Z0-9])/g;
/** A reference that could be a UTR/bank ref: 6–30 A-Z0-9 with at least 5 digits, not all zeros, not an IFSC. */
export function refOf(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 6 || s.length > 30 || /^0+$/.test(s) || IFSC.test(s)) return null;
  if ((s.match(/\d/g)?.length ?? 0) < 5) return null;
  return s;
}
function refsOf(refCell: string, narration: string): string[] {
  const out: string[] = [];
  const own = refCell ? refOf(refCell) : null;
  if (own) out.push(own);
  for (const m of narration.toUpperCase().matchAll(REF_TOKEN)) {
    const r = refOf(m[1]!);
    if (r && !out.includes(r)) out.push(r);
    if (out.length >= 5) break;
  }
  return out;
}

function decode(input: Uint8Array | string): string | null {
  if (typeof input === "string") return input.replace(/^﻿/, "");
  if (input.byteLength >= 4 && input[0] === 0x25 && input[1] === 0x50 && input[2] === 0x44 && input[3] === 0x46) return null; // %PDF
  if (input.byteLength >= 2 && input[0] === 0x50 && input[1] === 0x4b) return null; // PK: xlsx/zip
  if (input.byteLength >= 2 && input[0] === 0xd0 && input[1] === 0xcf) return null; // xls (OLE)
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(input); }
  catch { text = new TextDecoder("latin1").decode(input); }
  if (/\u0000/.test(text)) return null;
  return text.replace(/^﻿/, "");
}

export function parseStatement(input: Uint8Array | string): StatementParseResult {
  const refuse = (reasonCode: StatementParseRefusal, row?: number): StatementParseResult =>
    ({ ok: false, reasonCode, message: MESSAGE[reasonCode], ...(row !== undefined ? { row } : {}) });
  const size = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input?.byteLength;
  if (typeof size !== "number" || size === 0) return refuse("empty");
  if (size > MAX_STATEMENT_BYTES) return refuse("too-large");
  const text = decode(input);
  if (text === null) return refuse("not-text");
  if (text.trim() === "") return refuse("empty");
  const rows = csvRows(text);
  let h: Partial<Record<Col, number>> | null = null, start = -1;
  for (let i = 0; i < Math.min(rows.length, 60); i++) {
    h = headerOf(rows[i]!);
    if (h) { start = i + 1; break; }
  }
  if (!h || start < 0) return refuse("no-header");
  const cell = (r: readonly string[], c: Col) => (h![c] === undefined ? "" : (r[h![c]!] ?? "").trim());

  const lines: StatementLine[] = [];
  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.every((c) => c.trim() === "" || /^[*\-=_\s]+$/.test(c))) { skipped++; continue; }
    const date = dayOf(cell(r, "date")) ?? (h.valueDate !== undefined && h.valueDate !== h.date ? dayOf(cell(r, "valueDate")) : null);
    if (!date) { skipped++; continue; }
    let direction: StatementDirection | null = null, paise = 0;
    if (h.debit !== undefined || h.credit !== undefined) {
      const dr = paiseOf(cell(r, "debit")), cr = paiseOf(cell(r, "credit"));
      if ((h.debit !== undefined && !dr) || (h.credit !== undefined && !cr)) return refuse("bad-row", lines.length + 1);
      const d = dr?.paise ?? 0, c = cr?.paise ?? 0;
      if (d > 0 && c > 0) return refuse("bad-row", lines.length + 1);
      if (d > 0) { direction = "debit"; paise = d; } else if (c > 0) { direction = "credit"; paise = c; }
    } else {
      const a = paiseOf(cell(r, "amount"));
      if (!a) return refuse("bad-row", lines.length + 1);
      const t = norm(cell(r, "drcr"));
      const kind = /^(cr|credit|c|deposit)$/.test(t) || a.suffix === "cr" ? "credit" : /^(dr|debit|d|withdrawal)$/.test(t) || a.suffix === "dr" ? "debit" : a.negative ? "debit" : null;
      if (a.paise > 0 && !kind) return refuse("bad-row", lines.length + 1);
      direction = kind; paise = a.paise;
    }
    if (!direction || paise <= 0) { skipped++; continue; }
    if (lines.length >= MAX_STATEMENT_LINES) return refuse("too-many-lines");
    const narration = cell(r, "narration").replace(/\s+/g, " ").slice(0, 200);
    lines.push(Object.freeze({ line: lines.length + 1, date, direction, amountPaise: paise, refs: Object.freeze(refsOf(cell(r, "ref"), narration)), narration }));
  }
  if (!lines.length) return refuse("no-lines");
  const days = lines.map((l) => l.date).sort();
  return { ok: true, value: Object.freeze({ lines: Object.freeze(lines), from: days[0]!, to: days[days.length - 1]!, skipped }) };
}
