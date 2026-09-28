/**
 * M09-S03-T01 — THE INVESTOR RECORD: one read per Contact plus its related lists, sections by seat
 * (D26, D35, D45, D48, D69, D70).
 *
 * One GET /Contacts/{id} on the signed-in person's own token (D53), admitted by the one IR/AM choke point
 * (server/data/ir-guard admitContact — an IR only for a Contact from their own lead, a KAM only for their
 * own account), then, for that Contact alone:
 *   allotments (with the LLP each sits in)   — every seat with the record ("What they hold", hold banner)
 *   Receipts                                 — only a seat with the Money section (Finance side)
 *   Attachments on Contact / allotment / LLP — only a seat with the Paper section, grouped by D70 scope
 * Money and Paper are hidden for an AM seat and an IR (M09-S03-T02): what a seat may not see is never
 * read, so it cannot leak. No identity field is selected (projections); KYC/FEMA are STATUS fields read
 * for the Finance side only (the same wall as ./finance-list).
 *
 * The Contact's Modified_Time is returned as `version` — the value a later write sends as
 * If-Unmodified-Since. A 412 on such a write is mapped by `recordConflict` to the in-page refusal
 * "Changed by someone else — reload." (logged by id, Plane B) — never a silent overwrite.
 *
 * Rows live for this response only (D45); nothing here is cached.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailure } from "../../lib/zoho/errors";
import type { ImInvestor } from "../../lib/im/types";
import { createInvestorsAdapters, type AllotmentRow, type ReceiptRow } from "../data/adapters";
import { isAmSeat } from "../data/am-scope";
import { parseContact, str } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { admitContact, contactsKeyFor, createInvestorGuard, type GuardRefusal, type PlaneCRefusal } from "../data/ir-guard";
import { holdOf, investorOf } from "../data/live";
import { MODULES, PROJECTIONS } from "../data/projections";
import { scopesFor } from "../data/scope";
import { expectedPaymentStatus, type PaymentStatus } from "../money/allotment-receipts";
import { FINANCE_CONTACT_FIELDS, type FinanceKyc } from "./finance-list";
import { LIFECYCLE_FIELD, resolveIrs, stateLabel, type InvestorStateLabel } from "./lifecycle";

const RECORD_ID = /^\d{15,22}$/;

/** The record's section tabs, in the prototype's keys (features/im/inv SECS). */
export type RecordSection = "who" | "hold" | "care" | "money" | "paper" | "jrn" | "tkt";

const FINANCE_SIDE: readonly RecordSection[] = Object.freeze(["who", "hold", "money", "paper", "jrn", "tkt"]);
const AM_SIDE: readonly RecordSection[] = Object.freeze(["who", "hold", "care", "jrn", "tkt"]);
/** PROVISIONAL: the sections the owner allows for IRs (M09-S03 AC6) — no Money, no Paper, no Care. */
export const IR_SECTIONS: readonly RecordSection[] = Object.freeze(["who", "hold", "jrn"]);

/** The sections a seat's record offers, or null when the seat has no investor record at all. */
export function sectionsFor(seat: string, userId: string): readonly RecordSection[] | null {
  const s = scopesFor(seat, userId).investors;
  if (s.kind === "none" || s.kind === "user") return null;
  if (s.kind === "own-lead") return IR_SECTIONS;
  if (isAmSeat(seat)) return AM_SIDE;
  return FINANCE_SIDE;
}

/** Finance-side status fields (KYC, FEMA) — never identity; the same list the Finance list reads. */
const FINANCE_STATUS = Object.freeze(["KYC", "KYC_Completed_On", "FEMA_Applicable", "FEMA_Verified_At"].filter((f) => FINANCE_CONTACT_FIELDS.includes(f)));
export const ATTACHMENT_FIELDS = Object.freeze(["id", "File_Name", "Size", "Created_Time"]);
const NOT_STANDING: ReadonlySet<string> = new Set(["Reversed", "Not found", "Claimed"]);
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);

export interface HoldingLine {
  readonly id: string;
  readonly llpId: string;
  readonly llpName: string;
  readonly block: string;
  readonly committed: number;
  readonly issued: number;
  readonly status: AllotmentRow["Allocation_Status"];
  /** Agreement_Signed: the supplementary agreement verified (Supplementary_Verified_At); null where Paper is hidden. */
  readonly agreementSigned: boolean | null;
  /** Payment_Status from matched receipts (money/allotment-receipts); null where Money is hidden. */
  readonly paymentStatus: PaymentStatus | null;
  readonly holdUntil: string | null;
}

export interface AttachmentLine { readonly id: string; readonly name: string; readonly size: number | null; readonly at: string | null }

export interface InvestorRecord {
  readonly id: string;
  /** Modified_Time as read: send it as If-Unmodified-Since on the next write to this Contact. */
  readonly version: string | null;
  readonly sections: readonly RecordSection[];
  readonly investor: ImInvestor;
  readonly state: InvestorStateLabel | null;
  /** Finance side only (null elsewhere). */
  readonly kyc: { readonly status: FinanceKyc; readonly on: string | null } | null;
  readonly fema: "outstanding" | "done" | null;
  readonly holdings: readonly HoldingLine[];
  readonly hold: { readonly until: string; readonly extension: string | null } | null;
  readonly money: { readonly paid: number; readonly due: number; readonly receipts: readonly ReceiptRow[] } | null;
  /** D70's three scopes: Personal (Contact), per allotment (per farm), Farm documents (LLP). */
  readonly paper: {
    readonly personal: readonly AttachmentLine[];
    readonly allotments: readonly { readonly allotmentId: string; readonly llpId: string; readonly files: readonly AttachmentLine[] }[];
    readonly farms: readonly { readonly llpId: string; readonly files: readonly AttachmentLine[] }[];
  } | null;
  readonly origin: { readonly leadId: string | null; readonly irId: string | null; readonly irVia: "contact" | "lead" | null; readonly saidYesAt: string | null };
}

export type RecordResult =
  | { readonly ok: true; readonly record: InvestorRecord }
  | GuardRefusal
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface RecordDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "getRelated">;
  readonly events: InvestorEvents;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
}

export interface RecordConflict { readonly ok: false; readonly kind: "conflict"; readonly recordId: string | null; readonly message: string }
export const RECORD_CONFLICT_MESSAGE = "Changed by someone else — reload.";

/** A write's 412 as the in-page refusal the record shows (logged once, by id). Anything else → null. */
export function recordConflict(events: InvestorEvents, userId: string, action: string, failure: ZohoFailure): RecordConflict | null {
  if (failure.kind !== "conflict") return null;
  events.conflict(userId, action, failure.recordId);
  return Object.freeze({ ok: false as const, kind: "conflict" as const, recordId: failure.recordId, message: RECORD_CONFLICT_MESSAGE });
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const imKyc = (k: FinanceKyc): ImInvestor["kyc"] => (k === "passed" || k === "na" ? "passed" : k === "failed" ? "failed" : "pending");
const kycOf = (v: string | null): FinanceKyc => (v === "Completed" ? "passed" : v === "Failed" ? "failed" : v === "NA" ? "na" : "pending");

export function createInvestorRecordReader(deps: RecordDeps) {
  const adapters = createInvestorsAdapters({ crm: deps.crm, events: deps.events });
  const guard = createInvestorGuard({ events: deps.events, planeCRefusal: deps.planeCRefusal });

  const attachments = async (cred: UserCredential, module: string, id: string, signal?: AbortSignal): Promise<readonly AttachmentLine[] | { errorKind: string }> => {
    let r: Awaited<ReturnType<typeof deps.crm.getRelated>>;
    try {
      r = await deps.crm.getRelated(cred, module, id, "Attachments", { fields: ATTACHMENT_FIELDS, perPage: 200, signal });
    } catch { return { errorKind: "unexpected" }; }
    if (!r.ok) return r.error.kind === "not-found" ? [] : { errorKind: r.error.kind };
    return Object.freeze(r.value.records.filter((x) => RECORD_ID.test(x.id)).map((x) => Object.freeze({
      id: x.id, name: str(x, "File_Name", 255) ?? "", size: num(x.Size), at: (str(x, "Created_Time", 40) ?? "").slice(0, 16) || null,
    })));
  };

  async function read(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal): Promise<RecordResult> {
    const me = cred.userId;
    if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return guard.refuse(me, seat, "investor-record", "invalid-request", []);
    const sections = sectionsFor(seat, me);
    if (!sections) return guard.refuse(me, seat, "investor-record", "seat-denied", [contactId]);
    const scope = scopesFor(seat, me).investors;
    const money = sections.includes("money"), paper = sections.includes("paper");

    // M09-S08-T02: an IR first asks Zoho for the id under their own filter (ir-guard oneContactWhere): another
    // IR's investor is not returned, so nothing of it is read — refused before the record GET.
    if (scope.kind === "own-lead") {
      const pre = await guard.one(deps.crm, cred, seat, contactId, signal, "investor-record");
      if (!pre.ok) return pre;
    }
    // One GET per Contact. Finance's status fields only where Money shows; never an identity field; an IR's
    // projection carries no money and no address (irContacts).
    const fields = [...PROJECTIONS[contactsKeyFor(scope)], ...(money ? FINANCE_STATUS : []), ...(LIFECYCLE_FIELD ? [LIFECYCLE_FIELD] : [])];
    let got: Awaited<ReturnType<typeof deps.crm.getRecord>>;
    try { got = await deps.crm.getRecord(cred, MODULES.contacts, contactId, { fields, signal }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected" }; }
    if (!got.ok) {
      if (got.error.kind === "not-found" || got.error.kind === "forbidden") return guard.refuse(me, seat, "investor-record", "not-visible", [contactId]);
      return { ok: false, kind: "source-error", errorKind: got.error.kind };
    }
    const raw: ZohoRecord | null = got.value && got.value.id === contactId ? got.value : null;
    const c = raw ? parseContact(raw) : null;
    if (!raw || !c) return guard.refuse(me, seat, "investor-record", "not-visible", [contactId]);
    const admit = admitContact(scope, c);
    if (!admit.ok) return guard.refuse(me, seat, "investor-record", admit.reason, [contactId]);

    const al = await adapters.allotments(cred, scopesFor(seat, me).money.kind === "none" ? scope : scopesFor(seat, me).money, [contactId], signal, true, money);
    if (!al.ok) return al.kind === "refused" ? guard.refuse(me, seat, "investor-record", "not-own-lead", [contactId]) : { ok: false, kind: "source-error", errorKind: al.errorKind };
    const allots = al.rows.filter((a) => a.Customer === contactId);
    const ll = await adapters.llps(cred, signal);
    const llps = new Map((ll.ok ? ll.rows : []).map((l) => [l.id, l]));

    let receipts: readonly ReceiptRow[] = [];
    if (money) {
      const rc = await adapters.receipts(cred, scopesFor(seat, me).money, allots.map((a) => a.id), signal, true);
      if (!rc.ok) return rc.kind === "refused" ? guard.refuse(me, seat, "investor-record", "not-own-lead", [contactId]) : { ok: false, kind: "source-error", errorKind: rc.errorKind };
      receipts = rc.rows;
    }
    const standing = new Map<string, number>(), matchedIn = new Map<string, number>(), inbound = new Map<string, number>();
    for (const r of receipts) {
      if (!r.allotmentId || (r.matchState && NOT_STANDING.has(r.matchState))) continue;
      const refund = r.kind === "Refund" || !!r.reversalOf;
      const isIn = !refund && !!r.kind && INBOUND.has(r.kind);
      if (isIn) inbound.set(r.allotmentId, (inbound.get(r.allotmentId) ?? 0) + r.amount);
      if (isIn && r.matched) matchedIn.set(r.allotmentId, (matchedIn.get(r.allotmentId) ?? 0) + r.amount);
      standing.set(r.allotmentId, (standing.get(r.allotmentId) ?? 0) + (isIn ? r.amount : refund ? -r.amount : 0));
    }
    const live = allots.filter((a) => a.Allocation_Status !== "Cancelled");
    const holdings: HoldingLine[] = allots.map((a) => {
      const l = llps.get(a.LLP_Lookup);
      return Object.freeze({
        id: a.id, llpId: a.LLP_Lookup, llpName: l?.Name ?? "", block: l?.Block_Code ?? "", committed: a.Committed_Units, issued: a.Issued_Units,
        status: a.Allocation_Status, agreementSigned: paper ? !!a.agreementSignedAt : null,
        paymentStatus: money ? expectedPaymentStatus(matchedIn.get(a.id) ?? 0, a.Committed_Units * a.Unit_Price) : null,
        holdUntil: a.holdUntil,
      });
    });
    const paid = live.reduce((t, a) => t + (inbound.get(a.id) ?? 0), 0);
    const due = live.filter((a) => a.Allocation_Status === "Reserved").reduce((t, a) => t + Math.max(0, a.Committed_Units * a.Unit_Price - (standing.get(a.id) ?? 0)), 0);

    let paperOut: InvestorRecord["paper"] = null;
    if (paper) {
      const personal = await attachments(cred, MODULES.contacts, contactId, signal);
      if ("errorKind" in personal) return { ok: false, kind: "source-error", errorKind: personal.errorKind };
      const perAllot: { allotmentId: string; llpId: string; files: readonly AttachmentLine[] }[] = [];
      for (const a of allots) {
        const f = await attachments(cred, MODULES.allotments, a.id, signal);
        if ("errorKind" in f) return { ok: false, kind: "source-error", errorKind: f.errorKind };
        perAllot.push(Object.freeze({ allotmentId: a.id, llpId: a.LLP_Lookup, files: f }));
      }
      const farms: { llpId: string; files: readonly AttachmentLine[] }[] = [];
      for (const llpId of [...new Set(allots.map((a) => a.LLP_Lookup).filter((x) => RECORD_ID.test(x)))]) {
        const f = await attachments(cred, MODULES.llps, llpId, signal);
        if ("errorKind" in f) return { ok: false, kind: "source-error", errorKind: f.errorKind };
        farms.push(Object.freeze({ llpId, files: f }));
      }
      paperOut = Object.freeze({ personal, allotments: Object.freeze(perAllot), farms: Object.freeze(farms) });
    }

    const [ir] = await resolveIrs(deps.crm, cred, [c], signal);
    const investor = investorOf(c, allots, (id) => llps.get(id)?.Block_Code ?? "");
    const derived = !allots.length ? null : !live.length ? "lapsed" as const : investor.st;
    const holdUntil = holdOf(live);
    const holdRow = holdUntil ? live.find((a) => a.holdUntil === holdUntil) : undefined;
    const femaApplies = raw.FEMA_Applicable === true;
    const record: InvestorRecord = Object.freeze({
      id: c.id,
      version: str(raw, "Modified_Time", 40),
      sections,
      investor: money ? { ...investor, kyc: imKyc(kycOf(str(raw, "KYC", 40))), kycOn: (str(raw, "KYC_Completed_On", 40) ?? "").slice(0, 10) || null } : investor,
      state: stateLabel({ blueprint: LIFECYCLE_FIELD ? raw[LIFECYCLE_FIELD] : null, derived, saidYesAt: c.saidYesAt }),
      kyc: money ? Object.freeze({ status: kycOf(str(raw, "KYC", 40)), on: (str(raw, "KYC_Completed_On", 40) ?? "").slice(0, 10) || null }) : null,
      fema: money && femaApplies ? (str(raw, "FEMA_Verified_At", 40) ? "done" : "outstanding") : null,
      holdings: Object.freeze(holdings),
      hold: holdUntil ? Object.freeze({ until: holdUntil, extension: holdRow?.holdExtension ?? null }) : null,
      money: money ? Object.freeze({ paid, due, receipts }) : null,
      paper: paperOut,
      origin: Object.freeze({ leadId: c.originLeadId, irId: ir ?? null, irVia: c.originatingIrId ? "contact" as const : ir ? "lead" as const : null, saidYesAt: c.saidYesAt }),
    });
    return { ok: true, record };
  }

  return Object.freeze({ read });
}
export type InvestorRecordReader = ReturnType<typeof createInvestorRecordReader>;

