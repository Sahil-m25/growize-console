"use client";

/* Activity — imx.js section 14, vAct (lines 2512–2542). The log is the reason a masked field is
   worth masking: looking at one leaves a line here with a name on it. M15-S03-W1: the rows, the per-person and
   per-kind counts and the scope come from GET /api/activity (side=investors); the person and kind cuts are the
   route's own filters. The route's answer already holds only what this seat may read, and an organisation audit
   has its investor details withheld by the route. */

import type { ReactNode } from "react";
import { fmtDay, GLYPH, KINDS, navFor, pageReadable, who } from "@/lib/im";
import type { ImKind } from "@/lib/im";
import { useApiRead, type Read } from "@/lib/data/api";
import { activityRead, type ActivityRowView } from "@/lib/data/endpoints/activity";
import { ImPav, ImPname, type ImPageProps } from "../common";

/** "2026-08-29T10:22:00+05:30" (the route) or "29 Aug 10:22" (the book) as "29 Aug 10:22" */
const whenText = (at: string): string =>
  /^\d{4}-\d{2}-\d{2}T/.test(at) ? fmtDay(Date.parse(at.slice(0, 10) + "T00:00:00Z")) + " " + at.slice(11, 16) : at;

const Wait = ({ r }: { r: Read<unknown> }) => r.state === "error"
  ? <div className="note" role="alert">{r.err.error}</div> : <p className="sm" style={{ margin: "8px 0" }}>Loading…</p>;

export function ImAct({ s, me, dispatch }: ImPageProps) {
  const book = { s, me };
  const { LOGWHO, LOGKIND } = s.ui;
  const filtered = !!(LOGWHO || LOGKIND);
  /* the unfiltered read carries every chip's count; a cut is read on its own, so the chips never shrink under a filter */
  const all = useApiRead(activityRead, book, { person: null, kind: null });
  const cut = useApiRead(activityRead, book, filtered ? { person: LOGWHO, kind: LOGKIND } : null);
  if (!pageReadable(s, me, "act")) return null;
  const head = (sub: string, tag?: ReactNode) => <div className="ph"><h1>Activity</h1><span className="sub">{sub}</span><div className="sp"></div>{tag}</div>;
  if (all.state !== "ok") return <>{head("")}<Wait r={all} /></>;
  const A = all.data, shown = filtered ? cut : all;
  const kindN = (k: string) => A.byDay.reduce((a, d) => a + (d.kinds[k] ?? 0), 0);
  const piiN = kindN("pii");
  const canInv = navFor(s, me).some(n => n.k === "inv");
  const rows: readonly ActivityRowView[] = shown.state === "ok" ? shown.data.rows : [];
  return (
    <>
      {head(`${A.total} accessible entries · ${A.adminView ? "organisation audit with investor details withheld" : "your work on accounts you can open"}`,
        piiN ? <span className={`tag ${piiN > 3 ? "due" : ""}`}><span className="dot"></span>{piiN} identity reveal{piiN === 1 ? "" : "s"}</span> : null)}
      <div className="secbar">
        <button className={`sc ${LOGWHO ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGWHO: null } })}>
          {A.solo ? "Your activity" : "Everyone"}</button>
        {A.byPerson.map(p => (
          <button key={p.key} className={`sc ${LOGWHO === p.key ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGWHO: p.key } })}>
            <ImPav s={s} k={p.key} cls="xs" /> {who(s, p.key).n.split(" ")[0]}<i>{p.total}</i></button>
        ))}
      </div>
      <div className="secbar" style={{ marginTop: "-2px" }}>
        <button className={`sc ${LOGKIND ? "" : "on"}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGKIND: null } })}>All kinds</button>
        {(Object.keys(A.kinds) as ImKind[]).filter(k => kindN(k) > 0).map(k => (
          <button key={k} className={`sc ${LOGKIND === k ? "on" : ""}`} onClick={() => dispatch({ type: "setFilter", patch: { LOGKIND: k } })}>
            {GLYPH[k]} {KINDS[k] ?? A.kinds[k]} <i>{kindN(k)}</i></button>
        ))}
      </div>
      {shown.state !== "ok" ? <Wait r={shown} /> : null}
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Investor</th><th>Detail</th></tr></thead>
        <tbody>{rows.length ? rows.map((e, i) => {
          const link = e.recordId && canInv ? e.recordId : null;
          return (
            <tr key={i} {...(link ? { className: "k", tabIndex: 0, onClick: () => dispatch({ type: "go", v: "inv", id: link }) } : {})}>
              <td className="sm mono nw">{whenText(e.at)}</td>
              <td className="sm"><ImPname s={s} k={e.byId} first /></td>
              <td><span className={`tag ${e.kind === "pii" ? "late" : e.kind === "money" ? "go" : ""}`}>{GLYPH[e.kind as ImKind] || "·"} {KINDS[e.kind as ImKind] || e.kind}</span>{" "}
                <b style={{ fontWeight: 600 }}>{e.what}</b></td>
              <td className="sm mono">{e.recordId || "—"}</td>
              <td className="sm">{e.withheld ? "Investor details withheld" : e.detail ?? ""}</td></tr>
          );
        }) : shown.state === "ok" ? <tr><td colSpan={5}><div className="empty">Nothing in this cut.</div></td></tr> : null}
        </tbody></table></div></div></div>
    </>
  );
}
