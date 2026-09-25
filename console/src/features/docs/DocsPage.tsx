"use client";

/* ── Documents — `vDocs()`, redesigned prototype line 9051 ─────────────────────────────────
   A single read-only register of Finance's document history. The document is uploaded, sent, signed
   and verified in the Investor Management portal — that is where the file and the signing account
   live — and this screen is a mirror of it, for every reader alike, Finance's own reflection
   included: there is no send panel here any more, because the round moves from the lead's
   Paperwork, one beat at a time, never from a second panel that could get ahead of it.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { financeBook, financeDocuments, may } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { ImBanner } from "@/features/pay/common";
import "@/features/lead/drawers/finance";

/* financeDocumentState(d) — redesigned prototype line ~8968 */
const STATE_LABEL: Record<string, string> = {
  signed: "Signed", awaiting: "Awaiting signature", issued: "Issued", sent: "Sent",
  blocked: "Blocked", filed: "Filed", expired: "Expired",
};
function DocState({ s }: { s: string }) {
  return <span className={`tag ${s === "signed" ? "go" : s === "blocked" ? "late" : ""}`}>
    {STATE_LABEL[s] || s || "Not supplied"}</span>;
}

export function DocsPage() {
  const { state, dispatch } = useConsole();
  if (!may(state, "docs", "view")) return <div className="empty">Documents are unavailable for your account.</div>;

  const rows = financeBook(state, "docs").flatMap(l => financeDocuments(state,l).map(d => ({l,d})));

  return (
    <>
      <div className="ph"><h1>Documents</h1>
        <span className="sub">Finance document history · read only</span></div>
      <section className="ux-docs ux-section">
      <ImBanner />
      <div className="card fill"><div className="ch"><h3>Document register</h3><span className="cnt">{rows.length}</span></div>
        <div className="tw"><table>
          <thead><tr><th>Document</th><th>Investor</th><th>Sent / issued</th><th>Status</th><th>Completed</th></tr></thead>
          <tbody>{rows.map(({l,d},i) => (
            <tr className="k" key={d.id || l.id + d.title + i} tabIndex={0} onClick={() => dispatch({type:"openDrawer",k:"paper",id:l.id})}
              onKeyDown={e => { if (e.key === "Enter") dispatch({type:"openDrawer",k:"paper",id:l.id}); }}>
              <td><b>{d.title}</b><div className="sm mono">{d.id || "Source ID not supplied"} · {d.class || "Document"}</div></td>
              <td>{l.n}</td>
              <td className="sm mono">{d.sentOn || "Not supplied"}</td>
              <td><DocState s={d.state} /></td>
              <td className="sm mono">{d.completedOn || "—"}</td></tr>
          ))}{!rows.length ? <tr><td colSpan={5} className="empty">No Finance documents on your eligible investors.</td></tr> : null}</tbody></table></div></div>
      </section>
    </>
  );
}
