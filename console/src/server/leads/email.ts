/**
 * M07-S05-T02 — the email composer's Send, through Zoho CRM's send_mail on the signed-in person's own token.
 *
 * Send is the approval (D60): nothing leaves before this call, and it leaves from the sender's own
 * mailbox (their primary address on the org's domain), to the lead's own address only, so Zoho files it
 * on the Lead's Emails list. Before anything is sent the server re-reads the lead and refuses when the
 * seat cannot work it (owner, secondary owner, active cover or team, as the follow-up writer decides),
 * when the lead changed since the composer opened, is closed as lost, has no email permission, or the
 * template needs the NDA back and it is not.
 *
 * After Zoho accepts, the touch is recorded ONCE through the follow-up writer (D76): channel Email,
 * "Email approved and sent — From <me> via Zoho · “<subject>”". A mail cannot be unsent, so when the
 * touch then fails the answer is still "sent", with a Plane B line naming the lead for repair and a
 * notice to log the contact by hand (jev decide: a, 0.94 — PROVISIONAL).
 *
 * Plane B (the ops log) gets ids and reason codes only: never the subject, message, or any address.
 */

import type { FromAddress, UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailure, ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { LEADS_MODULE } from "./capture";
import type { FollowupAccessAuthority, FollowupCommand, createFollowups } from "./followup";

/** Product limits, tighter than send_mail's own. */
export const EMAIL_MAX_SUBJECT = 200;
export const EMAIL_MAX_MESSAGE = 20_000;
export const EMAIL_OUTCOME = "Email approved and sent";
export const NURTURE_STEP = "Nurture — check back";
const NURTURE_DAYS = 3;

/** The composer's templates (prototype EMTPL). Deck and webinar carry material, so they wait for the NDA (EMMAT, D60). */
export const EMAIL_TEMPLATES: Readonly<Record<string, { readonly title: string; readonly needsNda: boolean }>> = Object.freeze({
  intro: { title: "Introduction", needsNda: false },
  deck: { title: "Deck follow-up", needsNda: true },
  webinar: { title: "Webinar invite", needsNda: true },
  paper: { title: "Paperwork reminder", needsNda: false },
  balance: { title: "Balance reminder", needsNda: false },
});

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const MAIL = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
const DOMAIN = /^[a-z0-9.-]{1,253}\.[a-z]{2,63}$/;
const LEAD_FIELDS = ["Modified_Time", "Owner", "Secondary_Owner", "Cover_By", "Cover_Until", "Lost_At", "Email", "Consent_Email",
  "Email_Opt_Out", "Full_Name", "Next_Step_At", "Next_Step_Channel"] as const;

/** Whether the lead's NDA is back signed (Zoho Sign → the lead). Absent → deck and webinar stay shut. */
export interface NdaReader {
  signed(credential: UserCredential, leadId: string, signal?: AbortSignal): Promise<boolean>;
}

export interface EmailCommand {
  readonly leadId: string;
  /** The lead's Modified_Time as the composer loaded it. */
  readonly expectedModifiedTime: string;
  readonly template: string;
  readonly subject: string;
  readonly message: string;
  /** The recipient the composer showed; must be the lead's own address. */
  readonly to?: string;
  /** The open next-step activity the page showed, if any (completed when the email was that step). */
  readonly scheduled?: { readonly module: "Tasks" | "Calls" | "Events"; readonly id: string } | null;
}

export type EmailRefusal = "invalid-request" | "empty" | "too-long" | "unknown-template" | "nda-not-back" | "session-changed"
  | "capability-missing" | "not-visible" | "not-in-book" | "lead-changed" | "lead-lost" | "no-email" | "no-consent"
  | "recipient-changed" | "no-org-address" | "sending" | "daily-limit" | "zoho-consent" | "not-sent" | "send-unconfirmed";

export type EmailResult =
  | { readonly ok: true; readonly value: { readonly sent: true; readonly messageId: string | null; readonly from: string;
      readonly touchRecorded: boolean; readonly touchId: string | null; readonly notice: string } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: EmailRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export const EMAIL_REASON: Readonly<Record<EmailRefusal, string>> = Object.freeze({
  "invalid-request": "Not sent — the email is incomplete.",
  "empty": "Add a subject and a message.",
  "too-long": `Not sent — keep the subject under ${EMAIL_MAX_SUBJECT} characters and the message under ${EMAIL_MAX_MESSAGE}.`,
  "unknown-template": "Not sent — choose one of the templates.",
  "nda-not-back": "Deck goes after the NDA is signed.",
  "session-changed": "Not sent — the sign-in session changed.",
  "capability-missing": "Not sent — this seat cannot send email to investors.",
  "not-visible": "Not sent — the lead is unavailable.",
  "not-in-book": "Not sent — this lead is not yours to work (not the owner, and no active cover).",
  "lead-changed": "Not sent — the lead changed in Zoho since it was opened. Review it and send again.",
  "lead-lost": "Not sent — this lead is closed as lost.",
  "no-email": "Not sent — this investor has no email address.",
  "no-consent": "This investor has not given email permission, or has no email address.",
  "recipient-changed": "Not sent — the address on the lead is not the one shown. Reopen the composer.",
  "no-org-address": "Not sent — Zoho has no mailbox for you on the company domain. Ask Digital Infrastructure to set it up.",
  "sending": "Already sending this email.",
  "daily-limit": "Not sent — Zoho's daily email limit is reached. Try again tomorrow.",
  "zoho-consent": "Not sent — Zoho refused: this address has opted out or has no email consent in Zoho.",
  "not-sent": "Not sent — Zoho refused the email.",
  "send-unconfirmed": "Zoho did not confirm the send. Check the lead's Emails list in Zoho before sending again.",
});

export interface EmailDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "sendMail" | "fromAddresses">;
  readonly followups: Pick<ReturnType<typeof createFollowups>, "save">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** The org's mail domains (lower case), e.g. ["agresearchlabs.com"]. The sender's address must be on one. */
  readonly orgDomains: readonly string[];
  readonly nda?: NdaReader | null;
  readonly clock?: () => number;
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const codeOf = (f: ZohoFailure): string => ("code" in f && typeof f.code === "string" ? f.code : "").toUpperCase();

export function createEmailSender(deps: EmailDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.sendMail !== "function" || typeof deps.crm?.fromAddresses !== "function"
    || typeof deps.followups?.save !== "function" || typeof deps.access?.recheck !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)
    || !Array.isArray(deps.orgDomains) || !deps.orgDomains.length || !deps.orgDomains.every((d) => typeof d === "string" && DOMAIN.test(d))) {
    throw new TypeError("The email sender needs crm getRecord/sendMail/fromAddresses, the follow-up writer, the access authority, the ops log, the record-id prefix and the org mail domains.");
  }
  const { crm, access, log, followups } = deps;
  const clock = deps.clock ?? Date.now;
  const domains = new Set(deps.orgDomains);
  const inFlight = new Set<string>();
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, code: EmailRefusal, ids: readonly string[] = []): EmailResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-email", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: EMAIL_REASON[code] };
  };
  const zoho = (k: ZohoFailureKind | "unexpected", retryable = false): EmailResult => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable });

  async function send(principal: { credential: UserCredential; sessionId: string }, c: EmailCommand, signal?: AbortSignal): Promise<EmailResult> {
    if (!principal || !isUserCredential(principal.credential) || !validId(principal.credential.userId)
      || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) return refuse("unrecognised", "invalid-request");
    const cred = principal.credential, me = cred.userId;
    // ---- shape (nothing reaches Zoho until it is right)
    const lead = c && validId(c.leadId) ? c.leadId : null;
    if (!c || !lead || typeof c.expectedModifiedTime !== "string" || !DATETIME.test(c.expectedModifiedTime)
      || typeof c.subject !== "string" || typeof c.message !== "string" || typeof c.template !== "string"
      || (c.to !== undefined && typeof c.to !== "string")
      || (c.scheduled !== undefined && c.scheduled !== null && (typeof c.scheduled !== "object"
        || !["Tasks", "Calls", "Events"].includes(c.scheduled.module) || !validId(c.scheduled.id)))) return refuse(me, "invalid-request", lead ? [lead] : []);
    const subject = c.subject.trim(), message = c.message.trim();
    if (!subject || !message) return refuse(me, "empty", [lead]);
    if (subject.length > EMAIL_MAX_SUBJECT || c.message.length > EMAIL_MAX_MESSAGE) return refuse(me, "too-long", [lead]);
    if (/[\r\n]/.test(subject)) return refuse(me, "invalid-request", [lead]);
    const tpl = Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, c.template) ? EMAIL_TEMPLATES[c.template]! : null;
    if (!tpl) return refuse(me, "unknown-template", [lead]);

    const key = `${me}|${lead}`;
    if (inFlight.has(key)) return refuse(me, "sending", [lead]);
    inFlight.add(key);
    try {
      // ---- who is asking, now
      let a: Awaited<ReturnType<FollowupAccessAuthority["recheck"]>>;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== me) return refuse(me, "session-changed", [lead]);
      if (!a.mayRecordFollowup) return refuse(me, "capability-missing", [lead]);

      // ---- the lead as it is now
      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try { got = await crm.getRecord(cred, LEADS_MODULE, lead, { fields: LEAD_FIELDS, signal }); } catch { return zoho("unexpected"); }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [lead]) : zoho(got.error.kind);
      if (!got.value || got.value.id !== lead) return refuse(me, "not-visible", [lead]);
      const L = got.value as ZohoRecord;
      const owner = idOf(L.Owner), today = zohoTime(clock()).slice(0, 10);
      const inBook = owner === me || idOf(L.Secondary_Owner) === me
        || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
        || (owner !== null && a.teamOwnerIds.includes(owner));
      if (!inBook) return refuse(me, "not-in-book", [lead]);
      if (L.Modified_Time !== c.expectedModifiedTime) return refuse(me, "lead-changed", [lead]);
      if (L.Lost_At) return refuse(me, "lead-lost", [lead]);
      const to = typeof L.Email === "string" ? L.Email.trim() : "";
      if (!to || !MAIL.test(to)) return refuse(me, "no-email", [lead]);
      if (L.Consent_Email !== true || L.Email_Opt_Out === true) return refuse(me, "no-consent", [lead]);
      if (c.to !== undefined && c.to.trim().toLowerCase() !== to.toLowerCase()) return refuse(me, "recipient-changed", [lead]);
      if (tpl.needsNda) {
        let signed = false;
        try { signed = deps.nda ? (await deps.nda.signed(cred, lead, signal)) === true : false; } catch { signed = false; }
        if (!signed) return refuse(me, "nda-not-back", [lead]);
      }

      // ---- from: the sender's own primary mailbox on the org's domain
      let addrs: Awaited<ReturnType<typeof crm.fromAddresses>>;
      try { addrs = await crm.fromAddresses(cred, { signal }); } catch { return zoho("unexpected"); }
      if (!addrs.ok) return zoho(addrs.error.kind);
      const onOrg = (x: FromAddress) => domains.has(x.email.slice(x.email.lastIndexOf("@") + 1).toLowerCase());
      const from = addrs.value.find((x) => x.type === "primary" && onOrg(x)) ?? null;
      if (!from) return refuse(me, "no-org-address", [lead]);

      // ---- send (never retried: a mail may have left)
      let sent: Awaited<ReturnType<typeof crm.sendMail>>;
      try {
        sent = await crm.sendMail(cred, LEADS_MODULE, lead, {
          from: from.userName ? { email: from.email, userName: from.userName } : { email: from.email },
          to: [typeof L.Full_Name === "string" && L.Full_Name.trim() && L.Full_Name.length <= 200 ? { email: to, userName: L.Full_Name.trim() } : { email: to }],
          subject, content: message, format: "text",
        }, { signal });
      } catch { return refuse(me, "send-unconfirmed", [lead]); }
      if (!sent.ok) {
        const f = sent.error, code = codeOf(f);
        // ponytail: send_mail's limit and consent codes are undocumented; matched by word until the sandbox shows them.
        if (/LIMIT|EXCEED/.test(code) && f.kind !== "concurrency-exceeded") return refuse(me, "daily-limit", [lead]);
        if (/CONSENT|OPT(?:ED)?_?OUT|UNSUBSCRI|BLOCK/.test(code)) return refuse(me, "zoho-consent", [lead]);
        if (f.kind === "server" || f.kind === "network" || f.kind === "aborted" || f.kind === "unexpected") return refuse(me, "send-unconfirmed", [lead]);
        if (f.kind === "auth-expired" || f.kind === "auth-rejected" || f.kind === "busy" || f.kind === "concurrency-exceeded"
          || f.kind === "rate-limited-unclassified" || f.kind === "credits-exhausted") return zoho(f.kind, f.kind === "busy" || f.kind === "concurrency-exceeded");
        return refuse(me, "not-sent", [lead]);
      }

      // ---- the touch, once, through the follow-up writer
      const now = clock();
      let modified = c.expectedModifiedTime;
      try {
        const again = await crm.getRecord(cred, LEADS_MODULE, lead, { fields: ["Modified_Time"], signal });
        if (again.ok && again.value && typeof again.value.Modified_Time === "string" && DATETIME.test(again.value.Modified_Time)) modified = again.value.Modified_Time;
      } catch { /* keep the loaded one; the writer refuses if it moved */ }
      const planned = typeof L.Next_Step_At === "string" && L.Next_Step_At !== "";
      const keep = planned && L.Next_Step_Channel !== "Email";
      const scheduled = c.scheduled ?? null;
      const cmd: FollowupCommand = {
        leadId: lead, expectedModifiedTime: modified,
        contact: { channel: "email", outcome: EMAIL_OUTCOME, occurredAt: zohoTime(now), reached: true,
          note: `From ${from.email} via Zoho · “${subject}”`.slice(0, 1_800) },
        scheduled, keep, complete: !keep && !!scheduled,
        next: keep ? null : { text: NURTURE_STEP, at: zohoTime(now + NURTURE_DAYS * 86_400_000), channel: "other" },
      };
      let saved: Awaited<ReturnType<typeof followups.save>> | null = null;
      try { saved = await followups.save(principal, cmd, signal); } catch { saved = null; }
      const messageId = sent.value.messageId;
      if (!saved || !saved.ok) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "lead-email", reason: "touch-not-recorded", recordIds: [lead] });
        return { ok: true, value: { sent: true, messageId, from: from.email, touchRecorded: false, touchId: null,
          notice: "Email sent. The contact could not be recorded — add it with 'Log a contact'." } };
      }
      return { ok: true, value: { sent: true, messageId, from: from.email, touchRecorded: true, touchId: saved.value.touchId, notice: "Email sent" } };
    } finally {
      inFlight.delete(key);
    }
  }

  return Object.freeze({ send });
}
