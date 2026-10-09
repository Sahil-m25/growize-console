/**
 * THE NoSQL ADAPTER FOR PLANE C, THE EXTRA APPEND-ONLY PLANES AND THE AUDIT ARCHIVE (B-27; LOG_SINK=state).
 *
 * Staging already has a Catalyst NoSQL state store (STATE_STORE=catalyst, GZ_STATE_*). This puts the activity log on it
 * instead of Stratus, so no bucket and no second OAuth grant are needed. Same data centre, same project (D47): rows are
 * codes and ids only (the identity guard and the cleanRow allow-list run before anything reaches here).
 *
 *   plane lines   a SharedLog per plane and UTC day ("lg-<plane>-<day>"): each flush packs the buffered lines into
 *                 chunks of at most CHUNK chars (the state store caps a value at 4,096) and appends one slot per chunk;
 *                 "lg-<plane>-days" lists the days written. Reads take every slot of every instance, plus this
 *                 instance's unflushed lines.
 *   audit day     the day's JSONL, gzipped, base64, cut into chunks under "audit|<day>|<id>|<i>"; the day is listed in
 *                 the "audit-days" SharedLog, then sealed by "audit|<day>|seal" = rows, sha256 of the JSONL, chunk count.
 *                 Written once: a lock claim guards the write, a sealed day is refused, reads check the hash.
 *
 * Not for Plane B (ops, errors): that is one line per Zoho call, far too many NoSQL writes. They stay in the rings.
 */

import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ArchivedAuditRow, AuditArchive } from "../activity/archive";
import { createSharedLog } from "../state/shared-log";
import type { SharedState } from "../state/shared-state";
import type { StoredSegment } from "./chain";
import { dayOf } from "./jsonl";
import type { PlaneStore } from "./sink";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PLANE = /^[a-z][a-z0-9-]{0,11}$/;
const CHUNK = 3_800;
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const parseLines = (text: string): unknown[] => {
  const out: unknown[] = [];
  for (const line of text.split("\n")) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ } }
  return out;
};

/** Every line of a SharedLog, oldest slot first. */
async function drainLog(state: SharedState, ns: string): Promise<string[]> {
  const reader = createSharedLog(state, ns).reader();
  const out: string[] = [];
  for (let i = 0; i < 100; i++) {
    const before = reader.cursor();
    for (const x of await reader.poll()) out.push(x.line);
    if (reader.cursor() === before) break;
  }
  return out;
}

export interface StatePlaneStoreOptions {
  readonly state: SharedState;
  readonly plane: string;
  readonly clock?: () => number;
  readonly flushLines?: number;
  readonly flushMs?: number;
  readonly maxPending?: number;
  readonly onError?: (code: string) => void;
  /** false in tests that drive flush() themselves. */
  readonly timer?: boolean;
}

export interface StatePlaneStore extends PlaneStore { pending(): number; close(): void }

export function createStatePlaneStore(o: StatePlaneStoreOptions): StatePlaneStore {
  if (!PLANE.test(o.plane)) throw new Error("A NoSQL log store needs a short plane code.");
  const clock = o.clock ?? Date.now;
  const flushLines = o.flushLines ?? 50;
  const maxPending = o.maxPending ?? 5_000;
  const buffer = new Map<string, string[]>(); // day → lines not yet written
  const listed = new Set<string>();           // days already added to the days list by this process
  let queued = 0;
  let chain: Promise<void> = Promise.resolve();
  const dayNs = (day: string) => `lg-${o.plane}-${day}`;
  const daysNs = `lg-${o.plane}-days`;

  const drain = async (): Promise<void> => {
    for (const day of [...buffer.keys()]) {
      const lines = buffer.get(day)!;
      while (lines.length) {
        const chunk: string[] = [];
        let size = 0;
        while (lines.length && size + lines[0]!.length <= CHUNK) { size += lines[0]!.length; chunk.push(lines.shift()!); }
        try {
          if (!listed.has(day)) { await createSharedLog(o.state, daysNs).append(day); listed.add(day); }
          await createSharedLog(o.state, dayNs(day)).append(chunk.join(""));
          queued -= chunk.length;
        } catch {
          lines.unshift(...chunk); // kept in order; the next flush retries
          try { o.onError?.("state-write-failed"); } catch { /* never throws */ }
          return;
        }
      }
      buffer.delete(day);
    }
  };
  const flush = (): Promise<void> => (chain = chain.then(drain, drain));
  const timer = o.timer === false ? null : setInterval(() => { void flush(); }, o.flushMs ?? 15_000);
  (timer as { unref?: () => void } | null)?.unref?.();

  const readDay = async (day: string): Promise<readonly unknown[]> => {
    if (!DAY.test(day)) return Object.freeze([]);
    const stored = (await drainLog(o.state, dayNs(day))).join("");
    return Object.freeze(parseLines(stored + (buffer.get(day) ?? []).join("")));
  };
  return Object.freeze({
    plane: o.plane,
    append(record: object): void {
      const line = JSON.stringify(record) + "\n";
      if (line.length > CHUNK) throw new RangeError(`A ${o.plane} log line is over ${CHUNK} characters.`);
      if (queued >= maxPending) throw new Error(`The ${o.plane} log buffer is full: the state store has not taken it.`);
      const day = dayOf(clock());
      const b = buffer.get(day) ?? [];
      b.push(line);
      buffer.set(day, b);
      queued++;
      if (b.length >= flushLines) void flush();
    },
    async days() {
      const d = new Set((await drainLog(o.state, daysNs)).filter((x) => DAY.test(x)));
      for (const [day, l] of buffer) if (l.length) d.add(day);
      return Object.freeze([...d].sort());
    },
    read: readDay,
    async segments(day: string): Promise<readonly StoredSegment[]> {
      const lines = await readDay(day);
      return lines.length ? [Object.freeze({ key: `${o.plane}-${day}`, manifest: null, lines, problem: null })] : [];
    },
    flush,
    pending: () => queued,
    close: () => { if (timer) clearInterval(timer); },
  });
}

/* ---- the audit archive -------------------------------------------------------------------------- */

export function createStateAuditArchive(o: { readonly state: SharedState; readonly clean: (x: unknown) => ArchivedAuditRow | null; readonly clock?: () => number }): AuditArchive {
  const clock = o.clock ?? Date.now;
  type Seal = { day: string; id: string; chunks: number; rows: number; sha256: string; at: number };
  const sealKey = (day: string) => `audit|${day}|seal`;
  const sealOf = async (day: string): Promise<Seal | null> => {
    if (!DAY.test(day)) return null;
    const t = await o.state.get(sealKey(day));
    if (!t) return null;
    try {
      const s = JSON.parse(t) as Seal;
      return s.day === day && /^[0-9a-f]{12}$/.test(s.id) && Number.isSafeInteger(s.chunks) && s.chunks >= 0 && /^[0-9a-f]{64}$/.test(s.sha256) ? s : null;
    } catch { return null; }
  };
  const listedDays = async (): Promise<string[]> => [...new Set((await drainLog(o.state, "audit-days")).filter((d) => DAY.test(d)))].sort();
  const inBatches = async <T>(items: readonly T[], f: (x: T) => Promise<void>): Promise<void> => {
    for (let i = 0; i < items.length; i += 8) await Promise.all(items.slice(i, i + 8).map(f));
  };
  return Object.freeze({
    kind: "state" as const,
    async has(day: string) { return !!(await sealOf(day)); },
    async write(day: string, rows: readonly ArchivedAuditRow[]) {
      if (!DAY.test(day)) throw new RangeError("An archive day is YYYY-MM-DD.");
      if (!(await o.state.claim(`audit|${day}|lock`, 600))) throw new Error(`The audit archive is already writing ${day}.`);
      try {
        if (await sealOf(day)) throw new Error(`The audit archive already holds ${day}; it is never rewritten.`);
        const clean = rows.map(o.clean).filter((r): r is ArchivedAuditRow => !!r && r.day === day);
        const body = clean.map((r) => JSON.stringify(r) + "\n").join("");
        const b64 = gzipSync(Buffer.from(body, "utf8")).toString("base64");
        const parts: string[] = [];
        for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
        const id = randomBytes(6).toString("hex");
        await inBatches(parts.map((p, i) => [i, p] as const), ([i, p]) => o.state.set(`audit|${day}|${id}|${i}`, p));
        await createSharedLog(o.state, "audit-days").append(day);
        const seal: Seal = { day, id, chunks: parts.length, rows: clean.length, sha256: sha256(body), at: clock() };
        await o.state.set(sealKey(day), JSON.stringify(seal));
        return { rows: clean.length, sha256: seal.sha256 };
      } finally { await o.state.release(`audit|${day}|lock`).catch(() => {}); }
    },
    async days() {
      /* only days that were really sealed (a day listed before its seal landed reads as nothing) */
      const out: string[] = [];
      for (const d of await listedDays()) if (await sealOf(d)) out.push(d);
      return out;
    },
    async read(day: string) {
      const s = await sealOf(day);
      if (!s) return [];
      const parts: string[] = new Array(s.chunks).fill("");
      await inBatches([...parts.keys()], async (i) => {
        const v = await o.state.get(`audit|${day}|${s.id}|${i}`);
        if (v === null) throw new Error("tampered");
        parts[i] = v;
      });
      let body: string;
      try { body = gunzipSync(Buffer.from(parts.join(""), "base64")).toString("utf8"); } catch { throw new Error("tampered"); }
      if (sha256(body) !== s.sha256) throw new Error("tampered");
      return body.split("\n").filter(Boolean).map((l) => o.clean(JSON.parse(l))).filter((r): r is ArchivedAuditRow => !!r);
    },
    async lastRun() {
      const days = await listedDays();
      for (let i = days.length - 1; i >= 0; i--) { const s = await sealOf(days[i]!); if (s) return s.at; }
      return null;
    },
  });
}
