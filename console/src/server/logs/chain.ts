/**
 * PLANE C'S HASH CHAIN (D47 audit trail; docs/architecture/log-sink.md).
 *
 * Neither sink can promise immutability: a local file can be edited, and Catalyst Stratus documents
 * versioning but no object lock or retention. So tamper evidence comes from the lines themselves.
 * Every Plane C line, as stored, carries four fields added AFTER the identity guard (they are our own
 * hex, never caller data):
 *
 *   ch    the chain: one per writing instance (process), restarted each UTC day
 *   n     the line's place in that chain, 0, 1, 2…
 *   prev  the previous line's `h` (for n = 0, genesis(ch, day))
 *   h     sha256 of the canonical JSON of the line without `h` (so of the record, ch, n and prev)
 *
 * Editing a line breaks its `h`; deleting one leaves a gap in `n`; moving one puts an `n` out of order.
 * A durable sink cuts each chain into segments whose manifests carry the first and last `h` and the
 * previous segment's last `h`, so a missing segment shows too. What a chain cannot show by itself is the
 * loss of its tail or of a whole chain: `anchor` is the digest of every chain's head for a closed day, to
 * be kept somewhere else (the spike decides where) and passed back to `verifyChain`.
 *
 * Self-contained on purpose (node:crypto only): scripts/verify-audit-chain.mjs transpiles this one file.
 */

import { createHash } from "node:crypto";

export const CHAIN_FIELDS = Object.freeze(["ch", "n", "prev", "h"] as const);
const HEX64 = /^[0-9a-f]{64}$/;
const CHAIN_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/** JSON with every object's keys sorted, so the same record always hashes the same. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export const genesis = (ch: string, day: string): string => sha256(`growize-plane-c\n${ch}\n${day}`);

/** The `h` a chained line should carry. */
export function hashOf(line: Readonly<Record<string, unknown>>): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(line)) if (k !== "h") rest[k] = v;
  return sha256(canonical(rest));
}

export interface ChainedFields { readonly ch: string; readonly n: number; readonly prev: string; readonly h: string }

export interface ChainLinker {
  readonly chainId: string;
  /** The record with ch, n, prev and h added for `day`. Nothing advances until `commit`. */
  link<T extends object>(record: T, day: string): T & ChainedFields;
  /** The line returned by the last `link` was stored: advance the chain. */
  commit(line: ChainedFields, day: string): void;
}

export function createChainLinker(chainId: string): ChainLinker {
  if (!CHAIN_ID.test(chainId)) throw new Error("A chain id is a short lower-case code.");
  let day = "";
  let n = 0;
  let prev = "";
  const roll = (d: string) => {
    if (!DAY.test(d)) throw new RangeError("A chain day is YYYY-MM-DD.");
    if (d !== day) { day = d; n = 0; prev = genesis(chainId, d); }
  };
  return Object.freeze({
    chainId,
    link<T extends object>(record: T, d: string): T & ChainedFields {
      roll(d);
      const base: Record<string, unknown> = { ...(record as Record<string, unknown>), ch: chainId, n, prev };
      delete base.h;
      return Object.freeze({ ...base, h: hashOf(base) }) as unknown as T & ChainedFields;
    },
    commit(line: ChainedFields, d: string): void {
      roll(d);
      if (line.ch !== chainId || line.n !== n || line.prev !== prev) return; // not the line we linked last
      n += 1;
      prev = line.h;
    },
  });
}

/* ---- verification ------------------------------------------------------------------------------- */

export interface SegmentManifest {
  readonly v: 1;
  readonly plane: string;
  readonly day: string;
  readonly instance: string;
  readonly seq: number;
  readonly lines: number;
  /** sha256 of the segment object's bytes. */
  readonly sha256: string;
  /** `h` of the first and last line (null for a plane that is not chained). */
  readonly first: string | null;
  readonly last: string | null;
  /** `last` of the previous segment of this instance and day; null for seq 0. */
  readonly prevLast: string | null;
  readonly at: number;
}

export type SegmentProblem = "segment-edited" | "unsealed" | "unreadable";

export interface StoredSegment {
  readonly key: string;
  /** null for the file sink (one file per plane per day, no manifest). */
  readonly manifest: SegmentManifest | null;
  readonly lines: readonly unknown[];
  readonly problem: SegmentProblem | null;
}

export type ChainProblemKind = SegmentProblem | "edited" | "deleted" | "reordered" | "broken-link" | "unchained"
  | "segment-missing" | "manifest-mismatch" | "anchor-mismatch";

export interface ChainProblem {
  readonly kind: ChainProblemKind;
  readonly chain: string | null;
  /** The line's n, or the segment's seq for segment problems; null when not applicable. */
  readonly at: number | null;
}

export interface ChainVerdict {
  readonly ok: boolean;
  readonly day: string;
  readonly lines: number;
  readonly chains: number;
  readonly problems: readonly ChainProblem[];
  /** The last n and h of every chain, by chain id. */
  readonly heads: Readonly<Record<string, { readonly n: number; readonly h: string }>>;
  /** sha256 over the sorted heads: keep it elsewhere for a closed day, pass it back as `anchor`. */
  readonly anchor: string;
}

const MAX_PROBLEMS = 200;

const chainedLine = (x: unknown): (Record<string, unknown> & ChainedFields) | null => {
  const r = typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  if (!r) return null;
  return typeof r.ch === "string" && CHAIN_ID.test(r.ch) && Number.isSafeInteger(r.n) && (r.n as number) >= 0
    && typeof r.prev === "string" && HEX64.test(r.prev) && typeof r.h === "string" && HEX64.test(r.h)
    ? (r as Record<string, unknown> & ChainedFields) : null;
};

export function anchorOf(heads: Readonly<Record<string, { readonly n: number; readonly h: string }>>): string {
  return sha256(Object.keys(heads).sort().map((ch) => `${ch}:${heads[ch]!.n}:${heads[ch]!.h}`).join("\n"));
}

/**
 * Checks one day of one chained plane, segments in stored order (instance, then seq). Detects an edited
 * line, a deleted line, a reordered line, a line with no chain fields, an edited or missing segment and a
 * manifest that does not match its segment; with `anchor`, a lost tail or a lost chain.
 */
export function verifyChain(segments: readonly StoredSegment[], o: { readonly day: string; readonly anchor?: string | null }): ChainVerdict {
  const problems: ChainProblem[] = [];
  const add = (p: ChainProblem) => { if (problems.length < MAX_PROBLEMS) problems.push(Object.freeze(p)); };
  const chains = new Map<string, (Record<string, unknown> & ChainedFields)[]>();
  const manifests = new Map<string, { m: SegmentManifest; lines: (Record<string, unknown> & ChainedFields)[] }[]>();
  let total = 0;

  for (const seg of segments) {
    if (seg.problem) add({ kind: seg.problem, chain: seg.manifest?.instance ?? null, at: seg.manifest?.seq ?? null });
    const mine: (Record<string, unknown> & ChainedFields)[] = [];
    for (const raw of seg.lines) {
      total++;
      const l = chainedLine(raw);
      if (!l) { add({ kind: "unchained", chain: null, at: null }); continue; }
      mine.push(l);
      if (!chains.has(l.ch)) chains.set(l.ch, []);
      chains.get(l.ch)!.push(l);
    }
    if (seg.manifest && seg.problem !== "segment-edited") {
      const id = seg.manifest.instance;
      if (!manifests.has(id)) manifests.set(id, []);
      manifests.get(id)!.push({ m: seg.manifest, lines: mine });
    }
  }

  const heads: Record<string, { n: number; h: string }> = {};
  for (const [ch, lines] of chains) {
    const all = new Set(lines.map((l) => l.n));
    let expect = 0;
    let prev = genesis(ch, o.day);
    for (const l of lines) {
      if (hashOf(l) !== l.h) add({ kind: "edited", chain: ch, at: l.n });
      if (l.n < expect) add({ kind: "reordered", chain: ch, at: l.n });
      else if (l.n > expect) {
        for (let k = expect; k < l.n && problems.length < MAX_PROBLEMS; k++) add({ kind: all.has(k) ? "reordered" : "deleted", chain: ch, at: k });
      } else if (l.prev !== prev) add({ kind: "broken-link", chain: ch, at: l.n });
      if (l.n >= expect) prev = l.h; // a line found behind its place does not move the expected link
      expect = Math.max(expect, l.n + 1);
    }
    const last = lines[lines.length - 1]!;
    heads[ch] = { n: last.n, h: last.h };
  }

  for (const [id, segs] of manifests) {
    segs.sort((a, b) => a.m.seq - b.m.seq);
    let prevLast: string | null = null;
    let expectSeq = 0;
    for (const { m, lines } of segs) {
      if (m.seq < expectSeq) add({ kind: "manifest-mismatch", chain: id, at: m.seq }); // the same seq twice
      for (let k = expectSeq; k < m.seq && problems.length < MAX_PROBLEMS; k++) add({ kind: "segment-missing", chain: id, at: k });
      const linked = m.seq === 0 ? m.prevLast === null : m.seq !== expectSeq || m.prevLast === prevLast; // after a gap the gap is the finding
      const fits = m.lines === lines.length && m.first === (lines[0]?.h ?? null) && m.last === (lines[lines.length - 1]?.h ?? null) && linked;
      if (!fits) add({ kind: "manifest-mismatch", chain: id, at: m.seq });
      prevLast = m.last;
      expectSeq = Math.max(expectSeq, m.seq + 1);
    }
  }

  const anchor = anchorOf(heads);
  if (o.anchor && o.anchor !== anchor) add({ kind: "anchor-mismatch", chain: null, at: null });
  return Object.freeze({
    ok: problems.length === 0, day: o.day, lines: total, chains: chains.size,
    problems: Object.freeze(problems), heads: Object.freeze(heads), anchor,
  });
}
