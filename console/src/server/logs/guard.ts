/**
 * M18-S02-T03 / M01-S04-T01 — THE LAST LOCK BEFORE A LOG LINE IS KEPT.
 *
 * Every producer (Plane B's call and refusal lines, its error lines, Plane C) already rebuilds its
 * record from an allow-list. This guard runs once more on the finished record, in the shared sink,
 * whatever produced it: any string that is shaped like an identity value or free text
 * (`looksLikeIdentity` — PAN, Aadhaar, mobile, email, UTR, account number, whitespace) becomes
 * "redacted", and any integer of nine or more digits outside `at` becomes null. Zoho ids (15–22
 * digits) and request UUIDs pass. The input is never mutated; a new frozen record is returned.
 */

import { looksLikeIdentity } from "../../lib/zoho/log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_KEYS: ReadonlySet<string> = new Set(["at"]);
const MAX_DEPTH = 4;

export const REDACTED = "redacted";

function clean(value: unknown, key: string, depth: number, hits: { n: number }): unknown {
  if (typeof value === "string") {
    if (UUID.test(value) || !looksLikeIdentity(value)) return value;
    hits.n++;
    return REDACTED;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (!TIME_KEYS.has(key) && Number.isInteger(value) && Math.abs(value) >= 100_000_000) {
      hits.n++;
      return null;
    }
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) {
    hits.n++;
    return null;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((v) => clean(v, key, depth + 1, hits)));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(k)) {
        hits.n++;
        continue;
      }
      out[k] = clean(v, k, depth + 1, hits);
    }
    return Object.freeze(out);
  }
  hits.n++;
  return null;
}

/** The record with every identity-shaped value removed, and how many values were removed. */
export function guardRecord<T extends object>(record: T): { readonly record: T; readonly redacted: number } {
  const hits = { n: 0 };
  const out = clean(record, "", 0, hits) as T;
  return { record: out, redacted: hits.n };
}
