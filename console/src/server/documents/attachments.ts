/**
 * M12-S01-T03 — ONE ATTACHMENT LISTER for the three D70 scopes (Contact · allotment · LLP).
 *
 * GET /crm/v8/{module}/{id}/Attachments on the caller's own token (D53) with an explicit field list:
 * metadata only (id, name, size, time, and the uploader's display name — a staff name, never an identity field).
 * A paper filed to a typed slot (M12-S02: PAN proof, FEMA declaration, supplementary agreement…) is a file-upload field
 * of the record, not an Attachment: the record's slot fields are read once and each file there is a line carrying its
 * `slot` label (M12-S01-W2; the file-upload value's key names are the org's `…__s` ones the uploader already reads). A file body is never downloaded, so nothing of a paper can reach a
 * log, the cache or a response (D45). A file name that carries an identity number (PAN, Aadhaar, an account
 * number) is masked here, for every seat — the wall on PAN/Aadhaar/bank holds for Sahil too (M12-S01 AC5).
 *
 * server/investors/record.ts lists its D70 paper through `listAttachments` too, so there is one lister.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { str } from "../data/contact-row";
import { MODULES } from "../data/projections";
import { SLOTS } from "./slots";

const RECORD_ID = /^\d{15,22}$/;
/** Metadata only — never a body. Created_By is read for its display name only (the uploader). Same list as server/investors/record.ts. */
export const ATTACHMENT_FIELDS: readonly string[] = Object.freeze(["id", "File_Name", "Size", "Created_Time", "Created_By"]);
/** Pages of 200 read per record at most (1000 files); past that the list says `truncated`. */
export const MAX_ATTACHMENT_PAGES = 5;

/** The three D70 scopes and the module each lives on. */
export type DocScope = "personal" | "allotment" | "project";
export const SCOPE_MODULE: Readonly<Record<DocScope, string>> = Object.freeze({
  personal: MODULES.contacts, allotment: MODULES.allotments, project: MODULES.llps,
});

export interface AttachmentLine {
  readonly id: string; readonly name: string; readonly size: number | null; readonly at: string | null;
  /** the typed slot's label ("PAN proof") for a paper filed to a slot; null for a plain attachment */
  readonly slot: string | null;
  /** who uploaded it, by display name — null where Zoho's file-upload value does not say */
  readonly by: string | null;
}
export type AttachmentList =
  | { readonly ok: true; readonly files: readonly AttachmentLine[]; readonly truncated: boolean }
  | { readonly ok: false; readonly errorKind: string; readonly forbidden: boolean };

/** A PAN (ABCDE1234F), a 12-digit Aadhaar (spaced or not) or any run of 9+ digits → masked, last 4 kept. */
export function maskFileName(name: string): string {
  return name
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, (m) => "•••••" + m.slice(-4))
    .replace(/\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, (m) => "•••• •••• " + m.slice(-4))
    .replace(/\d{9,}/g, (m) => "••••" + m.slice(-4));
}

const FILE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : null;
  return typeof n === "string" && n.trim() ? n.trim().slice(0, 100) : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The attachments of one record, metadata only. Zoho's "no content" / not-found is an empty list. `opts.slots` adds the papers filed
 *  to the record's typed slots (one more read of the record): the Documents readers ask for it; the investor record's own
 *  D70 paper (server/investors/record) keeps its one GET per Contact (TC-IM04-007) and does not. */
export async function listAttachments(
  crm: Pick<ZohoClient, "getRelated"> & Partial<Pick<ZohoClient, "getRecord">>, cred: UserCredential, scope: DocScope, recordId: string, signal?: AbortSignal, opts: { readonly slots?: boolean } = {},
): Promise<AttachmentList> {
  if (!RECORD_ID.test(recordId)) return { ok: false, errorKind: "invalid-request", forbidden: false };
  const out: AttachmentLine[] = [];
  for (let page = 1; page <= MAX_ATTACHMENT_PAGES; page++) {
    let r: Awaited<ReturnType<typeof crm.getRelated>>;
    try {
      r = await crm.getRelated(cred, SCOPE_MODULE[scope], recordId, "Attachments", { fields: ATTACHMENT_FIELDS, page, perPage: 200, signal });
    } catch { return { ok: false, errorKind: "unexpected", forbidden: false }; }
    if (!r.ok) {
      if (r.error.kind === "not-found") break;
      return { ok: false, errorKind: r.error.kind, forbidden: r.error.kind === "forbidden" };
    }
    for (const x of r.value.records) {
      if (!RECORD_ID.test(x.id)) continue;
      out.push(Object.freeze({ id: x.id, name: maskFileName(str(x, "File_Name", 255) ?? ""), size: num(x.Size), at: (str(x, "Created_Time", 40) ?? "").slice(0, 16) || null,
        slot: null, by: nameOf(x.Created_By) }));
    }
    if (!r.value.moreRecords) return { ok: true, files: Object.freeze([...(opts.slots ? await slotFiles(crm, cred, scope, recordId, signal) : []), ...out]), truncated: false };
    if (page === MAX_ATTACHMENT_PAGES) return { ok: true, files: Object.freeze([...(opts.slots ? await slotFiles(crm, cred, scope, recordId, signal) : []), ...out]), truncated: true };
  }
  return { ok: true, files: Object.freeze([...(opts.slots ? await slotFiles(crm, cred, scope, recordId, signal) : []), ...out]), truncated: false };
}

/** The papers filed to this record's typed slots (file-upload fields), as lines carrying their slot's label. One read of the
 *  record, on the same token. A slot the seat cannot read, or a read that fails, adds no lines — the Attachments still list. */
async function slotFiles(crm: Partial<Pick<ZohoClient, "getRecord">>, cred: UserCredential, scope: DocScope, recordId: string, signal?: AbortSignal): Promise<AttachmentLine[]> {
  const slots = Object.values(SLOTS[scope]);
  if (!slots.length || typeof crm.getRecord !== "function") return [];
  let r: Awaited<ReturnType<ZohoClient["getRecord"]>>;
  try { r = await crm.getRecord(cred, SCOPE_MODULE[scope], recordId, { fields: slots.map((x) => x.field), signal }); } catch { return []; }
  if (!r.ok || !r.value) return [];
  const out: AttachmentLine[] = [];
  for (const sl of slots) {
    const v = r.value[sl.field];
    for (const f of Array.isArray(v) ? v : []) {
      const o = f && typeof f === "object" ? (f as Record<string, unknown>) : null;
      const id = o && typeof o.File_Id__s === "string" && FILE_ID.test(o.File_Id__s) ? o.File_Id__s : null;
      if (!o || !id) continue;
      out.push(Object.freeze({ id, name: maskFileName(typeof o.File_Name__s === "string" ? o.File_Name__s.slice(0, 255) : ""), size: num(o.File_Size__s), at: null, slot: sl.label, by: null }));
    }
  }
  return out;
}
