/**
 * M12-S03-T02 — THE DOCUMENTS PAGE READ: "Out for signature" and "Everything on file", cut to the seat
 * (D45, D48, D53, D70, D72). Every read is COQL / Attachments on the viewer's own token; nothing is cached.
 *
 * The org has no Documents module (the queue's "new module" was never created). What exists, and is read here:
 *   paper              record (module)                  request id                   method            back & checked
 *   NDA                Lead (Leads)                     NDA_Sign_Req_Id              NDA_Signed_Via     NDA_Verified_At
 *   FEMA declaration   Contact (Contacts)               FEMA_Sign_Req_Id             FEMA_Signed_Via    FEMA_Verified_At
 *   Supplementary      allotment (LLP_UnitAllocation)   Supplementary_Sign_Req_Id    …_Signed_Via       Supplementary_Verified_At
 *   Allocation letter  allotment                        Alloc_Letter_Sign_Req_Id     …_Signed_Via       Alloc_Letter_Verified_At
 * "out" = a request id is set and the paper is not yet verified; "all" = every paper with a request id, plus the
 * Attachments of those records the seat may list (personal / allotment files per ./scope), capped per read.
 * The live Sign status (Viewed / Declined / Recalled / Expired), sent time, sender and expiry (D77/D79 keep them in
 * Zoho Sign) come from the per-viewer `signStatus` reader — server/zoho-sign/status.ts createSignStatusReader, on
 * the viewer's OWN Sign token (D53: never the provider-callback service token for a screen), composed by
 * ./runtime documentsList(). Without Zoho Sign configured (or in tests without a reader) rows carry `sign: null`.
 * PROVISIONAL (jev "b", 0.07, overridden to a D53-safe build: the CRM rows are the source; Sign joins per viewer).
 *
 * Seats: the Investors side (org/all book: Finance, Head of Finance, Compliance, Auditor, viewers, DI) reads every
 * paper row; an IR / channel partner / IR Manager reads only NDA rows on leads they own, with their "your move";
 * a person holding both halves (DI/ops) gets the fuller Investors-side list once. KAM and Head of AM have no
 * Documents door (TC-IM07-003) and are refused. Viewers and audit get `actions.verify/send = false`.
 *
 * A failed read answers no rows at all, with the time of this person's last good read (stale/error state).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { idOf, str } from "../data/contact-row";
import { freshnessOf, type ServedFreshness } from "../data/freshness";
import { scopesFor } from "../data/scope";
import { listAttachments, type AttachmentLine, type DocScope } from "./attachments";
import { docAccessFor } from "./scope";

const RECORD_ID = /^\d{15,22}$/;
const REQ_ID = /^\d{10,25}$/;
const MAX_PAGES = 10;
export const MAX_ATTACHMENT_RECORDS = 25;

export type Paper = "nda" | "fema" | "supplementary" | "allocation-letter";
export type Cut = "out" | "all";
interface PaperSpec {
  readonly paper: Paper; readonly label: string; readonly side: "lead" | "investors"; readonly scope: DocScope | "lead";
  readonly module: string; readonly req: string; readonly via: string; readonly verified: string; readonly names: readonly string[];
}
export const PAPERS: readonly PaperSpec[] = Object.freeze([
  { paper: "nda", label: "NDA", side: "lead", scope: "lead", module: "Leads", req: "NDA_Sign_Req_Id", via: "NDA_Signed_Via", verified: "NDA_Verified_At", names: ["Full_Name", "Owner"] },
  { paper: "fema", label: "FEMA declaration", side: "investors", scope: "personal", module: "Contacts", req: "FEMA_Sign_Req_Id", via: "FEMA_Signed_Via", verified: "FEMA_Verified_At", names: ["First_Name", "Last_Name", "ARL_ID"] },
  { paper: "supplementary", label: "Supplementary agreement", side: "investors", scope: "allotment", module: "LLP_UnitAllocation_Module", req: "Supplementary_Sign_Req_Id", via: "Supplementary_Signed_Via", verified: "Supplementary_Verified_At", names: ["Name", "Customer", "LLP"] },
  { paper: "allocation-letter", label: "Allocation letter", side: "investors", scope: "allotment", module: "LLP_UnitAllocation_Module", req: "Alloc_Letter_Sign_Req_Id", via: "Alloc_Letter_Signed_Via", verified: "Alloc_Letter_Verified_At", names: ["Name", "Customer", "LLP"] },
] as const);

/** What Zoho Sign says of one request, read on the viewer's own Sign token (see above). `status` is "completed" when
 *  signed, else the reader's state (sent, viewed, declined, recalled, expired, draft, unknown); `label` its words. */
export interface SignStatus { readonly status: string; readonly sentAt: string | null; readonly sentBy: string | null; readonly expiresAt: string | null; readonly label?: string | null }
/** A request Zoho Sign has closed without a signature: nobody can be reminded, a new one must be sent. */
export const SIGN_CLOSED = /^(declined|recalled|expired)$/i;
export type SignStatusReader = (cred: UserCredential, requestIds: readonly string[], signal?: AbortSignal) => Promise<ReadonlyMap<string, SignStatus>>;

export interface DocRow {
  readonly key: string;
  readonly paper: Paper;
  readonly label: string;
  readonly scope: DocScope | "lead";
  readonly module: string;
  readonly recordId: string;
  /** who the paper is for: the lead's or investor's name, or the allotment's name */
  readonly party: string | null;
  readonly contactId: string | null;
  readonly llpId: string | null;
  readonly requestId: string;
  readonly method: string | null;
  readonly state: "sent" | "signed" | "verified";
  readonly verifiedAt: string | null;
  readonly sign: SignStatus | null;
  readonly yourMove: string | null;
}
export interface RecordFiles { readonly scope: DocScope; readonly recordId: string; readonly files: readonly AttachmentLine[] }
export interface DocumentsPage {
  readonly side: "investors" | "lead";
  readonly cut: Cut;
  readonly rows: readonly DocRow[];
  readonly outCount: number;
  readonly files: readonly RecordFiles[] | null;
  readonly actions: { readonly send: boolean; readonly verify: boolean };
  readonly truncated: boolean;
  readonly fresh: ServedFreshness;
}
export type DocumentsPageResult =
  | { readonly ok: true; readonly page: DocumentsPage }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "seat-denied" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly fresh: ServedFreshness };

export interface DocumentsListDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRelated">;
  readonly log: OpsLog;
  readonly signStatus?: SignStatusReader;
  readonly clock?: () => number;
}

/** Seats that act on papers (Send one, Verify) — PROVISIONAL until OD8. */
const ACTING = new Set(["fin", "head", "di", "ops"]);
/** No Documents door (TC-IM07-003). */
const NO_DOOR = new Set(["kam", "amlead"]);

export function documentsSideFor(seat: string, userId: string): "investors" | "lead" | null {
  if (NO_DOOR.has(seat)) return null;
  const s = scopesFor(seat, userId);
  if (s.investors.kind === "org" || s.investors.kind === "all") return "investors";
  if (s.leads.kind === "user" || s.leads.kind === "subtree") return "lead";
  return null;
}

const G = globalThis as typeof globalThis & { __gzDocsLastGood?: Map<string, number> };
const lastGood = (): Map<string, number> => (G.__gzDocsLastGood ??= new Map());

function partyOf(spec: PaperSpec, r: ZohoRecord): string | null {
  if (spec.module === "Leads") return str(r, "Full_Name", 200);
  if (spec.module === "Contacts") {
    const n = [str(r, "First_Name", 100), str(r, "Last_Name", 100)].filter(Boolean).join(" ");
    const arl = str(r, "ARL_ID", 40);
    return n ? (arl ? `${n} (${arl})` : n) : arl;
  }
  return str(r, "Name", 200);
}

export function createDocumentsList(deps: DocumentsListDeps) {
  const clock = deps.clock ?? Date.now;

  async function readPaper(cred: UserCredential, spec: PaperSpec, cut: Cut, ownerOnly: boolean, signal?: AbortSignal)
    : Promise<{ ok: true; rows: ZohoRecord[]; truncated: boolean } | { ok: false; errorKind: string }> {
    const where = [`${spec.req} is not null`];
    if (cut === "out") where.push(`${spec.verified} is null`);
    if (ownerOnly) where.push(`Owner = '${cred.userId}'`);
    const fields = ["id", spec.req, spec.via, spec.verified, ...spec.names];
    const rows: ZohoRecord[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try {
        r = await deps.crm.coql(cred, `select ${fields.join(", ")} from ${spec.module} where (${where.join(" and ")}) order by id asc limit ${page * 200}, 200`, { signal });
      } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) return { ok: false, errorKind: r.error.kind };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { ok: true, rows, truncated: false };
    }
    return { ok: true, rows, truncated: true };
  }

  async function read(cred: UserCredential, seat: string, cut: Cut, signal?: AbortSignal): Promise<DocumentsPageResult> {
    const me = cred.userId;
    const refuse = (reason: "seat-denied" | "invalid-request"): DocumentsPageResult => {
      deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "documents-list", reason, recordIds: [] });
      return { ok: false, kind: "refused", reason };
    };
    if (cut !== "out" && cut !== "all") return refuse("invalid-request");
    const side = documentsSideFor(seat, me);
    if (!side) return refuse("seat-denied");
    const key = `${me}|${side}|${cut}`;
    const fail = (errorKind: string): DocumentsPageResult => ({ ok: false, kind: "source-error", errorKind,
      fresh: freshnessOf({ source: "zoho", userId: me, problems: [`documents:${errorKind}`], threw: true, now: clock(), lastGoodAt: lastGood().get(key) ?? null }) });

    const specs = PAPERS.filter((p) => p.side === side);
    const raw: { spec: PaperSpec; r: ZohoRecord }[] = [];
    let truncated = false;
    for (const spec of specs) {
      const got = await readPaper(cred, spec, cut, side === "lead", signal);
      if (!got.ok) return fail(got.errorKind);
      truncated ||= got.truncated;
      for (const r of got.rows) {
        const req = typeof r[spec.req] === "string" ? (r[spec.req] as string).trim() : "";
        if (!RECORD_ID.test(r.id) || !REQ_ID.test(req)) continue;
        if (side === "lead" && idOf(r.Owner) !== me) continue; // the IR's own leads only, whatever sharing let through
        raw.push({ spec, r });
      }
    }

    let sign: ReadonlyMap<string, SignStatus> = new Map();
    if (deps.signStatus && raw.length) {
      try { sign = await deps.signStatus(cred, [...new Set(raw.map(({ spec, r }) => (r[spec.req] as string).trim()))], signal); } catch { sign = new Map(); }
    }
    const acting = side === "investors" && ACTING.has(seat);
    const rows: DocRow[] = raw.map(({ spec, r }) => {
      const requestId = (r[spec.req] as string).trim();
      const verifiedAt = str(r, spec.verified, 40);
      const s = sign.get(requestId) ?? null;
      const signed = s !== null && /^(completed|signed)$/i.test(s.status);
      const state: DocRow["state"] = verifiedAt ? "verified" : signed ? "signed" : "sent";
      const closed = state === "sent" && s !== null && SIGN_CLOSED.test(s.status);
      const yourMove = side === "lead"
        ? (closed ? "Finance to send a new one" : state === "sent" ? "Remind them to sign" : state === "signed" ? "Finance to verify" : null)
        : acting && state === "signed" ? "Verify" : acting && closed ? "Send a new one" : null;
      return Object.freeze({
        key: `${spec.paper}:${r.id}`, paper: spec.paper, label: spec.label, scope: spec.scope, module: spec.module, recordId: r.id,
        party: partyOf(spec, r), contactId: spec.module === "Contacts" ? r.id : spec.module === "Leads" ? null : idOf(r.Customer),
        llpId: spec.module === "LLP_UnitAllocation_Module" ? idOf(r.LLP) : null,
        requestId, method: str(r, spec.via, 60), state, verifiedAt: verifiedAt ? verifiedAt.slice(0, 16) : null, sign: s, yourMove,
      });
    });

    let files: RecordFiles[] | null = null;
    if (cut === "all" && side === "investors") {
      const access = docAccessFor(seat, me);
      files = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const scope = row.scope as DocScope;
        if (scope === "personal" ? !access.personal : access.allotment !== "files") continue;
        const k = `${scope}:${row.recordId}`;
        if (seen.has(k)) continue;
        if (seen.size >= MAX_ATTACHMENT_RECORDS) { truncated = true; break; }
        seen.add(k);
        const l = await listAttachments(deps.crm, cred, scope, row.recordId, signal);
        if (!l.ok) { if (l.forbidden) continue; return fail(l.errorKind); }
        truncated ||= l.truncated;
        files.push(Object.freeze({ scope, recordId: row.recordId, files: l.files }));
      }
    }

    const now = clock();
    const m = lastGood();
    m.delete(key); m.set(key, now);
    while (m.size > 5_000) m.delete(m.keys().next().value as string);
    return { ok: true, page: Object.freeze({
      side, cut, rows: Object.freeze(rows), outCount: rows.filter((r) => r.state !== "verified").length,
      files: files ? Object.freeze(files) : null, actions: Object.freeze({ send: acting, verify: acting }), truncated,
      fresh: freshnessOf({ source: "zoho", userId: me, problems: [], threw: false, now, lastGoodAt: now }),
    }) };
  }

  return Object.freeze({ read });
}
export type DocumentsList = ReturnType<typeof createDocumentsList>;
