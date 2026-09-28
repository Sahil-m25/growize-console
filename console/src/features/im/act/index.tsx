"use client";

/* Activity — imx.js section 14, vAct (lines 2512–2542). The log is the reason a masked field is
   worth masking: looking at one leaves a line here with a name on it. Every line goes through the
   core's activityBase (safeNote, or auditText with investor details withheld for an organisation
   audit), and the Detail column through safeNote again, as the prototype does. */

import { activityBase, activityRows, GLYPH, isSys, KINDS, may, navFor, pageReadable, safeNote, who } from "@/lib/im";
import type { ImKind } from "@/lib/im";
import { ImPav, ImPname, type ImPageProps } from "../common";

export function ImAct({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "act")) return null;
  const base = activityBase(s, me), rows = activityRows(s, me), actors = [...new Set(base.map(e => e.who))];
  const piiN = base.filter(e => e.kind === "pii").length;
  const { LOGWHO, LOGKIND } = s.ui;
  const canInv = navFor(s, me).some(n => n.k === "inv");
  return (
    <>
      <div className="ph"><h1>Activity</h1>
        <span className="sub">{base.length} accessible entries · {isSys(s, me) && may(s, me, "log")
          ? "organisation audit with investor details withheld" : "your work on accounts you can open"}</span><div className="sp"></div>
        {piiN ? <span className={`tag ${piiN > 3 ? "due" : ""}`}><span className="dot"></span>{piiN} identity reveal{piiN === 1 ? "" : "s"}</span> : null}</div>
      <div className="secbar">
        <button className={`sc ${LOGWHO ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGWHO: null } })}>
          {may(s, me, "log") ? "Everyone" : "Your activity"}</button>
        {actors.map(k => (
          <button key={k} className={`sc ${LOGWHO === k ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGWHO: k } })}>
            <ImPav s={s} k={k} cls="xs" /> {who(s, k).n.split(" ")[0]}<i>{base.filter(e => e.who === k).length}</i></button>
        ))}
      </div>
      <div className="secbar" style={{ marginTop: "-2px" }}>
        <button className={`sc ${LOGKIND ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGKIND: null } })}>All kinds</button>
        {(Object.keys(KINDS) as ImKind[]).filter(k => base.some(e => e.kind === k)).map(k => (
          <button key={k} className={`sc ${LOGKIND === k ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGKIND: k } })}>
            {GLYPH[k]} {KINDS[k]} <i>{base.filter(e => e.kind === k).length}</i></button>
        ))}
      </div>
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Investor</th><th>Detail</th></tr></thead>
        <tbody>{rows.length ? rows.map((e, i) => {
          const link = e.inv && canInv ? e.inv : null;
          return (
            <tr key={i} {...(link ? { className: "k", tabIndex: 0, onClick: () => dispatch({ type: "go", v: "inv", id: link }) } : {})}>
              <td className="sm mono nw">{e.at}</td>
              <td className="sm"><ImPname s={s} k={e.who} first /></td>
              <td><span className={`tag ${e.kind === "pii" ? "late" : e.kind === "money" ? "go" : ""}`}>{GLYPH[e.kind] || "·"} {KINDS[e.kind] || e.kind}</span>{" "}
                <b style={{ fontWeight: 600 }}>{e.what}</b></td>
              <td className="sm mono">{e.inv || "—"}</td>
              <td className="sm">{safeNote(s, me, e.note)}</td></tr>
          );
        }) : <tr><td colSpan={5}><div className="empty">Nothing in this cut.</div></td></tr>}
        </tbody></table></div></div></div>
    </>
  );
}
