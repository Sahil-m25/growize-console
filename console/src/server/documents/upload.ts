/**
 * M12-S02-T02 — UPLOAD A PAPER FROM THE CONSOLE STRAIGHT TO ZOHO (D45, D48, D53, D70, D71).
 *
 * One guarded write unit, `commit()`, on the uploader's own token (Zoho records them as the uploader):
 *   · to a record's Attachments (POST /{module}/{id}/Attachments), or
 *   · to a typed slot — a file-upload field such as the lead's NDA ("Signed NDA") or the allotment's
 *     Supplementary_Agreement: POST /files (ZFS) then a guarded PUT of the field (If-Unmodified-Since).
 *
 * Before anything reaches Zoho: the seat may file to that scope and slot, the file is 1 byte–20 MB, its type is
 * PDF/JPEG/PNG by declared type, by name AND by its first bytes (magic numbers) — all three must agree.
 * No temp file: the bytes live in memory for the one call and are zeroed when Zoho has answered (AC5).
 *
 * Double press (AC7): one Idempotency-Key per chosen file. A second press with the same key while the first runs
 * waits for it; after a confirmed answer it returns that answer (`duplicate: true`); after an unknown outcome
 * (the POST may have landed) it first re-reads the record and counts files of that name and size against the
 * count taken before the first attempt — landed → done, not landed → sent again. So two presses never make two
 * attachments. A failure part-way answers "Not saved yet".
 *
 * Plane B: the Zoho client writes one line per attempt with ids only (actor, endpoint template, status, record
 * id); refusals here add a line with the reason code and record id. Never a file name, a byte or a size.
 */

import { createHash } from "node:crypto";
import type { UserCredential, ZohoClient, UploadMime } from "../../lib/zoho/client";
import { isUserCredential, MAX_UPLOAD_BYTES, uploadFileName } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { scopesFor } from "../data/scope";
import { listAttachments, maskFileName, SCOPE_MODULE, type DocScope } from "./attachments";

export { MAX_UPLOAD_BYTES };
export type UploadScope = DocScope | "lead";
export const UPLOAD_MODULE: Readonly<Record<UploadScope, string>> = Object.freeze({ ...SCOPE_MODULE, lead: "Leads" });

/** The typed slots (M12-S02-T01 fields, confirmed read-only in the org 2026-09-28) → file-upload field. OD8 may add more. */
export const SLOTS: Readonly<Record<UploadScope, Readonly<Record<string, { readonly field: string; readonly label: string }>>>> = Object.freeze({
  lead: Object.freeze({ "signed-nda": { field: "NDA", label: "Signed NDA" } }),
  personal: Object.freeze({
    "pan-proof": { field: "PAN_Proof", label: "PAN proof" },
    "bank-proof": { field: "Bank_Proof", label: "Bank proof" },
    "fema-declaration": { field: "FEMA_Declaration", label: "FEMA declaration" },
  }),
  allotment: Object.freeze({
    "supplementary-agreement": { field: "Supplementary_Agreement", label: "Supplementary agreement" },
    "allocation-letter": { field: "Allocation_Letter", label: "Allocation letter" },
    "unit-certificate": { field: "Unit_Certificate", label: "Unit certificate" },
  }),
  project: Object.freeze({
    "llp-deed": { field: "LLP_Deed", label: "LLP deed" },
    "insurance-policy": { field: "Insurance_Policy_Document", label: "Insurance policy" },
  }),
});

/**
 * Who may file where — PROVISIONAL until OD8 (who-sees-what per seat and scope) is decided: Finance and Head of
 * Finance everywhere on the Investors side, Compliance for personal (KYC) papers, Digital Infrastructure (ops/di)
 * everywhere; the lead side's own seats (IR, channel partner, IR Manager) on leads in their own book only.
 * Viewers, audit, KAM and Head of AM file nothing. Zoho's own permissions on the uploader's token are the second wall.
 */
const UPLOAD_SEATS: Readonly<Record<UploadScope, ReadonlySet<string>>> = Object.freeze({
  personal: new Set(["fin", "head", "comp", "di", "ops"]),
  allotment: new Set(["fin", "head", "di", "ops"]),
  project: new Set(["fin", "head", "di", "ops"]),
  lead: new Set(["ir", "cp", "conv", "ops"]),
});

export function mayUpload(seat: string, scope: UploadScope): boolean {
  return Object.hasOwn(UPLOAD_SEATS, scope) && UPLOAD_SEATS[scope].has(seat);
}

/** The type the bytes really are, from their first bytes; null when not PDF/JPEG/PNG. */
export function sniffMime(b: Uint8Array): UploadMime | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}
const EXT: Readonly<Record<string, UploadMime>> = Object.freeze({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" });
const DECLARED: Readonly<Record<string, UploadMime>> = Object.freeze({ "application/pdf": "application/pdf", "image/png": "image/png", "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg" });
/** M18-S15-H4: the Content-Type allow-list (the route refuses anything else 415 before reading a byte). */
export const isAllowedUploadType = (contentType: string | null): boolean =>
  contentType !== null && Object.hasOwn(DECLARED, contentType.split(";")[0]!.trim().toLowerCase());

export type UploadRefusal =
  | "invalid-request" | "idempotency-key-invalid" | "idempotency-key-reused" | "seat-denied" | "unknown-slot"
  | "too-large" | "empty" | "type-not-allowed" | "type-mismatch" | "not-in-book" | "not-visible" | "record-changed" | "busy";

export const UPLOAD_MESSAGE: Readonly<Record<UploadRefusal, string>> = Object.freeze({
  "invalid-request": "Not sent — the upload is incomplete.",
  "idempotency-key-invalid": "Not sent — reload and choose the file again.",
  "idempotency-key-reused": "Not sent — that press belongs to another file. Choose the file again.",
  "seat-denied": "Your seat cannot file papers here.",
  "unknown-slot": "Not sent — that paper slot does not exist here.",
  "too-large": "Not sent — the file is over the 20 MB limit.",
  "empty": "Not sent — the file is empty.",
  "type-not-allowed": "Not sent — only PDF, JPG or PNG files can be filed.",
  "type-mismatch": "Not sent — the file is not the type its name says (only PDF, JPG or PNG).",
  "not-in-book": "This lead is not in your book.",
  "not-visible": "You cannot open this record in Zoho.",
  "record-changed": "Not saved yet — the record changed in Zoho. Reload and file it again.",
  "busy": "Not saved yet — this upload is still going. Wait a moment.",
});
export const NOT_SAVED = "Not saved yet";

export interface UploadInput {
  readonly scope: UploadScope;
  readonly recordId: string;
  /** a SLOTS key, or null for the record's Attachments */
  readonly slot: string | null;
  readonly fileName: string;
  /** the Content-Type the browser declared */
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** the record's Modified_Time as the page loaded it — required for a typed slot (guarded write) */
  readonly expectedModifiedTime?: string | null;
}
export interface UploadDone {
  readonly scope: UploadScope;
  readonly recordId: string;
  readonly slot: string | null;
  readonly attachmentId: string | null;
  readonly fileName: string;
  readonly size: number;
  readonly duplicate: boolean;
  readonly recovered: boolean;
}
export type UploadResult =
  | { readonly ok: true; readonly value: UploadDone }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: UploadRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "not-saved"; readonly errorKind: string; readonly message: string; readonly retryable: true; readonly unknownOutcome: boolean };

export interface UploadDeps {
  readonly crm: Pick<ZohoClient, "uploadAttachment" | "uploadFile" | "update" | "getRecord" | "getRelated">;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

const RECORD_ID = /^\d{15,22}$/;
const OPAQUE_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export const HELD_TTL_MS = 30 * 60_000;
const MAX_HELD = 2_000;
const UNKNOWN = new Set(["network", "server", "aborted", "unexpected"]);

type Held = { readonly at: number; readonly fingerprint: string; before: number | null; result: Promise<UploadResult> };
const idOf = (v: unknown): string | null => (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

export function createUploader(deps: UploadDeps) {
  const clock = deps.clock ?? Date.now;
  const held = new Map<string, Held>();
  const inFlight = new Set<string>();

  const refuse = (userId: string, code: UploadRefusal, ids: readonly string[] = []): UploadResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "document-upload", reason: code, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reasonCode: code, message: UPLOAD_MESSAGE[code] };
  };
  const notSaved = (errorKind: string, unknownOutcome: boolean): UploadResult =>
    ({ ok: false, kind: "not-saved", errorKind, message: NOT_SAVED, retryable: true, unknownOutcome });

  /** How many files of this (masked) name and size the record holds now — the before/after count for recovery. */
  async function countMatching(cred: UserCredential, i: UploadInput, name: string, signal?: AbortSignal): Promise<number | null> {
    const module = UPLOAD_MODULE[i.scope];
    if (i.slot === null) {
      if (i.scope === "lead") {
        let r: Awaited<ReturnType<typeof deps.crm.getRelated>>;
        try { r = await deps.crm.getRelated(cred, module, i.recordId, "Attachments", { fields: ["id", "File_Name", "Size"], perPage: 200, signal }); } catch { return null; }
        if (!r.ok) return r.error.kind === "not-found" ? 0 : null;
        return r.value.records.filter((x) => x.File_Name === name && Number(x.Size) === i.bytes.byteLength).length;
      }
      const l = await listAttachments(deps.crm, cred, i.scope, i.recordId, signal);
      if (!l.ok) return null;
      return l.files.filter((f) => f.name === maskFileName(name) && f.size === i.bytes.byteLength).length;
    }
    const field = SLOTS[i.scope][i.slot]!.field;
    let r: Awaited<ReturnType<typeof deps.crm.getRecord>>;
    try { r = await deps.crm.getRecord(cred, module, i.recordId, { fields: [field], signal }); } catch { return null; }
    if (!r.ok || !r.value) return null;
    const v = r.value[field];
    return (Array.isArray(v) ? v : []).filter((f) => f && typeof f === "object"
      && (f as Record<string, unknown>).File_Name__s === name && Number((f as Record<string, unknown>).File_Size__s) === i.bytes.byteLength).length;
  }

  async function admitLead(cred: UserCredential, seat: string, leadId: string, signal?: AbortSignal): Promise<UploadRefusal | "unknown" | null> {
    const kind = scopesFor(seat, cred.userId).leads.kind;
    if (kind === "all") return null;
    if (kind !== "user" && kind !== "subtree") return "seat-denied";
    let r: Awaited<ReturnType<typeof deps.crm.getRecord>>;
    try { r = await deps.crm.getRecord(cred, "Leads", leadId, { fields: ["Owner", "Cover_By", "Cover_Until"], signal }); } catch { return "unknown"; }
    if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? "not-visible" : "unknown";
    if (!r.value || r.value.id !== leadId) return "not-visible";
    const today = new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const mine = idOf(r.value.Owner) === cred.userId
      || (idOf(r.value.Cover_By) === cred.userId && typeof r.value.Cover_Until === "string" && r.value.Cover_Until >= today);
    // PROVISIONAL (as server/leads/email-runtime): with no subtree reader yet an IR Manager files only on leads they own or cover.
    return mine ? null : "not-in-book";
  }

  async function run(cred: UserCredential, i: UploadInput, name: string, mime: UploadMime, h: Held, signal?: AbortSignal): Promise<UploadResult> {
    const module = UPLOAD_MODULE[i.scope];
    const file = { fileName: name, contentType: mime, bytes: i.bytes };
    const ok = (attachmentId: string | null, recovered: boolean): UploadResult => ({ ok: true, value: Object.freeze({
      scope: i.scope, recordId: i.recordId, slot: i.slot, attachmentId, fileName: name, size: i.bytes.byteLength, duplicate: false, recovered,
    }) });
    if (i.slot === null) {
      let up: Awaited<ReturnType<typeof deps.crm.uploadAttachment>>;
      try { up = await deps.crm.uploadAttachment(cred, module, i.recordId, file, { signal }); } catch { return notSaved("unexpected", true); }
      if (up.ok) return ok(up.value.attachmentId, false);
      if (up.error.kind === "forbidden" || up.error.kind === "not-found") return refuse(cred.userId, "not-visible", [i.recordId]);
      return notSaved(up.error.kind, UNKNOWN.has(up.error.kind));
    }
    const field = SLOTS[i.scope][i.slot]!.field;
    let f: Awaited<ReturnType<typeof deps.crm.uploadFile>>;
    try { f = await deps.crm.uploadFile(cred, file, { signal }); } catch { return notSaved("unexpected", false); }
    // A ZFS file alone attaches nothing; Zoho drops unused uploads. Not saved, and safe to press again.
    if (!f.ok) return notSaved(f.error.kind, false);
    let put: Awaited<ReturnType<typeof deps.crm.update>>;
    try {
      put = await deps.crm.update(cred, module, i.recordId, { [field]: [{ file_id: f.value.fileId }] }, { ifUnmodifiedSince: i.expectedModifiedTime!, signal });
    } catch { return notSaved("unexpected", true); }
    if (put.ok) return ok(null, false);
    if (put.error.kind === "conflict") return refuse(cred.userId, "record-changed", [i.recordId]);
    if (put.error.kind === "forbidden" || put.error.kind === "not-found") return refuse(cred.userId, "not-visible", [i.recordId]);
    return notSaved(put.error.kind, UNKNOWN.has(put.error.kind));
  }

  return Object.freeze({
    /** File one upload, exactly once per Idempotency-Key. Always zeroes `input.bytes` before returning. */
    async commit(principal: { readonly credential: unknown; readonly seat: string }, input: UploadInput, idempotencyKey: unknown, signal?: AbortSignal): Promise<UploadResult> {
      try {
        const cred = principal?.credential;
        if (!isUserCredential(cred)) return refuse("unrecognised", "invalid-request");
        const me = cred.userId, seat = String(principal.seat ?? "");
        if (typeof idempotencyKey !== "string" || !OPAQUE_KEY.test(idempotencyKey)) return refuse(me, "idempotency-key-invalid");
        const i = input;
        if (!i || !Object.hasOwn(UPLOAD_MODULE, i.scope) || typeof i.recordId !== "string" || !RECORD_ID.test(i.recordId)
          || !(i.bytes instanceof Uint8Array) || typeof i.fileName !== "string" || typeof i.contentType !== "string") return refuse(me, "invalid-request");
        if (!mayUpload(seat, i.scope)) return refuse(me, "seat-denied", [i.recordId]);
        if (i.slot !== null && (typeof i.slot !== "string" || !Object.hasOwn(SLOTS[i.scope], i.slot))) return refuse(me, "unknown-slot", [i.recordId]);
        if (i.slot !== null && (typeof i.expectedModifiedTime !== "string" || !DATETIME.test(i.expectedModifiedTime))) return refuse(me, "invalid-request", [i.recordId]);
        if (i.bytes.byteLength > MAX_UPLOAD_BYTES) return refuse(me, "too-large", [i.recordId]);
        if (i.bytes.byteLength === 0) return refuse(me, "empty", [i.recordId]);
        const declared = DECLARED[i.contentType.split(";")[0]!.trim().toLowerCase()];
        const ext = EXT[(i.fileName.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? "").toLowerCase()];
        const sniffed = sniffMime(i.bytes);
        if (!declared || !ext) return refuse(me, "type-not-allowed", [i.recordId]);
        if (!sniffed || sniffed !== declared || sniffed !== ext) return refuse(me, sniffed ? "type-mismatch" : "type-not-allowed", [i.recordId]);
        const name = uploadFileName(i.fileName, sniffed);

        const now = clock();
        for (const [k, v] of held) if (now - v.at > HELD_TTL_MS) held.delete(k);
        const slotKey = `${me}\u0000${idempotencyKey}`;
        const fingerprint = createHash("sha256").update(`${i.scope}|${i.recordId}|${i.slot ?? ""}|${name}|`).update(i.bytes).digest("hex");
        const first = held.get(slotKey);
        if (first && first.fingerprint !== fingerprint) return refuse(me, "idempotency-key-reused", [i.recordId]);
        const target = `${i.scope}|${i.recordId}|${i.slot ?? ""}`;

        if (first) {
          const r = await first.result;
          if (r.ok) return { ok: true, value: Object.freeze({ ...r.value, duplicate: true }) };
          if (r.kind === "refused") return r;
          // An unknown outcome: did the first press land? Count again before sending anything.
          if (!r.unknownOutcome) held.delete(slotKey);
          else {
            if (first.before === null) return notSaved("unknown-outcome", true);
            if (inFlight.has(target)) return refuse(me, "busy", [i.recordId]);
            const nowCount = await countMatching(cred, i, name, signal);
            if (nowCount === null) return notSaved("unknown-outcome", true);
            if (nowCount > first.before) {
              const value = Object.freeze({ scope: i.scope, recordId: i.recordId, slot: i.slot, attachmentId: null, fileName: name, size: i.bytes.byteLength, duplicate: true, recovered: true });
              first.result = Promise.resolve({ ok: true, value } as UploadResult);
              return { ok: true, value };
            }
            held.delete(slotKey);
          }
        }
        if (held.size >= MAX_HELD) return refuse(me, "busy");
        if (inFlight.has(target)) return refuse(me, "busy", [i.recordId]);
        inFlight.add(target);
        const h: Held = { at: now, fingerprint, before: null, result: Promise.resolve(notSaved("pending", false)) };
        h.result = (async (): Promise<UploadResult> => {
          if (i.scope === "lead") {
            const a = await admitLead(cred, seat, i.recordId, signal);
            if (a === "unknown") return notSaved("unexpected", false);
            if (a) return refuse(me, a, [i.recordId]);
          }
          h.before = await countMatching(cred, i, name, signal);
          return run(cred, i, name, sniffed, h, signal);
        })().finally(() => inFlight.delete(target));
        held.set(slotKey, h);
        const r = await h.result;
        // A refusal or a clean not-saved may be pressed again with the same key; only success and unknown outcomes are held.
        if (!r.ok && (r.kind === "refused" || !r.unknownOutcome) && held.get(slotKey) === h) held.delete(slotKey);
        return r;
      } finally {
        try { input?.bytes?.fill(0); } catch { /* frozen or detached — nothing kept either way */ }
      }
    },
  });
}
export type Uploader = ReturnType<typeof createUploader>;
