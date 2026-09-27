"use client";

/* Investors side — section 9, DASHBOARD (imx.js lines 1367–1466): vDash, vDashAM, amCards,
   vDashFin, qRow. Not a wall of figures — a worklist. The first thing on it is the thing that will
   cost money if nobody does it today, and every row carries the control that does it. */

import type { KeyboardEvent, MouseEvent } from "react";
import {
  banked, careQueue, freeUnits, holdDays, inr, isAM, isSuper, isSys, KAMS, kamLoad, may, mineQueue,
  money, myBook, cared, outstandingReserved, pageReadable, poolBook, tierOf, TIERS, tkOpen, who, FORFEIT,
} from "@/lib/im";
import type { ImInvestor, ImQ } from "@/lib/im";
import { ProvIR } from "../common";
import type { ImPageProps } from "../common";

const enterOrSpace = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(); }
};

/* vDash — imx.js 1371 */
export function ImDash(p: ImPageProps) {
  const { s, me } = p;
  if (!pageReadable(s, me, "dash")) return null;
  return isAM(s, me) ? <VDashAM {...p} /> : <VDashFin {...p} />;
}

/* vDashAM — imx.js 1376–1393. Account Management's day. */
function VDashAM({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "dash") || !isAM(s, me)) return null;
  const q = mineQueue(s, me), now = q.filter(x => x.urg === "now");
  const book = myBook(s, me).filter(cared);
  /* the prototype also computes `late` (quiet accounts) and `kept` (conversations logged by this
     seat) here and renders neither */
  const mine = who(s, me).r === "kam";
  return (
    <>
      <div className="ph"><h1>{who(s, me).n.split(" ")[0]}&apos;s day</h1>
        <span className="sub">{(mine ? book.length + " account" + (book.length === 1 ? "" : "s") : "the whole book")
          + (q.length ? " · " + q.length + " waiting on you" : " · nothing waiting on you")}</span></div>
      <div><div>
        <div className="card fill"><div className="ch"><h3>Waiting on you</h3><div className="sp" />
          {now.length ? <span className="tag late"><span className="dot" />{now.length} today</span>
            : <span className="tag go"><span className="dot" />clear</span>}</div>
          <div className="cb">{q.length ? <div className="q">{q.map((x, i) => <QRow key={i} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
            : <div className="empty">Every account you hold has been spoken to inside its cadence, and no ticket is open on you.</div>}</div></div>
      </div></div>
    </>
  );
}

/* amCards(book, mine) — imx.js 1394–1411. Rendered by the Teams page for an AM seat; lives here
   because the prototype defines it in section 9. */
export function AmCards({ s, me, book, mine }: { s: ImPageProps["s"]; me: string; book: ImInvestor[]; mine: boolean }) {
  const n = KAMS(s).length;
  const l = kamLoad(book);
  const pl = kamLoad(poolBook(s, me));
  return (
    <div>
      <div className="card"><div className="ch"><h3>The cadence</h3><div className="sp" />
        <span className="sm">{mine ? "your book, by tier" : "the whole book, by tier"}</span></div><div className="cb">
        {TIERS.map(t => {
          const c = book.filter(x => tierOf(x)!.k === t.k).length;
          return (
            <div className="led" key={t.k}><span className={`tag ${t.k === "A" ? "br" : ""}`}>{t.t}</span>
              <span style={{ minWidth: 0 }}><b>{`${t.min}${t.k === "A" ? "+" : t.k === "B" ? "–3" : ""} unit${t.min > 1 ? "s" : ""}`}</b>
                <div className="sm">{t.t2}</div></span><span className="amt">{c}</span></div>
          );
        })}
        <p className="sm" style={{ margin: "10px 0 0" }}>{"A tier is not a judgement about the investor. It is a statement about what "
          + n + " " + (n === 1 ? "person" : "people") + " can deliver, written down before it is promised — which is the only version of a service promise anybody keeps. "
          + (mine ? "That is" : "Across the whole book that is") + " "
          + l + " conversation" + (l === 1 ? "" : "s") + " a month" + (mine ? " of yours" : "") + "."
          + (mine ? "" : " " + pl + " of them sit in the pool, which means they belong to whoever is free — the arrangement that works until it does not.")}</p>
      </div></div>
    </div>
  );
}

/* vDashFin — imx.js 1413–1445. Finance's day, and the super user's view of both queues. */
function VDashFin({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "dash") || isAM(s, me) || isSys(s, me)) return null;
  const q = mineQueue(s, me), now = q.filter(x => x.urg === "now");
  const risk = outstandingReserved(s, me);
  const holds = s.data.INV.filter(x => x.st === "reserved" && x.hold), soon = holds.filter(x => (holdDays(s, x) ?? 0) <= 30).length;
  const forfeit = holds.reduce((a, x) => a + FORFEIT * x.units, 0), tk = tkOpen(s, me).length;
  const sup = isSuper(s, me);
  const sig = (k: string, t: string, run: () => void, warn: boolean) => (
    <a key={k} className={`chip sig ${warn ? "warn" : ""}`} role="button" tabIndex={0} onClick={run} onKeyDown={enterOrSpace(run)}>
      {t}<span className="sigto" aria-hidden="true">→</span></a>
  );
  const c = sup ? careQueue(s, me) : [];
  return (
    <>
      <div className="ph"><h1>{who(s, me).n.split(" ")[0]}&apos;s day</h1>
        <span className="sub">{(sup ? q.length + " in Finance's queue · " + careQueue(s, me).length + " in Account Management's"
          : q.length ? q.length + " waiting on you" : "nothing waiting on you") + (now.length ? " · " + now.length + " today" : "")}</span></div>
      <div className="sigs" role="list" aria-label="Elsewhere today — each opens its page">
        {sig("txn", money(banked(s)) + " banked · " + money(risk) + " outstanding · Payments", () => dispatch({ type: "go", v: "txn" }), false)}
        {holds.length ? sig("hold", soon + " hold" + (soon === 1 ? "" : "s") + " ending within 30 days · " + inr(forfeit) + " at risk · Investors",
          () => { dispatch({ type: "setFilter", patch: { IFILT: "hold" } }); dispatch({ type: "go", v: "inv" }); }, soon > 0) : null}
        {sig("farms", freeUnits(s) + " units free to sell · Farms", () => dispatch({ type: "go", v: "farms" }), false)}
        {sig("tkt", tk + " ticket" + (tk === 1 ? "" : "s") + " open · Tickets", () => dispatch({ type: "go", v: "tkt" }), tk > 0)}
      </div>
      {sup ? <div className="note su" style={{ marginBottom: 12 }}><b>Super user.</b> These are other people&apos;s queues. Finance (primary doer: Harsha Bhat) owns money and paper; Compliance (Fahad Rizvi) owns KYC; Account Management (Divya Kamath) owns care. Every button works for you so you can test it, and what you do is recorded as yours.</div> : null}
      <div className="card fill"><div className="ch"><h3>{sup ? "Finance's queue · primary: Harsha Bhat" : "Waiting on you"}</h3><div className="sp" />
        {now.length ? <span className="tag late"><span className="dot" />{now.length} today</span>
          : <span className="tag go"><span className="dot" />clear</span>}</div>
        <div className="cb">{q.length ? <div className="q">{q.map((x, i) => <QRow key={i} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
          : <div className="empty">Nothing is waiting on this seat.<br />
            <span className="sm">{may(s, me, "pay") || may(s, me, "doc") || may(s, me, "kyc")
              ? "Every document is out or signed, every claim is answered and no hold is close."
              : "This is a read-only seat — the queue belongs to the people who can act on it."}</span></div>}
        </div></div>
      {sup ? (
        <div className="card fill" style={{ marginTop: 12 }}><div className="ch"><h3>Account Management&apos;s queue · primary: Divya Kamath</h3>
          <div className="sp" /><span className={`tag ${c.length ? "due" : "go"}`}><span className="dot" />{c.length || "clear"}</span></div>
          <div className="cb">{c.length ? <div className="q">{c.map((x, i) => <QRow key={i} s={s} me={me} dispatch={dispatch} x={x} />)}</div>
            : <div className="empty">Nothing is owed.</div>}</div></div>
      ) : null}
    </>
  );
}

/* qRow(x) — imx.js 1447–1466. One queue row, carrying the control that does it. */
export function QRow({ s, me, dispatch, x }: ImPageProps & { x: ImQ }) {
  if (!x.inv) return null;
  const id = x.inv.id;
  const stop = (run: () => void) => (e: MouseEvent) => { e.stopPropagation(); run(); };
  const b =
    x.kind === "nokam" ? (may(s, me, "assign")
      ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "kam", id, seed: { KSEL: null } }))}>Assign manager</button>
      : <span className="tag late">no manager</span>)
      : x.kind === "intro" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "talk", id, seed: { CT: { ch: "call", mood: "good", note: "", next: "" } } }))}>Record the introduction</button>
        : x.kind === "due" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "talk", id, seed: { CT: { ch: "call", mood: "good", note: "", next: "" } } }))}>Log a conversation</button>
          : x.kind === "claim" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "claim", id: x.n.id }))}>Answer it</button>
            : x.kind === "verify" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "verify", id: x.r.d ? x.r.d.id : null, seed: { DREF: "" } }))}>Verify it</button>
              : x.kind === "send" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "send", id, seed: { DTPL: x.r.R ? x.r.R.tpl : null } }))}>Send it</button>
                : x.kind === "kyc" ? <button className="act" onClick={stop(() => dispatch({ type: "openDrawer", k: "kyc", id }))}>Check it</button>
                  : x.kind === "declined" ? <button className="act" onClick={stop(() => { dispatch({ type: "go", v: "inv", id }); dispatch({ type: "setSec", v: "inv:" + id, k: "paper" }); })}>Open the paper</button>
                  : <button className="act ghost" onClick={stop(() => dispatch({ type: "go", v: "inv", id }))}>Open the record</button>;
  /* the prototype's `x.kind==="tkt"` branch ("Open tickets") is unreachable: no queue emits it */
  const open = () => dispatch({ type: "go", v: "inv", id });
  return (
    <div className={`qc ${x.urg === "now" ? "now" : "soon"}`} role="button" tabIndex={0}
      onClick={open} onKeyDown={e => { if (e.key === "Enter") open(); }}>
      <div className="who2"><b>{x.inv.n}</b><span>{x.t}{x.kind === "claim" ? <>{" · "}<ProvIR t={"from " + who(s, x.n.ir).n.split(" ")[0]} /></> : null}
        {" · "}<span className="mono">{id}</span></span></div>{b}</div>
  );
}
