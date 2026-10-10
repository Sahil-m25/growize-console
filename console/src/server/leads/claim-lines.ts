/**
 * D139 (owner ruling 10 Oct 2026, Jev p=1.00) — THE STATE OF THE IR'S OWN PAYMENT REPORTS.
 *
 * An IR does NOT see individual receipt lines (D69 stands). What the IR does see, for every report of their own: whether it is
 * pending (Finance has not found it yet), matched (Finance found it and recorded the receipt) or rejected (Finance did not find
 * it, with the reason), the amount claimed, the date the investor said they paid, and the day Finance answered.
 *
 * Reads only the IR's own Claimed receipts — Receipts sharing is Private, so the IR's token returns only their own rows — and only
 * the fields the IR profile can read: Match_State, Amount, Received_On, the CLAIM-<leadId>-<n> reference, and the system
 * Modified_Time (the answer is a write on the report, so it is the day Finance answered). Never Matched_By, the bank UTR of the
 * receipt Finance records, Kind, Mode or the allotment. If Zoho refuses a field (COQL refuses the whole query), the read repeats
 * with the key and state alone: the line then carries no amount or date, never a guess.
 *
 * Receipts has no answer field (claim-answer.ts): the two answers share Match_State "Not found" and differ by the Note's title
 * ("Finance found it" -> matched; "Finance did not find it" -> rejected, the Note's body is the reason). A Note that cannot be
 * read leaves the line "answered". Nothing is cached (D45); nothing here is logged; no reference is returned.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { FOUND_TITLE, NOT_FOUND_TITLE, ANSWERED_STATE } from "../money/claim-answer";

export const CLAIM_KEY = /^CLAIM-(\d{15,22})-(\d{1,4})$/;
const RECORD_ID = /^\d{15,22}$/;
const FIELDS = "id, UTR, Match_State, Amount, Received_On, Modified_Time";
const FIELDS_MIN = "id, UTR, Match_State, Modified_Time";   // Modified_Time is a system field: the answer day survives a hidden Amount or Received_On
const MAX_NOTE_READS = 10;

export type ClaimLineState = "pending" | "matched" | "rejected" | "answered";

export interface IrClaimLine {
  readonly claimId: string;
  readonly leadId: string;
  readonly seq: number;
  readonly state: ClaimLineState;
  /** whole rupees the investor said they paid; null when Zoho hides the field */
  readonly amount: number | null;
  /** the day the investor said they paid (Received_On), YYYY-MM-DD; null when hidden */
  readonly claimedOn: string | null;
  /** the IST day Finance answered (the report's Modified_Time) — pending reports have none */
  readonly answeredOn: string | null;
  /** Finance's reason, for a rejected line only */
  readonly reason: string | null;
}

const istDay = (zoho: unknown): string | null => {
  if (typeof zoho !== "string") return null;
  const t = Date.parse(zoho);
  return Number.isFinite(t) ? new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10) : null;
};

/** Pure: one report row as the IR may read it. `answer` / `reason` come from the report's Notes (answered reports only). */
export function claimLineOf(r: ZohoRecord, answer: "found" | "not-found" | null, reason: string | null): IrClaimLine | null {
  const m = typeof r.UTR === "string" ? CLAIM_KEY.exec(r.UTR) : null;
  if (!m || typeof r.id !== "string" || !RECORD_ID.test(r.id)) return null;
  const st = r.Match_State;
  const state: ClaimLineState = st === "Claimed" ? "pending" : st === ANSWERED_STATE ? (answer === "found" ? "matched" : answer === "not-found" ? "rejected" : "answered") : "answered";
  const amount = typeof r.Amount === "number" && Number.isFinite(r.Amount) && r.Amount >= 0 ? r.Amount : null;
  const claimedOn = typeof r.Received_On === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.Received_On) ? r.Received_On.slice(0, 10) : null;
  return Object.freeze({
    claimId: r.id, leadId: m[1]!, seq: Number(m[2]), state, amount, claimedOn,
    answeredOn: state === "pending" ? null : istDay(r.Modified_Time),
    reason: state === "rejected" && reason ? reason.slice(0, 500) : null,
  });
}

export type ClaimLinesResult = { readonly ok: true; readonly lines: readonly IrClaimLine[] } | { readonly ok: false; readonly kind: ZohoFailureKind | "invalid" | "unexpected" };

/**
 * The IR's own reports, newest first. `leadIds`: only these leads' reports (the key names the lead). One COQL on the IR's token
 * (their own rows are all Zoho returns); more than one page is refused as "invalid" rather than showing a part.
 */
export async function readClaimLines(crm: Pick<ZohoClient, "coql"> & Partial<Pick<ZohoClient, "getRelated">>, cred: UserCredential,
  leadIds: readonly string[], signal?: AbortSignal): Promise<ClaimLinesResult> {
  const ids = new Set(leadIds.filter((x) => typeof x === "string" && RECORD_ID.test(x)));
  if (!ids.size) return { ok: true, lines: Object.freeze([]) };
  const like = ids.size === 1 ? `CLAIM-${[...ids][0]}-%` : "CLAIM-%";
  let rows: readonly ZohoRecord[] = [];
  for (const fields of [FIELDS, FIELDS_MIN]) {
    let r: Awaited<ReturnType<typeof crm.coql>>;
    try { r = await crm.coql(cred, `select ${fields} from Receipts where UTR like '${like}' limit 0, 200`, { signal }); } catch { return { ok: false, kind: "unexpected" }; }
    if (!r.ok) {
      if (r.error.kind === "invalid-data" && fields === FIELDS) continue;   // a hidden field: repeat with the key and state alone
      return { ok: false, kind: r.error.kind };
    }
    if (r.value.invalidRecordIds || r.value.moreRecords) return { ok: false, kind: "invalid" };
    rows = r.value.records;
    break;
  }
  const mine = rows.filter((x) => { const m = typeof x.UTR === "string" ? CLAIM_KEY.exec(x.UTR) : null; return !!m && ids.has(m[1]!); });
  const lines: IrClaimLine[] = [];
  let notes = 0;
  for (const x of [...mine].sort((a, b) => Number(CLAIM_KEY.exec(String(b.UTR))![2]) - Number(CLAIM_KEY.exec(String(a.UTR))![2]))) {
    let answer: "found" | "not-found" | null = null, reason: string | null = null;
    if (x.Match_State === ANSWERED_STATE && typeof crm.getRelated === "function" && notes < MAX_NOTE_READS) {
      notes++;
      try {
        const n = await crm.getRelated(cred, "Receipts", String(x.id), "Notes", { fields: ["Note_Title", "Note_Content"], perPage: 200, signal });
        if (!n.ok && n.error.kind !== "not-found") return { ok: false, kind: n.error.kind };
        const list = n.ok ? n.value.records : [];
        if (list.some((y) => y.Note_Title === FOUND_TITLE)) answer = "found";
        else {
          const nf = list.find((y) => y.Note_Title === NOT_FOUND_TITLE);
          if (nf) { answer = "not-found"; reason = typeof nf.Note_Content === "string" ? nf.Note_Content : null; }
        }
      } catch { return { ok: false, kind: "unexpected" }; }
    }
    const line = claimLineOf(x, answer, reason);
    if (!line) return { ok: false, kind: "invalid" };
    lines.push(line);
  }
  return { ok: true, lines: Object.freeze(lines) };
}
