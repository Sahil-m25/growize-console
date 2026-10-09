/**
 * M12-S04-T04 — ONE-SAVE SEND THROUGH commit() (D17, D45, D48, D52, D53, D68, D72).
 *
 * Finance sends the next paper from the allotment or the Contact. Everything runs on the sender's own token:
 *   1. The seat may send this paper (papers.ts, PROVISIONAL until OD8); Send is never offered to a viewer or KAM.
 *   2. The record is read (it must be visible to the sender) with the slot's request id, verified stamp and
 *      Modified_Time; the recipient is read from the record (Contact name + email; for an allotment, its Customer).
 *   3. One live request per paper per record: a verified paper is "already on file"; a request id whose Zoho Sign
 *      request is still out (draft / in progress) is refused and named; a declined / expired / recalled one may be
 *      replaced. If Zoho Sign cannot be read the send does not happen (it cannot prove the rule).
 *   4. An NRI (Residency NRI/OCI) is never sent Aadhaar eSign; the page offers email OTP instead.
 *   5. The request is created in Zoho Sign (template or uploaded PDF with Finance's signature box), then ONE
 *      guarded write (If-Unmodified-Since) puts the request id and the method on the record. If that write fails
 *      the new request is recalled at once (the compensating step), so no live request exists that the record
 *      does not name; the answer is "Not saved yet". Status, sent time and sender stay in Zoho Sign (D77).
 *   6. Double press: one Idempotency-Key per Send. A second press with the same key returns the first answer;
 *      a different key while the first is running is "busy". Nothing is kept but keys and ids, in memory.
 * Plane B: the clients log each call (ids only); refusals and the send itself add one line with ids and a code.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { ROUND_FIELDS } from "../leads/paperwork";
import { createIdempotency } from "../state/idempotent";
import { createMemoryState } from "../state/memory";
import type { SharedState } from "../state/shared-state";
import type { SignApi, SignField, SignMethod, SignRecipient, SignTemplate } from "./api";
import { SIGN_NOT_CONFIGURED, signFailure } from "./api";
import {
  DATETIME, isLive, isPaper, mayActOnPaper, PAPER_FIELDS, PAPER_KEYS, primaryDoerNote, RECORD_ID, reqIdOf, SEND_BELONGS_TO, SIGNED_VIA, signStateOf,
  STATE_LABEL, verifiedOf, type Paper, type PaperFields, type SignState,
} from "./papers";

export type SendRefusal =
  | "invalid-request" | "idempotency-key-invalid" | "idempotency-key-reused" | "seat-denied" | "not-visible" | "already-on-file"
  | "already-out" | "nda-first" | "no-agreed-draft" | "aadhaar-not-for-nri" | "aadhaar-needs-template" | "no-recipient" | "record-changed" | "busy" | "template-shape";

export const SEND_MESSAGE: Readonly<Record<SendRefusal, string>> = Object.freeze({
  "invalid-request": "Not sent — the send is incomplete.",
  "idempotency-key-invalid": "Not sent — reload and press Send again.",
  "idempotency-key-reused": "Not sent — that press belongs to another send. Press Send again.",
  "seat-denied": SEND_BELONGS_TO,
  "not-visible": "You cannot open this record in Zoho.",
  "already-on-file": "Not sent — this paper is already on file, signed and verified.",
  "already-out": "Not sent — a request for this paper is already out for signature.",
  "nda-first": "Not sent — the NDA has not come back signed and been verified yet. The supplementary agreement follows it.",
  "no-agreed-draft": "Not sent — the IR has not recorded an agreed final draft of the supplementary agreement yet.",
  "aadhaar-not-for-nri": "Aadhaar eSign is not available: this investor is an NRI, and Aadhaar eSign needs an Aadhaar linked to a live Indian mobile. Send with email OTP.",
  "aadhaar-needs-template": "Aadhaar eSign is set in a Zoho Sign template. Pick the template, or send the uploaded PDF with email OTP.",
  "no-recipient": "Not sent — the record has no name and email to send to.",
  "record-changed": "Not saved yet — the record changed in Zoho. Reload and send again.",
  "busy": "Not saved yet — this send is still going. Wait a moment.",
  "template-shape": "Not sent — that Zoho Sign template does not have exactly one signer. Finance fixes it in Zoho Sign.",
});
export const NOT_SAVED = "Not saved yet";

export type SendSource =
  | { readonly kind: "template"; readonly templateId: string }
  | { readonly kind: "pdf"; readonly fileName: string; readonly bytes: Uint8Array; readonly field: SignField };
export interface SendInput {
  readonly paper: Paper;
  readonly recordId: string;
  readonly method: SignMethod;
  readonly source: SendSource;
  /** the record's Modified_Time as the send panel loaded it (guarded write) */
  readonly expectedModifiedTime: string;
}
export interface SendDone {
  readonly paper: Paper;
  readonly recordId: string;
  readonly requestId: string;
  readonly method: SignMethod;
  readonly signedVia: string;
  readonly state: "sent";
  readonly label: string;
  readonly duplicate: boolean;
  readonly note: string | null;
}
export type SendResult =
  | { readonly ok: true; readonly value: SendDone }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: SendRefusal; readonly message: string; readonly requestId?: string }
  | { readonly ok: false; readonly kind: "not-saved"; readonly errorKind: string; readonly message: string; readonly recalled: boolean };

/** The supplementary draft the IR and the investor agreed (Lead.Supp_Agreed_*, written from the lead page row, M12-S12): what
 *  Finance's Send offers as the default document. `ref` is the Zoho Writer / WorkDrive link or `attachment:<id>` the IR gave. */
export interface AgreedDraft { readonly ref: string; readonly version: number | null; readonly at: string | null }
const AGREED_REF = /^(?:attachment:\d{15,22}|https:\/\/(?:writer|workdrive|docs)\.zoho\.(?:in|com)\/[A-Za-z0-9._~\/?#=&%-]{1,400})$/;
const AGREED_FIELDS = [ROUND_FIELDS.supp.agreedRef, ROUND_FIELDS.supp.agreedVersion, ROUND_FIELDS.supp.agreedAt] as const;
export interface Prefill {
  readonly paper: Paper;
  readonly recordId: string;
  readonly recipient: SignRecipient | null;
  readonly nri: boolean;
  readonly methods: readonly SignMethod[];
  readonly methodNote: string | null;
  readonly modifiedTime: string | null;
  /** the request already on the record, if any, and what Zoho Sign says of it */
  readonly current: { readonly requestId: string; readonly state: SignState | "verified"; readonly label: string } | null;
  readonly maySend: boolean;
  readonly note: string | null;
  /** supplementary only: the agreed final draft to send, or null (none agreed, or the lead is not readable by this seat) */
  readonly agreedDraft: AgreedDraft | null;
  /** set by the prefill route when this deployment signs with the sandbox fake (ZOHO_SIGN_MODE=fake): the panel shows "Test signing" */
  readonly testSigning?: boolean;
}
export type PrefillResult = { readonly ok: true; readonly value: Prefill } | { readonly ok: false; readonly kind: "refused" | "source-error"; readonly reasonCode: string; readonly message: string };

export type TemplatesResult = { readonly ok: true; readonly value: readonly SignTemplate[] } | { readonly ok: false; readonly kind: "refused" | "source-error"; readonly reasonCode: string; readonly message: string };

export interface SendDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly sign: Pick<SignApi, "createFromTemplate" | "createFromPdf" | "getRequest" | "recall"> & Partial<Pick<SignApi, "listTemplates">>;
  readonly log: OpsLog;
  readonly clock?: () => number;
  /** Where the double-press guard and the one-send-per-paper lock live (runtime: sharedState()); default this process only. */
  readonly state?: SharedState;
}

const OPAQUE_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const HELD_TTL_MS = 30 * 60_000;
const SEND_LOCK_S = 120;
const idOf = (v: unknown): string | null => (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);
const s = (r: ZohoRecord, k: string, max = 200): string | null => (typeof r[k] === "string" && (r[k] as string).trim() !== "" ? (r[k] as string).trim().slice(0, max) : null);
const isNri = (residency: string | null): boolean => residency !== null && /^(nri|oci)$|non[- ]?resident/i.test(residency);

export function createSignSender(deps: SendDeps) {
  const clock = deps.clock ?? Date.now;
  const state = deps.state ?? createMemoryState({ clock });
  // The double-press guard (../state/idempotent): joined here, replayed from SharedState, else claimed — so the same
  // press on two instances sends once. Only a success is held; the answer is ids and codes (no recipient, no file).
  const presses = createIdempotency<SendResult>({
    state, ns: "sign-send", ttlSeconds: HELD_TTL_MS / 1_000, clock,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r),
    load: (v) => { try { return JSON.parse(v) as SendResult; } catch { return null; } },
  });

  const refuse = (userId: string, code: SendRefusal, ids: readonly string[] = [], requestId?: string): SendResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "sign-send", reason: code, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reasonCode: code, message: SEND_MESSAGE[code], ...(requestId ? { requestId } : {}) };
  };

  type Party = { ok: true; rec: ZohoRecord; recipient: SignRecipient | null; nri: boolean; contact?: ZohoRecord } | { ok: false; code: "not-visible" | "source"; errorKind: string };
  /** The record (slot fields + Modified_Time) and whom it is for, on the sender's token. */
  async function readParty(cred: UserCredential, f: PaperFields, recordId: string, signal?: AbortSignal): Promise<Party> {
    const own = f.module === "Leads" ? ["First_Name", "Last_Name", "Email"] : f.module === "Contacts" ? ["First_Name", "Last_Name", "Email", "Residency"] : ["Customer"];
    let r: Awaited<ReturnType<typeof deps.crm.getRecord>>;
    try { r = await deps.crm.getRecord(cred, f.module, recordId, { fields: ["id", f.req, f.verifiedAt, "Modified_Time", ...own], signal }); } catch { return { ok: false, code: "source", errorKind: "unexpected" }; }
    if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? { ok: false, code: "not-visible", errorKind: r.error.kind } : { ok: false, code: "source", errorKind: r.error.kind };
    if (!r.value || r.value.id !== recordId) return { ok: false, code: "not-visible", errorKind: "not-found" };
    let person: ZohoRecord = r.value;
    if (f.module === "LLP_UnitAllocation_Module") {
      const cid = idOf(r.value.Customer);
      if (!cid) return { ok: true, rec: r.value, recipient: null, nri: false };
      let c: Awaited<ReturnType<typeof deps.crm.getRecord>>;
      try { c = await deps.crm.getRecord(cred, "Contacts", cid, { fields: ["id", "First_Name", "Last_Name", "Email", "Residency", "Origin_Lead"], signal }); } catch { return { ok: false, code: "source", errorKind: "unexpected" }; }
      if (!c.ok) return c.error.kind === "not-found" || c.error.kind === "forbidden" ? { ok: false, code: "not-visible", errorKind: c.error.kind } : { ok: false, code: "source", errorKind: c.error.kind };
      if (!c.value) return { ok: false, code: "not-visible", errorKind: "not-found" };
      person = c.value;
    }
    const name = [s(person, "First_Name", 100), s(person, "Last_Name", 100)].filter(Boolean).join(" ");
    const email = s(person, "Email", 200);
    return { ok: true, rec: r.value, recipient: name && email ? { name, email } : null, nri: isNri(s(person, "Residency", 40)), contact: person };
  }

  /** The agreed supplementary draft of the lead this allotment's Contact came from, on the sender's token. Not readable,
   *  not agreed, or a ref that is not a Writer/WorkDrive link or a lead attachment → null (nothing is offered, nothing guessed). */
  async function agreedDraftOf(cred: UserCredential, contact: ZohoRecord | undefined, signal?: AbortSignal): Promise<AgreedDraft | null> {
    const lead = idOf(contact?.Origin_Lead);
    if (!lead || !RECORD_ID.test(lead)) return null;
    try {
      const r = await deps.crm.getRecord(cred, "Leads", lead, { fields: ["id", ...AGREED_FIELDS], signal });
      if (!r.ok || !r.value || r.value.id !== lead) return null;
      const ref = s(r.value, ROUND_FIELDS.supp.agreedRef, 500), at = s(r.value, ROUND_FIELDS.supp.agreedAt, 40);
      if (!ref || !AGREED_REF.test(ref) || !at || !DATETIME.test(at)) return null;
      const v = r.value[ROUND_FIELDS.supp.agreedVersion];
      const version = typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : typeof v === "string" && /^\d{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : null;
      return Object.freeze({ ref, version, at });
    } catch { return null; }
  }

  /** W3-E2E-4 - the order of the two rounds (lib/selectors/paper prNext: the supplementary "waits for the NDA to come back signed",
   *  and goes out only on the IR's agreed final draft). A contact that did not come through a lead (no Origin_Lead) has no lead-side
   *  round to wait for. "unreadable": the lead could not be read, so the order cannot be proved and nothing is sent. */
  async function orderGate(cred: UserCredential, contact: ZohoRecord | undefined, signal?: AbortSignal): Promise<"ok" | "nda-first" | "no-agreed-draft" | "unreadable"> {
    const lead = idOf(contact?.Origin_Lead);
    if (!lead || !RECORD_ID.test(lead)) return "ok";
    try {
      const r = await deps.crm.getRecord(cred, "Leads", lead, { fields: ["id", "NDA_Verified_At", ...AGREED_FIELDS], signal });
      if (!r.ok || !r.value || r.value.id !== lead) return "unreadable";
      const nda = s(r.value, "NDA_Verified_At", 40);
      if (!nda || !DATETIME.test(nda)) return "nda-first";
      const ref = s(r.value, ROUND_FIELDS.supp.agreedRef, 500), at = s(r.value, ROUND_FIELDS.supp.agreedAt, 40);
      return ref && AGREED_REF.test(ref) && at && DATETIME.test(at) ? "ok" : "no-agreed-draft";
    } catch { return "unreadable"; }
  }

  /** What Zoho Sign says of the request already on the record (sender's token); null = could not read. */
  async function liveState(cred: UserCredential, requestId: string, signal?: AbortSignal): Promise<SignState | null> {
    try {
      const r = await deps.sign.getRequest(cred, requestId, { signal });
      if (r.ok) return signStateOf(r.value);
      return r.error.kind === "not-found" ? "recalled" : null; // gone from Zoho Sign: nothing live
    } catch { return null; }
  }

  async function run(cred: UserCredential, seat: string, i: SendInput, signal?: AbortSignal): Promise<SendResult> {
    const me = cred.userId;
    const f = PAPER_FIELDS[i.paper];
    const party = await readParty(cred, f, i.recordId, signal);
    if (!party.ok) return party.code === "not-visible" ? refuse(me, "not-visible", [i.recordId]) : { ok: false, kind: "not-saved", errorKind: party.errorKind, message: NOT_SAVED, recalled: false };
    if (verifiedOf(party.rec, f)) return refuse(me, "already-on-file", [i.recordId]);
    const existing = reqIdOf(party.rec, f);
    if (existing) {
      const st = await liveState(cred, existing, signal);
      if (st === null) return { ok: false, kind: "not-saved", errorKind: "sign-unreadable", message: NOT_SAVED, recalled: false };
      if (st === "signed") return refuse(me, "already-on-file", [i.recordId], existing);
      if (isLive(st)) return refuse(me, "already-out", [i.recordId], existing);
    }
    if (!party.recipient) return refuse(me, "no-recipient", [i.recordId]);
    if (i.paper === "supplementary") {
      const order = await orderGate(cred, party.contact, signal);
      if (order === "unreadable") return { ok: false, kind: "not-saved", errorKind: "unexpected", message: NOT_SAVED, recalled: false };
      if (order !== "ok") return refuse(me, order, [i.recordId]);
    }
    if (i.method === "aadhaar" && party.nri) return refuse(me, "aadhaar-not-for-nri", [i.recordId]);
    if (i.method === "aadhaar" && i.source.kind === "pdf") return refuse(me, "aadhaar-needs-template", [i.recordId]);

    const requestName = `${f.label} — ${party.recipient.name}`;
    let created: Awaited<ReturnType<SignApi["createFromTemplate"]>>;
    try {
      created = i.source.kind === "template"
        ? await deps.sign.createFromTemplate(cred, { templateId: i.source.templateId, requestName, recipient: party.recipient, method: i.method }, { signal })
        : await deps.sign.createFromPdf(cred, { file: { fileName: i.source.fileName, contentType: "application/pdf", bytes: i.source.bytes }, requestName, recipient: party.recipient, method: i.method, field: i.source.field }, { signal });
    } catch { return { ok: false, kind: "not-saved", errorKind: "unexpected", message: NOT_SAVED, recalled: false }; }
    if (!created.ok) {
      if (created.error.kind === "invalid-data" && created.error.code === "TEMPLATE_SHAPE") return refuse(me, "template-shape", [i.recordId]);
      if (created.error.kind === "invalid-data" && created.error.code === "AADHAAR_NEEDS_TEMPLATE") return refuse(me, "aadhaar-needs-template", [i.recordId]);
      return { ok: false, kind: "not-saved", errorKind: created.error.kind, message: NOT_SAVED, recalled: false };
    }
    const requestId = created.value.requestId;

    let put: Awaited<ReturnType<typeof deps.crm.update>> | null = null;
    try {
      put = await deps.crm.update(cred, f.module, i.recordId, { [f.req]: requestId, [f.via]: SIGNED_VIA[i.method] }, { ifUnmodifiedSince: i.expectedModifiedTime, signal });
    } catch { put = null; }
    if (!put || !put.ok) {
      // Compensating step: the record does not name the request, so the request must not stay live.
      let recalled = false;
      try { const rc = await deps.sign.recall(cred, requestId, {}); recalled = rc.ok; } catch { recalled = false; }
      deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "sign-send", reason: recalled ? "record-write-failed.recalled" : "record-write-failed.orphan-request", recordIds: [i.recordId] });
      if (put && !put.ok && put.error.kind === "conflict") return { ok: false, kind: "refused", reasonCode: "record-changed", message: SEND_MESSAGE["record-changed"] };
      return { ok: false, kind: "not-saved", errorKind: put ? (put.ok ? "unexpected" : put.error.kind) : "unexpected", message: NOT_SAVED, recalled };
    }
    deps.log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "sign-send", reason: `sent.${i.paper}.${i.method}`, recordIds: [i.recordId] });
    return { ok: true, value: Object.freeze({
      paper: i.paper, recordId: i.recordId, requestId, method: i.method, signedVia: SIGNED_VIA[i.method], state: "sent" as const,
      label: STATE_LABEL.sent, duplicate: false, note: primaryDoerNote(seat),
    }) };
  }

  return Object.freeze({
    /** The templates the send panel offers (M12-S04): Finance's, read on the sender's own Sign token (D53). Only a seat that
     *  sends some paper may ask; the list holds ids and names, never a recipient or a file. */
    async templates(principal: { readonly credential: unknown; readonly seat: string }, signal?: AbortSignal): Promise<TemplatesResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred)) return { ok: false, kind: "refused", reasonCode: "invalid-request", message: SEND_MESSAGE["invalid-request"] };
      const seat = String(principal.seat ?? "");
      if (!PAPER_KEYS.some((p) => mayActOnPaper(seat, p))) {
        refuse(cred.userId, "seat-denied");
        return { ok: false, kind: "refused", reasonCode: "seat-denied", message: SEND_BELONGS_TO };
      }
      if (!deps.sign.listTemplates) return { ok: false, kind: "source-error", reasonCode: "not-configured", message: SIGN_NOT_CONFIGURED };
      let r: Awaited<ReturnType<SignApi["listTemplates"]>>;
      try { r = await deps.sign.listTemplates(cred, { signal }); } catch { return { ok: false, kind: "source-error", reasonCode: "unexpected", message: "Zoho Sign is not answering. Try again." }; }
      if (!r.ok) return { ok: false, kind: "source-error", ...signFailure(r.error.kind, "Zoho Sign is not answering. Try again.") };
      return { ok: true, value: r.value };
    },

    /** The send panel's facts (AC2): recipient from the record, NRI, the methods on offer, what is already out. */
    async prefill(principal: { readonly credential: unknown; readonly seat: string }, paper: unknown, recordId: unknown, signal?: AbortSignal): Promise<PrefillResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !isPaper(paper) || typeof recordId !== "string" || !RECORD_ID.test(recordId)) return { ok: false, kind: "refused", reasonCode: "invalid-request", message: SEND_MESSAGE["invalid-request"] };
      const seat = String(principal.seat ?? "");
      if (!mayActOnPaper(seat, paper)) {
        refuse(cred.userId, "seat-denied", [recordId]);
        return { ok: false, kind: "refused", reasonCode: "seat-denied", message: SEND_BELONGS_TO };
      }
      const f = PAPER_FIELDS[paper];
      const party = await readParty(cred, f, recordId, signal);
      if (!party.ok) return party.code === "not-visible"
        ? { ok: false, kind: "refused", reasonCode: "not-visible", message: SEND_MESSAGE["not-visible"] }
        : { ok: false, kind: "source-error", reasonCode: party.errorKind, message: "Zoho is not answering. Try again." };
      const existing = reqIdOf(party.rec, f);
      let current: Prefill["current"] = null;
      if (verifiedOf(party.rec, f)) current = { requestId: existing ?? "", state: "verified", label: "Signed and verified" };
      else if (existing) {
        const st = (await liveState(cred, existing, signal)) ?? "unknown";
        current = { requestId: existing, state: st, label: STATE_LABEL[st] };
      }
      const blocked = current !== null && (current.state === "verified" || current.state === "signed" || isLive(current.state as SignState));
      const order = paper === "supplementary" && !blocked ? await orderGate(cred, party.contact, signal) : "ok";
      const held = order === "ok" ? null : order === "unreadable" ? "The lead's paperwork could not be read, so the order of the rounds cannot be checked. Try again." : SEND_MESSAGE[order];
      return { ok: true, value: Object.freeze({
        paper, recordId, recipient: party.recipient, nri: party.nri,
        methods: Object.freeze(party.nri ? ["email-otp"] as SignMethod[] : ["aadhaar", "email-otp"] as SignMethod[]),
        methodNote: party.nri ? SEND_MESSAGE["aadhaar-not-for-nri"] : null,
        modifiedTime: typeof party.rec.Modified_Time === "string" ? party.rec.Modified_Time : null,
        current, maySend: !blocked && party.recipient !== null && order === "ok", note: held ?? primaryDoerNote(seat),
        agreedDraft: paper === "supplementary" && !blocked ? await agreedDraftOf(cred, party.contact, signal) : null,
      }) };
    },

    /** Send one paper, exactly once per Idempotency-Key. Zeroes an uploaded PDF's bytes before returning. */
    async commit(principal: { readonly credential: unknown; readonly seat: string }, input: SendInput, idempotencyKey: unknown, signal?: AbortSignal): Promise<SendResult> {
      try {
        const cred = principal?.credential;
        if (!isUserCredential(cred)) return refuse("unrecognised", "invalid-request");
        const me = cred.userId, seat = String(principal.seat ?? "");
        const i = input;
        if (!i || !isPaper(i.paper) || typeof i.recordId !== "string" || !RECORD_ID.test(i.recordId) || (i.method !== "aadhaar" && i.method !== "email-otp")
          || typeof i.expectedModifiedTime !== "string" || !DATETIME.test(i.expectedModifiedTime) || !i.source
          || (i.source.kind === "template" ? typeof i.source.templateId !== "string" || !/^\d{10,25}$/.test(i.source.templateId)
            : i.source.kind === "pdf" ? !(i.source.bytes instanceof Uint8Array) || typeof i.source.fileName !== "string" || !i.source.field : true)) {
          return refuse(me, "invalid-request", i && typeof i.recordId === "string" ? [i.recordId] : []);
        }
        if (!mayActOnPaper(seat, i.paper)) return refuse(me, "seat-denied", [i.recordId]);
        if (typeof idempotencyKey !== "string" || !OPAQUE_KEY.test(idempotencyKey)) return refuse(me, "idempotency-key-invalid", [i.recordId]);

        const slot = `${me}\u0000${idempotencyKey}`;
        const fingerprint = `${i.paper}|${i.recordId}|${i.method}|${i.source.kind}|${i.source.kind === "template" ? i.source.templateId : i.source.bytes.byteLength}`;
        // One send per paper and record at a time, on any instance (a second key for the same paper waits out).
        const lock = `sign-send-paper|${i.paper}|${i.recordId}`;
        const o = await presses.once(slot, fingerprint, async () => {
          if (!(await state.claim(lock, SEND_LOCK_S))) return refuse(me, "busy", [i.recordId]);
          try { return await run(cred, seat, i, signal); } finally { await state.release(lock).catch(() => { /* the TTL frees it */ }); }
        });
        if (o.kind === "reused") return refuse(me, "idempotency-key-reused", [i.recordId]);
        if (o.kind === "busy" || o.kind === "unavailable") return refuse(me, "busy", [i.recordId]);
        const r = o.result;
        if (o.kind === "ran") return r;
        return r.ok ? { ok: true, value: Object.freeze({ ...r.value, duplicate: true }) } : r;
      } finally {
        if (input?.source?.kind === "pdf") { try { input.source.bytes.fill(0); } catch { /* nothing kept either way */ } }
      }
    },
  });
}
export type SignSender = ReturnType<typeof createSignSender>;
