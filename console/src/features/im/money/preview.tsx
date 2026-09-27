"use client";

/* App preview (M10-S22, D93 §4): a phone-sized, read-only mock-up of the investor app, filled with
   this investor's own figures as this seat reads them. No Growize App Design reference is in the
   repo, so it is kept plain and labelled as a mock-up; nothing in it changes data — only the tab
   strip moves. */

import type { ReactNode } from "react";
import {
  PREVIEW_TABS, allotPayStatus, allotUnits, docOf, fmtDate, llpName, llpOf, maskAcct, maskPan, money, notFin, portfolioOf,
} from "@/lib/im";
import type { ImAllot } from "@/lib/im";
import type { ImPageProps } from "../common";

const Row = ({ l, r }: { l: ReactNode; r: ReactNode }) => (
  <div className="led"><span style={{ minWidth: 0, flex: 1 }}>{l}</span><span className="amt">{r}</span></div>
);

export function AppPreview({ s, me, dispatch, id }: ImPageProps & { id: string }) {
  const P = portfolioOf(s, me, id); if (!P) return null;
  const { x } = P;
  const key = "pv:" + id;
  const tab = (s.ui.MX || {})[key] || "Home";
  const projKey = "pvp:" + id;
  const proj: ImAllot | null = P.al.find(a => a.id === (s.ui.MX || {})[projKey]) || P.al[0] || null;
  const docs = docOf(s, me, id).filter(d => d.state === "signed" || d.state === "issued");
  const acts = s.data.OUTBOX.filter(o => o.inv === id)
    .concat(s.data.UPD.filter(u => u.to === "all" || (u.to === "allocated" && x.st === "allocated") || (u.to === "nri" && x.nri))
      .map(u => ({ at: u.on, inv: id, t: u.t, by: u.by })));
  const stage = [
    { t: "Reserved", done: true },
    { t: "Paid in full", done: x.st === "paid" || x.st === "allocated" },
    { t: "Allotted", done: x.st === "allocated" },
    { t: "Monthly payouts", done: P.payouts.some(p => p.Payout_State === "Paid") },
  ];
  return (
    <>
      <div className="note warn" style={{ marginBottom: 12 }}><b>Preview — mock-up, not the live app.</b> Filled from {x.n}&apos;s own figures as you can see them. Nothing here can be pressed to change anything.</div>
      <div role="tablist" aria-label="App screens" className="chips" style={{ marginBottom: 10 }}>
        {PREVIEW_TABS.map(t => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`}
          onClick={() => dispatch({ type: "mset", k: key, v: t })}>{t === "Project" ? "A project" : t}</button>)}
      </div>
      {tab === "Project" && P.al.length > 1 ? <div className="chips" style={{ marginBottom: 10 }}>{P.al.map(a =>
        <button key={a.id} className={`chip ${proj && proj.id === a.id ? "on" : ""}`} onClick={() => dispatch({ type: "mset", k: projKey, v: a.id })}>{llpName(s, a)}</button>)}</div> : null}
      <div aria-label="Phone-sized preview" style={{ width: 340, maxWidth: "100%", margin: "0 auto", border: "1px solid var(--line)",
        borderRadius: 28, padding: "18px 14px 22px", background: "var(--bg)", minHeight: 560, pointerEvents: "none", userSelect: "none" }}>
        <div className="sm" style={{ textAlign: "center", marginBottom: 10 }}>Growize · {tab === "Project" ? "Project" : tab}</div>
        {tab === "Home" ? (
          <div className="card"><div className="cb">
            <p className="sm" style={{ margin: 0 }}>Hello,</p><h3 style={{ margin: "2px 0 10px" }}>{x.n.split(" ")[0]}</h3>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="stat"><b>{P.units}</b><span>units</span></div>
              <div className="stat"><b>{money(P.invested)}</b><span>invested</span></div>
              <div className="stat"><b>{money(P.paidOut)}</b><span>paid out to you</span></div>
              <div className="stat"><b>{P.next ? fmtDate(P.next.Due_On).slice(0, 6) : "—"}</b><span>next payout</span></div>
            </div>
            <p className="lbl" style={{ marginTop: 12 }}>Where you are</p>
            {stage.map(g => <Row key={g.t} l={g.t} r={g.done ? "✓" : "…"} />)}
          </div></div>
        ) : null}
        {tab === "Projects" ? (
          <div className="card"><div className="cb">
            {P.al.length ? P.al.map(a => (
              <Row key={a.id} l={<><b>{llpName(s, a)}</b><div className="sm">{a.Allocation_Status} · {allotUnits(a)} unit{allotUnits(a) === 1 ? "" : "s"}</div></>}
                r={money(a.Ticket_Snapshot)} />
            )) : <p className="sm" style={{ margin: 0 }}>{Object.keys(x.blocks).map(k => "Block " + k).join(", ") || "No project yet"}</p>}
          </div></div>
        ) : null}
        {tab === "Project" ? (
          <div className="card"><div className="cb">
            {proj ? (() => {
              const l = llpOf(s, proj.LLP_Lookup);
              const f = l ? s.data.FARMS.find(y => y.k === l.Block_Code) : null;
              return (
                <>
                  <h3 style={{ margin: "0 0 6px" }}>{llpName(s, proj)}</h3>
                  <p className="sm" style={{ margin: "0 0 10px" }}>{f ? f.crop : l ? l.LLP_Status : ""}</p>
                  <Row l="Your units" r={allotUnits(proj)} />
                  <Row l="Price a unit (as recorded)" r={money(proj.Unit_Price)} />
                  <Row l="Payment" r={allotPayStatus(s, proj)} />
                  <Row l="Yield" r={proj.Annual_Rental_Yield + "% a year"} />
                  {f ? s.data.FIELD.filter(n => n.blk === f.k).slice(0, 2).map(n => <Row key={n.id} l={<span className="sm">{n.head}</span>} r={n.at.slice(0, 6)} />) : null}
                </>
              );
            })() : <p className="sm" style={{ margin: 0 }}>No project yet.</p>}
          </div></div>
        ) : null}
        {tab === "Financials" ? (
          <div className="card"><div className="cb">
            <Row l="Invested" r={money(P.invested)} />
            <Row l="Current value" r={money(P.value)} />
            <Row l="Paid out" r={money(P.paidOut)} />
            <p className="lbl" style={{ marginTop: 12 }}>Payouts</p>
            {P.payouts.filter(p => p.Payout_State !== "Scheduled").slice(-4).map(p =>
              <Row key={p.id} l={<>{fmtDate(p.Period_Month)}<div className="sm">{p.Payout_State}</div></>} r={money(p.Net_Amount)} />)}
            {P.next ? <Row l={<>Next · {fmtDate(P.next.Due_On)}<div className="sm">Scheduled</div></>} r={money(P.next.Net_Amount)} />
              : <p className="sm" style={{ margin: 0 }}>Payouts start once the units are allotted.</p>}
          </div></div>
        ) : null}
        {tab === "Documents" ? (
          <div className="card"><div className="cb">
            {docs.length ? docs.map(d => <Row key={d.id} l={<>{d.t}<div className="sm">{d.cls}</div></>} r={(d.on || d.sent).slice(0, 6)} />)
              : <p className="sm" style={{ margin: 0 }}>Nothing signed yet.</p>}
          </div></div>
        ) : null}
        {tab === "Activity" ? (
          <div className="card"><div className="cb">
            {acts.length ? acts.slice(0, 8).map((a, i) => <Row key={i} l={a.t} r={a.at.slice(0, 6)} />)
              : <p className="sm" style={{ margin: 0 }}>Nothing yet.</p>}
          </div></div>
        ) : null}
        {tab === "Profile" ? (
          <div className="card"><div className="cb">
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Name</dt><dd>{x.n}</dd><dt>Email</dt><dd className="mono">{x.em}</dd><dt>Mobile</dt><dd className="mono">{x.ph}</dd>
              <dt>City</dt><dd>{x.city || "—"}</dd><dt>Nominee</dt><dd>{x.nominee || "—"}</dd>
              <dt>PAN</dt><dd className="mono">{notFin(s, me) ? "Finance only" : maskPan(x.pan)}</dd>
              <dt>Bank</dt><dd className="mono">{notFin(s, me) ? "Finance only" : maskAcct(x.bank.acct)}</dd>
            </dl>
          </div></div>
        ) : null}
      </div>
    </>
  );
}
