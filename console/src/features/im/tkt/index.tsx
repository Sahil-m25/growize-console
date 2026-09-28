"use client";

/* 12. TICKETS — imx.js 2028–2054 (tkRow) and 2055–2089 (vTkt). An AM seat sees its own queue and
   nothing else — the counts, the cuts and the rows all read from the same list. */

import {
  aged, day6, I, isAM, isSuper, may, mayTkt, needsFin, pageReadable, readBook, safeNote, ticketBook,
  tktFilters, watchedTkt, who,
} from "@/lib/im";
import type { ImTicket } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";

export function TkRow({ s, me, dispatch, t }: ImPageProps & { t: ImTicket | null | undefined }) {
  if (!t || !I(s, me, t.inv)) return null;
  const x = I(s, me, t.inv), d = aged(s.data.NOW, t.opened);
  const first = (k: string) => who(s, k).n.split(" ")[0];
  return (
    <div className={`qc ${t.state === "closed" ? "" : t.pri === "high" ? "now" : "soon"}`} style={{ marginBottom: 6 }}>
      <div className="who2"><b>{t.t}</b>
        <span><span className="mono">{t.id}</span> · {t.cat} · {x ? x.n : t.inv} ·{" "}
          <ImPname s={s} k={t.own} first /> · opened <span className="mono">{day6(t.opened)}</span>{
            t.state === "closed" ? <> · closed <span className="mono">{day6(t.closed)}</span></>
              : ` · ${d} day${d === 1 ? "" : "s"} old, SLA ${t.sla}`}</span>
        {t.d ? <span className="sm" style={{ marginTop: 4, display: "block" }}>{safeNote(s, me, t.d)}</span> : null}</div>
      {t.handed ? <span className="tag br">handed to {first(t.own)} by {first(t.handed.by)} · {day6(t.handed.at)}</span> : null}
      {watchedTkt(s, me, t) ? <span className="sm">Yours until you handed it on. You can see where it has got to
        and tell them; you cannot work it, which is the point.</span> : null}
      {t.state === "closed" ? <span className="tag go"><span className="dot"></span>closed</span>
        : needsFin(s, t) && ((isAM(s, me) && t.own === me) || isSuper(s, me)) && may(s, me, "tkt") ? <div className="chips">
          <button className="chip on" onClick={e => { e.stopPropagation(); dispatch({ type: "handToFinance", id: t.id }); }}>Hand it to Finance</button>
          <span className="sm">{t.cat === "Bank" ? "a bank account cannot be changed from this side, and should not be"
            : "a compliance answer comes from the seat that holds the paper"}</span></div>
          : !mayTkt(s, me, t) ? <><span className="tag">{t.state}</span>{may(s, me, "tkt") && isAM(s, me)
            ? <span className="sm"> · {first(t.own)}&apos;s</span> : null}</>
            : t.cat === "Bank" && !may(s, me, "bank") ? <span className="tag">a bank ticket needs a seat that can see the account</span>
              : <div className="chips">
                {t.state !== "waiting" ? <button className="chip" onClick={e => { e.stopPropagation();
                  dispatch({ type: "moveTicket", id: t.id, state: "waiting" }); }}>Waiting on them</button> : null}
                <button className="chip on" onClick={e => { e.stopPropagation();
                  dispatch({ type: "moveTicket", id: t.id, state: "closed" }); }}>Close it</button>
              </div>}
    </div>
  );
}

export function ImTkt({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "tkt")) return null;
  const BOOK = ticketBook(s, me);
  const F = tktFilters(s, me);
  const KFILT = s.ui.KFILT;
  const f = F[KFILT] ? KFILT : "open", rows = BOOK.filter(F[f][1]);
  const late = BOOK.filter(t => t.state !== "closed" && t.pri === "high").length;
  return (
    <>
      <div className="ph"><h1>Tickets</h1>
        <span className="sub">what an investor asks for after they have paid</span><div className="sp"></div>
        {may(s, me, "tkt") ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "tkt", id: null,
          seed: { TK: { inv: (readBook(s, me)[0] || { id: null }).id || null, cat: "Query", t: "", d: "", pri: "normal" } } })}>＋ Open a ticket</button>
          : <span className="tag">read only</span>}</div>
      <div className="stats">
        <div className={`stat ${late ? "bad" : ""}`}><b>{late}</b><span>high priority open</span></div>
        <div className="stat"><b>{BOOK.filter(t => t.state === "open").length}</b><span>open</span></div>
        <div className="stat"><b>{BOOK.filter(t => t.state === "waiting").length}</b><span>waiting on the investor</span></div>
        <div className="stat"><b>{BOOK.filter(t => t.state === "closed").length}</b><span>closed</span></div>
      </div>
      <div className="secbar">{Object.entries(F).map(([k, [t, fn]]) =>
        <button key={k} className={`sc ${f === k ? "on" : ""}`}
          onClick={() => dispatch({ type: "setFilter", patch: { KFILT: k } })}>{t}<i>{BOOK.filter(fn).length}</i></button>)}</div>
      <div className="secw"><div className="card fill"><div className="cb">
        {rows.length ? rows.map(t => <TkRow key={t.id} s={s} me={me} dispatch={dispatch} t={t} />)
          : <div className="empty">{isAM(s, me)
            ? "Nothing assigned to you. A ticket on one of your accounts can still be Finance's — a bank change or a FIRC is a compliance job — and those do not appear here."
            : "Nothing in this cut."}</div>}
        <p className="sm" style={{ margin: "10px 0 0" }}>A ticket is the half of the relationship the lead side
          knows nothing about, and it is most of what an investor experiences after the money leaves
          their account. A bank change is a compliance job, not an admin one — which is why the
          category is on every row{isAM(s, me) ? ", and why this screen holds only the ones that are yours" : ""}.</p>
      </div></div></div>
    </>
  );
}
