/**
 * M12-S09-T01 — A RECORD'S EMAILS, READ THROUGH ZOHO CRM ON THE VIEWER'S OWN TOKEN (D17, D45, D53, D69, D72).
 *
 *   list(kind, id)            GET /{module}/{id}/Emails            sender, recipients, subject, time — no body
 *   open(kind, id, messageId) GET /{module}/{id}/Emails/{message_id}  the one email with its content, read-only
 *
 * Before Zoho is asked, the record is admitted the way its page is:
 *   investor  (Contacts)  the one Investors-side choke point, ir-guard `one`: an IR only when the investor came from
 *                         their own lead (D69), a KAM only their own book, org seats all; anything else refused.
 *   allotment             its Customer is read on the viewer's token and admitted by the same `one`.
 *   lead      (Leads)     the lead-side book: the owner or a live cover (IR, channel partner; IR Manager PROVISIONAL
 *                         as server/leads/email-runtime), every lead for DI; Investors-side seats have no lead emails.
 * Zoho then applies the viewer's own profile and sharing: what Zoho hides is not in its answer, so not in ours; a
 * record Zoho will not open (403/404) is an in-page refusal, never "no emails".
 *
 * Nothing is kept: no cache of lists or bodies (per scope or otherwise), `Cache-Control: no-store` on the route,
 * and Plane B carries the actor, the endpoint template, the status and the record id — never a subject, an
 * address or a body (the client never logs them; refusals here log ids and a reason code).
 */

import type { EmailContent, EmailLine, UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { idOf } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { createInvestorGuard, type PlaneCRefusal } from "../data/ir-guard";
import { MODULES } from "../data/projections";
import { scopesFor } from "../data/scope";

export type EmailRecordKind = "lead" | "investor" | "allotment";
export const EMAIL_MODULE: Readonly<Record<EmailRecordKind, string>> = Object.freeze({
  lead: "Leads", investor: MODULES.contacts, allotment: MODULES.allotments,
});
const RECORD_ID = /^\d{15,22}$/;
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const INDEX = /^[A-Za-z0-9_-]{1,200}$/;

export type EmailsRefusal = "invalid-request" | "seat-denied" | "not-in-book" | "not-visible" | "not-own-lead" | "no-origin";
export const EMAILS_MESSAGE: Readonly<Record<EmailsRefusal, string>> = Object.freeze({
  "invalid-request": "This record's emails cannot be opened.",
  "seat-denied": "Your seat does not show emails on this record.",
  "not-in-book": "This lead is not in your book, so its emails are not shown.",
  "not-visible": "You cannot open this record in Zoho, so its emails are not shown.",
  "not-own-lead": "This investor did not come from your lead, so their emails are not shown.",
  "no-origin": "This investor has no lead of yours on record, so their emails are not shown.",
});

export type EmailsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: EmailsRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface EmailsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "listEmails" | "getEmail">;
  readonly events: InvestorEvents;
  readonly log: OpsLog;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
  readonly clock?: () => number;
}

export function createRecordEmails(deps: EmailsDeps) {
  const clock = deps.clock ?? Date.now;
  const guard = createInvestorGuard({ events: deps.events, planeCRefusal: deps.planeCRefusal });
  const refused = (me: string, reason: EmailsRefusal, ids: readonly string[], logHere = true): EmailsResult<never> => {
    if (logHere) deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "record-emails", reason, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reason, message: EMAILS_MESSAGE[reason] };
  };
  const srcErr = (errorKind: string): EmailsResult<never> => ({ ok: false, kind: "source-error", errorKind });

  /** null = admitted; otherwise the answer to give. */
  async function admit(cred: UserCredential, seat: string, kind: EmailRecordKind, id: string, signal?: AbortSignal): Promise<EmailsResult<never> | null> {
    const me = cred.userId;
    const scopes = scopesFor(seat, me);
    if (kind === "lead") {
      const k = scopes.leads.kind;
      if (k === "all") return null;
      if (k !== "user" && k !== "subtree") return refused(me, "seat-denied", [id]);
      let r: Awaited<ReturnType<typeof deps.crm.getRecord>>;
      try { r = await deps.crm.getRecord(cred, "Leads", id, { fields: ["Owner", "Cover_By", "Cover_Until"], signal }); } catch { return srcErr("unexpected"); }
      if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? refused(me, "not-visible", [id]) : srcErr(r.error.kind);
      if (!r.value || r.value.id !== id) return refused(me, "not-visible", [id]);
      const today = new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      const mine = idOf(r.value.Owner) === me
        || (idOf(r.value.Cover_By) === me && typeof r.value.Cover_Until === "string" && r.value.Cover_Until >= today);
      return mine ? null : refused(me, "not-in-book", [id]);
    }
    if (scopes.investors.kind === "none") return refused(me, "seat-denied", [id]);
    let contactId = id;
    if (kind === "allotment") {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try { r = await deps.crm.coql(cred, `select id, Customer from ${MODULES.amAllotments} where id = '${id}' limit 0, 1`, { signal }); } catch { return srcErr("unexpected"); }
      if (!r.ok) return r.error.kind === "forbidden" ? refused(me, "not-visible", [id]) : srcErr(r.error.kind);
      const row = r.value.records.find((x) => x.id === id);
      const customer = row ? idOf(row.Customer) : null;
      if (!customer || !RECORD_ID.test(customer)) return refused(me, "not-visible", [id]);
      contactId = customer;
    }
    const one = await guard.one(deps.crm, cred, seat, contactId, signal, "record-emails");
    if (one.ok) return null;
    if (one.kind === "source-error") return srcErr(one.errorKind);
    // the guard has already logged its refusal (Plane B + Plane C hook)
    const reason: EmailsRefusal = one.reason === "invalid-request" ? "invalid-request" : one.reason;
    return refused(me, reason, [id], false);
  }

  const valid = (me: string, kind: unknown, id: unknown): EmailsResult<never> | null =>
    typeof kind === "string" && Object.hasOwn(EMAIL_MODULE, kind) && typeof id === "string" && RECORD_ID.test(id) ? null : refused(me, "invalid-request", []);

  return Object.freeze({
    async list(cred: UserCredential, seat: string, kind: EmailRecordKind, id: string, index?: string | null, signal?: AbortSignal)
      : Promise<EmailsResult<{ readonly emails: readonly EmailLine[]; readonly nextIndex: string | null }>> {
      const me = cred.userId;
      const bad = valid(me, kind, id);
      if (bad) return bad;
      if (index !== undefined && index !== null && (typeof index !== "string" || !INDEX.test(index))) return refused(me, "invalid-request", [id]);
      const a = await admit(cred, seat, kind, id, signal);
      if (a) return a;
      let r: Awaited<ReturnType<typeof deps.crm.listEmails>>;
      try { r = await deps.crm.listEmails(cred, EMAIL_MODULE[kind], id, { ...(index ? { index } : {}), signal }); } catch { return srcErr("unexpected"); }
      if (!r.ok) return r.error.kind === "forbidden" || r.error.kind === "not-found" ? refused(me, "not-visible", [id]) : srcErr(r.error.kind);
      return { ok: true, value: r.value };
    },

    async open(cred: UserCredential, seat: string, kind: EmailRecordKind, id: string, messageId: string, ownerId?: string | null, signal?: AbortSignal)
      : Promise<EmailsResult<EmailContent>> {
      const me = cred.userId;
      const bad = valid(me, kind, id);
      if (bad) return bad;
      if (typeof messageId !== "string" || !MESSAGE_ID.test(messageId)) return refused(me, "invalid-request", [id]);
      if (ownerId !== undefined && ownerId !== null && (typeof ownerId !== "string" || !RECORD_ID.test(ownerId))) return refused(me, "invalid-request", [id]);
      const a = await admit(cred, seat, kind, id, signal);
      if (a) return a;
      let r: Awaited<ReturnType<typeof deps.crm.getEmail>>;
      try { r = await deps.crm.getEmail(cred, EMAIL_MODULE[kind], id, messageId, { ...(ownerId ? { ownerId } : {}), signal }); } catch { return srcErr("unexpected"); }
      if (!r.ok) return r.error.kind === "forbidden" || r.error.kind === "not-found" ? refused(me, "not-visible", [id]) : srcErr(r.error.kind);
      if (!r.value) return refused(me, "not-visible", [id]);
      return { ok: true, value: r.value };
    },
  });
}
export type RecordEmails = ReturnType<typeof createRecordEmails>;
