/**
 * M12-S04..S07 — THE PAPER SLOTS a Zoho Sign request lives on, and the shared helpers of the send / status /
 * filing / block chain. The field names are the org's (confirmed read-only with getFields, 2026-09-28):
 *
 *   paper              module                      request id                  method (picklist)           verified at / by                                   signed file slot
 *   nda                Leads                       NDA_Sign_Req_Id             NDA_Signed_Via              NDA_Verified_At / NDA_Verified_By                  NDA
 *   fema               Contacts                    FEMA_Sign_Req_Id            FEMA_Signed_Via             FEMA_Verified_At / FEMA_Verified_By                FEMA_Declaration
 *   supplementary      LLP_UnitAllocation_Module   Supplementary_Sign_Req_Id   Supplementary_Signed_Via    Supplementary_Verified_At / _By                    Supplementary_Agreement
 *   allocation-letter  LLP_UnitAllocation_Module   Alloc_Letter_Sign_Req_Id    Alloc_Letter_Signed_Via     Alloc_Letter_Verified_At / _By                     Allocation_Letter
 *
 * There is no "Agreement_Signed" field on the allotment: the console's Agreement_Signed is
 * Supplementary_Verified_At (server/data/adapters.ts), and the lead's alloc gate is computed from it
 * (server/leads/gates.ts) — so setting or clearing that stamp opens or closes the gate on its next read.
 * D77: no Documents module; the request's live status (sent, viewed, declined…) stays in Zoho Sign.
 */

import type { Credential, ZohoApi, ZohoRecord } from "../../lib/zoho/client";
import { PAPERS as LIST_PAPERS, type Paper } from "../documents/list";
import type { SignMethod, SignRequestDetail } from "./api";

export type { Paper };
export interface PaperFields {
  readonly paper: Paper;
  readonly label: string;
  readonly module: "Leads" | "Contacts" | "LLP_UnitAllocation_Module";
  readonly req: string;
  readonly via: string;
  readonly verifiedAt: string;
  readonly verifiedBy: string;
  readonly slot: string;
}
const SLOT_OF: Readonly<Record<Paper, string>> = Object.freeze({
  nda: "NDA", fema: "FEMA_Declaration", supplementary: "Supplementary_Agreement", "allocation-letter": "Allocation_Letter",
});
const LABEL_OF: Readonly<Record<Paper, string>> = Object.freeze({
  nda: "Non-disclosure agreement", fema: "FEMA declaration", supplementary: "Supplementary agreement", "allocation-letter": "Allocation letter",
});
export const PAPER_FIELDS: Readonly<Record<Paper, PaperFields>> = Object.freeze(Object.fromEntries(LIST_PAPERS.map((p) => [p.paper, Object.freeze({
  paper: p.paper, label: LABEL_OF[p.paper], module: p.module as PaperFields["module"], req: p.req, via: p.via,
  verifiedAt: p.verified, verifiedBy: p.verified.replace(/_At$/, "_By"), slot: SLOT_OF[p.paper],
})])) as Record<Paper, PaperFields>);
export const PAPER_KEYS: readonly Paper[] = Object.freeze(Object.keys(PAPER_FIELDS) as Paper[]);
export const isPaper = (v: unknown): v is Paper => typeof v === "string" && Object.hasOwn(PAPER_FIELDS, v);

/** The *_Signed_Via picklist values (org picklist, confirmed). */
export const SIGNED_VIA: Readonly<Record<SignMethod, string>> = Object.freeze({ aadhaar: "Zoho Sign - Aadhaar", "email-otp": "Zoho Sign - Email OTP" });
/** Paper signed outside Zoho Sign, verified by hand (M12-S06 AC4). */
export const HAND_METHODS: readonly string[] = Object.freeze(["Class 3 DSC", "Wet signature", "Uploaded"]);

/**
 * Who sends, reminds, recalls, verifies and blocks — PROVISIONAL until OD8. Finance (fin), Head of Finance
 * (head), Finance Operations on the Investors side and Digital Infrastructure/super user (ops, di);
 * Compliance (comp) for the FEMA declaration (its KYC paper — TC-IM07-012/016). Viewers, audit, KAM,
 * Head of AM and the lead side never (TC-IM07-007).
 */
const ACT_SEATS: Readonly<Record<Paper, ReadonlySet<string>>> = Object.freeze({
  nda: new Set(["fin", "head", "ops", "di"]),
  fema: new Set(["fin", "head", "ops", "di", "comp"]),
  supplementary: new Set(["fin", "head", "ops", "di"]),
  "allocation-letter": new Set(["fin", "head", "ops", "di"]),
});
export function mayActOnPaper(seat: string, paper: Paper): boolean {
  return isPaper(paper) && ACT_SEATS[paper].has(seat);
}
export const SEND_BELONGS_TO = "Sending belongs to Finance Operations, Compliance and the Head of Finance.";
/** D68: the super user may act for testing; the answer names Finance as the primary doer. */
export const primaryDoerNote = (seat: string): string | null => (seat === "di" ? "Finance is the primary doer; this was done as the super user for testing." : null);

export const RECORD_ID = /^\d{15,22}$/;
export const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export const reqIdOf = (r: ZohoRecord | null | undefined, f: PaperFields): string | null => {
  const v = r?.[f.req];
  return typeof v === "string" && /^\d{10,25}$/.test(v.trim()) ? v.trim() : null;
};
export const verifiedOf = (r: ZohoRecord | null | undefined, f: PaperFields): string | null => {
  const v = r?.[f.verifiedAt];
  return typeof v === "string" && v !== "" ? v : null;
};

/** A Zoho datetime in IST ("2026-09-28T11:30:00+05:30") for a stamp. */
export function istStamp(ms: number): string {
  return `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
}

/** The row's state from Zoho Sign's own record (D72): only "completed" is signed. */
export type SignState = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired" | "recalled" | "unknown";
export function signStateOf(d: Pick<SignRequestDetail, "status" | "actions">): SignState {
  switch (d.status) {
    case "completed": return "signed";
    case "declined": return "declined";
    case "expired": return "expired";
    case "recalled": return "recalled";
    case "draft": return "draft";
    case "inprogress": case "in progress": case "in_progress":
      return d.actions.some((a) => a.status === "VIEWED") ? "viewed" : "sent";
    default: return "unknown";
  }
}
/** A request that still asks someone to sign: the "one live request per type per record" rule counts these. */
export const isLive = (s: SignState): boolean => s === "sent" || s === "viewed" || s === "draft" || s === "unknown";
export const STATE_LABEL: Readonly<Record<SignState, string>> = Object.freeze({
  draft: "Not sent yet", sent: "Out for signature — the IR is chasing", viewed: "Viewed", signed: "Signed", declined: "Declined",
  expired: "Expired", recalled: "Recalled", unknown: "Out for signature",
});

/** A Zoho Note on the record (the reason for a recall or block: D45 keeps it in Zoho, never in a log). */
export async function addNote<C extends Credential>(crm: Pick<ZohoApi<C>, "insert">, cred: C, module: string, recordId: string, title: string, content: string, signal?: AbortSignal)
  : Promise<{ ok: true; noteId: string } | { ok: false; errorKind: string }> {
  let r: Awaited<ReturnType<ZohoApi<C>["insert"]>>;
  try {
    r = await crm.insert(cred, "Notes", [{ Note_Title: title.slice(0, 120), Note_Content: content.slice(0, 2000), Parent_Id: { module: { api_name: module }, id: recordId } }], { signal });
  } catch { return { ok: false, errorKind: "unexpected" }; }
  if (!r.ok) return { ok: false, errorKind: r.error.kind };
  const o = r.value[0];
  return o && o.ok && o.id ? { ok: true, noteId: o.id } : { ok: false, errorKind: "partial" };
}

/** A reason is required text: 3–500 characters once trimmed, one line or a few. */
export function cleanReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t.length >= 3 && t.length <= 500 ? t : null;
}
