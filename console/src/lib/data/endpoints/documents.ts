/* M12-S01-W1 / S02-W1 / S03-W1 / S05-W2 — the Documents area's reads and the upload:
     GET  /api/documents/investor/[id] and /api/documents/farm/[id]   the three scopes (D70), metadata only
     GET  /api/documents/list?cut=out|all                              the Documents page (server/documents/list)
     POST /api/documents/upload?scope=&id=&slot=&name=&expected=       the file's bytes, one Idempotency-Key per file
   Live: the routes. Fixture: the same answer projected from the demo book (its uploads and its document rows),
   and the upload runs the reducer's `uploadDoc` it replaces. No Documents module exists (D77): a paper is a request
   id on the Lead / Contact / allotment and its live status comes from Zoho Sign, which is what the list's `sign` is. */

import type { DocumentsPage, DocRow, Paper, RecordFiles } from "@/server/documents/list";
import type { AllotmentPapers, FarmDocuments, InvestorDocuments } from "@/server/documents/reader";
import type { AttachmentLine } from "@/server/documents/attachments";
import type { UploadDone } from "@/server/documents/upload";
import { I, allotsOf, llpOf, llps, may, pageReadable, signChip, who, type ImScope, type ImUpload, type ImDoc } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, type ImBook, type ImDispatch } from "./im";

const NOT_YOURS = () => fail(403, "not-visible", "This investor is not part of your book.");

/* ---- the book's words → the route's ---------------------------------------------------------------- */
/** A demo document's template → the route's paper. The other templates (receipts, power of attorney) are not papers
 *  the Documents list carries (server/documents/list PAPERS). */
export const PAPER_OF: Readonly<Record<string, Paper>> = Object.freeze({
  "Non-disclosure agreement": "nda", "FEMA declaration": "fema", "Supplementary agreement": "supplementary", "Allocation letter": "allocation-letter",
});
export const paperOfDoc = (d: Pick<ImDoc, "t">): Paper | null => PAPER_OF[d.t] ?? null;
const SCOPE_KEY: Readonly<Record<ImScope, "personal" | "allotment" | "project">> = { Personal: "personal", Allotment: "allotment", Project: "project" };
/** The upload slots the route types (server/documents/upload SLOTS) by the prototype's slot names; anything else is a plain attachment. */
const SLOT_KEY: Readonly<Record<string, string>> = Object.freeze({
  "PAN proof": "pan-proof", "Bank proof": "bank-proof", "FEMA declaration": "fema-declaration",
  "Supplementary agreement": "supplementary-agreement", "Allocation letter": "allocation-letter", "Unit certificate": "unit-certificate",
  "LLP deed": "llp-deed", "Insurance": "insurance-policy",
});
export const slotKey = (docType: string): string | null => SLOT_KEY[docType] ?? null;

const line = (u: ImUpload): AttachmentLine => ({ id: u.id, name: u.File_Name, size: u.File_Size, at: u.at });
const blockOf = (s: ImBook["s"], llpId: string): string => llpOf(s, llpId)?.Block_Code ?? "";

/* ---- M12-S01 the DOCS tab ---------------------------------------------------------------------------- */
export type InvestorDocs = InvestorDocuments;
export const investorDocuments: ReadEndpoint<ImBook, string | null, InvestorDocs> = {
  path: id => (id ? `/api/documents/investor/${encodeURIComponent(id)}` : null),
  pick: j => (j as { documents: InvestorDocs }).documents,
  fixture({ s, me }, id) {
    const x = I(s, me, id);
    if (!x) return NOT_YOURS();
    const ups = (s.data.UPLOADS || []).filter(u => u.Investor === x.id || (u.Scope === "Project" && !!x.blocks[u.LLP || ""]));
    const allotments: AllotmentPapers[] = allotsOf(s, me, x.id).filter(a => a.Allocation_Status !== "Cancelled").map(a => {
      const files = ups.filter(u => u.Scope === "Allotment" && u.LLP === blockOf(s, a.LLP_Lookup)).map(line);
      return { allotmentId: a.id, contactId: x.id, llpId: a.LLP_Lookup, files, count: files.length };
    });
    return ok({
      contactId: x.id, access: { personal: true, allotment: "files" as const, project: true },
      personal: ups.filter(u => u.Scope === "Personal").map(line), allotments,
      farms: Object.keys(x.blocks).map(k => llps(s).find(l => l.Block_Code === k)).filter((l): l is NonNullable<typeof l> => !!l)
        .map(l => ({ llpId: l.id, files: ups.filter(u => u.Scope === "Project" && u.LLP === l.Block_Code).map(line) })),
      truncated: false,
    });
  },
};

export const farmDocuments: ReadEndpoint<ImBook, string | null, FarmDocuments> = {
  path: id => (id ? `/api/documents/farm/${encodeURIComponent(id)}` : null),
  pick: j => (j as { documents: FarmDocuments }).documents,
  fixture({ s, me }, id) {
    if (!pageReadable(s, me, "farms")) return fail(403, "seat-denied", "This page is not part of your seat.");
    const l = llpOf({ data: s.data }, id);
    if (!l) return fail(404, "not-found", "Not found, or not yours to open.");
    const ups = s.data.UPLOADS || [];
    const holders = s.data.INV.filter(x => !!x.blocks[l.Block_Code] && I(s, me, x.id));
    return ok({
      llpId: l.id, access: { allotment: "files" as const, project: true as const },
      project: ups.filter(u => u.Scope === "Project" && u.LLP === l.Block_Code).map(line),
      allotments: holders.flatMap(x => allotsOf(s, me, x.id).filter(a => a.LLP_Lookup === l.id && a.Allocation_Status !== "Cancelled").map(a => {
        const files = ups.filter(u => u.Scope === "Allotment" && u.LLP === l.Block_Code && u.Investor === x.id).map(line);
        return { allotmentId: a.id, contactId: x.id, llpId: l.id, files, count: files.length };
      })),
      truncated: false,
    });
  },
};

/* ---- M12-S03 the Documents page ---------------------------------------------------------------------- */
export type DocsCut = "out" | "all";
export type DocsList = DocumentsPage;

/** The route's 503 carries the last good read; the page draws it as the stale block, never old rows. */
export const staleOf = (e: { detail?: Record<string, unknown> }): { at: number | null; tone: string } | null => {
  const f = e.detail?.fresh as { at?: unknown; tone?: unknown } | undefined;
  return f ? { at: typeof f.at === "number" ? f.at : null, tone: typeof f.tone === "string" ? f.tone : "stale" } : null;
};

/** A demo document as the route's row. `recordId` is the book's own document id in fixture mode: it is the one
 *  identity the reducer's verify / block / remind / recall actions know. */
export function fixtureDocRow(b: ImBook, d: ImDoc, paper: Paper): DocRow {
  const x = I(b.s, b.me, d.inv);
  const al = allotsOf(b.s, b.me, d.inv)[0] || null;
  const ch = signChip(b.s, d);
  const closed = !!ch && (ch.st === "declined" || ch.st === "expired" || ch.st === "recalled");
  const verified = d.state === "signed", blocked = d.state === "blocked";
  const acting = may(b.s, b.me, "doc");
  return {
    /* the demo lists a blocked paper (the route's rows are Zoho requests; a blocked one has none) — key "blocked:" marks it, fixture only */
    key: `${blocked ? "blocked" : paper}:${d.id}`, paper, label: d.t, scope: paper === "fema" ? "personal" : "allotment",
    module: paper === "fema" ? "Contacts" : "LLP_UnitAllocation_Module", recordId: d.id, party: x ? x.n : null,
    contactId: d.inv, llpId: paper === "fema" ? null : al ? al.LLP_Lookup : null, requestId: d.id, method: d.sig,
    state: verified ? "verified" : "sent", verifiedAt: verified ? d.on ?? null : null,
    sign: verified ? { status: "completed", sentAt: d.sent, sentBy: who(b.s, d.by).n, expiresAt: d.exp ?? null, label: "Signed" }
      : { status: ch && ch.st !== "signed" ? ch.st : "sent", sentAt: d.sent, sentBy: who(b.s, d.by).n, expiresAt: d.exp ?? null, label: ch ? ch.t : "Sent" },
    yourMove: acting && closed ? "Send a new one" : null,
  };
}

function filesOf({ s, me }: ImBook): RecordFiles[] {
  const by = new Map<string, RecordFiles>();
  for (const u of s.data.UPLOADS || []) {
    if (u.Scope !== "Project" && !I(s, me, u.Investor)) continue;
    const scope = SCOPE_KEY[u.Scope];
    const recordId = u.Scope === "Personal" ? u.Investor! : u.Scope === "Project" ? (llps(s).find(l => l.Block_Code === u.LLP)?.id ?? u.LLP ?? "")
      : (allotsOf(s, me, u.Investor!).find(a => blockOf(s, a.LLP_Lookup) === u.LLP)?.id ?? u.Investor!);
    const k = scope + ":" + recordId;
    const rf = by.get(k) || { scope, recordId, files: [] as AttachmentLine[] };
    (rf.files as AttachmentLine[]).push(line(u));
    by.set(k, rf);
  }
  return [...by.values()];
}

export const documentsList: ReadEndpoint<ImBook, DocsCut | null, DocsList> = {
  path: cut => (cut ? `/api/documents/list?cut=${cut}` : null),
  pick: j => (j as { documents: DocsList }).documents,
  fixture(b, cut) {
    if (!cut) return fail(400, "invalid-request", "Unknown view.");
    if (!pageReadable(b.s, b.me, "docs")) return fail(403, "seat-denied", "Your seat has no Documents page.");
    /* the investors side lists FEMA, supplementary and allocation letter; a blocked paper has no request id any more */
    const book = b.s.data.DOCS.filter(d => I(b.s, b.me, d.inv) && d.state !== "issued" && (d.state !== "blocked" || cut === "all"));
    const rows = book.flatMap(d => { const p = paperOfDoc(d); return p && p !== "nda" ? [fixtureDocRow(b, d, p)] : []; })
      .filter(r => cut === "all" || r.state !== "verified");
    const acting = may(b.s, b.me, "doc");
    return ok({
      side: "investors" as const, cut, rows, outCount: rows.filter(r => r.state !== "verified" && !r.key.startsWith("blocked:")).length,
      files: cut === "all" ? filesOf(b) : null, actions: { send: acting, verify: acting }, truncated: false,
      fresh: { source: "fixtures" as const, at: 0, failed: false, tone: "live" as const, ceilingMs: 0, servedAt: 0, problems: [] },
    });
  },
};

/** The rail's Documents badge: the route's outCount. `door` = the seat has a Documents page at all (else nothing is read).
 *  Fixture: the book is the badge the rail already counts off the demo book (nav.ts count(state, "docs")). */
export const documentsOutCount: ReadEndpoint<number, boolean, { outCount: number }> = {
  path: door => (door ? "/api/documents/list?cut=out" : null),
  pick: j => ({ outCount: (j as { documents: DocsList }).documents.outCount }),
  fixture: n => ok({ outCount: n }),
};

/* ---- M12-S02 the upload ------------------------------------------------------------------------------ */
export type UploadArgs = {
  scope: "personal" | "allotment" | "project" | "lead";
  /** the Contact, allotment or LLP record id (live) */
  recordId: string;
  /** the route's typed-slot key, or null for a plain attachment */
  slot: string | null;
  name: string;
  /** the record's Modified_Time as the page read it — required by the route with a slot */
  expected: string | null;
  bytes: Uint8Array;
  contentType: string;
  /** the book's own words for the reducer action the fixture runs */
  book: { key: string; Scope: ImScope; Doc_Type: string; Investor: string | null; LLP: string | null; File_Size: number; File_Type: string };
};

const qs = (o: Record<string, string | null>): string =>
  Object.entries(o).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");

export const documentUpload: WriteEndpoint<ImBook, UploadArgs, UploadDone, ImDispatch> = {
  method: "POST",
  path: a => `/api/documents/upload?${qs({ scope: a.scope, id: a.recordId, slot: a.slot, name: a.name, expected: a.expected })}`,
  raw: a => ({ body: new Blob([a.bytes as BlobPart], { type: a.contentType }), contentType: a.contentType }),
  idempotent: true,
  pick: j => (j as { uploaded: UploadDone }).uploaded,
  fixture(b, d, a): ApiResult<UploadDone> {
    const k = a.book;
    return imFixtureWrite(b, d, { type: "uploadDoc", key: k.key, Scope: k.Scope, Doc_Type: k.Doc_Type, Investor: k.Investor, LLP: k.LLP,
      File_Name: a.name, File_Size: k.File_Size, File_Type: k.File_Type },
    { scope: a.scope, recordId: a.recordId, slot: a.slot, attachmentId: null, fileName: a.name, size: k.File_Size, duplicate: false, recovered: false });
  },
  onLiveError: (d, e) => d({ type: "note", msg: e.error }),
};

/** "26 Aug" — a day as the book stamps it ("26 Aug 09:00"); the route's ISO time said the same way. */
export function dayOf(t: string | null | undefined): string {
  const m = t ? /^\d{4}-(\d{2})-(\d{2})/.exec(t) : null;
  return m ? `${m[2]} ${"JanFebMarAprMayJunJulAugSepOctNovDec".slice((+m[1] - 1) * 3, (+m[1] - 1) * 3 + 3)}` : String(t || "").slice(0, 6);
}
