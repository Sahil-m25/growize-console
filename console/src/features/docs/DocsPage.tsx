"use client";

/* ── Documents — `vDocs()`, ir-merged.js:6705 (8. DOCUMENTS) ────────────────────────────────
   A single read-only register of Finance's document history. D59: what needs action first
   (blocked, expired, awaiting, sent), then what is complete. D61: a waiting row that is the IR's
   move says so ("Your move · …") and opens that lead's Paperwork row, where the step is done.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { IMP } from "@/domain";
import { may } from "@/lib/selectors";
import { useApiRead } from "@/lib/data/api";
import { dayOf, leadDocumentsList } from "@/lib/data/endpoints/documents";
import type { DocRow } from "@/server/documents/list";
import { useConsole } from "@/lib/store";
import { useGoLead } from "@/features/leads/nav";
import { ReadNote } from "@/features/im/paper2/ReadNote";
import "@/features/lead/drawers/finance";

/* M12-S03-W2: the register is GET /api/documents/list?cut=all on the lead side (the NDA rows on the leads this seat owns,
   each with the route's "your move"); the status words are Zoho Sign's own label. financeDocumentState(d) — ir-merged.js:6634 */
function DocState({ r }: { r: DocRow }) {
  const blocked = r.key.startsWith("blocked:");
  return <span className={`tag ${r.state === "verified" ? "go" : blocked ? "late" : ""}`}>
    {r.state === "verified" ? "Signed" : (r.sign && r.sign.label) || "Sent"}</span>;
}

export function DocsPage() {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("docs");
  const r = useApiRead(leadDocumentsList, state, "all");
  if (!may(state, "docs", "view")) return null;

  /* goPaper(id) — ir-merged.js:3292 */
  const goPaper = (id: string) => { goLead(id); dispatch({ type: "setUi", patch: { LPFOCUS: id } }); };
  const all: readonly DocRow[] = r.state === "ok" ? r.data.rows : [];
  const open = all.filter(d => d.state !== "verified");
  const done = all.filter(d => d.state === "verified");
  /* the IR's own move is the chip; a Finance move is plain words */
  const mine = (d: DocRow) => !!d.yourMove && !/^Finance/.test(d.yourMove);
  const row = (d: DocRow) => {
    const go = () => mine(d) ? goPaper(d.recordId) : dispatch({ type: "openDrawer", k: "paper", id: d.recordId });
    return (
      <tr className={`k${mine(d) ? " d61-mine" : ""}`} key={d.key} tabIndex={0} onClick={go}
        onKeyDown={e => { if (e.key === "Enter") go(); }}>
        <td><b>{d.label}</b><div className="sm mono">{d.requestId || "Source ID not supplied"}</div></td>
        <td>{d.party}</td><td className="sm mono">{(d.sign && dayOf(d.sign.sentAt)) || "Not supplied"}</td>
        <td><DocState r={d} />{d.yourMove && d.state !== "verified" ? <> {mine(d)
          ? <button type="button" className="chip d61-move" onClick={e => { e.stopPropagation(); goPaper(d.recordId); }}>Your move · {d.yourMove}</button>
          : <span className="sm">{d.yourMove}</span>}</> : null}</td>
        <td className="sm mono">{d.state === "verified" ? dayOf(d.verifiedAt) : "—"}</td></tr>
    );
  };
  const mineN = open.filter(mine).length;
  const grp = (t: string, list: readonly DocRow[]) => list.length ? <>
    <tr className="g5-grp"><th colSpan={5}>{t} · {list.length}{t === "Waiting" && mineN ? <> <span className="tag br">{mineN} your move</span></> : null}</th></tr>
    {list.map(row)}</> : null;

  return (
    <>
      <div className="ph"><h1>Documents</h1><span className="sub">Read only · sent by Finance from the {IMP}</span></div>
      <section className="ux-docs ux-section">
      <ReadNote r={r} what="the documents" />
      <div className="card fill"><div className="ch"><h3>Document register</h3><span className="cnt">{all.length}</span></div>
        <div className="tw"><table>
          <thead><tr><th>Document</th><th>Investor</th><th>Sent / issued</th><th>Status</th><th>Completed</th></tr></thead>
          <tbody>{all.length ? <>{grp("Waiting", open)}{grp("Complete", done)}</>
            : <tr><td colSpan={5} className="empty">{r.state === "loading" ? "Reading…" : "No Finance documents on your eligible investors."}</td></tr>}</tbody></table></div></div>
      </section>
    </>
  );
}
