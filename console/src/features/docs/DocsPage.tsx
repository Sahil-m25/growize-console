"use client";

/* ── Documents — `vDocs()`, ir-merged.js:6705 (8. DOCUMENTS) ────────────────────────────────
   A single read-only register of Finance's document history. D59: what needs action first
   (blocked, expired, awaiting, sent), then what is complete. D61: a waiting row that is the IR's
   move says so ("Your move · …") and opens that lead's Paperwork row, where the step is done.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { IMP } from "@/domain";
import type { Lead } from "@/domain";
import type { FinanceDocument } from "@/lib/selectors";
import { financeBook, financeDocuments, irPaperStep, may } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useGoLead } from "@/features/leads/nav";
import "@/features/lead/drawers/finance";

/* financeDocumentState(d) — ir-merged.js:6634 */
const STATE_LABEL: Record<string, string> = {
  signed: "Signed", awaiting: "Awaiting signature", issued: "Issued", sent: "Sent",
  blocked: "Blocked", filed: "Filed", expired: "Expired",
};
function DocState({ s }: { s: string }) {
  return <span className={`tag ${s === "signed" ? "go" : s === "blocked" ? "late" : ""}`}>
    {STATE_LABEL[s] || s || "Not supplied"}</span>;
}

const ACT = ["blocked", "expired", "awaiting", "sent"];
type Row = { l: Lead; d: FinanceDocument };

export function DocsPage() {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("docs");
  if (!may(state, "docs", "view")) return null;

  /* goPaper(id) — ir-merged.js:3292 */
  const goPaper = (id: string) => { goLead(id); dispatch({ type: "setUi", patch: { LPFOCUS: id } }); };
  const all: Row[] = financeBook(state, "docs").flatMap(l => financeDocuments(state, l).map(d => ({ l, d })));
  const open = all.filter(r => ACT.includes(r.d.state)).sort((a, b) => ACT.indexOf(a.d.state) - ACT.indexOf(b.d.state));
  const done = all.filter(r => !ACT.includes(r.d.state));
  const row = ({ l, d }: Row, i: number) => {
    const st = ACT.includes(d.state) ? irPaperStep(state, l) : null;
    const go = () => st ? goPaper(l.id) : dispatch({ type: "openDrawer", k: "paper", id: l.id });
    return (
      <tr className={`k${st ? " d61-mine" : ""}`} key={(d.id || l.id + d.title) + i} tabIndex={0} onClick={go}
        onKeyDown={e => { if (e.key === "Enter") go(); }}>
        <td><b>{d.title}</b><div className="sm mono">{d.id || "Source ID not supplied"} · {d.class || "Document"}</div></td>
        <td>{l.n}</td><td className="sm mono">{d.sentOn || "Not supplied"}</td>
        <td><DocState s={d.state} />{st ? <> <button type="button" className="chip d61-move"
          onClick={e => { e.stopPropagation(); goPaper(l.id); }}>Your move · {st.t}</button></> : null}</td>
        <td className="sm mono">{d.completedOn || "—"}</td></tr>
    );
  };
  const mineN = open.filter(r => irPaperStep(state, r.l)).length;
  const grp = (t: string, list: Row[]) => list.length ? <>
    <tr className="g5-grp"><th colSpan={5}>{t} · {list.length}{t === "Waiting" && mineN ? <> <span className="tag br">{mineN} your move</span></> : null}</th></tr>
    {list.map(row)}</> : null;

  return (
    <>
      <div className="ph"><h1>Documents</h1><span className="sub">Read only · sent by Finance from the {IMP}</span></div>
      <section className="ux-docs ux-section">
      <div className="card fill"><div className="ch"><h3>Document register</h3><span className="cnt">{all.length}</span></div>
        <div className="tw"><table>
          <thead><tr><th>Document</th><th>Investor</th><th>Sent / issued</th><th>Status</th><th>Completed</th></tr></thead>
          <tbody>{all.length ? <>{grp("Waiting", open)}{grp("Complete", done)}</>
            : <tr><td colSpan={5} className="empty">No Finance documents on your eligible investors.</td></tr>}</tbody></table></div></div>
      </section>
    </>
  );
}
