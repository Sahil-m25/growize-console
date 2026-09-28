/**
 * M12-S01-T03 — ONE ATTACHMENT LISTER for the three D70 scopes (Contact · allotment · LLP).
 *
 * GET /crm/v8/{module}/{id}/Attachments on the caller's own token (D53) with an explicit field list:
 * metadata only (id, name, size, time). A file body is never downloaded, so nothing of a paper can reach a
 * log, the cache or a response (D45). A file name that carries an identity number (PAN, Aadhaar, an account
 * number) is masked here, for every seat — the wall on PAN/Aadhaar/bank holds for Sahil too (M12-S01 AC5).
 *
 * server/investors/record.ts has the same lister inline (its ATTACHMENT_FIELDS match this one — the test
 * asserts it); it should switch to `listAttachments` so there is one.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { str } from "../data/contact-row";
import { MODULES } from "../data/projections";

const RECORD_ID = /^\d{15,22}$/;
/** Metadata only — never a body, never Owner/Created_By names. Same list as server/investors/record.ts. */
export const ATTACHMENT_FIELDS: readonly string[] = Object.freeze(["id", "File_Name", "Size", "Created_Time"]);
/** Pages of 200 read per record at most (1000 files); past that the list says `truncated`. */
export const MAX_ATTACHMENT_PAGES = 5;

/** The three D70 scopes and the module each lives on. */
export type DocScope = "personal" | "allotment" | "project";
export const SCOPE_MODULE: Readonly<Record<DocScope, string>> = Object.freeze({
  personal: MODULES.contacts, allotment: MODULES.allotments, project: MODULES.llps,
});

export interface AttachmentLine { readonly id: string; readonly name: string; readonly size: number | null; readonly at: string | null }
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The attachments of one record, metadata only. Zoho's "no content" / not-found is an empty list. */
export async function listAttachments(
  crm: Pick<ZohoClient, "getRelated">, cred: UserCredential, scope: DocScope, recordId: string, signal?: AbortSignal,
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
      out.push(Object.freeze({ id: x.id, name: maskFileName(str(x, "File_Name", 255) ?? ""), size: num(x.Size), at: (str(x, "Created_Time", 40) ?? "").slice(0, 16) || null }));
    }
    if (!r.value.moreRecords) return { ok: true, files: Object.freeze(out), truncated: false };
    if (page === MAX_ATTACHMENT_PAGES) return { ok: true, files: Object.freeze(out), truncated: true };
  }
  return { ok: true, files: Object.freeze(out), truncated: false };
}
