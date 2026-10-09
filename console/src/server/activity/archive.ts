/**
 * M15-S03-T01 — THE APPEND-ONLY AUDIT ARCHIVE.
 *
 * D14 names S3 with Object Lock (a separate AWS account) as the target; the account is not chosen (AP4).
 * The job therefore writes through `AuditArchive`, and this file supplies the local implementation:
 * one file per archived day, created with O_EXCL (never overwritten), fsynced, then made read-only,
 * and one line per sealed day appended to a manifest with the file's SHA-256. A day is archived once:
 * a second run for a sealed day does nothing; a run that died before sealing leaves an orphan file
 * the next run ignores (it writes a new one). Reads trust only sealed days and check the hash, so an
 * edited file reads as "tampered", never as data. There is no update, rewrite or delete.
 *
 * What a row holds (logs rule, D52): the time, the Zoho user id of who did it, the action and module
 * codes and the record id. Never a record name, a field value or an email.
 */

import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface ArchivedAuditRow {
  /** ISO 8601 with the +05:30 offset. */
  readonly at: string;
  /** The Asia/Kolkata day of `at` ("2026-09-27"). */
  readonly day: string;
  /** A Zoho user id, or "unrecognised". */
  readonly byId: string;
  readonly action: string;
  readonly module: string;
  readonly recordId: string | null;
}

export interface AuditArchive {
  readonly kind: "local" | "s3" | "stratus" | "state";
  /** True once the day is sealed. */
  has(day: string): Promise<boolean>;
  /** Seal one day's rows. Refuses a day already sealed. */
  write(day: string, rows: readonly ArchivedAuditRow[]): Promise<{ readonly rows: number; readonly sha256: string }>;
  /** Sealed days, oldest first. */
  days(): Promise<readonly string[]>;
  /** A sealed day's rows; [] for a day not archived. Throws "tampered" if the file no longer matches. */
  read(day: string): Promise<readonly ArchivedAuditRow[]>;
  /** When the last day was sealed (ms), for the System page's "Audit archive last run". */
  lastRun(): Promise<number | null>;
}

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID = /^\d{15,25}$/;
const RECORD_ID = /^\d{15,22}$/;
const ACTION = /^[a-z][a-z0-9-]{0,47}$/;
const MODULE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?\+05:30$/;

/** Rebuild a row from the allow-list; null when it has no usable time. */
export function cleanRow(x: unknown): ArchivedAuditRow | null {
  const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  if (typeof r.at !== "string" || !AT.test(r.at) || Number.isNaN(Date.parse(r.at))) return null;
  const action = typeof r.action === "string" ? r.action.toLowerCase().trim().replace(/[\s_]+/g, "-") : "";
  return Object.freeze({
    at: r.at,
    day: r.at.slice(0, 10),
    byId: typeof r.byId === "string" && USER_ID.test(r.byId) ? r.byId : "unrecognised",
    action: ACTION.test(action) ? action : "unrecognised",
    module: typeof r.module === "string" && MODULE.test(r.module) ? r.module : "unrecognised",
    recordId: typeof r.recordId === "string" && RECORD_ID.test(r.recordId) ? r.recordId : null,
  });
}

interface Seal { readonly day: string; readonly file: string; readonly rows: number; readonly sha256: string; readonly at: number }

export function createLocalAuditArchive(o: { readonly dir: string; readonly clock?: () => number }): AuditArchive {
  if (typeof o.dir !== "string" || !path.isAbsolute(o.dir)) throw new Error("The audit archive needs an absolute directory.");
  const dir = path.resolve(o.dir);
  const clock = o.clock ?? Date.now;
  const manifest = path.join(dir, "manifest.jsonl");
  const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

  const seals = (): Seal[] => {
    let text = "";
    try { text = fs.readFileSync(manifest, "utf8"); } catch { return []; }
    const out: Seal[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const s = JSON.parse(line) as Seal;
        if (DAY.test(s.day) && /^audit-\d{4}-\d{2}-\d{2}-[0-9a-f]{12}\.jsonl$/.test(s.file) && /^[0-9a-f]{64}$/.test(s.sha256)) out.push(s);
      } catch { /* a torn manifest line is skipped */ }
    }
    return out;
  };
  const sealOf = (day: string): Seal | undefined => seals().find((s) => s.day === day);

  return Object.freeze({
    kind: "local" as const,
    async has(day: string) { return DAY.test(day) && !!sealOf(day); },
    async write(day: string, rows: readonly ArchivedAuditRow[]) {
      if (!DAY.test(day)) throw new RangeError("An archive day is YYYY-MM-DD.");
      if (sealOf(day)) throw new Error(`The audit archive already holds ${day}; it is never rewritten.`);
      const clean = rows.map(cleanRow).filter((r): r is ArchivedAuditRow => !!r && r.day === day);
      const body = Buffer.from(clean.map((r) => JSON.stringify(r) + "\n").join(""), "utf8");
      const sha256 = createHash("sha256").update(body).digest("hex");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = `audit-${day}-${randomBytes(6).toString("hex")}.jsonl`;
      const fd = fs.openSync(path.join(dir, file), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
      try {
        if (body.length && fs.writeSync(fd, body, 0, body.length) !== body.length) throw new Error("The audit archive write was cut short.");
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.chmodSync(path.join(dir, file), 0o400);
      const seal: Seal = { day, file, rows: clean.length, sha256, at: clock() };
      const mfd = fs.openSync(manifest, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | NOFOLLOW, 0o600);
      try { fs.writeSync(mfd, JSON.stringify(seal) + "\n"); fs.fsyncSync(mfd); } finally { fs.closeSync(mfd); }
      return { rows: clean.length, sha256 };
    },
    async days() { return [...new Set(seals().map((s) => s.day))].sort(); },
    async read(day: string) {
      const s = DAY.test(day) ? sealOf(day) : undefined;
      if (!s) return [];
      const body = fs.readFileSync(path.join(dir, s.file));
      if (createHash("sha256").update(body).digest("hex") !== s.sha256) throw new Error("tampered");
      return body.toString("utf8").split("\n").filter(Boolean).map((l) => cleanRow(JSON.parse(l))).filter((r): r is ArchivedAuditRow => !!r);
    },
    async lastRun() { const all = seals(); return all.length ? Math.max(...all.map((s) => s.at)) : null; },
  });
}
