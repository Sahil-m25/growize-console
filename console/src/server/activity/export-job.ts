/**
 * M15-S03-T01 — THE NIGHTLY AUDIT EXPORT: request the org audit log export for one day, poll, download,
 * parse, and seal it in the append-only archive (./archive.ts). A failure at any step alerts through
 * `onFailure` (runtime: reportOpsFailure("backup-failed", code)) and leaves the day unsealed, so the next
 * night retries it. A day already sealed is skipped.
 *
 * Runs on the `audit-archive` service credential (D53: background work, never a screen). The Zoho side
 * is `AuditExportSource`; `createZohoAuditExportSource` is the v8 REST implementation.
 * ponytail: the request/poll/download shapes and the CSV column names follow Zoho's Audit Log Export
 * docs and are unproven until the sandbox run (M02-S10); the header mapping below is deliberately
 * tolerant and every value it keeps is rebuilt from an allow-list (archive.ts cleanRow).
 */

import { inflateRawSync } from "node:zlib";
import type { ServiceCredential } from "../../lib/zoho/client";
import { cleanRow, type ArchivedAuditRow, type AuditArchive } from "./archive";

export interface AuditExportSource {
  /** Ask for the export of [from, to]; returns the job id. */
  request(fromIso: string, toIso: string): Promise<string>;
  status(jobId: string): Promise<{ readonly state: "pending" | "done" | "failed"; readonly links: readonly string[] }>;
  download(link: string): Promise<Uint8Array>;
}

export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const ZOHO_HOST = /(^|\.)zoho(apis)?\.(in|com|eu|com\.au|jp|ca|sa|com\.cn|uk|ae)$/;

export function createZohoAuditExportSource(o: { readonly credential: ServiceCredential; readonly fetch: HttpFetch }): AuditExportSource {
  if (o.credential?.kind !== "service" || o.credential.job !== "audit-archive") throw new TypeError("The audit export runs on the audit-archive service credential (D53).");
  const base = `${o.credential.apiDomain}/crm/v8/settings/audit_log_export`;
  const auth = (): Record<string, string> => ({ Authorization: `Zoho-oauthtoken ${o.credential.accessToken}` });
  const json = async (r: { status: number; text(): Promise<string> }): Promise<Record<string, unknown>> => {
    if (r.status < 200 || r.status >= 300) throw new ExportError(`http-${r.status}`);
    try { return JSON.parse(await r.text()) as Record<string, unknown>; } catch { throw new ExportError("malformed"); }
  };
  const first = (b: Record<string, unknown>): Record<string, unknown> => {
    const a = b.audit_log_export;
    const x = Array.isArray(a) ? a[0] : null;
    if (!x || typeof x !== "object") throw new ExportError("malformed");
    return x as Record<string, unknown>;
  };
  return Object.freeze({
    async request(fromIso: string, toIso: string) {
      const body = JSON.stringify({ audit_log_export: [{ criteria: { field: { api_name: "audited_time" }, comparator: "between", value: [fromIso, toIso] } }] });
      const x = first(await json(await o.fetch(base, { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body })));
      const details = (x.details ?? {}) as Record<string, unknown>;
      const id = details.id ?? x.id;
      if (typeof id !== "string" && typeof id !== "number") throw new ExportError("no-job-id");
      const s = String(id);
      if (!/^\d{1,25}$/.test(s)) throw new ExportError("no-job-id");
      return s;
    },
    async status(jobId: string) {
      if (!/^\d{1,25}$/.test(jobId)) throw new ExportError("no-job-id");
      const x = first(await json(await o.fetch(`${base}/${jobId}`, { method: "GET", headers: auth() })));
      const st = String(x.status ?? "").toLowerCase();
      const links = (Array.isArray(x.download_links) ? x.download_links : []).filter((l): l is string => typeof l === "string");
      return { state: /complet|success|done/.test(st) ? "done" as const : /fail|error|cancel/.test(st) ? "failed" as const : "pending" as const, links };
    },
    async download(link: string) {
      let u: URL;
      try { u = new URL(link); } catch { throw new ExportError("bad-link"); }
      // The token only ever goes to a Zoho host over https.
      if (u.protocol !== "https:" || !ZOHO_HOST.test(u.hostname)) throw new ExportError("bad-link");
      const r = await o.fetch(u.toString(), { method: "GET", headers: auth() });
      if (r.status !== 200) throw new ExportError(`http-${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  });
}

export class ExportError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ExportError"; }
}

/* ---- zip and CSV ----------------------------------------------------------------------------------- */

/** The files in a zip (stored or deflated), read through the central directory. A plain CSV passes through. */
export function unzip(bytes: Uint8Array): { readonly name: string; readonly data: Buffer }[] {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 4 || b.readUInt32LE(0) !== 0x04034b50) return [{ name: "export.csv", data: b }];
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ExportError("bad-zip");
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new ExportError("bad-zip");
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + size);
    if (!name.endsWith("/")) out.push({ name, data: method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : (() => { throw new ExportError("bad-zip"); })() });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** RFC 4180 CSV → rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A Zoho time as ISO +05:30. Offsets are honoured; a time with none is read as Asia/Kolkata (the org's zone). */
export function auditTime(raw: string): string | null {
  const s = raw.trim();
  let ms: number;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) ms = Date.parse(s);
  else {
    let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
    let y: number, mo: number, d: number, h: number, mi: number, se: number, ap: string | undefined;
    if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; h = +m[4]!; mi = +m[5]!; se = +(m[6] ?? 0); ap = m[7]; }
    else {
      m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s)
        ?? /^(\d{1,2})[\s/-]([A-Za-z]{3})[a-z]*[\s/-](\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
      if (!m) return null;
      const monFirst = /^[A-Za-z]/.test(m[1]!);
      mo = MONTHS.indexOf((monFirst ? m[1]! : m[2]!).slice(0, 3).toLowerCase()) + 1;
      d = +(monFirst ? m[2]! : m[1]!); y = +m[3]!; h = +m[4]!; mi = +m[5]!; se = +(m[6] ?? 0); ap = m[7];
      if (mo < 1) return null;
    }
    if (ap) { h = h % 12 + (/pm/i.test(ap) ? 12 : 0); }
    ms = Date.parse(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se)}+05:30`);
  }
  if (!Number.isFinite(ms)) return null;
  return `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
}

/**
 * CSV rows → archive rows. `userIdOf` resolves a "Done by" label (email or full name) to a Zoho user id
 * from the Users API; the label itself is never kept.
 */
export function auditRowsFromCsv(text: string, userIdOf: (label: string) => string | null): ArchivedAuditRow[] {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...res: RegExp[]): number => { for (const re of res) { const i = h.findIndex((x) => re.test(x)); if (i >= 0) return i; } return -1; };
  const iAt = col(/audited.?time/, /date.*time/, /^time$/, /^date$/);
  const iById = col(/(user|done.?by|performed.?by).*id$/);
  const iBy = col(/done.?by|performed.?by|^user( name)?$/, /^email$/, /user.*email/);
  const iAction = col(/^action$/, /action/);
  const iModule = col(/^module$/, /module/, /^feature$/);
  const iRecord = col(/record.?id/, /^id$/);
  if (iAt < 0 || iAction < 0) throw new ExportError("unknown-columns");
  const out: ArchivedAuditRow[] = [];
  for (const r of body) {
    const at = auditTime(r[iAt] ?? "");
    if (!at) continue;
    const byRaw = iById >= 0 ? (r[iById] ?? "").trim() : "";
    const byId = /^\d{15,25}$/.test(byRaw) ? byRaw : iBy >= 0 ? userIdOf((r[iBy] ?? "").trim()) : null;
    const row = cleanRow({ at, byId: byId ?? "unrecognised", action: r[iAction] ?? "", module: iModule >= 0 ? (r[iModule] ?? "").trim().replace(/\s+/g, "_") : "", recordId: iRecord >= 0 ? (r[iRecord] ?? "").trim() : null });
    if (row) out.push(row);
  }
  return out;
}

/** The Users API as a label → id map (emails and full names, lower-cased). Held in memory only. */
export async function fetchUserDirectory(o: { readonly credential: ServiceCredential; readonly fetch: HttpFetch }): Promise<(label: string) => string | null> {
  const map = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const r = await o.fetch(`${o.credential.apiDomain}/crm/v8/users?type=AllUsers&per_page=200&page=${page}`, { method: "GET", headers: { Authorization: `Zoho-oauthtoken ${o.credential.accessToken}` } });
    if (r.status === 204) break;
    if (r.status !== 200) throw new ExportError(`users-http-${r.status}`);
    const b = JSON.parse(await r.text()) as { users?: { id?: unknown; email?: unknown; full_name?: unknown }[]; info?: { more_records?: boolean } };
    for (const u of b.users ?? []) {
      if (typeof u.id !== "string" || !/^\d{15,25}$/.test(u.id)) continue;
      for (const k of [u.email, u.full_name]) if (typeof k === "string" && k.trim()) map.set(k.trim().toLowerCase(), u.id);
    }
    if (!b.info?.more_records) break;
  }
  return (label: string) => map.get(label.trim().toLowerCase()) ?? null;
}

/* ---- the job --------------------------------------------------------------------------------------- */

/** The Asia/Kolkata day before `now` ("2026-09-27"). */
export const previousIstDay = (now: number): string => new Date(now + 5.5 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);

export type ExportRun =
  | { readonly ok: true; readonly day: string; readonly rows: number; readonly skipped: boolean }
  | { readonly ok: false; readonly day: string; readonly code: string };

export async function runAuditExport(o: {
  readonly source: AuditExportSource; readonly archive: AuditArchive; readonly userIdOf: (label: string) => string | null;
  readonly day?: string; readonly clock?: () => number; readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number; readonly maxPolls?: number; readonly onFailure?: (code: string) => void;
}): Promise<ExportRun> {
  const clock = o.clock ?? Date.now;
  const day = o.day ?? previousIstDay(clock());
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const fail = (code: string): ExportRun => {
    const c = /^[a-z][a-z0-9-]{0,39}$/.test(code) ? code : "unrecognised";
    try { o.onFailure?.(c); } catch { /* never throws into the job */ }
    return { ok: false, day, code: c };
  };
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail("bad-day");
    if (await o.archive.has(day)) return { ok: true, day, rows: 0, skipped: true };
    const job = await o.source.request(`${day}T00:00:00+05:30`, `${day}T23:59:59+05:30`);
    let links: readonly string[] = [];
    for (let n = 0; ; n++) {
      const s = await o.source.status(job);
      if (s.state === "failed") return fail("export-failed");
      if (s.state === "done") { links = s.links; break; }
      if (n + 1 >= (o.maxPolls ?? 60)) return fail("export-timeout");
      await sleep(o.pollMs ?? 30_000);
    }
    if (!links.length) return fail("no-download");
    const rows: ArchivedAuditRow[] = [];
    for (const link of links) {
      for (const f of unzip(await o.source.download(link))) {
        if (!/\.csv$/i.test(f.name)) continue;
        rows.push(...auditRowsFromCsv(f.data.toString("utf8"), o.userIdOf));
      }
    }
    const inDay = rows.filter((r) => r.day === day);
    const w = await o.archive.write(day, inDay);
    return { ok: true, day, rows: w.rows, skipped: false };
  } catch (e) {
    return fail(e instanceof ExportError ? e.code : "unexpected");
  }
}
