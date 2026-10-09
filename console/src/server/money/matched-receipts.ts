/**
 * D137 — one reader for the receipts behind the 10% and the balance (ruling 2(a)), on the reader's OWN token (D53).
 *
 * Reads Receipts by a WHERE the caller builds (an allotment list, or — before the investor exists — the Lead, GC-1527) and returns
 * them as lib/money/ten-percent TrailReceipt rows plus the link each one carries. Two fields are D137's and may not exist yet in an
 * org (zoho/changes/2026-10-09-d137-fields.md); the read degrades instead of failing:
 *   Receipts.Matched_At  the match's date-time (IST). Missing → the read is repeated without it and the trail uses Received_On,
 *                        marked "(received)".
 *   Receipts.Lead        the lead a pre-investor receipt belongs to. A WHERE naming it on an org without it → `fields-missing`.
 * The bank reference (UTR) is read so the trail can MASK it; it is never logged and never leaves this process unmasked
 * (lib/money/ten-percent maskReference). A read cut short (more than one page) is `unknown`, never a partial total.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { TrailReceipt } from "../../lib/money/ten-percent";

export const RECEIPTS = "Receipts";
export const MATCHED_AT_FIELD = "Matched_At";
export const RECEIPT_LEAD_FIELD = "Lead";
const BASE = Object.freeze(["id", "Allotment", "Kind", "Amount", "UTR", "Received_On", "Match_State", "Matched_By", "Modified_Time"]);
const RECORD_ID = /^\d{15,22}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 200;

export interface ReadReceipt extends TrailReceipt {
  readonly allotmentId: string | null;
  readonly leadId: string | null;
  readonly modifiedTime: string | null;
}
export type ReadReceipts =
  | { readonly ok: true; readonly rows: readonly ReadReceipt[]; readonly matchedAtField: boolean }
  | { readonly ok: false; readonly kind: "fields-missing" | "unknown"; readonly errorKind: ZohoFailureKind | "unexpected" | "cut-short" | "unreadable" };

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Parse one row, or null when it cannot be trusted (then the caller's whole read is `unknown`). */
export function parseReceipt(x: ZohoRecord, matchedAtField: boolean): ReadReceipt | null {
  if (typeof x.id !== "string" || !RECORD_ID.test(x.id)) return null;
  const kind = text(x.Kind), state = text(x.Match_State);
  const amount = typeof x.Amount === "number" ? x.Amount : typeof x.Amount === "string" && /^\d+$/.test(x.Amount) ? Number(x.Amount) : NaN;
  if (!kind || !state || !Number.isSafeInteger(amount)) return null;
  const matchedAt = matchedAtField && typeof x[MATCHED_AT_FIELD] === "string" && DATETIME.test(x[MATCHED_AT_FIELD] as string) ? x[MATCHED_AT_FIELD] as string : null;
  const rcv = typeof x.Received_On === "string" && (DATETIME.test(x.Received_On) || DAY.test(x.Received_On)) ? x.Received_On : null;
  return Object.freeze({
    id: x.id, kind, amount, state,
    at: matchedAt ?? rcv, atIsReceived: !matchedAt && !!rcv,
    ref: text(x.UTR), matchedById: idOf(x.Matched_By),
    allotmentId: idOf(x.Allotment), leadId: idOf(x[RECEIPT_LEAD_FIELD]),
    modifiedTime: typeof x.Modified_Time === "string" && DATETIME.test(x.Modified_Time) ? x.Modified_Time : null,
  });
}

/** Receipts matching `where` (already escaped by the caller: ids only). `withLead` also selects Receipts.Lead. */
export async function readReceipts(crm: Pick<ZohoClient, "coql">, cred: UserCredential, where: string, signal?: AbortSignal,
  opts: { readonly withLead?: boolean } = {}): Promise<ReadReceipts> {
  const fields = (matchedAt: boolean) => [...BASE, ...(opts.withLead ? [RECEIPT_LEAD_FIELD] : []), ...(matchedAt ? [MATCHED_AT_FIELD] : [])];
  const q = (matchedAt: boolean) => `select ${fields(matchedAt).join(", ")} from ${RECEIPTS} where ${where} order by id asc limit 0, ${PAGE}`;
  let matchedAt = true;
  let r: Awaited<ReturnType<typeof crm.coql>>;
  try {
    r = await crm.coql(cred, q(true), { signal });
    if (!r.ok && r.error.kind === "invalid-data") { matchedAt = false; r = await crm.coql(cred, q(false), { signal }); }
  } catch { return { ok: false, kind: "unknown", errorKind: "unexpected" }; }
  if (!r.ok) return { ok: false, kind: r.error.kind === "invalid-data" ? "fields-missing" : "unknown", errorKind: r.error.kind };
  if (r.value.invalidRecordIds) return { ok: false, kind: "unknown", errorKind: "unreadable" };
  if (r.value.moreRecords) return { ok: false, kind: "unknown", errorKind: "cut-short" };
  const rows: ReadReceipt[] = [];
  for (const x of r.value.records) {
    const p = parseReceipt(x, matchedAt);
    if (!p) return { ok: false, kind: "unknown", errorKind: "unreadable" };
    rows.push(p);
  }
  return { ok: true, rows: Object.freeze(rows), matchedAtField: matchedAt };
}

/** The committed amount of live allotments (units × Unit_Price), or null when any live one's price or units cannot be read. */
export function committedOf(allots: readonly ZohoRecord[]): number | null {
  let sum = 0;
  for (const a of allots) {
    if (a.Allocation_Status === "Cancelled") continue;
    const units = Math.max(typeof a.Issued_Units === "number" ? a.Issued_Units : 0, typeof a.Reserved_Units === "number" ? a.Reserved_Units : 0);
    const price = a.Unit_Price;
    if (typeof price !== "number" || !Number.isSafeInteger(price) || price <= 0 || !Number.isSafeInteger(units) || units <= 0) return null;
    sum += units * price;
  }
  return sum > 0 && Number.isSafeInteger(sum) ? sum : null;
}
