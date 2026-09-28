/**
 * M13-S06-T02 — PUBLISH AN INVESTOR UPDATE TO A RECONSTRUCTABLE SEGMENT (D12, D45, D53, D70, D73).
 *
 * One guarded write unit ("commit()" on the server), all on the publisher's own token:
 *   1. guards: the seat holds `upd` (lib/im ROLE via cases/rights); Statement and Compliance are Finance's
 *      (a KAM or the Head of AM is offered Produce and Notice only); headline and text carry no identity value
 *   2. the audience is resolved AS COQL AT PUBLISH over the publisher's own investors book
 *      (data/ir-guard contactsWhere: a KAM's book is KAM = me, Finance's the org):
 *        all       Contacts where (book)
 *        allotted  Contacts where (book) and id in (Customer of LLP_UnitAllocation_Module where Allocation_Status = 'Issued')
 *        farm      … and LLP = '<the farm LLP>'
 *      IN lists ≤100 ids, ≤2000 rows per call; a segment larger than one bounded read is refused rather
 *      than counted short (the count must be exact)
 *   3. Investor_Updates gets one record: Name, Category, Audience (+ LLP), Body, Published_At, Published_By
 *      and Sent_Count = the count at publish. Audience + LLP + Published_By's book IS the stored predicate:
 *      `predicateOf` rebuilds the same COQL from them, so the segment can always be reconstructed.
 *   4. only after Zoho said yes, update.published is pushed to the investor app through the M13-S01
 *      outbox, one event per investor in the segment — exactly those, never anyone else.
 *
 * The org as found (read-only getFields, 28 Sep 2026): Category Produce/Statement/Compliance/Farm/Other
 * (no "Notice": written as Other, PROVISIONAL), Audience All investors/Allotted only/One farm (no NRI value
 * and no predicate field: an NRI-only publish is refused, jev 0.96).
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { contactsWhere } from "../data/ir-guard";
import { scopesFor } from "../data/scope";
import { identityPaths, updatePublished } from "../contracts/outbox";
import { idOf, IN_CHUNK, inClause, istStamp, nameOf, num, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { imRightsOf, type ImRights } from "../cases/rights";
import { checkProjection } from "../data/projections";

export const UPDATES_MODULE = "Investor_Updates";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
export const UPDATE_FIELDS = checkProjection(UPDATES_MODULE, [
  "id", "Name", "Category", "Audience", "LLP", "Body", "Published_At", "Published_By", "Sent_Count", "Delivered_Count", "Created_Time",
]);

export const KINDS = Object.freeze(["Produce", "Statement", "Compliance", "Notice"] as const);
export type UpdateKind = (typeof KINDS)[number];
/** Statements and compliance notes are Finance's (the prototype's rule, the story's AC3). */
const FINANCE_KINDS: ReadonlySet<UpdateKind> = new Set(["Statement", "Compliance"]);
const CATEGORY_OF: Readonly<Record<UpdateKind, string>> = Object.freeze({ Produce: "Produce", Statement: "Statement", Compliance: "Compliance", Notice: "Other" });

export const AUDIENCES = Object.freeze(["all", "allotted", "farm", "nri"] as const);
export type Audience = (typeof AUDIENCES)[number];
const AUDIENCE_VALUE: Readonly<Record<Exclude<Audience, "nri">, string>> = Object.freeze({ all: "All investors", allotted: "Allotted only", farm: "One farm" });
export const AUDIENCE_TEXT: Readonly<Record<Audience, string>> = Object.freeze({
  all: "everyone on the book", allotted: "allotted investors only", farm: "the holders of one farm", nri: "NRI investors only",
});

export type RefusalReason = "read-only" | "kind-not-yours" | "invalid-request" | "no-book" | "audience-not-in-zoho" | "empty-segment" | "segment-too-large" | "identity-in-text";
export const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = Object.freeze({
  "read-only": "This seat reads investor updates; it does not publish them.",
  "kind-not-yours": "Statements and compliance notes are Finance's. Account Management publishes produce notes and notices.",
  "invalid-request": "An update needs a headline, a kind from the list, an audience and the text.",
  "no-book": "You have no investors book to publish to.",
  "audience-not-in-zoho": "An NRI-only update cannot be published yet: Zoho cannot store that audience, and an update is never sent to a segment that cannot be reconstructed from the book.",
  "empty-segment": "Nobody on your book is in that audience, so nothing was published.",
  "segment-too-large": "That audience is larger than one exact count can read. Nothing was published; Digital Infrastructure has been told.",
  "identity-in-text": "The update carries what looks like a PAN, Aadhaar or bank number. Those never go to the app; take it out and publish again.",
});

export interface UpdateRow {
  readonly id: string;
  readonly t: string;
  readonly kind: string;
  readonly on: string;
  readonly by: string;
  readonly byName: string | null;
  readonly to: "all" | "allotted" | "farm" | "unknown";
  readonly toText: string;
  readonly llp: { readonly id: string; readonly name: string | null } | null;
  readonly n: number;
  readonly delivered: number | null;
  readonly d: string;
}

export type Result<V> =
  | ({ readonly ok: true } & V)
  | { readonly ok: false; readonly kind: "refused"; readonly reason: RefusalReason; readonly message: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface UpdatesPrincipal { readonly credential: UserCredential; readonly seat: string }
export interface PublishInput { readonly headline: unknown; readonly kind: unknown; readonly audience: unknown; readonly llpId?: unknown; readonly body: unknown }
export type PushToApp = (event: Record<string, unknown>) => Promise<{ readonly ok: boolean }>;

export interface UpdatesDeps {
  readonly crm: Pick<ZohoClient, "coql" | "insert">;
  readonly events: InvestorEvents;
  readonly push?: PushToApp;
  readonly rights?: (seat: string, userId: string) => ImRights;
  readonly clock?: () => number;
  readonly maxPages?: number;
}

const IST_MS = 5.5 * 3_600_000;
const istIso = (ms: number): string => `${new Date(ms + IST_MS).toISOString().slice(0, 19)}+05:30`;
const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

/** The kinds a seat may publish (the drawer's choices). Empty → the page is read only. */
export function kindsFor(r: ImRights): readonly UpdateKind[] {
  if (!r.upd) return [];
  return r.team === "fin" || r.team === "di" ? KINDS : KINDS.filter((k) => !FINANCE_KINDS.has(k));
}

/** The segment as COQL, rebuilt from what Zoho stores (Audience, LLP and the publisher's book). Pure. */
export function predicateOf(bookWhere: string, audience: Exclude<Audience, "nri">, llpId: string | null): string {
  const contacts = `select id from Contacts where (${bookWhere})`;
  if (audience === "all") return contacts;
  const allot = `select Customer from ${ALLOTMENTS_MODULE} where Allocation_Status = 'Issued'${audience === "farm" && llpId ? ` and LLP = '${llpId}'` : ""}`;
  return `${contacts} and id in (${allot})`;
}

const toOf = (v: string | null): UpdateRow["to"] => (v === "All investors" ? "all" : v === "Allotted only" ? "allotted" : v === "One farm" ? "farm" : "unknown");

export function updateOf(x: ZohoRecord): UpdateRow | null {
  if (!idOf(x.id)) return null;
  const to = toOf(str(x, "Audience", 40));
  const llpId = idOf(x.LLP);
  const cat = str(x, "Category", 40) ?? "";
  return Object.freeze({
    id: x.id, t: str(x, "Name", 120) ?? "", kind: cat === "Other" ? "Notice" : cat,
    on: istStamp(str(x, "Published_At", 40) ?? str(x, "Created_Time", 40)) ?? "",
    by: idOf(x.Published_By) ?? "", byName: nameOf(x.Published_By),
    to, toText: to === "unknown" ? "an audience this console cannot read" : AUDIENCE_TEXT[to],
    llp: llpId ? Object.freeze({ id: llpId, name: nameOf(x.LLP) }) : null,
    n: num(x, "Sent_Count") ?? 0, delivered: num(x, "Delivered_Count"), d: str(x, "Body", 50_000) ?? "",
  });
}

export function createInvestorUpdates(deps: UpdatesDeps) {
  const clock = deps.clock ?? Date.now;
  const rightsOf = deps.rights ?? imRightsOf;
  const refuse = <V>(me: string, action: string, reason: RefusalReason, ids: readonly string[] = []): Result<V> => {
    deps.events.refusal(me, action, reason, ids);
    return { ok: false, kind: "refused", reason, message: REFUSAL_TEXT[reason] };
  };
  const zohoFail = <V>(kind: string): Result<V> => ({ ok: false, kind: "source-error", errorKind: kind, retryable: retryable(kind) });

  /** Every contact id in the segment, exactly, or why not. */
  async function resolve(cred: UserCredential, bookWhere: string, audience: Exclude<Audience, "nri">, llpId: string | null, signal?: AbortSignal):
    Promise<{ ok: true; ids: string[] } | { ok: false; out: Result<never> }> {
    if (audience === "all") {
      const r = await pagedSelect(deps.crm, cred, ["id"], "Contacts", bookWhere, "id asc", signal, deps.maxPages);
      if (!r.ok) return { ok: false, out: r.kind === "refused" ? zohoFail("source-invalid") : zohoFail(r.errorKind) };
      if (r.truncated) return { ok: false, out: refuse(cred.userId, "update-publish", "segment-too-large") };
      return { ok: true, ids: [...new Set(r.rows.map((x) => x.id))] };
    }
    const where = `Allocation_Status = 'Issued'${audience === "farm" ? ` and LLP = '${llpId}'` : ""}`;
    const a = await pagedSelect(deps.crm, cred, ["id", "Customer"], ALLOTMENTS_MODULE, where, "id asc", signal, deps.maxPages);
    if (!a.ok) return { ok: false, out: a.kind === "refused" ? zohoFail("source-invalid") : zohoFail(a.errorKind) };
    if (a.truncated) return { ok: false, out: refuse(cred.userId, "update-publish", "segment-too-large") };
    const customers = [...new Set(a.rows.map((x) => idOf(x.Customer)).filter((x): x is string => !!x))];
    const ids = new Set<string>();
    for (let i = 0; i < customers.length; i += IN_CHUNK) {
      const clause = inClause("id", customers.slice(i, i + IN_CHUNK));
      if (!clause) continue;
      let r;
      try { r = await deps.crm.coql(cred, `select id from Contacts where (${bookWhere}) and ${clause} order by id asc limit 0, ${IN_CHUNK}`, { signal }); } catch { return { ok: false, out: zohoFail("unexpected") }; }
      if (!r.ok) return { ok: false, out: zohoFail(r.error.kind) };
      for (const x of r.value.records) if (RECORD_ID.test(x.id)) ids.add(x.id);
    }
    return { ok: true, ids: [...ids] };
  }

  return Object.freeze({
    /** The updates as published, newest first, and what this seat may do on the page. */
    async list(p: UpdatesPrincipal, signal?: AbortSignal): Promise<Result<{ readonly rows: readonly UpdateRow[]; readonly truncated: boolean; readonly readOnly: boolean; readonly kinds: readonly UpdateKind[] }>> {
      const r = await pagedSelect(deps.crm, p.credential, UPDATE_FIELDS, UPDATES_MODULE, "id is not null", "Published_At desc", signal, deps.maxPages);
      if (!r.ok) return r.kind === "refused" ? zohoFail("source-invalid") : zohoFail(r.errorKind);
      const kinds = kindsFor(rightsOf(p.seat, p.credential.userId));
      return { ok: true, rows: Object.freeze(r.rows.map(updateOf).filter((x): x is UpdateRow => x !== null)), truncated: r.truncated, readOnly: kinds.length === 0, kinds };
    },

    async publish(p: UpdatesPrincipal, input: PublishInput, signal?: AbortSignal): Promise<Result<{
      readonly row: UpdateRow; readonly predicate: string; readonly count: number; readonly pushed: { readonly queued: number; readonly refused: number };
    }>> {
      const me = p.credential.userId;
      const kinds = kindsFor(rightsOf(p.seat, me));
      if (!kinds.length) return refuse(me, "update-publish", "read-only");
      const headline = text(input.headline, 120);
      const body = text(input.body, 50_000);
      const kind = (KINDS as readonly unknown[]).includes(input.kind) ? (input.kind as UpdateKind) : null;
      const audience = (AUDIENCES as readonly unknown[]).includes(input.audience) ? (input.audience as Audience) : null;
      const llpId = audience === "farm" ? (typeof input.llpId === "string" && RECORD_ID.test(input.llpId) ? input.llpId : null) : null;
      if (!headline || !body || !kind || !audience || (audience === "farm" && !llpId)) return refuse(me, "update-publish", "invalid-request");
      if (!kinds.includes(kind)) return refuse(me, "update-publish", "kind-not-yours");
      if (audience === "nri") return refuse(me, "update-publish", "audience-not-in-zoho");
      if (identityPaths({ headline, body }).length) return refuse(me, "update-publish", "identity-in-text");
      const bookWhere = contactsWhere(scopesFor(p.seat, me).investors);
      if (!bookWhere) return refuse(me, "update-publish", "no-book");

      const seg = await resolve(p.credential, bookWhere, audience, llpId, signal);
      if (!seg.ok) return seg.out;
      if (!seg.ids.length) return refuse(me, "update-publish", "empty-segment", llpId ? [llpId] : []);

      const now = clock();
      const fields: ZohoFields = {
        Name: headline, Category: CATEGORY_OF[kind], Audience: AUDIENCE_VALUE[audience], Body: body,
        Published_At: istIso(now), Published_By: { id: me }, Sent_Count: seg.ids.length,
        ...(llpId ? { LLP: { id: llpId } } : {}),
      };
      let ins;
      try { ins = await deps.crm.insert(p.credential, UPDATES_MODULE, [fields], { signal }); } catch { return zohoFail("unexpected"); }
      if (!ins.ok) return zohoFail(ins.error.kind);
      const o = ins.value[0];
      if (!o || !o.ok || !o.id) return zohoFail("partial");

      let queued = 0, refused = 0;
      if (deps.push) {
        for (const contactId of seg.ids) {
          try {
            const r = await deps.push(updatePublished({ updateId: o.id, contactId, headline, kind, body, byUserId: me, at: now }, clock));
            if (r.ok) queued++; else refused++;
          } catch { refused++; }
        }
      }
      const row: UpdateRow = Object.freeze({
        id: o.id, t: headline, kind, on: istIso(now).slice(0, 16), by: me, byName: null, to: audience, toText: AUDIENCE_TEXT[audience],
        llp: llpId ? Object.freeze({ id: llpId, name: null }) : null, n: seg.ids.length, delivered: null, d: body,
      });
      return { ok: true, row, predicate: predicateOf(bookWhere, audience, llpId), count: seg.ids.length, pushed: { queued, refused } };
    },
  });
}
export type InvestorUpdates = ReturnType<typeof createInvestorUpdates>;
