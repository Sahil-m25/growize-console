/**
 * M12-S01-T03 — SCOPED DOCUMENT READS (D45, D53, D70).
 *
 * Two views, both on the signed-in person's own token and rules from ./scope:
 *   forInvestor(contactId) — personal (Contact) · per allotment (investor × LLP) · project (the LLPs the investor
 *                            holds, resolved from their live allotments). The investor is admitted first by the
 *                            one IR/AM choke point (ir-guard `one`: IR own lead, KAM own book), so a Contact the
 *                            seat may not see is refused before any attachment is listed.
 *   forFarm(llpId)         — project (LLP) plus, per holder allotment on that LLP, the allotment papers, only for
 *                            holders inside the seat's own investors scope (own-book / own-lead read their book
 *                            first; wider scopes ask Zoho by LLP).
 * What a seat may not see is never read. Metadata only (./attachments); nothing is cached; logs carry ids.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { createInvestorsAdapters } from "../data/adapters";
import { idOf, str } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { createInvestorGuard, type GuardRefusal, type PlaneCRefusal } from "../data/ir-guard";
import { MODULES, PROJECTIONS } from "../data/projections";
import { listAttachments, type AttachmentLine, type AttachmentList } from "./attachments";
import { docAccessFor, heldLlps, type AllotmentAccess, type HolderRow } from "./scope";

const RECORD_ID = /^\d{15,22}$/;
const MAX_HOLDER_PAGES = 10;

export interface AllotmentPapers {
  readonly allotmentId: string;
  readonly contactId: string;
  readonly llpId: string;
  /** null when the seat has the status only (an IR) */
  readonly files: readonly AttachmentLine[] | null;
  /** paperwork status: how many files are on the allotment */
  readonly count: number;
}
export interface FarmPapers { readonly llpId: string; readonly files: readonly AttachmentLine[] }

export interface InvestorDocuments {
  readonly contactId: string;
  readonly access: { readonly personal: boolean; readonly allotment: AllotmentAccess; readonly project: boolean };
  readonly personal: readonly AttachmentLine[] | null;
  readonly allotments: readonly AllotmentPapers[];
  readonly farms: readonly FarmPapers[] | null;
  readonly truncated: boolean;
}
export interface FarmDocuments {
  readonly llpId: string;
  readonly access: { readonly allotment: AllotmentAccess; readonly project: true };
  readonly project: readonly AttachmentLine[];
  readonly allotments: readonly AllotmentPapers[];
  readonly truncated: boolean;
}

type SourceError = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };
export type InvestorDocsResult = { readonly ok: true; readonly documents: InvestorDocuments } | GuardRefusal | SourceError;
export type FarmDocsResult = { readonly ok: true; readonly documents: FarmDocuments } | GuardRefusal | SourceError;

export interface DocumentsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRelated">;
  readonly events: InvestorEvents;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
}

const srcErr = (errorKind: string): SourceError => ({ ok: false, kind: "source-error", errorKind });

export function createDocumentsReader(deps: DocumentsDeps) {
  const adapters = createInvestorsAdapters({ crm: deps.crm, events: deps.events });
  const guard = createInvestorGuard({ events: deps.events, planeCRefusal: deps.planeCRefusal });

  /** One allotment's papers as the seat may see them (files, or the count only). */
  const allotmentPapers = async (cred: UserCredential, access: AllotmentAccess, a: HolderRow & { id: string }, signal?: AbortSignal): Promise<AllotmentPapers | AttachmentList> => {
    const l = await listAttachments(deps.crm, cred, "allotment", a.id, signal, { slots: true });
    if (!l.ok) return l;
    return Object.freeze({ allotmentId: a.id, contactId: a.Customer, llpId: a.LLP_Lookup, files: access === "files" ? l.files : null, count: l.files.length });
  };

  async function forInvestor(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal): Promise<InvestorDocsResult> {
    const me = cred.userId, action = "documents-investor";
    if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return guard.refuse(me, seat, action, "invalid-request", []);
    const access = docAccessFor(seat, me);
    if (access.allotment === "none") return guard.refuse(me, seat, action, "seat-denied", [contactId]);
    const one = await guard.one(deps.crm, cred, seat, contactId, signal, action);
    if (!one.ok) return one;

    let truncated = false;
    let personal: readonly AttachmentLine[] | null = null;
    if (access.personal) {
      const p = await listAttachments(deps.crm, cred, "personal", contactId, signal, { slots: true });
      if (!p.ok) return srcErr(p.errorKind);
      personal = p.files; truncated ||= p.truncated;
    }
    // AM projection: no price, no amount — documents need none.
    const al = await adapters.allotments(cred, access.investors, [contactId], signal, true, false);
    if (!al.ok) return al.kind === "refused" ? guard.refuse(me, seat, action, "not-own-lead", [contactId]) : srcErr(al.errorKind);
    const allots = al.rows.filter((a) => a.Customer === contactId);
    truncated ||= al.truncated;
    const perAllot: AllotmentPapers[] = [];
    for (const a of allots) {
      const x = await allotmentPapers(cred, access.allotment, a, signal);
      if ("ok" in x) { if (!x.ok) return srcErr(x.errorKind); continue; }
      perAllot.push(x);
    }
    let farms: FarmPapers[] | null = null;
    if (access.project) {
      farms = [];
      for (const llpId of heldLlps(allots, contactId).filter((x) => RECORD_ID.test(x))) {
        const f = await listAttachments(deps.crm, cred, "project", llpId, signal, { slots: true });
        if (!f.ok) return srcErr(f.errorKind);
        farms.push(Object.freeze({ llpId, files: f.files })); truncated ||= f.truncated;
      }
    }
    return { ok: true, documents: Object.freeze({
      contactId, access: Object.freeze({ personal: access.personal, allotment: access.allotment, project: access.project }),
      personal, allotments: Object.freeze(perAllot), farms: farms ? Object.freeze(farms) : null, truncated,
    }) };
  }

  /** Every allotment on one LLP the token sees (AM projection), paged by LIMIT offset, ≤2000 rows. */
  const holdersOf = async (cred: UserCredential, llpId: string, signal?: AbortSignal): Promise<{ ok: true; rows: (HolderRow & { id: string })[]; truncated: boolean } | SourceError> => {
    const rows: (HolderRow & { id: string })[] = [];
    for (let page = 0; page < MAX_HOLDER_PAGES; page++) {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try {
        r = await deps.crm.coql(cred, `select ${PROJECTIONS.amAllotments.join(", ")} from ${MODULES.amAllotments} where (LLP = '${llpId}') order by id asc limit ${page * 200}, 200`, { signal });
      } catch { return srcErr("unexpected"); }
      if (!r.ok) return srcErr(r.error.kind);
      for (const x of r.value.records) {
        const customer = idOf(x.Customer), llp = idOf(x.LLP);
        if (!RECORD_ID.test(x.id) || !customer || llp !== llpId) continue;
        rows.push({ id: x.id, Customer: customer, LLP_Lookup: llp, Allocation_Status: str(x, "Allocation_Status", 40) ?? "Reserved" });
      }
      if (!r.value.moreRecords) return { ok: true, rows, truncated: false };
    }
    return { ok: true, rows, truncated: true };
  };

  async function forFarm(cred: UserCredential, seat: string, llpId: string, signal?: AbortSignal): Promise<FarmDocsResult> {
    const me = cred.userId, action = "documents-farm";
    if (typeof llpId !== "string" || !RECORD_ID.test(llpId)) return guard.refuse(me, seat, action, "invalid-request", []);
    const access = docAccessFor(seat, me);
    if (!access.project) return guard.refuse(me, seat, action, "seat-denied", [llpId]);
    const p = await listAttachments(deps.crm, cred, "project", llpId, signal, { slots: true });
    if (!p.ok) return p.forbidden ? guard.refuse(me, seat, action, "not-visible", [llpId]) : srcErr(p.errorKind);
    let truncated = p.truncated;
    const perAllot: AllotmentPapers[] = [];
    if (access.allotment !== "none") {
      const h = await holdersOf(cred, llpId, signal);
      if (!h.ok) return h;
      truncated ||= h.truncated;
      let holders = h.rows;
      const inv = access.investors;
      if (inv.kind === "own-lead" || inv.kind === "own-book") {
        // A person-bound seat keeps only holders in its own book (the Contacts read under its own filter).
        const book = await adapters.contacts(cred, inv, signal);
        if (!book.ok) return book.kind === "refused" ? guard.refuse(me, seat, action, "not-own-lead", [llpId]) : srcErr(book.errorKind);
        const mine = new Set(book.rows.map((c) => c.id));
        holders = holders.filter((a) => mine.has(a.Customer));
        truncated ||= book.truncated;
      }
      for (const a of holders) {
        const x = await allotmentPapers(cred, access.allotment, a, signal);
        if ("ok" in x) { if (!x.ok) return srcErr(x.errorKind); continue; }
        perAllot.push(x);
      }
    }
    return { ok: true, documents: Object.freeze({
      llpId, access: Object.freeze({ allotment: access.allotment, project: true as const }),
      project: p.files, allotments: Object.freeze(perAllot), truncated,
    }) };
  }

  return Object.freeze({ forInvestor, forFarm });
}
export type DocumentsReader = ReturnType<typeof createDocumentsReader>;
