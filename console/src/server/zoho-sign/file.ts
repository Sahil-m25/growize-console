/**
 * M12-S06-T02 — FILE THE SIGNED COPY AS ONE ACT (D19, D22, D45, D52, D70, D72).
 *
 * On a completed Zoho Sign request (the webhook re-read it, or the periodic check did), under the
 * provider-callback service token (D53 allows it for this background act; no screen reads with it):
 *   1. Re-read the record: it must still name this request id (else nothing is written — a stale request),
 *      and an already-verified slot is "already filed" (a repeated event is a no-op).
 *   2. Download the signed PDF and the completion certificate from Zoho Sign (bytes held in memory only).
 *   3. The certificate goes to the record's Attachments; the signed PDF is uploaded to ZFS.
 *   4. ONE guarded write (If-Unmodified-Since) puts the PDF in the paper's typed slot AND sets *_Verified_At.
 *      For the supplementary that stamp is the console's Agreement_Signed, so the lead's alloc gate opens on
 *      its next read (gates.ts computes it) — the gate and its evidence land together or not at all.
 *   5. Compensating step: if step 4 (or the ZFS upload) fails, the certificate attachment from step 3 is
 *      deleted, so nothing is left that looks filed; the answer is "Not saved yet" and the event is retried
 *      (webhook redelivery / the periodic check). A ZFS file never written to a field is dropped by Zoho.
 * The bytes are zeroed when Zoho has answered. Plane B carries ids and codes only.
 *
 * verifyByHand (S06 AC4) is the paper signed outside Zoho Sign: Finance uploads it to the slot
 * (/api/documents/upload) and presses "The signed copy is here" — one guarded write of *_Verified_At,
 * *_Verified_By (the person) and *_Signed_Via, on the person's own token, plus a Note with the reference.
 */

import type { ServiceCredential, UserCredential, ZohoClient, ZohoRecord, ZohoServiceClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { SignApi } from "./api";
import {
  addNote, cleanReason, DATETIME, HAND_METHODS, isPaper, istStamp, mayActOnPaper, PAPER_FIELDS, primaryDoerNote, RECORD_ID, reqIdOf, verifiedOf, type Paper,
} from "./papers";

export interface FileTarget { readonly module: string; readonly id: string; readonly paper: Paper }
export type FileResult =
  | { readonly ok: true; readonly outcome: "filed" | "already-filed"; readonly attachmentId: string | null }
  | { readonly ok: false; readonly kind: "stale" | "not-visible" | "not-saved"; readonly step: string; readonly errorKind: string; readonly compensated: boolean; readonly retryable: boolean };

export interface FilerDeps {
  readonly crm: Pick<ZohoServiceClient, "getRecord" | "update" | "uploadAttachment" | "uploadFile" | "deleteAttachment">;
  readonly sign: Pick<SignApi, "download">;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

const ACTOR = { kind: "service", job: "provider-callback" } as const;

export function createSignedFiler(deps: FilerDeps) {
  const clock = deps.clock ?? Date.now;
  const line = (reason: string, ids: readonly string[]) => deps.log.refusal({ at: clock(), actor: ACTOR, action: "sign-file", reason, recordIds: ids.filter((x) => RECORD_ID.test(x)) });

  return Object.freeze({
    async file(cred: ServiceCredential, target: FileTarget, requestId: string, signal?: AbortSignal): Promise<FileResult> {
      const f = PAPER_FIELDS[target.paper];
      const ids = [target.id];
      const fail = (kind: "stale" | "not-visible" | "not-saved", step: string, errorKind: string, compensated = false, retryable = kind === "not-saved"): FileResult => {
        line(`${step}.${errorKind}${compensated ? ".compensated" : ""}`, ids);
        return { ok: false, kind, step, errorKind, compensated, retryable };
      };
      if (!f || f.module !== target.module || !RECORD_ID.test(target.id)) return fail("not-visible", "target", "invalid");

      let rec: ZohoRecord | null;
      try {
        const r = await deps.crm.getRecord(cred, f.module, target.id, { fields: ["id", f.req, f.verifiedAt, "Modified_Time"], signal });
        if (!r.ok) return fail(r.error.kind === "not-found" || r.error.kind === "forbidden" ? "not-visible" : "not-saved", "read", r.error.kind);
        rec = r.value;
      } catch { return fail("not-saved", "read", "unexpected"); }
      if (!rec || rec.id !== target.id) return fail("not-visible", "read", "not-found");
      if (reqIdOf(rec, f) !== requestId) return fail("stale", "read", "request-id-changed", false, false);
      if (verifiedOf(rec, f)) {
        deps.log.event?.({ at: clock(), actor: ACTOR, action: "sign-file", reason: "already-filed", recordIds: ids });
        return { ok: true, outcome: "already-filed", attachmentId: null };
      }
      const modified = typeof rec.Modified_Time === "string" && DATETIME.test(rec.Modified_Time) ? rec.Modified_Time : null;
      if (!modified) return fail("not-saved", "read", "no-modified-time");

      const pdf = await deps.sign.download(cred, requestId, "pdf", { signal });
      if (!pdf.ok) return fail("not-saved", "download-pdf", pdf.error.kind);
      const cert = await deps.sign.download(cred, requestId, "certificate", { signal });
      if (!cert.ok) { pdf.value.bytes.fill(0); return fail("not-saved", "download-certificate", cert.error.kind); }

      try {
        let att: Awaited<ReturnType<typeof deps.crm.uploadAttachment>>;
        try { att = await deps.crm.uploadAttachment(cred, f.module, target.id, { fileName: `${f.label} completion certificate.pdf`, contentType: "application/pdf", bytes: cert.value.bytes }, { signal }); }
        catch { return fail("not-saved", "attach-certificate", "unexpected"); }
        if (!att.ok) return fail("not-saved", "attach-certificate", att.error.kind);
        const attachmentId = att.value.attachmentId;
        const compensate = async (step: string, errorKind: string): Promise<FileResult> => {
          let undone = false;
          try { const d = await deps.crm.deleteAttachment(cred, f.module, target.id, attachmentId, {}); undone = d.ok; } catch { undone = false; }
          if (!undone) line("compensation-failed", [target.id, attachmentId]);
          return fail("not-saved", step, errorKind, undone);
        };

        let zfs: Awaited<ReturnType<typeof deps.crm.uploadFile>>;
        try { zfs = await deps.crm.uploadFile(cred, { fileName: `${f.label} signed.pdf`, contentType: "application/pdf", bytes: pdf.value.bytes }, { signal }); }
        catch { return compensate("upload-pdf", "unexpected"); }
        if (!zfs.ok) return compensate("upload-pdf", zfs.error.kind);

        let put: Awaited<ReturnType<typeof deps.crm.update>>;
        try {
          put = await deps.crm.update(cred, f.module, target.id, { [f.slot]: [{ file_id: zfs.value.fileId }], [f.verifiedAt]: istStamp(clock()) }, { ifUnmodifiedSince: modified, signal });
        } catch { return compensate("set-signed", "unexpected"); }
        if (!put.ok) return compensate("set-signed", put.error.kind);
        deps.log.event?.({ at: clock(), actor: ACTOR, action: "sign-file", reason: `filed.${target.paper}`, recordIds: [target.id, attachmentId] });
        return { ok: true, outcome: "filed", attachmentId };
      } finally {
        pdf.value.bytes.fill(0);
        cert.value.bytes.fill(0);
      }
    },
  });
}
export type SignedFiler = ReturnType<typeof createSignedFiler>;

/* ---- M12-S06 AC4: verified by hand ------------------------------------------------------------------ */

export type VerifyRefusal = "invalid-request" | "seat-denied" | "not-visible" | "already-verified" | "no-signed-copy" | "record-changed" | "unknown-method";
export const VERIFY_MESSAGE: Readonly<Record<VerifyRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved — the verification is incomplete.",
  "seat-denied": "Verifying belongs to Finance Operations, Compliance and the Head of Finance.",
  "not-visible": "You cannot open this record in Zoho.",
  "already-verified": "This paper is already signed and verified.",
  "no-signed-copy": "File the signed copy in the paper's slot first, then press 'The signed copy is here'.",
  "record-changed": "Not saved yet — the record changed in Zoho. Reload and verify again.",
  "unknown-method": "Pick how it was signed: Class 3 DSC, wet signature or uploaded.",
});
export type VerifyResult =
  | { readonly ok: true; readonly value: { readonly paper: Paper; readonly recordId: string; readonly verifiedAt: string; readonly noteSaved: boolean | null; readonly note: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: VerifyRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "not-saved"; readonly errorKind: string; readonly message: string };

export function createHandVerifier(deps: { readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert">; readonly log: OpsLog; readonly clock?: () => number }) {
  const clock = deps.clock ?? Date.now;
  const refuse = (userId: string, code: VerifyRefusal, ids: readonly string[] = []): VerifyResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "sign-verify", reason: code, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reasonCode: code, message: VERIFY_MESSAGE[code] };
  };
  return Object.freeze({
    async verify(principal: { readonly credential: unknown; readonly seat: string },
      i: { readonly paper: unknown; readonly recordId: unknown; readonly method: unknown; readonly reference?: unknown; readonly expectedModifiedTime: unknown }, signal?: AbortSignal): Promise<VerifyResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred)) return refuse("unrecognised", "invalid-request");
      const me = cred.userId, seat = String(principal.seat ?? "");
      if (!isPaper(i?.paper) || typeof i.recordId !== "string" || !RECORD_ID.test(i.recordId) || typeof i.expectedModifiedTime !== "string" || !DATETIME.test(i.expectedModifiedTime)) return refuse(me, "invalid-request");
      if (!mayActOnPaper(seat, i.paper)) return refuse(me, "seat-denied", [i.recordId]);
      if (typeof i.method !== "string" || !HAND_METHODS.includes(i.method)) return refuse(me, "unknown-method", [i.recordId]);
      const reference = i.reference === undefined || i.reference === null || i.reference === "" ? null : cleanReason(i.reference);
      if (i.reference && !reference) return refuse(me, "invalid-request", [i.recordId]);
      const f = PAPER_FIELDS[i.paper];
      const cr = cred as UserCredential;
      let rec: ZohoRecord | null;
      try {
        const r = await deps.crm.getRecord(cr, f.module, i.recordId, { fields: ["id", f.slot, f.verifiedAt], signal });
        if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? refuse(me, "not-visible", [i.recordId]) : { ok: false, kind: "not-saved", errorKind: r.error.kind, message: "Not saved yet" };
        rec = r.value;
      } catch { return { ok: false, kind: "not-saved", errorKind: "unexpected", message: "Not saved yet" }; }
      if (!rec || rec.id !== i.recordId) return refuse(me, "not-visible", [i.recordId]);
      if (verifiedOf(rec, f)) return refuse(me, "already-verified", [i.recordId]);
      if (!Array.isArray(rec[f.slot]) || (rec[f.slot] as unknown[]).length === 0) return refuse(me, "no-signed-copy", [i.recordId]);
      const at = istStamp(clock());
      let put: Awaited<ReturnType<typeof deps.crm.update>>;
      try { put = await deps.crm.update(cr, f.module, i.recordId, { [f.verifiedAt]: at, [f.verifiedBy]: { id: me }, [f.via]: i.method }, { ifUnmodifiedSince: i.expectedModifiedTime, signal }); }
      catch { return { ok: false, kind: "not-saved", errorKind: "unexpected", message: "Not saved yet" }; }
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "record-changed", [i.recordId]) : { ok: false, kind: "not-saved", errorKind: put.error.kind, message: "Not saved yet" };
      let noteSaved: boolean | null = null;
      if (reference) {
        const n = await addNote(deps.crm, cr, f.module, i.recordId, `Signed copy verified — ${f.label}`, `Reference: ${reference}`, signal);
        noteSaved = n.ok;
        if (!n.ok) deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "sign-verify", reason: `note-not-saved.${n.errorKind}`, recordIds: [i.recordId] });
      }
      deps.log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "sign-verify", reason: `verified.${i.paper}`, recordIds: [i.recordId] });
      return { ok: true, value: Object.freeze({ paper: i.paper, recordId: i.recordId, verifiedAt: at, noteSaved, note: primaryDoerNote(seat) }) };
    },
  });
}
