/* M12-S09-W1 — a record's emails (D72), read on the viewer's own token, never cached, never written:
     GET /api/emails/{lead|investor|allotment}/{id}                     the list — sender, subject, time (no body)
     GET /api/emails/{kind}/{id}/{messageId}?owner={ownerId}            one email with its content
   A record the seat cannot open answers 403 and the page shows its in-page refusal (nothing was read).
   Fixture: the same lines projected from the demo book's record emails (RecEmail), through the same wall the
   book's selectors already apply (investorEmails: an IR sees an investor's emails only for their own lead, D69). */

import type { EmailContent, EmailLine, EmailPage } from "@/lib/zoho/client";
import { investorEmails, leadEmails, type ImState, type RecEmail } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint } from "../api";

export type EmailKind = "lead" | "investor" | "allotment";
/** What the fixture half reads: the Investors book, who is signed in, and the lead side's own mail (LEADMAIL). */
export type EmailBook = { s: ImState; me: string; leadmail: RecEmail[] | undefined };
export type EmailsArgs = { kind: EmailKind; id: string | null };
export type OpenArgs = { kind: EmailKind; id: string; messageId: string; ownerId: string | null };

const party = (p: { user_name: string; email: string }) => ({ email: p.email, name: p.user_name });
const lineOf = (e: RecEmail): EmailLine => ({
  messageId: e.message_id, subject: e.subject, from: party(e.from), to: e.to.map(party), sentTime: e.sent_time,
  sent: true, hasAttachment: false, ownerId: null,
});
const REFUSED = () => fail(403, "not-visible", "You cannot open this record in Zoho, so its emails are not shown.");

function rowsOf(b: EmailBook, kind: EmailKind, id: string): RecEmail[] | null {
  if (kind === "lead") return leadEmails(b.leadmail, id);
  if (kind === "investor") return investorEmails(b.s, b.me, id);
  return [];
}

export const recordEmails: ReadEndpoint<EmailBook, EmailsArgs, EmailPage> = {
  path: a => (a.id ? `/api/emails/${a.kind}/${encodeURIComponent(a.id)}` : null),
  pick: j => j as EmailPage,
  fixture(b, a): ApiResult<EmailPage> {
    const rows = a.id ? rowsOf(b, a.kind, a.id) : null;
    return rows ? ok({ emails: rows.map(lineOf), nextIndex: null }) : REFUSED();
  },
};

export const emailOpen: ReadEndpoint<EmailBook, OpenArgs | null, EmailContent> = {
  path: a => (a ? `/api/emails/${a.kind}/${encodeURIComponent(a.id)}/${encodeURIComponent(a.messageId)}${a.ownerId ? `?owner=${encodeURIComponent(a.ownerId)}` : ""}` : null),
  pick: j => (j as { email: EmailContent }).email,
  fixture(b, a) {
    const e = a ? (rowsOf(b, a.kind, a.id) || []).find(r => r.message_id === a.messageId) : null;
    return e ? ok({ ...lineOf(e), cc: [], content: e.content, attachments: [] }) : REFUSED();
  },
};

/** "31 Aug 19:05" as the book stamps it; the route's ISO time said the same way. */
export function emailWhen(t: string | null): string {
  const m = t ? /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(t) : null;
  return m ? `${m[2]} ${"JanFebMarAprMayJunJulAugSepOctNovDec".slice((+m[1] - 1) * 3, (+m[1] - 1) * 3 + 3)} ${m[3]}` : t || "—";
}
