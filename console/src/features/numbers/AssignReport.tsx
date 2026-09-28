"use client";

/* ── Assignments by IR — the merged prototype's `vAssignReport()` (ir-merged.js 11213–11290).
   The IR manager's report: leads handed over in each period, what has happened to them since, and
   the names behind any count. Figures come from `arData` (`@/lib/selectors/assign`). ─────────── */

import { Fragment } from "react";
import { TOUCHSLA } from "@/domain";
import { dLabel } from "@/lib/format";
import { P, assignees, numNamed, roleOf, me } from "@/lib/selectors";
import { AR_MACROS, arData } from "@/lib/selectors/assign";
import type { ArData, ArRow } from "@/lib/selectors/assign";
import { useConsole } from "@/lib/store";
import { Pav } from "@/components/ui";
import { useGo } from "@/features/pay/common";
import { rateOf } from "./bits";

type ArPick = { k: string; p: string; m: string };

declare module "@/lib/store" {
  interface UiState {
    /** the IR whose breakdown is unfolded under their row. ir-merged.js 11118 */
    AROPEN?: string | null;
    /** the count whose leads are listed by name. ir-merged.js 11119 */
    ARPICK?: ArPick | null;
    /** Numbers · Review: every line, not only the worst five. ir-merged.js 7280 */
    G6REVALL?: boolean;
  }
}

export function AssignReport() {
  const { state, dispatch } = useConsole();
  const go = useGo();
  const arOpen = state.ui.AROPEN ?? null, arPick = state.ui.ARPICK ?? null;
  const D = arData(state), any = D.all.length;
  const macros = AR_MACROS(state.NOW);
  const role = roleOf(state.PEOPLE, me(state));
  const who = role === "conv" ? "your team" : role === "ir" ? "you" : "every IR";

  const arTap = (k: string, p: string, m: string) => dispatch({ type: "setUi", patch: {
    ARPICK: arPick && arPick.k === k && arPick.p === p && arPick.m === m ? null : { k, p, m } } });
  const arToggle = (k: string) => {
    const next = arOpen === k ? null : k;
    dispatch({ type: "setUi", patch: { AROPEN: next,
      ...(arPick && arPick.k === k && next !== k ? { ARPICK: null } : {}) } });
  };

  if (!any) return (
    <div className="card ar" id="ar-root"><div className="ch"><h3>Assignments by IR</h3></div>
      <div className="cb"><p className="sm ar-empty">No leads have been assigned to {who} yet. Assignments appear here, by week and month, as leads are handed over.</p></div></div>
  );

  /* a count that lists its leads; zero is plain text, because a button that opens nothing is dead */
  const arCount = (n: number, label: string, k: string, p: string, m: string, late?: boolean) => !n
    ? <span className="ar-z">{label ? "0 " + label : "0"}</span>
    : <button type="button"
        className={`ar-n${late ? " ar-late" : ""}${arPick && arPick.k === k && arPick.p === p && arPick.m === m ? " on" : ""}`}
        onClick={e => { e.stopPropagation(); arTap(k, p, m); }}>{n}{label ? " " + label : ""}</button>;

  const arNames = (D: ArData) => {
    if (!arPick) return null;
    const r = arPick.k === "_tot" ? { per: D.tot.per, missed: D.tot.missed } : D.rows.find(x => x.k === arPick.k);
    if (!r) return null;
    const pi = D.P5.findIndex(p => p.k === arPick.p), c = pi >= 0 ? r.per[pi] : r.per[4];
    const mac = macros.find(x => x.k === arPick.m);
    const xs = arPick.m === "nw" ? c.nw : arPick.m === "miss" ? r.missed : mac && mac.f ? c.xs.filter(mac.f) : [];
    const what = arPick.m === "nw" ? "Not yet worked" : arPick.m === "miss" ? "Missed first touch" : mac ? mac.t : "";
    return (
      <div className="ar-names"><p className="sm"><b>{what}</b> · {arPick.m === "miss" ? "all periods" : (D.P5[pi] || D.P5[4]).t}
        {arPick.k === "_tot" ? "" : " · " + P(state.PEOPLE, arPick.k).n}</p><ul>{xs.map(x => {
          const open = numNamed(state, x.l);
          return (
            <li key={x.l.id}>{open
              ? <button type="button" className="ar-lead" onClick={() => go("lead", x.l.id)}>{x.l.n}</button>
              : <span>{x.l.n}</span>}{" "}
              <span className="sm">{P(state.PEOPLE, x.own).n.split(" ")[0]} · assigned {x.t0 ? dLabel(x.t0) : ""}{x.cap ? " (capture)" : ""}{
                x.worked ? " · " + x.n + " touch" + (x.n === 1 ? "" : "es") : ""}</span></li>
          );
        })}</ul></div>
    );
  };

  const arMacros = (r: ArRow, D: ArData) => (
    <div className="ar-mac-box"><table className="ar-mac"><thead><tr><th>Inside the row</th>{D.P5.map(p => <th key={p.k}>{p.t}</th>)}</tr></thead>
      <tbody>{macros.map(m => (
        <tr key={m.k}><th scope="row">{m.t}</th>{r.per.map((c, i) => (
          <td key={i}>{m.v ? m.v(c.xs) : arCount(c.xs.filter(m.f!).length, "", r.k, D.P5[i].k, m.k)}</td>))}</tr>
      ))}</tbody></table></div>
  );

  const cellH = (c: ArData["tot"]["per"][number], k: string, p: string, key: number) => (
    <td key={key}><div className="ar-c"><b>{c.n}</b>{c.n ? <> <span className="sm">· {rateOf(c.w, c.n)} worked</span></> : null}</div>
      {c.nw.length ? <div>{arCount(c.nw.length, "not worked", k, p, "nw", true)}</div> : null}</td>
  );

  const on = assignees(state);
  const T = D.tot;
  return (
    <div className="card ar" id="ar-root"><div className="ch"><h3>Assignments by IR</h3>
      <span className="sm">Leads handed over in each period, and what has happened to them since</span></div>
      <div className="ar-scroll"><table className="ar-t"><thead><tr><th>IR</th>{D.P5.map(p => <th key={p.k}>{p.t}</th>)}<th>Missed first touch</th></tr></thead>
        <tbody>{D.rows.map(r => {
          const open = arOpen === r.k, off = !on.includes(r.k), pickHere = !!arPick && arPick.k === r.k;
          const pp = state.PEOPLE[r.k];
          return (
            <Fragment key={r.k}>
              <tr className={`ar-r${open ? " on" : ""}`} onClick={() => arToggle(r.k)}>
                <th scope="row"><button type="button" className="ar-who" aria-expanded={open}
                  onClick={e => { e.stopPropagation(); arToggle(r.k); }}>
                  <Pav k={r.k} /><span>{P(state.PEOPLE, r.k).n.split(" ")[0]}{off
                    ? <> <span className="sm">({pp && pp.on ? "off" : "left"})</span></> : null}</span></button></th>
                {r.per.map((c, i) => cellH(c, r.k, D.P5[i].k, i))}
                <td>{r.missed.length ? arCount(r.missed.length, "", r.k, "all", "miss", true) : <span className="ar-z">0</span>}</td></tr>
              {open || pickHere ? (
                <tr className="ar-x"><td colSpan={D.P5.length + 2}>{pickHere ? arNames(D) : null}{open ? arMacros(r, D) : null}</td></tr>
              ) : null}
            </Fragment>
          );
        })}</tbody>
        <tfoot><tr className="ar-tot"><th scope="row">Team</th>{T.per.map((c, i) => cellH(c, "_tot", D.P5[i].k, i))}
          <td>{T.missed.length ? arCount(T.missed.length, "", "_tot", "all", "miss", true) : <span className="ar-z">0</span>}</td></tr>
          {arPick && arPick.k === "_tot" ? <tr className="ar-x"><td colSpan={D.P5.length + 2}>{arNames(D)}</td></tr> : null}</tfoot></table></div>
      <div className="cb ar-foot"><p className="sm">Tap an IR for what happened inside the row. Worked = at least one contact attempt by that IR after the lead reached them.
        Missed first touch = no touch by the end of the first-touch service level day, counted from assignment ({TOUCHSLA.map(x => x.t + " " + x.due).join(", ")}; earliest permitted channel).
        Leads with no handover line use their capture date as the assignment date, and older touch stamps with no author count as the owner&#39;s.</p></div></div>
  );
}
