/**
 * M13-S03-T02 — CASE WRITES: open a ticket, park it waiting on the investor, close it, and reply to the
 * investor (D12, D45, D48, D53). One guarded write unit per action ("commit()" on the server): every guard
 * runs before Zoho is touched, the write goes on the person's own token, a conditional PUT carries
 * If-Unmodified-Since (D44: someone else's newer change is never overwritten), and the cached cuts are
 * dropped only once Zoho said yes. Nothing about the ticket is stored in the console (D45).
 *
 * Guards (prototype moveTicket / mayTkt / newTicket, the rights in lib/im ROLE via ./rights):
 *   - the seat must hold `tkt`; the Auditor and every viewer are read only
 *   - Account Management works its own tickets: a KAM (own-book) may move or answer only a Case whose
 *     Owner is them; a Head of AM only their subtree (their token under the role hierarchy when no subtree
 *     reader is wired, as the register reads). Refused in-page, and one Plane B line by id.
 *   - a Bank ticket is moved only by a seat holding `bank` (Finance Operations, Head of Finance)
 *   - a ticket is opened only on an investor in the person's own investors book; owned by someone else
 *     only with `assign`
 * A reply is written as a Note on the Case, then pushed to the investor app as case.replied through the
 * M13-S01 outbox (closing M13-S01's gap); an identity value in the text is refused before either.
 *
 * Field names are the org as found (read-only getFields, 28 Sep 2026): Related_To (→ Contacts),
 * Ticket_Category Bank/Query/Records/Access/Compliance, Status New/Escalated/On Hold/Closed, Priority
 * High/Medium/Low, Case_Origin Email/Phone/Web, SLA_Due and Closed_At datetimes. "waiting" is On Hold.
 */

import type { ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { conflictOf } from "../data/events";
import { contactsWhere } from "../data/ir-guard";
import { scopesFor } from "../data/scope";
import { caseReplied, identityPaths } from "../contracts/outbox";
import { idOf, RECORD_ID, str } from "./predicate";
import { CASE_FIELDS, CASES_MODULE, caseOf, READ_ONLY_SEATS, type CaseRow } from "./register";
import { imRightsOf, type ImRights } from "./rights";

export const CATEGORIES = Object.freeze(["Bank", "Query", "Records", "Access", "Compliance"] as const);
export type CaseCategory = (typeof CATEGORIES)[number];
export type CaseMove = "waiting" | "closed";
const STATUS_OF: Readonly<Record<CaseMove, string>> = Object.freeze({ waiting: "On Hold", closed: "Closed" });
const ORIGINS = Object.freeze(["Email", "Phone"] as const);
/** Working days to the SLA (prototype newTicket: high 2, normal 5). */
export const SLA_DAYS = Object.freeze({ high: 2, normal: 5 });
const ZOHO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const IST_MS = 5.5 * 3_600_000;

export type RefusalReason =
  | "read-only" | "not-yours" | "bank-seat" | "not-found" | "invalid-request" | "not-in-book" | "cannot-assign" | "identity-in-reply" | "no-book";

export const REFUSAL_TEXT: Readonly<Record<RefusalReason, string>> = Object.freeze({
  "read-only": "This seat reads tickets; it does not work them.",
  "not-yours": "This ticket belongs to someone else. Account Management works its own tickets — a compliance or money ticket is closed by the seat that can actually do the work, not by whoever opened the screen.",
  "bank-seat": "A bank ticket needs a fresh name match before anything is done with it, so it belongs to a seat that can see the account — Finance Operations or the Head of Finance.",
  "not-found": "Not found, or not yours to open.",
  "invalid-request": "That ticket is missing something: an investor, a category from the list and what they want.",
  "not-in-book": "That investor is not in your book.",
  "cannot-assign": "Only a seat that assigns work can open a ticket in someone else's name.",
  "identity-in-reply": "The reply carries what looks like a PAN, Aadhaar or bank number. Those never go to the app; take it out and send again.",
  "no-book": "This page is not part of your seat.",
});

export type WriteResult<V> =
  | ({ readonly ok: true } & V)
  | { readonly ok: false; readonly kind: "refused"; readonly reason: RefusalReason; readonly message: string }
  | { readonly ok: false; readonly kind: "conflict"; readonly recordId: string | null; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface CaseWritesPrincipal { readonly credential: UserCredential; readonly seat: string }
export interface OpenInput {
  readonly investorId: unknown; readonly category: unknown; readonly subject: unknown; readonly description?: unknown;
  readonly priority?: unknown; readonly ownerId?: unknown; readonly origin?: unknown;
}
/** The push the reply goes through (server/contracts/runtime publishToInvestorApp). */
export type PushToApp = (event: Record<string, unknown>) => Promise<{ readonly ok: boolean; readonly eventId?: string; readonly state?: { readonly label: string; readonly status: string } }>;

export interface CaseWritesDeps {
  readonly crm: Pick<ZohoClient, "coql" | "insert" | "update">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  readonly push?: PushToApp;
  readonly rights?: (seat: string, userId: string) => ImRights;
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
  readonly clock?: () => number;
}

/** ISO in Asia/Kolkata with +05:30 (rule 9). */
export const istIso = (ms: number): string => `${new Date(ms + IST_MS).toISOString().slice(0, 19)}+05:30`;

/** `days` working days (Mon–Fri, IST calendar) after `now`, same clock time. Pure: exported for tests. */
export function slaDue(now: number, days: number): string {
  let t = now, left = days;
  while (left > 0) {
    t += 86_400_000;
    const dow = new Date(t + IST_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return istIso(t);
}

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

export function createCaseWrites(deps: CaseWritesDeps) {
  const clock = deps.clock ?? Date.now;
  const rightsOf = deps.rights ?? imRightsOf;

  const refuse = <V>(me: string, action: string, reason: RefusalReason, ids: readonly string[] = []): WriteResult<V> => {
    deps.events.refusal(me, action, reason, ids);
    return { ok: false, kind: "refused", reason, message: REFUSAL_TEXT[reason] };
  };
  const zohoFail = <V>(kind: string): WriteResult<V> => ({ ok: false, kind: "source-error", errorKind: kind, retryable: retryable(kind) });

  /** Every scope's cached cuts are stale once a Case moved (they are one group-by per scope). */
  async function dropCuts(): Promise<void> {
    await Promise.all(["org", "own-book", "subtree", "all"].map((k) => deps.cache.invalidate({ prefix: `${k}.cases.` }).catch(() => 0)));
  }

  async function readCase(cred: UserCredential, id: string, signal?: AbortSignal):
    Promise<{ ok: true; rec: ZohoRecord | null } | { ok: false; kind: string }> {
    try {
      const r = await deps.crm.coql(cred, `select ${[...CASE_FIELDS, "Modified_Time"].join(", ")} from ${CASES_MODULE} where id = '${id}' limit 0, 1`, { signal });
      if (!r.ok) return { ok: false, kind: r.error.kind };
      return { ok: true, rec: r.value.records[0] ?? null };
    } catch { return { ok: false, kind: "unexpected" }; }
  }

  /** The guards shared by move and reply: may this person work this Case at all? */
  async function mayWork(p: CaseWritesPrincipal, action: string, id: unknown, signal?: AbortSignal):
    Promise<{ ok: true; rec: ZohoRecord; row: CaseRow; rights: ImRights } | { ok: false; out: WriteResult<never> }> {
    const me = p.credential.userId;
    const rights = rightsOf(p.seat, me);
    if (!rights.tkt || READ_ONLY_SEATS.has(p.seat)) return { ok: false, out: refuse(me, action, "read-only") };
    if (typeof id !== "string" || !RECORD_ID.test(id)) return { ok: false, out: refuse(me, action, "invalid-request") };
    const scope = scopesFor(p.seat, me).cases;
    if (scope.kind === "none") return { ok: false, out: refuse(me, action, "no-book") };
    const got = await readCase(p.credential, id, signal);
    if (!got.ok) return { ok: false, out: zohoFail(got.kind) };
    const row = got.rec ? caseOf(got.rec) : null;
    if (!got.rec || !row) return { ok: false, out: refuse(me, action, "not-found", [id]) };
    if (scope.kind === "own-book" && row.own !== me) return { ok: false, out: refuse(me, action, "not-yours", [id]) };
    if (scope.kind === "subtree" && deps.subtreeOf) {
      const team = await deps.subtreeOf(scope.managerId, signal);
      if (team && ![scope.managerId, ...team].includes(row.own)) return { ok: false, out: refuse(me, action, "not-yours", [id]) };
    }
    return { ok: true, rec: got.rec, row, rights };
  }

  return Object.freeze({
    /** Open a ticket for an investor in the person's book. Owner = the person unless they may assign. */
    async open(p: CaseWritesPrincipal, input: OpenInput, signal?: AbortSignal): Promise<WriteResult<{ readonly row: CaseRow }>> {
      const me = p.credential.userId;
      const rights = rightsOf(p.seat, me);
      if (!rights.tkt || READ_ONLY_SEATS.has(p.seat)) return refuse(me, "case-open", "read-only");
      const inv = typeof input.investorId === "string" && RECORD_ID.test(input.investorId) ? input.investorId : null;
      const cat = (CATEGORIES as readonly unknown[]).includes(input.category) ? (input.category as CaseCategory) : null;
      const subject = text(input.subject, 255);
      const description = input.description === undefined || input.description === "" ? "" : text(input.description, 2000);
      const pri = input.priority === undefined || input.priority === "normal" ? "normal" : input.priority === "high" ? "high" : null;
      const origin = input.origin === undefined ? "Phone" : (ORIGINS as readonly unknown[]).includes(input.origin) ? (input.origin as string) : null;
      const owner = input.ownerId === undefined || input.ownerId === null ? me : typeof input.ownerId === "string" && RECORD_ID.test(input.ownerId) ? input.ownerId : null;
      if (!inv || !cat || !subject || description === null || !pri || !origin || !owner) return refuse(me, "case-open", "invalid-request");
      if (owner !== me && !rights.assign) return refuse(me, "case-open", "cannot-assign");
      const where = contactsWhere(scopesFor(p.seat, me).investors);
      if (!where) return refuse(me, "case-open", "no-book");
      let seen;
      try { seen = await deps.crm.coql(p.credential, `select id from Contacts where (${where}) and id = '${inv}' limit 0, 1`, { signal }); } catch { return zohoFail("unexpected"); }
      if (!seen.ok) return zohoFail(seen.error.kind);
      if (!seen.value.records.some((r) => r.id === inv)) return refuse(me, "case-open", "not-in-book", [inv]);
      const now = clock();
      const fields: ZohoFields = {
        Subject: subject, Description: description, Related_To: { id: inv }, Owner: { id: owner },
        Priority: pri === "high" ? "High" : "Medium", Status: "New", Case_Origin: origin, Ticket_Category: cat,
        SLA_Due: slaDue(now, SLA_DAYS[pri]),
      };
      let ins;
      try { ins = await deps.crm.insert(p.credential, CASES_MODULE, [fields], { signal }); } catch { return zohoFail("unexpected"); }
      if (!ins.ok) return zohoFail(ins.error.kind);
      const o = ins.value[0];
      if (!o || !o.ok || !o.id) return zohoFail(o?.code === "INVALID_DATA" ? "invalid-data" : "partial");
      await dropCuts();
      // Read the new Case back for Zoho's own number and stamps; if that read fails the ticket still exists.
      const back = await readCase(p.credential, o.id, signal);
      const row = back.ok && back.rec ? caseOf(back.rec) : null;
      return {
        ok: true,
        row: row ?? Object.freeze({
          id: o.id, number: null, inv, t: subject, cat, opened: istIso(now).slice(0, 16), by: "staff" as const, own: owner,
          pri, state: "open" as const, d: description, sla: String(fields.SLA_Due).slice(0, 16),
        }),
      };
    },

    /** Park a ticket waiting on the investor, or close it. `expectedModifiedTime` is what the screen loaded. */
    async move(p: CaseWritesPrincipal, id: unknown, to: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal):
      Promise<WriteResult<{ readonly row: CaseRow; readonly already: boolean; readonly modifiedTime: string | null }>> {
      const me = p.credential.userId;
      if (to !== "waiting" && to !== "closed") return refuse(me, "case-move", "invalid-request");
      if (expectedModifiedTime !== undefined && expectedModifiedTime !== null && (typeof expectedModifiedTime !== "string" || !ZOHO_DT.test(expectedModifiedTime))) {
        return refuse(me, "case-move", "invalid-request");
      }
      const w = await mayWork(p, "case-move", id, signal);
      if (!w.ok) return w.out;
      if (w.row.cat === "Bank" && !w.rights.bank) return refuse(me, "case-move", "bank-seat", [w.row.id]);
      const modified = str(w.rec, "Modified_Time", 40);
      if (w.row.state === to) return { ok: true, row: w.row, already: true, modifiedTime: modified };
      const expect = typeof expectedModifiedTime === "string" ? expectedModifiedTime : modified;
      if (typeof expectedModifiedTime === "string" && modified && Date.parse(modified) !== Date.parse(expectedModifiedTime)) {
        deps.events.conflict(me, "case-move", w.row.id);
        return { ok: false, kind: "conflict", recordId: w.row.id, reason: "Someone else changed this ticket after you opened it. Their change is kept; reload to see it, then make yours again." };
      }
      const now = clock();
      const fields: ZohoFields = to === "closed" ? { Status: STATUS_OF.closed, Closed_At: istIso(now) } : { Status: STATUS_OF.waiting };
      let put;
      try { put = await deps.crm.update(p.credential, CASES_MODULE, w.row.id, fields, { ifUnmodifiedSince: expect ?? null, signal }); } catch { return zohoFail("unexpected"); }
      if (!put.ok) {
        const c = conflictOf(deps.events, me, "case-move", put.error);
        return c ? { ok: false, kind: "conflict", recordId: c.recordId, reason: c.reason } : zohoFail(put.error.kind);
      }
      await dropCuts();
      const row: CaseRow = Object.freeze({ ...w.row, state: to, ...(to === "closed" ? { closed: istIso(now).slice(0, 16) } : {}) });
      return { ok: true, row, already: false, modifiedTime: put.value.modifiedTime };
    },

    /**
     * Answer the investor on a ticket: a Note on the Case (the thread of record in Zoho), then case.replied
     * to the investor app. The reply is kept even if the push waits: delivery reads "Not delivered yet".
     */
    async reply(p: CaseWritesPrincipal, id: unknown, message: unknown, signal?: AbortSignal):
      Promise<WriteResult<{ readonly caseId: string; readonly noteId: string; readonly delivery: { readonly eventId: string | null; readonly label: string } }>> {
      const me = p.credential.userId;
      const msg = text(message, 2000);
      if (!msg) return refuse(me, "case-reply", "invalid-request");
      if (identityPaths(msg).length) return refuse(me, "case-reply", "identity-in-reply", typeof id === "string" && RECORD_ID.test(id) ? [id] : []);
      const w = await mayWork(p, "case-reply", id, signal);
      if (!w.ok) return w.out;
      const contact = idOf(w.rec.Related_To);
      if (!contact) return refuse(me, "case-reply", "not-found", [w.row.id]);
      let ins;
      try {
        ins = await deps.crm.insert(p.credential, "Notes", [{
          Note_Title: "Reply to the investor", Note_Content: msg, Parent_Id: { module: { api_name: CASES_MODULE }, id: w.row.id },
        }], { signal });
      } catch { return zohoFail("unexpected"); }
      if (!ins.ok) return zohoFail(ins.error.kind);
      const o = ins.value[0];
      if (!o || !o.ok || !o.id) return zohoFail("partial");
      let delivery: { eventId: string | null; label: string } = { eventId: null, label: "Not delivered yet" };
      if (deps.push) {
        try {
          const r = await deps.push(caseReplied({ caseId: w.row.id, contactId: contact, message: msg, byUserId: me, at: clock() }, clock));
          delivery = { eventId: r.eventId ?? null, label: r.ok && r.state ? r.state.label : "Not delivered — needs attention" };
        } catch { delivery = { eventId: null, label: "Not delivered — needs attention" }; }
      }
      return { ok: true, caseId: w.row.id, noteId: o.id, delivery };
    },
  });
}
export type CaseWrites = ReturnType<typeof createCaseWrites>;
