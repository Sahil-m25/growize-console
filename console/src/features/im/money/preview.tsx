"use client";

/* App preview (M10-S22, D93 §4): a phone-sized, read-only mock-up of the investor app, filled with
   this investor's own figures as this seat reads them. No Growize App Design reference is in the
   repo, so it is kept plain and labelled as a mock-up; nothing in it changes data — only the tab
   strip moves.
   M10-S22-W1: the figures are GET /api/investors/[id]/preview (lib/data/endpoints/app). Where a seat reads no amounts the route
   sends null and the screen says so; PAN and bank are always "Finance only". */

import type { ReactNode } from "react";
import { fmtDate, money } from "@/lib/im";
import { useApiRead } from "@/lib/data/api";
import { appPreview } from "@/lib/data/endpoints/app";
import type { ImPageProps } from "../common";

const Row = ({ l, r }: { l: ReactNode; r: ReactNode }) => (
  <div className="led"><span style={{ minWidth: 0, flex: 1 }}>{l}</span><span className="amt">{r}</span></div>
);
const amt = (v: number | null) => (v == null ? "—" : money(v));
/** "2026-09-23" → "23 Sep"; anything else (the demo book's own "23 Sep") is cut to the day */
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v).slice(0, 6) : (v || "—").slice(0, 6));

export function AppPreview({ s, me, dispatch, id }: ImPageProps & { id: string }) {
  const r = useApiRead(appPreview, { s, me }, id);
  if (r.state === "idle") return null;
  if (r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Building the preview…</p>;
  if (r.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{r.err.error}</p>;
  const P = r.data.preview;
  const key = "pv:" + id;
  const tab = (s.ui.MX || {})[key] || "Home";
  const projKey = "pvp:" + id;
  const proj = P.projects.find(a => a.allotmentId === (s.ui.MX || {})[projKey]) || P.projects[0] || null;
  const payouts = P.financials.payouts.filter(p => p.state !== "Scheduled");
  const next = P.home.nextPayout;
  return (
    <>
      <div className="note warn" style={{ marginBottom: 12 }}><b>{P.label}.</b> Filled from {P.home.name}&apos;s own figures as you can see them. Nothing here can be pressed to change anything.</div>
      <div role="tablist" aria-label="App screens" className="chips" style={{ marginBottom: 10 }}>
        {P.tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={`chip ${tab === t ? "on" : ""}`}
          onClick={() => dispatch({ type: "mset", k: key, v: t })}>{t === "Project" ? "A project" : t}</button>)}
      </div>
      {tab === "Project" && P.projects.length > 1 ? <div className="chips" style={{ marginBottom: 10 }}>{P.projects.map(a =>
        <button key={a.allotmentId} className={`chip ${proj && proj.allotmentId === a.allotmentId ? "on" : ""}`} onClick={() => dispatch({ type: "mset", k: projKey, v: a.allotmentId })}>{a.name}</button>)}</div> : null}
      <div aria-label="Phone-sized preview" style={{ width: 340, maxWidth: "100%", margin: "0 auto", border: "1px solid var(--line)",
        borderRadius: 28, padding: "18px 14px 22px", background: "var(--bg)", minHeight: 560, pointerEvents: "none", userSelect: "none" }}>
        <div className="sm" style={{ textAlign: "center", marginBottom: 10 }}>Growize · {tab === "Project" ? "Project" : tab}</div>
        {tab === "Home" ? (
          <div className="card"><div className="cb">
            <p className="sm" style={{ margin: 0 }}>Hello,</p><h3 style={{ margin: "2px 0 10px" }}>{P.home.firstName}</h3>
            <div className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="stat"><b>{P.home.units}</b><span>units</span></div>
              <div className="stat"><b>{amt(P.home.invested)}</b><span>invested</span></div>
              <div className="stat"><b>{amt(P.home.paidOut)}</b><span>paid out to you</span></div>
              <div className="stat"><b>{next ? day(next.dueOn) : "—"}</b><span>next payout</span></div>
            </div>
            <p className="lbl" style={{ marginTop: 12 }}>Where you are</p>
            {P.home.stages.map(g => <Row key={g.t} l={g.t} r={g.done ? "✓" : "…"} />)}
          </div></div>
        ) : null}
        {tab === "Projects" ? (
          <div className="card"><div className="cb">
            {P.projects.length ? P.projects.map(a => (
              <Row key={a.allotmentId} l={<><b>{a.name}</b><div className="sm">{a.status} · {a.units} unit{a.units === 1 ? "" : "s"}</div></>} r={a.paymentStatus ?? "—"} />
            )) : <p className="sm" style={{ margin: 0 }}>No project yet</p>}
          </div></div>
        ) : null}
        {tab === "Project" ? (
          <div className="card"><div className="cb">
            {proj ? (
              <>
                <h3 style={{ margin: "0 0 6px" }}>{proj.name}</h3>
                <p className="sm" style={{ margin: "0 0 10px" }}>{proj.status}</p>
                <Row l="Your units" r={proj.status === "Issued" ? proj.issued : proj.units} />
                <Row l="Payment" r={proj.paymentStatus ?? "—"} />
                {proj.holdUntil ? <Row l="Held until" r={day(proj.holdUntil)} /> : null}
              </>
            ) : <p className="sm" style={{ margin: 0 }}>No project yet.</p>}
          </div></div>
        ) : null}
        {tab === "Financials" ? (
          <div className="card"><div className="cb">
            <Row l="Invested" r={amt(P.financials.invested)} />
            <Row l="Still due" r={amt(P.financials.due)} />
            <Row l="Paid out" r={amt(P.financials.paidOut)} />
            <p className="lbl" style={{ marginTop: 12 }}>Payouts</p>
            {payouts.slice(-4).map(p =>
              <Row key={p.id} l={<>{fmtDate(p.month)}<div className="sm">{p.state}</div></>} r={amt(p.net)} />)}
            {next ? <Row l={<>Next · {fmtDate(next.dueOn)}<div className="sm">Scheduled</div></>} r={amt(next.net)} />
              : <p className="sm" style={{ margin: 0 }}>Payouts start once the units are allotted.</p>}
            {!r.data.preview.amounts ? <p className="sm" style={{ margin: "8px 0 0" }}>Your seat does not read amounts.</p> : null}
          </div></div>
        ) : null}
        {tab === "Documents" ? (
          <div className="card"><div className="cb">
            {P.documents === null ? <p className="sm" style={{ margin: 0 }}>Your seat does not read paper.</p>
              : P.documents.length ? P.documents.map(d => <Row key={d.id} l={<>{d.name}<div className="sm">{d.scope}</div></>} r={day(d.at)} />)
                : <p className="sm" style={{ margin: 0 }}>Nothing signed yet.</p>}
          </div></div>
        ) : null}
        {tab === "Activity" ? (
          <div className="card"><div className="cb">
            {P.activity.length ? P.activity.slice(0, 8).map((a, i) => <Row key={i} l={a.t} r={day(a.at)} />)
              : <p className="sm" style={{ margin: 0 }}>Nothing yet.</p>}
          </div></div>
        ) : null}
        {tab === "Profile" ? (
          <div className="card"><div className="cb">
            <dl className="kv" style={{ marginTop: 0 }}>
              <dt>Name</dt><dd>{P.profile.name}</dd><dt>Email</dt><dd className="mono">{P.profile.email}</dd><dt>Mobile</dt><dd className="mono">{P.profile.mobile}</dd>
              <dt>City</dt><dd>{P.profile.city || "—"}</dd><dt>Nominee</dt><dd>{P.profile.nominee || "—"}</dd>
              <dt>PAN</dt><dd className="mono">{P.profile.pan}</dd>
              <dt>Bank</dt><dd className="mono">{P.profile.bank}</dd>
            </dl>
          </div></div>
        ) : null}
      </div>
    </>
  );
}
