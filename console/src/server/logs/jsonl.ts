/**
 * M01-S04-T01 — THE STORE FOR PLANES B AND C: APPEND-ONLY JSON LINES, ONE FILE PER PLANE PER UTC DAY.
 *
 * Chosen by Jev (0.93, PROVISIONAL) over a Postgres table and over S3 Object Lock written directly:
 * no database of ours exists (CLAUDE.md, D45), the hosting account is not chosen (AP4), and C-07
 * warns that Object Lock would make an identity value that leaked into a line unerasable. Daily
 * files under LOG_DIR can be shipped to a locked archive bucket once a day has been scanned.
 *
 * Append-only by construction: the only write is `append`, which opens the day's file with
 * O_APPEND | O_CREAT and never O_TRUNC, refuses to follow a symlink, and writes each line in one
 * `write(2)` (lines are capped at 4 KiB, so concurrent appenders on a local filesystem do not
 * interleave). There is no update, rewrite, truncate or delete. Reading is by day, for the System
 * and Activity checks; a torn final line is skipped, never repaired.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface AppendOnlyStore {
  readonly plane: string;
  readonly dir: string;
  append(record: object): void;
  /** The days on disk for this plane, oldest first ("2026-09-28"). */
  days(): readonly string[];
  read(day: string): readonly unknown[];
}

export const MAX_LINE_BYTES = 4_096;
const PLANE = /^[a-z][a-z0-9-]{0,31}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const dayOf = (ms: number): string => new Date(Number.isFinite(ms) ? ms : 0).toISOString().slice(0, 10);

export function createJsonlStore(o: {
  readonly dir: string;
  readonly plane: string;
  readonly clock?: () => number;
  readonly maxLineBytes?: number;
}): AppendOnlyStore {
  if (typeof o.dir !== "string" || !path.isAbsolute(o.dir)) throw new Error("LOG_DIR must be an absolute path.");
  if (!PLANE.test(o.plane)) throw new Error("A plane name is a short lower-case code.");
  const dir = path.resolve(o.dir);
  const clock = o.clock ?? Date.now;
  const max = o.maxLineBytes ?? MAX_LINE_BYTES;
  const file = (day: string) => path.join(dir, `${o.plane}-${day}.jsonl`);
  let ready = false;
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0);

  return Object.freeze({
    plane: o.plane,
    dir,
    append(record: object): void {
      const line = JSON.stringify(record) + "\n";
      const bytes = Buffer.from(line, "utf8");
      if (bytes.length > max) throw new RangeError(`A ${o.plane} log line is over ${max} bytes.`);
      if (!ready) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        ready = true;
      }
      const fd = fs.openSync(file(dayOf(clock())), flags, 0o600);
      try {
        const written = fs.writeSync(fd, bytes, 0, bytes.length);
        if (written !== bytes.length) throw new Error(`A ${o.plane} log line was cut short.`);
      } finally {
        fs.closeSync(fd);
      }
    },
    days(): readonly string[] {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return Object.freeze([]);
      }
      const prefix = `${o.plane}-`;
      return Object.freeze(
        names
          .filter((n) => n.startsWith(prefix) && n.endsWith(".jsonl"))
          .map((n) => n.slice(prefix.length, -".jsonl".length))
          .filter((d) => DAY.test(d))
          .sort(),
      );
    },
    read(day: string): readonly unknown[] {
      if (!DAY.test(day)) return Object.freeze([]);
      let text: string;
      try {
        text = fs.readFileSync(file(day), "utf8");
      } catch {
        return Object.freeze([]);
      }
      const out: unknown[] = [];
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* a torn line (a crash mid-write) is skipped, never rewritten */
        }
      }
      return Object.freeze(out);
    },
  });
}
