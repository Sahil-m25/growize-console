/**
 * D140 (W8-IRA-1) — THE ONE WRITER OF THE ALLOTMENT'S Total_Amount_Received.
 *
 * Total_Amount_Received on LLP_UnitAllocation_Module is a DERIVED total: matched inbound receipts on the allotment (Advance, Part,
 * Balance, Full) minus matched refunds — the same arithmetic as the 10% trail and the full conversion (lib/money/ten-percent
 * `matched`). Before D140 nothing wrote it, so every allotment read 0 and the IR's / KAM's "amount due" (server/investors/ir-money:
 * Total_Amount_Receivable − Total_Amount_Received, on their own token, D138/D139) ignored the advance Finance had already matched.
 *
 * Rule 1 (one fact, one writer): this function is the only console path that writes the field. It is called on FINANCE'S OWN
 * TOKEN (rule 2 — Finance holds read_write on it, zoho/access/spec.json `allotment_money`) after every change to what is matched on
 * an allotment:
 *   - money/match consequences (every match: inbound money, a refund's second hand, and a repeated press — idempotent);
 *   - investors/convert after the lead's receipts are linked to the allotment (the 10% press and the lead-route balance).
 * The console has no unmatch path today (a Reversed receipt is not written by the console); a future one calls this too.
 *
 * The write: read the matched receipts (one page; a read cut short is `receipts-unread`, never a partial total), read the
 * allotment's current value and Modified_Time, and — only when they differ — ONE guarded PUT (If-Unmodified-Since, D44). A
 * conflict (someone wrote the allotment between the read and the write) re-reads and tries once more. The outcome is reported,
 * never thrown, and never undoes the match that called it. Logs carry ids and codes only — never the amount.
 */
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { tenPercentTrail } from "../../lib/money/ten-percent";
import { readReceipts } from "./matched-receipts";

export const ALLOTMENTS = "LLP_UnitAllocation_Module";
export const RECEIVED_FIELD = "Total_Amount_Received";
const RECORD_ID = /^\d{15,22}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export type ReceivedSync =
  | { readonly ok: true; readonly value: { readonly received: number; readonly written: boolean }; readonly code: null }
  | { readonly ok: false; readonly value: null; readonly code: string };

/** Pure: what the allotment's Total_Amount_Received must say for these receipts (matched inbound − matched refunds, never below 0). */
export function receivedOf(rows: Parameters<typeof tenPercentTrail>[1]): number {
  return Math.max(0, tenPercentTrail(null, rows).matched);
}

const current = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

/**
 * Bring the allotment's Total_Amount_Received in line with its matched receipts, on `cred` (Finance's own token).
 * `log` (optional): one refusal-line on a failure — ids and the code only.
 */
export async function syncReceived(crm: Pick<ZohoClient, "getRecord" | "coql" | "update">, cred: UserCredential, allotmentId: string,
  signal?: AbortSignal, log?: Pick<OpsLog, "refusal">, clock: () => number = Date.now): Promise<ReceivedSync> {
  const fail = (code: string): ReceivedSync => {
    try { log?.refusal({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "received-total", reason: code, recordIds: RECORD_ID.test(allotmentId) ? [allotmentId] : [] }); } catch { /* never breaks the caller */ }
    return { ok: false, value: null, code };
  };
  if (typeof allotmentId !== "string" || !RECORD_ID.test(allotmentId)) return fail("invalid-request");
  for (let attempt = 0; attempt < 2; attempt++) {
    const rc = await readReceipts(crm, cred, `Allotment = '${allotmentId}'`, signal).catch(() => null);
    if (!rc || !rc.ok) return fail("receipts-unread");
    const want = receivedOf(rc.rows.filter((r) => r.allotmentId === allotmentId));
    const a = await crm.getRecord(cred, ALLOTMENTS, allotmentId, { fields: [RECEIVED_FIELD, "Modified_Time"], signal }).catch(() => null);
    if (!a || !a.ok || !a.value || a.value.id !== allotmentId) return fail("allotment-unread");
    if (current(a.value[RECEIVED_FIELD]) === want) return { ok: true, value: { received: want, written: false }, code: null };
    const mt = typeof a.value.Modified_Time === "string" && ZDT.test(a.value.Modified_Time) ? a.value.Modified_Time : null;
    if (!mt) return fail("allotment-unread");
    const w = await crm.update(cred, ALLOTMENTS, allotmentId, { [RECEIVED_FIELD]: want }, { ifUnmodifiedSince: mt, signal }).catch(() => null);
    if (w && w.ok) return { ok: true, value: { received: want, written: true }, code: null };
    if (w && !w.ok && w.error.kind === "conflict" && attempt === 0) continue;   // the allotment moved under us: read again, once
    return fail(!w ? "unexpected" : w.error.kind === "conflict" ? "allotment-changed" : w.error.kind);
  }
  return fail("allotment-changed");
}
