"use client";

/* M12-S09 — a record's emails (D72): the list (sender, subject, time) and, when one is opened, its
   body read-only. Read through the Zoho CRM Emails API with the viewer's own token in phase 2; in
   phase 1 from the demo book. A record the person cannot open shows an in-page refusal and nothing
   is read. An IR sees an investor's emails only for an investor from their own lead (D69). */

import { useState } from "react";
import { investorEmails, leadEmails, leadInvestorEmails } from "@/lib/im";
import type { ImState, RecEmail } from "@/lib/im";
import { useConsole } from "@/lib/store";

export function EmailList({ rows, title, sub, empty }: { rows: RecEmail[]; title: string; sub?: string; empty: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const e = rows.find(r => r.message_id === open) || null;
  return (
    <div className="card fill"><div className="ch"><h3>{title}</h3><div className="sp" />
      <span className="sm">{sub || rows.length + " email" + (rows.length === 1 ? "" : "s") + " · read only"}</span></div>
      <div className="tw"><table><thead><tr><th>From</th><th>Subject</th><th>When</th></tr></thead>
        <tbody>{rows.length ? rows.map(r => {
          const on = open === r.message_id, go = () => setOpen(on ? null : r.message_id);
          return (
            <tr key={r.message_id} className="k" tabIndex={0} aria-expanded={on} onClick={go}
              onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); } }}>
              <td><b>{r.from.user_name}</b><div className="sm mono">{r.from.email}</div></td>
              <td>{r.subject}</td>
              <td className="sm mono">{r.sent_time}</td>
            </tr>
          );
        }) : <tr><td colSpan={3}><div className="empty">{empty}</div></td></tr>}</tbody></table></div>
      {e ? (
        <div className="cb" role="region" aria-label={"Email: " + e.subject}>
          <dl className="kv">
            <dt>From</dt><dd>{e.from.user_name} <span className="sm mono">{e.from.email}</span></dd>
            <dt>To</dt><dd>{e.to.map(t => t.user_name).join(", ")}</dd>
            <dt>Subject</dt><dd><b>{e.subject}</b></dd>
            <dt>Sent</dt><dd className="mono">{e.sent_time}</dd>
          </dl>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 10, lineHeight: 1.5 }}>{e.content}</div>
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
  const rows = investorEmails(s, me, id);
  if (!rows) return <EmailsRefused />;
  if (!open) return (
    <div className="card"><div className="ch"><h3>Emails</h3><div className="sp" />
      <span className="sm">{rows.length + " email" + (rows.length === 1 ? "" : "s") + " · read only"}</span>
      <button type="button" className="chip" aria-expanded={false} onClick={() => setOpen(true)}>Show emails</button></div></div>
  );
  return <EmailList rows={rows} title="Emails" empty="No email is filed on this investor." />;
}

/** the lead page's Emails: a row in the lead's stage list that opens the lead's own emails and —
 *  only for the IR whose lead it was, or an Investors seat that reads them — the emails of the
 *  investor the lead became. LeadPage has already refused a lead this person cannot open. */
export function LeadEmails({ leadId }: { leadId: string }) {
  const { state } = useConsole();
  const [open, setOpen] = useState(false);
  const s: ImState = { data: state.IM, ui: state.IMUI };
  const me = state.WHO;
  const rows = leadEmails(state.LEADMAIL, leadId);
  const inv = leadInvestorEmails(s, me, leadId);
  const n = rows.length + (inv ? inv.mail.length : 0);
  if (!n) return null;
  return (
    <>
      <div className="lp-stage"><span className="sm">Emails</span>
        <b>{n + " email" + (n === 1 ? "" : "s") + " on file"}</b>
        <button type="button" className="lp-link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide emails" : "Show emails"}</button></div>
      {open ? (
        <section aria-label="Emails" style={{ marginTop: 12 }}>
          <EmailList rows={rows} title="Emails" empty="No email is filed on this lead." />
          {inv ? <div style={{ marginTop: 12 }}><EmailList rows={inv.mail} title={"Emails as an investor · " + inv.x.id}
            empty="No email is filed on this investor yet." /></div> : null}
        </section>) : null}
    </>
  );
}
