"use client";

/* M12-S09 — a record's emails (D72): the list (sender, subject, time) and, when one is opened, its
   body read-only. Read through the Zoho CRM Emails API with the viewer's own token in phase 2; in
   phase 1 from the demo book. A record the person cannot open shows an in-page refusal and nothing
   is read. An IR sees an investor's emails only for an investor from their own lead (D69). */

import { Tw } from "@/components/ui";
import { useState } from "react";
import type { EmailLine } from "@/lib/zoho/client";
import type { ImState, RecEmail } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { emailOpen, emailWhen, recordEmails, type EmailBook, type EmailKind } from "@/lib/data/endpoints/emails";
import { useConsole } from "@/lib/store";

/* M12-S09-W1 (D104): the list is GET /api/emails/{kind}/{id} and an opened email GET /api/emails/{kind}/{id}/{messageId}
   through the adapter — read on the viewer's own token, never kept. A 403 draws the in-page refusal below and nothing else. */
type Src = { s: ImState; me: string; leadmail: RecEmail[] | undefined };
const book = (p: Src): EmailBook => ({ s: p.s, me: p.me, leadmail: p.leadmail });
const sender = (e: EmailLine): string => (e.from && (e.from.name || e.from.email)) || "—";

/** the emails of one record, and one of them read-only when it is opened */
export function EmailList({ src, kind, id, lines, title, sub, empty }: { src: Src; kind: EmailKind; id: string; lines: readonly EmailLine[]; title: string; sub?: string; empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const line = lines.find(r => r.messageId === open) || null;
  const one = useApiRead(emailOpen, book(src), line ? { kind, id, messageId: line.messageId, ownerId: line.ownerId } : null);
  return (
    <div className="card fill"><div className="ch"><h3>{title}</h3><div className="sp" />
      <span className="sm">{sub || lines.length + " email" + (lines.length === 1 ? "" : "s") + " · read only"}</span></div>
      <Tw><table><thead><tr><th>From</th><th>Subject</th><th>When</th></tr></thead>
        <tbody>{lines.length ? lines.map(r => {
          const on = open === r.messageId, go = () => setOpen(on ? null : r.messageId);
          return (
            <tr key={r.messageId} className="k" tabIndex={0} aria-expanded={on} onClick={go}
              onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } }}>
              <td><b>{sender(r)}</b><div className="sm mono">{r.from ? r.from.email : ""}</div></td>
              <td>{r.subject}</td>
              <td className="sm mono">{emailWhen(r.sentTime)}</td>
            </tr>
          );
        }) : <tr><td colSpan={3}><div className="empty">{empty}</div></td></tr>}</tbody></table></Tw>
      {line && one.state === "loading" ? <p className="sm" style={{ margin: "8px 16px" }}>Reading the email…</p> : null}
      {line && one.state === "error" ? <div className="note bad" role="alert" style={{ margin: 8 }}>{one.err.error}</div> : null}
      {line && one.state === "ok" ? (
        <div className="cb" role="region" aria-label={"Email: " + one.data.subject}>
          <dl className="kv">
            <dt>From</dt><dd>{sender(one.data)} <span className="sm mono">{one.data.from ? one.data.from.email : ""}</span></dd>
            <dt>To</dt><dd>{one.data.to.map(t => t.name || t.email).join(", ")}</dd>
            <dt>Subject</dt><dd><b>{one.data.subject}</b></dd>
            <dt>Sent</dt><dd className="mono">{emailWhen(one.data.sentTime)}</dd>
          </dl>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 10, lineHeight: 1.5 }}>{one.data.content}</div>
          <p className="sm" style={{ margin: "10px 0 0" }}>Read only — the email stays in Zoho CRM, and nothing of it is kept here.</p>
          <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setOpen(null)}>Close the email</button>
        </div>) : null}
    </div>
  );
}

/** the refusal a record's emails give a person who cannot open it — nothing is read */
export const EmailsRefused = () => (
  <div className="note bad" role="alert"><b>Not shown.</b> This record is not one you can open, so its emails were
    not read. Emails show only on records your own seat reaches.</div>
);

/** the investor record's Emails section */
/* closed by default, like the lead page's row: the record reads exactly as the prototype's until the
   emails are asked for */
export function InvEmails({ s, me, id }: { s: ImState; me: string; id: string }) {
  const [open, setOpen] = useState(false);
  const src: Src = { s, me, leadmail: undefined };
  const r = useApiRead(recordEmails, book(src), { kind: "investor", id });
  if (r.state === "loading") return <p className="sm" style={{ margin: "8px 0" }}>Reading the emails…</p>;
  if (r.state === "error") return r.err.status === 403 ? <EmailsRefused /> : <div className="note bad" role="alert">{r.err.error}</div>;
  if (r.state !== "ok") return null;
  const rows = r.data.emails;
  if (!open) return (
    <div className="card"><div className="ch"><h3>Emails</h3><div className="sp" />
      <span className="sm">{rows.length + " email" + (rows.length === 1 ? "" : "s") + " · read only"}</span>
      <button type="button" className="chip" aria-expanded={false} onClick={() => setOpen(true)}>Show emails</button></div></div>
  );
  return <EmailList src={src} kind="investor" id={id} lines={rows} title="Emails" empty="No email is filed on this investor." />;
}

/** the lead page's Emails: a row in the lead's stage list that opens the lead's own emails and —
 *  only for the IR whose lead it was, or an Investors seat that reads them — the emails of the
 *  investor the lead became. LeadPage has already refused a lead this person cannot open. */
export function LeadEmails({ leadId }: { leadId: string }) {
  const { state } = useConsole();
  const [open, setOpen] = useState(false);
  const s: ImState = { data: state.IM, ui: state.IMUI };
  const src: Src = { s, me: state.WHO, leadmail: state.LEADMAIL };
  /* the investor this lead became (the book's own link; a route that refuses them shows nothing of them) */
  const x = s.data.INV.find(i => i.lead === leadId) || null;
  const own = useApiRead(recordEmails, book(src), { kind: "lead", id: leadId });
  const inv = useApiRead(recordEmails, book(src), { kind: "investor", id: x ? x.id : null });
  const ownRows = own.state === "ok" ? own.data.emails : [], invRows = x && inv.state === "ok" ? inv.data.emails : null;
  const n = ownRows.length + (invRows ? invRows.length : 0);
  if (own.state === "error") return own.err.status === 403 ? <EmailsRefused /> : <div className="note bad" role="alert">{own.err.error}</div>;
  if (!n) return null;
  return (
    <>
      <div className="lp-stage"><span className="sm">Emails</span>
        <b>{n + " email" + (n === 1 ? "" : "s") + " on file"}</b>
        <button type="button" className="lp-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide emails" : "Show emails"}</button></div>
      {open ? (
        <section aria-label="Emails" style={{ marginTop: 12 }}>
          <EmailList src={src} kind="lead" id={leadId} lines={ownRows} title="Emails" empty="No email is filed on this lead." />
          {x && invRows ? <div style={{ marginTop: 12 }}><EmailList src={src} kind="investor" id={x.id} lines={invRows} title={"Emails as an investor · " + x.id}
            empty="No email is filed on this investor yet." /></div> : null}
        </section>) : null}
    </>
  );
}
