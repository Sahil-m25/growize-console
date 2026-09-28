"use client";

/* 12. TRANSACTIONS — imx.js 1912–1957 (vTxn, 1918), titled "Payments" on the page. A register: a list
   with a filter and a way in. The prototype has no matching control here, so none is drawn. */

import { day6, dueBy, I, money, pageReadable, safeNote, TXNF } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";
import { MatchCell, PayoutsDue } from "../money/pages";

export function ImTxn({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "txn")) return null;
  const { TXN, INV } = s.data;
  const F = TXNF;
  const TFILT = s.ui.TFILT;
  const f = TFILT && F[TFILT] ? TFILT : "all";
  const rows = TXN.filter(F[f][1]);
  const inSum = TXN.filter(t => t.kind !== "refund" && t.kind !== "forfeit").reduce((a, t) => a + t.amt, 0);
  const outSum = TXN.filter(t => t.kind === "refund").reduce((a, t) => a + t.amt, 0);
  return (
    <>
      <div className="ph"><h1>Payments</h1>
        <span className="sub">every rupee, with the reason it moved</span><div className="sp"></div>
        <span className="sm">{TXN.filter(t => t.rec !== "matched").length} not reconciled</span></div>
      <div className="stats">
        <div className="stat"><b>{money(inSum)}</b><span>received</span></div>
        <div className="stat"><b>{money(outSum)}</b><span>refunded</span></div>
        <div className="stat"><b>{money(inSum - outSum)}</b><span>net banked</span></div>
        <div className="stat"><b>{money(INV.filter(x => x.st === "reserved").reduce((a, x) => a + dueBy(s, me, x.id), 0))}</b>
          <span>still due</span></div>
      </div>
      <div className="secbar">{Object.entries(F).map(([k, [t, fn]]) => {
        const n = TXN.filter(fn).length;
        return <button key={k} className={`sc ${f === k ? "on" : ""}`}
          onClick={() => dispatch({ type: "setFilter", patch: { TFILT: k } })}>{t}<i>{n}</i></button>;
      })}</div>
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr><th>Reference</th><th>Investor</th><th>Kind</th><th className="n">Amount</th>
          <th>Mode · UTR</th><th>Recorded</th><th>Reconciled</th></tr></thead>
        <tbody>{rows.length ? rows.map(t => {
          const x = I(s, me, t.inv);
          return (
            <tr className="k" key={t.id} onClick={() => dispatch({ type: "go", v: "inv", id: t.inv })} tabIndex={0}>
              <td className="mono">{t.id}</td>
              <td>{x ? x.n : t.inv}<div className="sm mono">{t.inv}</div></td>
              <td><span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold"
                : t.kind === "forfeit" ? "due" : "go"}`}>{t.kind}</span></td>
              <td className="n mono"><b>{t.kind === "refund" ? "−" : ""}{money(t.amt)}</b></td>
              <td className="sm">{t.mode} <span className="mono">{t.utr}</span></td>
              <td className="sm"><ImPname s={s} k={t.by} first /> <span className="mono">{day6(t.on)}</span></td>
              <td>{t.rec === "matched" ? <span className="tag go"><span className="dot"></span>matched</span>
                : <span className="tag due"><span className="dot"></span>pending</span>}
                {t.note ? <div className="sm">{safeNote(s, me, t.note)}</div> : null}
                <MatchCell s={s} me={me} dispatch={dispatch} t={t} /></td></tr>
          );
        }) : <tr><td colSpan={7}><div className="empty">Nothing in this cut.</div></td></tr>}
        </tbody></table></div></div>
        <PayoutsDue s={s} me={me} dispatch={dispatch} /></div>
    </>
  );
}
