"use client";

/* The investor record's cards for the later owner decisions (not in the prototype):
   - Allotments (M11-S02, M10-S07): one row per farm LLP, each with a Receipts tab and a Payouts tab
     (M10-S20 — the schedule lives here, on the allotment; there is no payouts page).
   - Per-farm Money blocks (M10-S08) for an investor with several allotments.
   - App access (M10-S21) with Preview app (M10-S22) and Test sign-in link (M10-S23).
   - ARL holdings (M10-S09), read-only. */

import { useEffect, type ReactNode } from "react";
import {
  I, accessOf, accessView, agreementSigned, allotAmount, allotDue, allotPaid, allotPayStatus, allotTxns, allotUnits, allotsOf,
  arlTxnsOf, day6, fmtDate, holdingsOf, inr, isSuper, llpName, llpOf, may, mayAccess, mayHoldings, mayPayouts, mayPreview,
  mayTestLink, money, notFin, payoutsOf, thisMonth, unlinkedTxns, who,
} from "@/lib/im";
import type { ImAllot, ImInvestor } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";
import { payTagClass, poTagClass } from "./drawers";

type P = ImPageProps & { x: ImInvestor };
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;
const mxOf = (p: ImPageProps, k: string) => (p.s.ui.MX || {})[k] || "";
const allocTag = (st: string) => (st === "Issued" ? "go" : st === "Cancelled" ? "late" : "hold");

/* ---- a receipt line, as the Money section draws one ---- */
function TxLine({ s, t }: { s: ImPageProps["s"]; t: ReturnType<typeof allotTxns>[number] }) {
  return (
    <div className="led">
      <span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold" : "go"}`}>{t.kind}</span>
      <span style={{ minWidth: 0 }}><b className="mono">{t.id}</b>
        <div className="sm">{t.mode} <span className="mono">{t.utr}</span>{" · "}
          <ImPname s={s} k={t.by} first />{" · "}<span className="mono">{day6(t.on)}</span>{" · " + t.rec}{t.note ? " · " + t.note : ""}</div></span>
      <span className={`amt ${t.kind === "refund" ? "out" : ""}`}>{(t.kind === "refund" ? "−" : "") + money(t.amt)}</span>
    </div>
  );
}

/* ---- Allotments card on "What they hold" ---- */
export function AllotCard(p: P) {
  const { s, me, dispatch, x } = p;
  const rows = allotsOf(s, me, x.id);
  if (!rows.length) return null;
  const fin = !notFin(s, me);
  const open = mxOf(p, "al:" + x.id);             /* "<allotment id>|receipts" or "<allotment id>|payouts" */
  const [oid, otab] = open.split("|");
  const toggle = (id: string, tab: string) => dispatch({ type: "mset", k: "al:" + x.id, v: oid === id && otab === tab ? "" : id + "|" + tab });
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Allotments</h3><div className="sp" />
      <span className="sm">{rows.length} farm LLP{rows.length === 1 ? "" : "s"} · one record each</span></div>
      <div className="tw"><table>
        <thead><tr><th>Farm (LLP)</th><th className="n">Units</th>{fin ? <th className="n">Amount</th> : null}<th>Allocation</th>
          <th>Agreement</th>{fin ? <th>Payment</th> : null}<th></th></tr></thead>
        <tbody>{rows.map(a => {
          const l = llpOf(s, a.LLP_Lookup);
          const n = allotTxns(s, me, a).length, po = payoutsOf(s, me, a.id);
          return (
            <AllotRow key={a.id} {...p} a={a} fin={fin}
              cells={<>
                <td><a className="lnk" role="button" tabIndex={0} onClick={() => l && dispatch({ type: "openDrawer", k: "llp", id: l.id })}
                  onKeyDown={e => { if (e.key === "Enter" && l) dispatch({ type: "openDrawer", k: "llp", id: l.id }); }}>{llpName(s, a)}</a>
                  <div className="sm mono">{a.id}</div></td>
                <td className="n">{allotUnits(a)}</td>
                {fin ? <td className="n mono">{money(allotAmount(a))}<div className="sm">{money(a.Unit_Price)} a unit, as recorded</div></td> : null}
                <td><TagDot c={allocTag(a.Allocation_Status)}>{a.Allocation_Status}</TagDot></td>
                <td className="sm">{agreementSigned(s, a) ? "Signed" : "Not signed"}</td>
                {fin ? <td><span className={`tag ${payTagClass(allotPayStatus(s, a))}`}>{allotPayStatus(s, a)}</span></td> : null}
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fin ? <>
                  <button className={`chip ${oid === a.id && otab === "receipts" ? "on" : ""}`} onClick={() => toggle(a.id, "receipts")}>Receipts <span className="u">{n}</span></button>{" "}
                  {mayPayouts(s, me) ? <button className={`chip ${oid === a.id && otab === "payouts" ? "on" : ""}`} onClick={() => toggle(a.id, "payouts")}>Payouts <span className="u">{po.length}</span></button> : null}
                </> : null}</td>
              </>}
              open={oid === a.id ? otab : ""} />
          );
        })}</tbody></table></div>
      {fin ? <div className="cb"><p className="sm" style={{ margin: 0 }}>An allotment is one investor on one farm. Its receipts and its monthly payouts belong to it, so each farm&apos;s money adds up from the same records.</p></div> : null}
    </div>
  );
}
function AllotRow(p: P & { a: ImAllot; fin: boolean; cells: ReactNode; open: string }) {
  const { s, me, dispatch, a, fin, cells, open } = p;
  const cols = fin ? 7 : 4;
  return (
    <>
      <tr>{cells}</tr>
      {open === "receipts" ? <tr><td colSpan={cols}>
        {allotTxns(s, me, a).length ? allotTxns(s, me, a).map(t => <TxLine key={t.id} s={s} t={t} />)
          : <div className="empty">No receipt is linked to this allotment yet.</div>}
      </td></tr> : null}
      {open === "payouts" ? <tr><td colSpan={cols}><Payouts s={s} me={me} dispatch={dispatch} a={a} /></td></tr> : null}
    </>
  );
}

/* ---- the Payouts tab on one allotment (M10-S20) ---- */
function Payouts({ s, me, dispatch, a }: ImPageProps & { a: ImAllot }) {
  const po = payoutsOf(s, me, a.id);
  if (!po.length) return <div className="empty">{a.Allocation_Status === "Issued"
    ? "No payouts scheduled." : "The 60-month schedule is created when the allotment is issued."}</div>;
  const mo = thisMonth(s.data.NOW);
  const paid = po.filter(x => x.Payout_State === "Paid");
  return (
    <>
      <p className="sm" style={{ margin: "4px 0 8px" }}>{po.length} monthly payouts at {a.Annual_Rental_Yield}% a year · {paid.length} paid,{" "}
        {inr(paid.reduce((n, x) => n + x.Net_Amount, 0))} net so far. TDS is typed by Finance; net = gross − TDS.</p>
      <div className="tw" style={{ maxHeight: 360, overflow: "auto" }}><table>
        <thead><tr><th className="n">#</th><th>Month</th><th>Due</th><th className="n">Gross</th><th className="n">TDS</th><th className="n">Net</th>
          <th>State</th><th>Paid</th><th></th></tr></thead>
        <tbody>{po.map(x => (
          <tr key={x.id}>
            <td className="n sm">{x.Instalment_No}</td>
            <td className="sm">{fmtDate(x.Period_Month)}</td>
            <td className="sm mono">{fmtDate(x.Due_On)}</td>
            <td className="n mono">{inr(x.Gross_Amount)}</td>
            <td className="n mono sm">{x.TDS_Amount ? inr(x.TDS_Amount) : "—"}</td>
            <td className="n mono"><b>{inr(x.Net_Amount)}</b></td>
            <td><TagDot c={poTagClass(x.Payout_State)}>{x.Payout_State}</TagDot>{x.Payout_Note ? <div className="sm">{x.Payout_Note}</div> : null}</td>
            <td className="sm">{x.Paid_On ? <>{fmtDate(x.Paid_On)} · {x.Payout_Mode} <span className="mono">{x.Payout_UTR}</span> · {who(s, x.Paid_By).n.split(" ")[0]}</> : "—"}</td>
            <td style={{ textAlign: "right" }}>{may(s, me, "pay") && x.Payout_State !== "Paid" && x.Payout_State !== "Cancelled" && x.Due_On.slice(0, 7) <= mo
              ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "payout", id: x.id })}>Mark paid</button> : null}</td>
          </tr>
        ))}</tbody></table></div>
    </>
  );
}

/* ---- Money: per-farm blocks when there are several allotments (M10-S08) ---- */
export const allotCount = (p: P): number => allotsOf(p.s, p.me, p.x.id).length;
/** the Payment_Status tag the Money card's header carries when there is one allotment */
export function MoneyStatusTag(p: P) {
  const rows = allotsOf(p.s, p.me, p.x.id);
  if (rows.length !== 1) return null;
  const st = allotPayStatus(p.s, rows[0]);
  return <span className={`tag ${payTagClass(st)}`} title="Payment status of the allotment, from matched receipts">{st}</span>;
}
export function MoneyBlocks(p: P) {
  const { s, me, x } = p;
  const rows = allotsOf(s, me, x.id), loose = unlinkedTxns(s, me, x.id);
  const paid = rows.reduce((n, a) => n + allotPaid(s, me, a), 0), due = rows.reduce((n, a) => n + allotDue(s, me, a), 0);
  return (
    <>
      {rows.map(a => {
        const t = allotTxns(s, me, a);
        return (
          <div className="drwsec" key={a.id} style={{ marginTop: 0, marginBottom: 10 }}>
            <p className="lbl" style={{ display: "flex", gap: 8, alignItems: "center" }}><span>{llpName(s, a)}</span>
              <span className={`tag ${payTagClass(allotPayStatus(s, a))}`}>{allotPayStatus(s, a)}</span></p>
            <p className="sm" style={{ margin: "0 0 6px" }}>{allotUnits(a)} unit{allotUnits(a) === 1 ? "" : "s"} · {money(allotAmount(a))} · paid {money(allotPaid(s, me, a))} · due {money(allotDue(s, me, a))}</p>
            {t.length ? t.map(y => <TxLine key={y.id} s={s} t={y} />) : <p className="sm" style={{ margin: 0 }}>Nothing received on this farm yet.</p>}
          </div>
        );
      })}
      {loose.length ? <div className="drwsec" style={{ marginTop: 0, marginBottom: 10 }}><p className="lbl">Not linked to a farm</p>
        {loose.map(y => <TxLine key={y.id} s={s} t={y} />)}</div> : null}
      <div className="led"><span style={{ minWidth: 0, flex: 1 }}><b>Total across {rows.length} farms</b>
        <div className="sm">paid {money(paid + loose.filter(t => t.kind !== "refund" && t.kind !== "forfeit").reduce((n, t) => n + t.amt, 0))} · due {money(due)}</div></span>
        <span className="amt">{money(rows.reduce((n, a) => n + allotAmount(a), 0))}</span></div>
    </>
  );
}

/* ---- App access (M10-S21) — with Preview app (M10-S22) and Test sign-in link (M10-S23) ---- */
export function AppAccessCard(p: P) {
  const { s, me, dispatch, x } = p;
  const a = accessOf(s, me, x.id);
  const v = accessView(a);
  /* the investor app writes App_Welcome_At back once the email is out (stub receiver until MA1) */
  useEffect(() => {
    if (v.k !== "sending" || !mayAccess(s, me)) return;
    const t = setTimeout(() => dispatch({ type: "welcomeDelivered", id: x.id }), 1500);
    return () => clearTimeout(t);
  }, [v.k, s, me, dispatch, x.id]);
  const canWrite = mayAccess(s, me);
  const tag = v.k === "delivered" ? "go" : v.k === "locked" ? "late" : v.k === "sending" ? "br" : v.k === "hold" ? "due" : "";
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>App access</h3><div className="sp" />
      <span className={`tag ${tag}`}><span className="dot" />{v.k === "none" ? "no account" : v.k === "hold" ? "on hold" : v.k === "locked" ? "locked" : v.k === "sending" ? "sending" : "unlocked"}</span></div>
      <div className="cb">
        <p style={{ margin: 0 }}><b>{v.t}</b></p>
        {a && a.Locked_Reason ? <p className="sm" style={{ margin: "4px 0 0" }}>{a.Locked_Reason} · {who(s, a.Locked_By).n} · <span className="mono">{a.Locked_At}</span></p> : null}
        {canWrite && a ? <div className="drwsec"><div className="chips">
          {a.App_Access === "Hold"
            ? <button className="chip on" onClick={() => dispatch({ type: "sendWelcome", id: x.id })}>Send welcome and unlock</button>
            : <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "applock", id: x.id })}>Lock app access</button>}
        </div>
          <p className="sm" style={{ margin: "9px 0 0" }}>The welcome never goes by itself: the account opens on hold at the first matched money and waits for this button. Every change is on their Activity.</p></div>
          : <p className="sm" style={{ margin: "9px 0 0" }}>Finance controls app access.</p>}
        {mayPreview(s, me, x.id) || mayTestLink(s, me) ? <div className="drwsec"><div className="chips">
          {mayPreview(s, me, x.id) ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "preview", id: x.id })}>Preview app</button> : null}
          {mayTestLink(s, me) ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "testlink", id: x.id })}>Test sign-in link</button> : null}
        </div>{isSuper(s, me) ? <p className="sm" style={{ margin: "9px 0 0" }}>The preview is a mock-up with their figures. The test link opens the real app as them, once, for 10 minutes.</p> : null}</div> : null}
      </div></div>
  );
}

/* ---- ARL holdings (M10-S09), read-only ---- */
export function ArlHoldings(p: P) {
  const { s, me, dispatch, x } = p;
  if (!mayHoldings(s, me) || !I(s, me, x.id)) return null;
  const hs = holdingsOf(s, me, x.id);
  const open = mxOf(p, "arl:" + x.id);
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>ARL holdings</h3><div className="sp" /><span className="sm">read only</span></div>
      <div className="cb">{hs.length ? hs.map(h => (
        <div key={h.id}>
          <div className="led" role="button" tabIndex={0} style={{ cursor: "pointer" }} aria-expanded={open === h.id}
            onClick={() => dispatch({ type: "mset", k: "arl:" + x.id, v: open === h.id ? "" : h.id })}
            onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "mset", k: "arl:" + x.id, v: open === h.id ? "" : h.id }); }}>
            <span className="tag br">{h.Instrument_Type}</span>
            <span style={{ minWidth: 0 }}><b>{open === h.id ? "▾" : "▸"} {h.id}</b>
              <div className="sm">since {fmtDate(h.Invested_On)}{h.Interest_Rate != null ? " · " + h.Interest_Rate + "% interest" : ""}{h.Maturity_On ? " · matures " + fmtDate(h.Maturity_On) : ""}</div></span>
            <span className="amt">{money(h.Amount_Invested)}</span>
          </div>
          {open === h.id ? <div style={{ paddingLeft: 18 }}>{arlTxnsOf(s, h).length ? arlTxnsOf(s, h).map(t => (
            <div className="led" key={t.id}><span className="tag">{t.Type}</span>
              <span style={{ minWidth: 0 }}><span className="sm mono">{fmtDate(t.Date)}</span></span><span className="amt">{money(t.Amount)}</span></div>
          )) : <p className="sm" style={{ margin: 0 }}>No transactions on this holding.</p>}</div> : null}
        </div>
      )) : <div className="empty">No ARL holdings</div>}
        <p className="sm" style={{ margin: "10px 0 0" }}>Corporate instruments held with ARL, not farm units. Shown as Zoho holds them; nobody changes them from here.</p>
      </div></div>
  );
}
