"use client";

/* 12. TRANSACTIONS — imx.js 1912–1957 (vTxn, 1918), titled "Payments" on the page. A register: a list
   with a filter and a way in. M10-S01-W1: the rows, the chip counts and the totals are GET /api/payments
   (lib/data/endpoints/payments) — received, refunded, net banked and still due are MATCHED money only (D21); what
   is recorded and not yet matched is shown apart. The Match it button is M10-S02 (../money/pages). */

import { day6, fmtDate, money, pageReadable, TXNF } from "@/lib/im";
import type { ImTxn } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { paymentsRegister, type RegisterArgs, type RegisterRowView } from "@/lib/data/endpoints/payments";
import { ImPname, type ImPageProps } from "../common";
import { MatchCell, PayoutsDue } from "../money/pages";
import { StatementCard } from "../money/statement";

/** each chip is one cut of the route (the counts come back for every chip whichever is on) */
const CUT: Record<string, RegisterArgs> = { all: {}, adv: { kind: "advance" }, full: { kind: "full" }, out: { kind: "out" }, pend: { reconciled: false } };
const COUNT: Record<string, "all" | "advance" | "full" | "out" | "pending"> = { all: "all", adv: "advance", full: "full", out: "out", pend: "pending" };

/** the row as the book's own ImTxn, for the pieces that are not wired here (Match it reads it) */
const asTxn = (r: RegisterRowView): ImTxn => ({ id: r.id, inv: r.investor.id, kind: r.kind, amt: r.amount, mode: r.mode ?? "", utr: r.utr ?? "",
  on: r.receivedOn ?? "", by: r.recordedById ?? "", rec: r.reconciled ? "matched" : "pending" });
/** the demo book stamps "02 Sep 10:00"; the route sends "2026-09-02" */
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v).slice(0, 6) : day6(v));

export function ImTxn({ s, me, dispatch }: ImPageProps) {
  const TFILT = s.ui.TFILT;
  const f = TFILT && TXNF[TFILT] ? TFILT : "all";
  const r = useApiRead(paymentsRegister, { s, me }, CUT[f]);
  if (!pageReadable(s, me, "txn")) return null;
  if (r.state === "idle" || r.state === "loading") return <div className="empty">Reading the register…</div>;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="note bad" role="alert">{r.err.error}</div>;
  const { rows, counts, totals } = r.data;
  const rec = totals.recorded;
  return (
    <>
      <div className="ph"><h1>Payments</h1>
        <span className="sub">every rupee, with the reason it moved</span><div className="sp"></div>
        <span className="sm">{counts.pending} not reconciled</span></div>
      <StatementCard s={s} me={me} dispatch={dispatch} />
      <div className="stats">
        <div className="stat"><b>{money(totals.received)}</b><span>received</span></div>
        <div className="stat"><b>{money(totals.refunded)}</b><span>refunded</span></div>
        <div className="stat"><b>{money(totals.netBanked)}</b><span>net banked</span></div>
        <div className="stat"><b>{money(totals.stillDue)}</b>
          <span>still due</span></div>
      </div>
      {rec.received || rec.refunded ? <p className="sm" style={{ margin: "0 0 8px" }}>Recorded, not yet matched: <b>{money(rec.received)}</b> in
        {rec.refunded ? <> and <b>−{money(rec.refunded)}</b> out</> : null} · not counted above until Finance matches it.</p> : null}
      <div className="secbar">{Object.entries(TXNF).map(([k, [t]]) => (
        <button key={k} className={`sc ${f === k ? "on" : ""}`}
          onClick={() => dispatch({ type: "setFilter", patch: { TFILT: k } })}>{t}<i>{counts[COUNT[k]]}</i></button>
      ))}</div>
      <div className="secw"><div className="card fill"><div className="tw"><table>
        <thead><tr><th>Reference</th><th>Investor</th><th>Kind</th><th className="n">Amount</th>
          <th>Mode · UTR</th><th>Recorded</th><th>Reconciled</th></tr></thead>
        <tbody>{rows.length ? rows.map(t => (
          <tr className="k" key={t.id} onClick={() => dispatch({ type: "go", v: "inv", id: t.investor.id })} tabIndex={0}>
            <td className="mono">{t.id}</td>
            <td>{t.investor.name ?? t.investor.id}<div className="sm mono">{t.investor.id}</div></td>
            <td><span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold"
              : t.kind === "forfeit" ? "due" : "go"}`}>{t.kind}</span></td>
            <td className="n mono"><b>{t.kind === "refund" ? "−" : ""}{money(t.amount)}</b></td>
            <td className="sm">{t.mode ?? "—"} <span className="mono">{t.utrHidden ? "Finance only" : t.utr}</span></td>
            <td className="sm">{t.recordedById ? <ImPname s={s} k={t.recordedById} first /> : null} <span className="mono">{dayOf(t.receivedOn)}</span></td>
            <td>{t.reconciled ? <span className="tag go"><span className="dot"></span>matched</span>
              : <span className="tag due"><span className="dot"></span>pending</span>}
              <MatchCell s={s} me={me} dispatch={dispatch} t={asTxn(t)} /></td></tr>
        )) : <tr><td colSpan={7}><div className="empty">Nothing in this cut.</div></td></tr>}
        </tbody></table></div></div>
        <PayoutsDue s={s} me={me} dispatch={dispatch} /></div>
    </>
  );
}
