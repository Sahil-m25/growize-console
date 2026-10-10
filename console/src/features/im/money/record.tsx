"use client";

/* The investor record's cards for the later owner decisions (not in the prototype):
   - Allotments (M11-S02, M10-S07): one row per farm LLP, each with a Receipts tab and a Payouts tab
     (M10-S20 — the schedule lives here, on the allotment; there is no payouts page).
   - Per-farm Money blocks (M10-S08) for an investor with several allotments.
   - App access (M10-S21) with Preview app (M10-S22) and Test sign-in link (M10-S23).
   - ARL holdings (M10-S09), read-only. */

import { Tw } from "@/components/ui";
import { useEffect, useState, type ReactNode } from "react";
import {
  I, accessOf, accessView, allotAmount, allotDue, allotOf, allotPaid, allotPayStatus, allotTxns, allotUnits, allotsOf,
  arlTxnsOf, day6, fmtDate, holdingsOf, inr, isSuper, llpName, llpOf, may, mayAccess, mayHoldings, mayPayouts, mayPreview,
  mayAskFullPaid, mayMarkFullPaid, mayTestLink, money, notFin, payoutsOf, thisMonth, unlinkedTxns, who,
} from "@/lib/im";
import type { ImAllot, ImInvestor } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";
import { payTagClass, poTagClass } from "./drawers";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { investorAllotments } from "@/lib/data/endpoints/allotments";
import { moneyBlocks, arlHoldings } from "@/lib/data/endpoints/payments";
import { payoutSchedule, payoutScheduleRun } from "@/lib/data/endpoints/payouts";
import { appCard, appUnlock } from "@/lib/data/endpoints/app";
import { OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN, TEN_PERCENT_HINT, TEN_PERCENT_UNKNOWN_HINT } from "@/lib/im/app-gate";
import { TenTrail } from "@/components/money/TenTrail";

type P = ImPageProps & { x: ImInvestor };
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;
const mxOf = (p: ImPageProps, k: string) => (p.s.ui.MX || {})[k] || "";
const allocTag = (st: string) => (st === "Issued" ? "go" : st === "Cancelled" ? "late" : "hold");

/* ---- a receipt line, as the Money section draws one ---- */
type Line = { id: string; kind: string; mode: string | null; utr: string | null; by: string | null; on: string | null; rec: string; note?: string; amt: number };
/** the demo book stamps "02 Sep 10:00"; a route sends "2026-09-02" */
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? fmtDate(v).slice(0, 6) : day6(v));
const lineOf = (t: ReturnType<typeof allotTxns>[number]): Line => ({ id: t.id, kind: t.kind, mode: t.mode, utr: t.utr, by: t.by, on: t.on, rec: t.rec, note: t.note, amt: t.amt });
function TxLine({ s, t }: { s: ImPageProps["s"]; t: Line }) {
  return (
    <div className="led">
      <span className={`tag ${t.kind === "refund" ? "late" : t.kind === "advance" ? "hold" : "go"}`}>{t.kind}</span>
      <span style={{ minWidth: 0 }}><b className="mono">{t.id}</b>
        <div className="sm">{t.mode} <span className="mono">{t.utr}</span>{" · "}
          {t.by ? <ImPname s={s} k={t.by} first /> : null}{" · "}<span className="mono">{dayOf(t.on)}</span>{" · " + t.rec}{t.note ? " · " + t.note : ""}</div></span>
      <span className={`amt ${t.kind === "refund" ? "out" : ""}`}>{(t.kind === "refund" ? "−" : "") + money(t.amt)}</span>
    </div>
  );
}

/* D137 ruling 3 / D138 ruling 6: who may mark fully paid by hand, or ask Finance to — lib/im/money.ts, where the drawer gate
   (drawerReadable) reads the same functions so a button never opens a drawer its gate refuses (W7-FIN-1) */
export { mayAskFullPaid, mayMarkFullPaid } from "@/lib/im";
/** D138: until the supplementary agreement is signed and verified the allotment cannot be marked fully paid (the route says 409). */
export const SUPP_WAIT_TEXT = "Waiting for the signed supplementary agreement — until Finance verifies it, this allotment cannot be marked fully paid.";

/* ---- Allotments card on "What they hold" ---- */
export function AllotCard(p: P) {
  const { s, me, dispatch, x } = p;
  /* M11-S02-W1: the rows are GET /api/investors/[id]/allotments (lib/data/endpoints/allotments). The Receipts and Payouts
     tabs still read the book's receipts and payouts until M10-S08-W1 / M10-S20 wire them, so they show only where the book holds the allotment. */
  const r = useApiRead(investorAllotments, { s, me }, x.id);
  if (r.state === "loading") return <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading the allotments…</p></div></div>;
  if (r.state === "error") return r.err.status === 403 || r.err.status === 404 ? null
    : <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>Allotments: {r.err.error}</p></div></div>;
  if (r.state !== "ok" || !r.data.allotments.length) return null;
  const rows = r.data.allotments, fin = r.data.money;
  const open = mxOf(p, "al:" + x.id);             /* "<allotment id>|receipts" or "<allotment id>|payouts" */
  const [oid, otab] = open.split("|");
  const toggle = (id: string, tab: string) => dispatch({ type: "mset", k: "al:" + x.id, v: oid === id && otab === tab ? "" : id + "|" + tab });
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Allotments</h3><div className="sp" />
      <span className="sm">{rows.length} farm LLP{rows.length === 1 ? "" : "s"} · one record each</span></div>
      <Tw><table>
        <thead><tr><th>Farm (LLP)</th><th className="n">Units</th>{fin ? <th className="n">Amount</th> : null}<th>Allocation</th>
          <th>Agreement</th>{fin ? <th>Payment</th> : null}<th></th></tr></thead>
        <tbody>{rows.map(l => {
          const a = allotOf(s, l.id);
          const n = a ? allotTxns(s, me, a).length : 0;
          const llpId = l.llp.id;
          return (
            <AllotRow key={l.id} {...p} a={a} fin={fin}
              cells={<>
                <td><a className="lnk" role="button" tabIndex={0} onClick={() => llpId && dispatch({ type: "openDrawer", k: "llp", id: llpId })}
                  onKeyDown={e => { if (e.key === "Enter" && llpId) dispatch({ type: "openDrawer", k: "llp", id: llpId }); }}>{l.llp.name ?? "—"}</a>
                  {l.linked ? null : <div><span className="tag late" data-testid="needs-link">Needs a link</span> <span className="sm">no {l.llp.id ? "Customer" : "LLP"} on this allotment — link it in Zoho</span></div>}
                  <div className="sm mono">{l.id}</div></td>
                <td className="n">{l.committedUnits}</td>
                {fin ? <td className="n mono">{l.amount == null ? "—" : money(l.amount)}<div className="sm">{l.unitPrice == null ? "" : money(l.unitPrice) + " a unit, as recorded"}</div></td> : null}
                <td><TagDot c={allocTag(l.status)}>{l.status}</TagDot></td>
                <td className="sm">{l.agreementSigned == null ? "—" : l.agreementSigned ? "Signed" : "Not signed"}</td>
                {fin ? <td>{l.paymentStatus ? <span className={`tag ${payTagClass(l.paymentStatus)}`}>{l.paymentStatus}</span> : "—"}</td> : null}
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fin && a ? <>
                  <button className={`chip ${oid === l.id && otab === "receipts" ? "on" : ""}`} onClick={() => toggle(l.id, "receipts")}>Receipts <span className="u">{n}</span></button>{" "}
                  {mayPayouts(s, me) ? <PayoutsChip s={s} me={me} a={a} on={oid === l.id && otab === "payouts"} onClick={() => toggle(l.id, "payouts")} /> : null}
                </> : null}
                  {/* D137 ruling 3 / D138: Finance or Digital Infrastructure convert a Reserved allotment in full by hand (logged); a KAM
                      asks Finance instead; neither before the supplementary is signed (agreementSigned false: the reason, no button) */}
                  {l.status === "Reserved" && (mayMarkFullPaid(s, me) || mayAskFullPaid(s, me)) && l.agreementSigned === false
                    ? <div className="sm" data-testid="supp-wait">{SUPP_WAIT_TEXT}</div>
                    : l.status === "Reserved" && mayMarkFullPaid(s, me) ? <>{" "}<button className="chip" onClick={() => {
                      dispatch({ type: "mset", k: "fp:allot:" + x.id, v: l.id }); dispatch({ type: "openDrawer", k: "fullpaid", id: x.id });
                    }}>Mark fully paid…</button></>
                      : l.status === "Reserved" && mayAskFullPaid(s, me) ? <>{" "}<button className="chip" onClick={() => {
                        dispatch({ type: "mset", k: "fp:allot:" + x.id, v: l.id }); dispatch({ type: "openDrawer", k: "fullpaidask", id: x.id });
                      }}>Ask Finance to confirm full payment…</button></> : null}</td>
              </>}
              open={oid === l.id ? otab : ""} />
          );
        })}</tbody></table></Tw>
      {fin ? <div className="cb"><p className="sm" style={{ margin: 0 }}>An allotment is one investor on one farm. Its receipts and its monthly payouts belong to it, so each farm&apos;s money adds up from the same records.</p></div> : null}
    </div>
  );
}
function AllotRow(p: P & { a: ImAllot | null; fin: boolean; cells: ReactNode; open: string }) {
  const { s, me, dispatch, a, fin, cells, open } = p;
  const cols = fin ? 7 : 4;
  return (
    <>
      <tr>{cells}</tr>
      {a && open === "receipts" ? <tr><td colSpan={cols}>
        {allotTxns(s, me, a).length ? allotTxns(s, me, a).map(t => <TxLine key={t.id} s={s} t={lineOf(t)} />)
          : <div className="empty">No receipt is linked to this allotment yet.</div>}
      </td></tr> : null}
      {a && open === "payouts" ? <tr><td colSpan={cols}><Payouts s={s} me={me} dispatch={dispatch} a={a} /></td></tr> : null}
    </>
  );
}

/* ---- the Payouts tab on one allotment (M10-S20) ----
   M10-S20-W1: the schedule is GET /api/payouts/allotments/[id]; Mark paid opens the drawer on it; an Issued allotment with none
   gets "Create the schedule" (POST /api/payouts/schedule — creates the missing of the 60, never a duplicate). */
function PayoutsChip({ s, me, a, on, onClick }: Pick<ImPageProps, "s" | "me"> & { a: ImAllot; on: boolean; onClick: () => void }) {
  const r = useApiRead(payoutSchedule, { s, me }, a.id);
  return <button className={`chip ${on ? "on" : ""}`} onClick={onClick}>Payouts <span className="u">{r.state === "ok" ? r.data.payouts.length : 0}</span></button>;
}
function Payouts({ s, me, dispatch, a }: ImPageProps & { a: ImAllot }) {
  const r = useApiRead(payoutSchedule, { s, me }, a.id);
  const run = useApiWrite(payoutScheduleRun, { s, me }, dispatch);
  if (r.state === "idle" || r.state === "loading") return <div className="empty">Reading the payouts…</div>;
  if (r.state === "error") return <div className="empty" role="alert">{r.err.error}</div>;
  const po = r.data.payouts;
  if (!po.length) return (
    <div className="empty">{a.Allocation_Status === "Issued" ? "No payouts scheduled." : "The 60-month schedule is created when the allotment is issued."}
      {a.Allocation_Status === "Issued" && may(s, me, "pay") ? <div style={{ marginTop: 8 }}>
        <button className="chip on" onClick={() => void run({ allotmentIds: [a.id] })}>Create the 60-month schedule</button></div> : null}</div>
  );
  const mo = thisMonth(s.data.NOW);
  const paid = po.filter(x => x.state === "Paid");
  return (
    <>
      <p className="sm" style={{ margin: "4px 0 8px" }}>{po.length} monthly payouts at {a.Annual_Rental_Yield}% a year · {paid.length} paid,{" "}
        {inr(paid.reduce((n, x) => n + x.net, 0))} net so far. TDS is typed by Finance; net = gross − TDS.</p>
      <Tw style={{ maxHeight: 360, overflow: "auto" }}><table>
        <thead><tr><th className="n">#</th><th>Month</th><th>Due</th><th className="n">Gross</th><th className="n">TDS</th><th className="n">Net</th>
          <th>State</th><th>Paid</th><th></th></tr></thead>
        <tbody>{po.map(x => (
          <tr key={x.id}>
            <td className="n sm">{x.instalment}</td>
            <td className="sm">{fmtDate(x.month)}</td>
            <td className="sm mono">{fmtDate(x.dueOn)}</td>
            <td className="n mono">{inr(x.gross)}</td>
            <td className="n mono sm">{x.tds ? inr(x.tds) : "—"}</td>
            <td className="n mono"><b>{inr(x.net)}</b></td>
            <td><TagDot c={poTagClass(x.state ?? "")}>{x.state}</TagDot></td>
            <td className="sm">{x.paidOn ? <>{fmtDate(x.paidOn)} · {x.mode} <span className="mono">{x.utrMasked}</span> · {(x.paidBy?.name ?? "").split(" ")[0]}</> : "—"}</td>
            <td style={{ textAlign: "right" }}>{may(s, me, "pay") && x.state !== "Paid" && x.state !== "Cancelled" && (x.dueOn ?? "").slice(0, 7) <= mo
              ? <button className="chip" onClick={() => { dispatch({ type: "mset", k: "po:al", v: a.id }); dispatch({ type: "openDrawer", k: "payout", id: x.id }); }}>Mark paid</button> : null}</td>
          </tr>
        ))}</tbody></table></Tw>
    </>
  );
}

/* ---- Money: per-farm blocks when there are several allotments (M10-S08) ---- */
export const allotCount = (p: P): number => allotsOf(p.s, p.me, p.x.id).length;
/** the Payment_Status tag of a single allotment (What they hold carries it; the Money card keeps the prototype's header) */
export function MoneyStatusTag(p: P) {
  const rows = allotsOf(p.s, p.me, p.x.id);
  if (rows.length !== 1) return null;
  const st = allotPayStatus(p.s, rows[0]);
  return <span className={`tag ${payTagClass(st)}`} title="Payment status of the allotment, from matched receipts">{st}</span>;
}
/* M10-S08-W1: the blocks are GET /api/investors/[id]/money — paid and due from MATCHED receipts, what is recorded and not
   yet matched apart (D21). The total is the route's, and only with two or more blocks. */
export function MoneyBlocks(p: P) {
  const { s, me, x } = p;
  const r = useApiRead(moneyBlocks, { s, me }, x.id);
  if (r.state === "idle" || r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the money…</p>;
  if (r.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{r.err.error}</p>;
  const { blocks, total, unlinked } = r.data.money;
  const asLine = (y: (typeof unlinked)[number]): Line => ({ id: y.id, kind: y.kind ?? "", mode: y.mode, utr: y.utr, by: y.byId, on: y.on,
    rec: y.matched ? "matched" : (y.matchState ?? "pending").toLowerCase(), amt: y.amount });
  return (
    <>
      {blocks.map(b => (
        <div className="drwsec" key={b.allotmentId} style={{ marginTop: 0, marginBottom: 10 }}>
          <p className="lbl" style={{ display: "flex", gap: 8, alignItems: "center" }}><span>{b.llp.name ?? b.llp.id}</span>
            <span className={`tag ${payTagClass(b.paymentStatus)}`}>{b.paymentStatus}</span></p>
          <p className="sm" style={{ margin: "0 0 6px" }}>{b.units} unit{b.units === 1 ? "" : "s"} · {money(b.amount)} · paid {money(b.paid)} · due {money(b.due)}
            {b.recorded ? " · recorded, not yet matched " + money(b.recorded) : ""}</p>
          {b.receipts.length ? b.receipts.map(y => <TxLine key={y.id} s={s} t={asLine(y)} />) : <p className="sm" style={{ margin: 0 }}>Nothing received on this farm yet.</p>}
        </div>
      ))}
      {unlinked.length ? <div className="drwsec" style={{ marginTop: 0, marginBottom: 10 }}><p className="lbl">Not linked to a farm</p>
        {unlinked.map(y => <TxLine key={y.id} s={s} t={asLine(y)} />)}</div> : null}
      {total ? <div className="led"><span style={{ minWidth: 0, flex: 1 }}><b>Total across {blocks.filter(b => b.countsInTotal).length} farms</b>
        <div className="sm">paid {money(total.paid)} · due {money(total.due)}</div></span>
        <span className="amt">{money(blocks.filter(b => b.countsInTotal).reduce((n, b) => n + b.amount, 0))}</span></div> : null}
    </>
  );
}

/* ---- App access (M10-S21) — with Preview app (M10-S22) and Test sign-in link (M10-S23) ----
   M10-S21-W1: the card is GET /api/investors/[id]/unlock; "Send welcome and unlock" is POST (the card's modifiedTime goes back as
   expectedModifiedTime, D44); Lock app access opens the drawer that sends DELETE. */
export function AppAccessCard(p: P) {
  const { s, me, dispatch, x } = p;
  const r = useApiRead(appCard, { s, me }, x.id);
  const unlock = useApiWrite(appUnlock, { s, me }, dispatch);
  const mode = useApiMode();
  const card = r.state === "ok" ? r.data.card : null;
  /* the investor app writes App_Welcome_At back once the email is out (stub receiver until MA1) — the demo's stand-in for that
     receiver runs in the fixture only; live, the card re-reads what the app really wrote (M08-S08-W1) */
  useEffect(() => {
    if (!card || card.state !== "sending" || !card.mayChange || mode !== "fixture") return;
    const t = setTimeout(() => dispatch({ type: "welcomeDelivered", id: x.id }), 1500);
    return () => clearTimeout(t);
  }, [card?.state, card?.mayChange, mode, dispatch, x.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (r.state === "idle" || r.state === "loading") return <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading the app account…</p></div></div>;
  if (!card) return r.state === "error" && r.err.status !== 403 ? <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>App access: {r.err.error}</p></div></div> : null;
  const last = card.history[0];
  const canWrite = card.mayChange;
  /* G2 (D136 proposed): the release waits for the 10% — the server refuses it too; the button says why it is shut */
  const gateShut = card.access === "Hold" && (card.tenPercent === "not-verified" || card.tenPercent === "unknown");
  const gateWhy = card.tenPercent === "unknown" ? TEN_PERCENT_UNKNOWN_HINT : TEN_PERCENT_HINT;
  const tag = card.state === "delivered" ? "go" : card.state === "locked" ? "late" : card.state === "sending" ? "br" : card.state === "hold" ? "due" : "";
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>App access</h3><div className="sp" />
      <span className={`tag ${tag}`}><span className="dot" />{card.state === "none" ? "no account" : card.state === "hold" ? "on hold" : card.state === "locked" ? "locked" : card.state === "sending" ? "sending" : "unlocked"}</span></div>
      <div className="cb">
        <p style={{ margin: 0 }}><b>{card.text}</b></p>
        {card.state === "locked" && last ? <p className="sm" style={{ margin: "4px 0 0" }}>{last.byId ? who(s, last.byId).n + " · " : ""}<span className="mono">{last.at}</span></p> : null}
        {canWrite && card.access ? <div className="drwsec"><div className="chips">
          {card.access === "Hold"
            ? gateShut
              ? <button className="chip" disabled aria-disabled="true" title={gateWhy}>Send welcome and unlock</button>
              : <button className="chip on" onClick={() => void unlock({ id: x.id, expectedModifiedTime: card.modifiedTime })}>Send welcome and unlock</button>
            : <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "applock", id: x.id })}>Lock app access</button>}
        </div>
          {gateShut ? <p className="sm" role="status" data-gate="ten-percent" style={{ margin: "9px 0 0" }}>{gateWhy}</p> : null}
          {/* D137 ruling 2(a): the gate explains itself — the matched receipts, their running total and the 10% line */}
          {card.access === "Hold" && card.tenPercentTrail ? <TenTrail trail={card.tenPercentTrail} nameOf={id => who(s, id).n} /> : null}
          {gateShut && card.mayOverride && card.tenPercent === "not-verified"
            ? <AppOverride name={x.n} onUnlock={reason => unlock({ id: x.id, expectedModifiedTime: card.modifiedTime, override: { reason } }).then(r => r.ok)} /> : null}
          <p className="sm" style={{ margin: "9px 0 0" }}>The welcome never goes by itself: the account is created on hold and stays locked — a match does not unlock it — until this button. Every change is on their Activity.</p></div>
          : <p className="sm" style={{ margin: "9px 0 0" }}>{canWrite ? "The account is created on hold and stays locked until Finance presses Send welcome and unlock." : "Finance controls app access."}</p>}
        <div className="drwsec"><div className="chips">
          <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "preview", id: x.id })}>Preview app</button>
          {mayTestLink(s, me) ? <button className="chip" onClick={() => dispatch({ type: "openDrawer", k: "testlink", id: x.id })}>Test sign-in link</button> : null}
        </div>{isSuper(s, me) ? <p className="sm" style={{ margin: "9px 0 0" }}>The preview is a mock-up with their figures. The test link opens the real app as them, once, for 10 minutes.</p> : null}</div>
      </div></div>
  );
}

/* ---- GC-1526: Finance's override — unlock without a verified 10%, with a typed reason and an on-page confirmation (never a
   native dialog, M18-S11). Shown only to Finance Operations, the Head of Finance and Digital Infrastructure (D137 2(b); the card's mayOverride); the server re-checks
   the seat, writes the reason as a Note on the Contact under their name, and logs it (Plane C app-access-override). ---- */
export function AppOverride({ name, onUnlock, start = "", reason = "" }: {
  name: string; onUnlock: (reason: string) => Promise<boolean>;
  /** where the steps open (render tests); the card always opens them shut */
  start?: "" | "why" | "confirm"; reason?: string;
}) {
  const [step, setStep] = useState<"" | "why" | "confirm">(start);
  const [why, setWhy] = useState(reason);
  const short = why.trim().length < OVERRIDE_REASON_MIN;
  if (step === "") return <div className="chips" style={{ marginTop: 8 }}>
    <button className="chip" onClick={() => setStep("why")}>Unlock without the 10%…</button></div>;
  return (
    <div className="drwsec" data-override={step}>
      {step === "why" ? <>
        <label className="fi"><span>Why unlock without the 10%? It goes on {name}&apos;s record with your name.</span>
          <textarea className="inp" rows={3} maxLength={OVERRIDE_REASON_MAX} value={why} onChange={e => setWhy(e.target.value)}
            aria-describedby="ovr-min" /></label>
        <p className="sm" id="ovr-min" style={{ margin: "4px 0 8px" }}>At least {OVERRIDE_REASON_MIN} characters.</p>
        <div className="chips">
          <button className="chip on" disabled={short} onClick={() => setStep("confirm")}>Continue</button>
          <button className="chip" onClick={() => { setStep(""); setWhy(""); }}>Cancel</button></div>
      </> : <>
        <p className="note bad" role="alert" style={{ margin: "0 0 8px" }}><b>Unlock {name}&apos;s app without a verified 10%?</b> The welcome
          goes out now and they can sign in. Your reason is written on their record under your name.</p>
        <div className="chips">
          <button className="chip on" onClick={() => void onUnlock(why.trim()).then(done => { if (done) { setStep(""); setWhy(""); } })}>Yes, unlock without the 10%</button>
          <button className="chip" onClick={() => setStep("why")}>Back</button></div>
      </>}
    </div>
  );
}

/* ---- ARL holdings (M10-S09), read-only ----
   M10-S09-W1: GET /api/investors/[id]/holdings (the route exports GET and nothing else — the ledger is never written, D70). */
export function ArlHoldings(p: P) {
  const { s, me, dispatch, x } = p;
  const r = useApiRead(arlHoldings, { s, me }, x.id);
  if (!mayHoldings(s, me)) return null;
  if (r.state === "idle" || r.state === "loading") return null;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>ARL holdings: {r.err.error}</p></div></div>;
  const hs = r.data.holdings;
  const open = mxOf(p, "arl:" + x.id);
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>ARL holdings</h3><div className="sp" /><span className="sm">read only</span></div>
      <div className="cb">{hs.length ? hs.map(h => (
        <div key={h.id}>
          <div className="led" role="button" tabIndex={0} style={{ cursor: "pointer" }} aria-expanded={open === h.id}
            onClick={() => dispatch({ type: "mset", k: "arl:" + x.id, v: open === h.id ? "" : h.id })}
            onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "mset", k: "arl:" + x.id, v: open === h.id ? "" : h.id }); }}>
            <span className="tag br">{h.instrument ?? "—"}</span>
            <span style={{ minWidth: 0 }}><b>{open === h.id ? "▾" : "▸"} {h.id}</b>
              <div className="sm">since {fmtDate(h.investedOn)}{h.interestRatePct != null ? " · " + h.interestRatePct + "% interest" : ""}{h.maturesOn ? " · matures " + fmtDate(h.maturesOn) : ""}</div></span>
            <span className="amt">{h.amount == null ? "—" : money(h.amount)}</span>
          </div>
          {open === h.id ? <div style={{ paddingLeft: 18 }}>{h.transactions.length ? h.transactions.map(t => (
            <div className="led" key={t.id}><span className="tag">{t.type ?? "—"}</span>
              <span style={{ minWidth: 0 }}><span className="sm mono">{fmtDate(t.date)}</span></span><span className="amt">{t.amount == null ? "—" : money(t.amount)}</span></div>
          )) : <p className="sm" style={{ margin: 0 }}>No transactions on this holding.</p>}</div> : null}
        </div>
      )) : <div className="empty">No ARL holdings</div>}
        <p className="sm" style={{ margin: "10px 0 0" }}>Corporate instruments held with ARL, not farm units. Shown as Zoho holds them; nobody changes them from here.</p>
      </div></div>
  );
}
