"use client";

/* 12. TRANSACTIONS — imx.js 1912–1957 (vTxn, 1918), titled "Payments" on the page. A register: a list
   with a filter and a way in. M10-S01-W1: the rows, the chip counts and the totals are GET /api/payments
   (lib/data/endpoints/payments) — received, refunded, net banked and still due are MATCHED money only (D21); what
   is recorded and not yet matched is shown apart. The Match it button is M10-S02 (../money/pages). */

import { Tw } from "@/components/ui";
import { useState } from "react";
import { day6, fmtDate, money, pageReadable, refShown, REVWHY, TXNF } from "@/lib/im";
import type { ImTxn } from "@/lib/im";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { paymentsRegister, revealReceiptRef, type RegisterArgs, type RegisterRowView } from "@/lib/data/endpoints/payments";
import { claimList } from "@/lib/data/endpoints/receipts";
import { claimLine } from "../dash";
import { ImPname, type ImPageProps } from "../common";
import { StepUp } from "../stepup";
import { MatchCell, PayoutsDue } from "../money/pages";
import { StatementCard } from "../money/statement";

/** each chip is one cut of the route (the counts come back for every chip whichever is on) */
const CUT: Record<string, RegisterArgs> = { all: {}, adv: { kind: "advance" }, full: { kind: "full" }, out: { kind: "out" }, pend: { reconciled: false } };
const COUNT: Record<string, "all" | "advance" | "full" | "out" | "pending"> = { all: "all", adv: "advance", full: "full", out: "out", pend: "pending" };

/** the row as the book's own ImTxn, for the pieces that are not wired here (Match it reads it) */
const asTxn = (r: RegisterRowView): ImTxn => ({ id: r.id, inv: r.investor.id ?? "", kind: r.kind, amt: r.amount, mode: r.mode ?? "", utr: r.utr ?? "",
  on: r.receivedOn ?? "", by: r.recordedById ?? "", rec: r.reconciled ? "matched" : "pending" });
/** the demo book stamps "02 Sep 10:00"; the route sends "2026-09-02" */
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v).slice(0, 6) : day6(v));

/** The reference, masked ("SWIFT · ••• 8119"), with "Show the reference" for a seat that holds the reveal right (rule 7, D13/D22).
 *  M18-S05-NOTE-3: the reason first — the bank-account chips every other reveal asks (REVWHY.acct, common.tsx Pii) — then,
 *  live, step-up and POST /api/receipts/[id]/reveal { why }, which files the reason on the Plane C line. Fixture: the
 *  reducer's logged revealRef with the same reason (no Zoho to sign in to again). Either way "Hide" covers it again. */
function RefCells({ s, me, dispatch, t }: ImPageProps & { t: RegisterRowView }) {
  const mode = useApiMode();
  const reveal = useApiWrite(revealReceiptRef, { s, me }, dispatch);
  const [full, setFull] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const fixtureFull = mode === "fixture" && refShown(s, me, t.id) ? s.data.TXN.find(x => x.id === t.id)?.utr ?? null : null;
  const open = fixtureFull ?? full;
  if (t.utrHidden) return <><td className="sm">{t.mode ?? "—"} <span className="mono">Finance only</span></td><td></td></>;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  /* the asking row lives in the store (REVASK f "ref"), like the investor record's reveals */
  const choosing = s.ui.REVASK?.f === "ref" && s.ui.REVASK.id === t.id;
  const choose = (r: string) => {
    dispatch({ type: "revCancel" });
    if (mode === "fixture") void reveal({ id: t.id, why: r }); else setWhy(r);
  };
  /* the control sits in a cell of its own, so the row's text (the investor, the amount) is what names it */
  return (
    <>
      <td className="sm">{t.mode ?? "—"} · <span className="mono">{open ?? t.utrMask ?? "—"}</span>
        {open ? <span className="sm" style={{ display: "block" }}>shown — this is in the activity log</span> : null}</td>
      <td className="sm" onClick={stop} onKeyDown={stop}>
        {open ? (
          <button className="chip" title="Cover it again"
            onClick={() => { setFull(null); if (fixtureFull) dispatch({ type: "hideAll" }); }}>Hide the reference</button>
        ) : t.canReveal ? (
          <>
            <button className="chip" title="Shows the whole reference and writes your name, the minute and your reason into the log"
              onClick={() => dispatch({ type: "refAsk", id: t.id })}>Show the reference</button>
            {choosing ? (
              <div className="note" style={{ marginTop: 7 }}>
                <b>Why do you need it?</b> This goes in the log with your name against it.
                <div className="chips" style={{ marginTop: 7 }}>
                  {REVWHY.acct.map(r => <button key={r} className="chip" onClick={() => choose(r)}>{r}</button>)}
                  <button className="chip" onClick={() => dispatch({ type: "revCancel" })}>Cancel</button>
                </div>
              </div>
            ) : null}
            <StepUp action={why ? "reveal" : null} what="before the reference is shown"
              onOpen={() => { const w = why; setWhy(null); void reveal({ id: t.id, why: w }).then(r => { if (r.ok) setFull(r.data.utr); }); }}
              onCancel={() => setWhy(null)} />
          </>
        ) : null}
      </td>
    </>
  );
}

/** M10-S03-W2 — the IR's payment reports still waiting on Finance (GET /api/claims). A report is not money and is not in the register
 *  below: "Answer it" opens the claim drawer, which confirms it (a receipt, one per press) or says why it is not there yet. A seat
 *  that does not answer reports (the route's 403) sees nothing here, and so does Finance when none is waiting. */
function ClaimsWaiting({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(claimList, { s, me }, undefined);
  if (r.state !== "ok" || !r.data.claims.length) return r.state === "error" && r.err.status !== 403 ? <div className="note bad" role="alert">{r.err.error}</div> : null;
  const { claims } = r.data;
  return (
    <div className="card fill" style={{ marginBottom: 12 }}><div className="ch"><h3>Payment reports waiting on Finance</h3><div className="sp" />
      <span className="tag due"><span className="dot" />{claims.length}</span></div>
      <div className="cb"><div className="q">{claims.map(c => (
        <div className="qc now" key={c.claimId}>
          <div className="who2"><b>{claimLine(c)}</b>
            <span>{"reported by "}<ImPname s={s} k={c.byId} first />{" · "}<span className="mono">{c.claimId}</span></span></div>
          <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "claim", id: c.claimId })}>Answer it</button>
        </div>))}</div></div></div>
  );
}

export function ImTxn({ s, me, dispatch }: ImPageProps) {
  const TFILT = s.ui.TFILT;
  const f = TFILT && TXNF[TFILT] ? TFILT : "all";
  const r = useApiRead(paymentsRegister, { s, me }, CUT[f]);
  if (!pageReadable(s, me, "txn")) return null;
  if (r.state === "idle" || r.state === "loading") return <div className="empty">Reading the register…</div>;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="note bad" role="alert">{r.err.error}</div>;
  const { rows, counts, totals } = r.data;
  const rec = totals.recorded;
  /* B-02b: reservations Zoho holds no unit price for are left out of "still due" — said, never silently */
  const unpriced = (r.data.problems ?? []).map(p => /^price-missing:(\d+)$/.exec(p)).find(Boolean);
  /* B-02: payments Zoho holds that the register could not read are left out of the list and the totals — said, never a blank page */
  const unread = (r.data.problems ?? []).map(p => /^receipt-[a-z]+:(\d+)$/.exec(p)).reduce((n, m) => n + (m ? Number(m[1]) : 0), 0);
  return (
    <>
      <div className="ph"><h1>Payments</h1>
        <span className="sub">every rupee, with the reason it moved</span><div className="sp"></div>
        <span className="sm">{counts.pending} not reconciled</span></div>
      <StatementCard s={s} me={me} dispatch={dispatch} />
      <ClaimsWaiting s={s} me={me} dispatch={dispatch} />
      <div className="stats">
        <div className="stat"><b>{money(totals.received)}</b><span>received</span></div>
        <div className="stat"><b>{money(totals.refunded)}</b><span>refunded</span></div>
        <div className="stat"><b>{money(totals.netBanked)}</b><span>net banked</span></div>
        <div className="stat"><b>{money(totals.stillDue)}</b>
          <span>still due</span></div>
      </div>
      {unpriced ? <div className="note bad" role="status" style={{ marginBottom: 8 }}>{unpriced[1] + (unpriced[1] === "1" ? " reservation has" : " reservations have")
        + " no unit price (or units) in Zoho, so “still due” leaves them out. Tell Digital Infrastructure."}</div> : null}
      {unread ? <div className="note bad" role="status" style={{ marginBottom: 8 }}>{unread + (unread === 1 ? " payment" : " payments")
        + " in Zoho could not be read, so the list and the totals above leave " + (unread === 1 ? "it" : "them") + " out. Tell Digital Infrastructure."}</div> : null}
      {rec.received || rec.refunded ? <p className="sm" style={{ margin: "0 0 8px" }}>Recorded, not yet matched: <b>{money(rec.received)}</b> in
        {rec.refunded ? <> and <b>−{money(rec.refunded)}</b> out</> : null} · not counted above until Finance matches it.</p> : null}
      <div className="secbar">{Object.entries(TXNF).map(([k, [t]]) => (
        <button key={k} className={`sc ${f === k ? "on" : ""}`}
          onClick={() => dispatch({ type: "setFilter", patch: { TFILT: k } })}>{t}<i>{counts[COUNT[k]]}</i></button>
      ))}</div>
      <div className="secw"><div className="card fill"><Tw><table>
        <thead><tr><th>Reference</th><th>Investor</th><th>Kind</th><th className="n">Amount</th>
          <th>Mode · UTR</th><th aria-label="Show or hide the reference"></th><th>Recorded</th><th>Reconciled</th></tr></thead>
        <tbody>{rows.length ? rows.map(t => (
          <tr className="k" key={t.id} onClick={() => { if (t.investor.id) dispatch({ type: "go", v: "inv", id: t.investor.id }); }} tabIndex={0}>
            <td className="mono">{t.ref ?? "—"}</td>
            <td>{t.investor.name ?? t.investor.code ?? "Investor not readable"}<div className="sm mono">{t.investor.code ?? ""}</div></td>
            <td><span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold"
              : t.kind === "forfeit" ? "due" : "go"}`}>{t.kind}</span></td>
            <td className="n mono"><b>{t.kind === "refund" ? "−" : ""}{money(t.amount)}</b></td>
            <RefCells s={s} me={me} dispatch={dispatch} t={t} />
            <td className="sm">{t.recordedById ? <ImPname s={s} k={t.recordedById} first /> : null} <span className="mono">{dayOf(t.receivedOn)}</span></td>
            <td>{t.reconciled ? <span className="tag go"><span className="dot"></span>matched</span>
              : <span className="tag due"><span className="dot"></span>pending</span>}
              <MatchCell s={s} me={me} dispatch={dispatch} t={asTxn(t)} /></td></tr>
        )) : <tr><td colSpan={8}><div className="empty">Nothing in this cut.</div></td></tr>}
        </tbody></table></Tw></div>
        <PayoutsDue s={s} me={me} dispatch={dispatch} /></div>
    </>
  );
}
