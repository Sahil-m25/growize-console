"use client";

/* 12. TICKETS — imx.js 2028–2054 (tkRow) and 2055–2089 (vTkt). An AM seat sees its own queue and
   nothing else — the counts, the cuts and the rows all read from the same list. */

import { useState } from "react";
import {
  aged, day6, I, isAM, isSuper, may, mayTkt, needsFin, readBook, safeNote, who,
} from "@/lib/im";
import type { ImTicket } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { caseDeliveries, caseHandover, caseList, caseMove, caseReply, deliveryLine } from "@/lib/data/endpoints/cases";
import { ImPname, type ImPageProps } from "../common";

/* M13-S05-W1 — 'Reply to the investor': the reply is POST /api/cases/[id]/reply and the line under it is
   GET /api/cases/[id]/deliveries ("Delivered" only after the app's push.delivered; else "Reply not delivered yet"). */
function TkReply({ s, me, dispatch, t }: ImPageProps & { t: ImTicket }) {
  const [open, setOpen] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null), [err, setErr] = useState<string | null>(null);
  const reply = useApiWrite(caseReply, { s, me }, dispatch);
  const d = useApiRead(caseDeliveries, { s, me }, t.state === "closed" ? null : t.id);
  const line = deliveryLine(sent ?? (d.state === "ok" ? d.data.label : null));
  const send = async () => {
    setBusy(true); setErr(null);
    const r = await reply({ id: t.id, message: msg });
    setBusy(false);
    if (r.ok) { setSent(r.data.delivery.label); setMsg(""); setOpen(false); } else setErr(r.error);
  };
  return (
    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
      {line ? <span className={`tag ${line === "Delivered" ? "go" : "due"}`}><span className="dot"></span>{line}</span> : null}
      {open ? (
        <div style={{ marginTop: 6 }}>
          <textarea className="nta" rows={3} aria-label={`Reply to the investor on ${t.t}`} placeholder="Plain words. This is what the investor reads in the app."
            value={msg} onChange={e => setMsg(e.target.value)} />
          <div className="chips" style={{ marginTop: 6 }}>
            <button className="chip on" disabled={busy || !msg.trim()} onClick={() => { void send(); }}>Send reply</button>
            <button className="chip" onClick={() => { setOpen(false); setErr(null); }}>Not now</button>
          </div>
        </div>
      ) : <div className="chips" style={{ marginTop: 6 }}><button className="chip" onClick={() => setOpen(true)}>Reply to the investor</button></div>}
      {err ? <p className="sm" role="alert" style={{ margin: "6px 0 0" }}>{err}</p> : null}
    </div>
  );
}

export function TkRow({ s, me, dispatch, t, watched }: ImPageProps & { t: (ImTicket & { number?: string | null }) | null | undefined; watched?: boolean }) {
  /* M13-S03-W1 / S04-W1: move and hand-over are PATCH /api/cases/[id] and POST /api/cases/[id]/handover; a refusal lands in the page note */
  const move = useApiWrite(caseMove, { s, me }, dispatch);
  const hand = useApiWrite(caseHandover, { s, me }, dispatch);
  if (!t) return null;
  const x = I(s, me, t.inv), d = aged(s.data.NOW, t.opened);
  const first = (k: string) => who(s, k).n.split(" ")[0];
  const canWork = mayTkt(s, me, t) && !(t.cat === "Bank" && !may(s, me, "bank"));
  return (
    <div className={`qc ${t.state === "closed" ? "" : t.pri === "high" ? "now" : "soon"}`} style={{ marginBottom: 6 }}>
      <div className="who2"><b>{t.t}</b>
        <span><span className="mono">{t.number ?? t.id}</span> · {t.cat} · {x ? x.n : t.inv} ·{" "}
          <ImPname s={s} k={t.own} first /> · opened <span className="mono">{day6(t.opened)}</span>{
            t.state === "closed" ? <> · closed <span className="mono">{day6(t.closed)}</span></>
              : ` · ${d} day${d === 1 ? "" : "s"} old, SLA ${t.sla}`}</span>
        {t.d ? <span className="sm" style={{ marginTop: 4, display: "block" }}>{safeNote(s, me, t.d)}</span> : null}</div>
      {t.handed ? <span className="tag br">handed to {first(t.own)} by {first(t.handed.by)} · {day6(t.handed.at)}</span> : null}
      {watched ? <span className="sm">Yours until you handed it on. You can see where it has got to
        and tell them; you cannot work it, which is the point.</span> : null}
      {t.state === "closed" ? <span className="tag go"><span className="dot"></span>closed</span>
        : needsFin(s, t) && ((isAM(s, me) && t.own === me) || isSuper(s, me)) && may(s, me, "tkt") ? <div className="chips">
          <button className="chip on" onClick={e => { e.stopPropagation(); void hand({ id: t.id, expectedModifiedTime: t.version ?? null }); }}>Hand it to Finance</button>
          <span className="sm">{t.cat === "Bank" ? "a bank account cannot be changed from this side, and should not be"
            : "a compliance answer comes from the seat that holds the paper"}</span></div>
          : !mayTkt(s, me, t) ? <><span className="tag">{t.state}</span>{may(s, me, "tkt") && isAM(s, me)
            ? <span className="sm"> · {first(t.own)}&apos;s</span> : null}</>
            : t.cat === "Bank" && !may(s, me, "bank") ? <span className="tag">a bank ticket needs a seat that can see the account</span>
              : <div className="chips">
                {t.state !== "waiting" ? <button className="chip" onClick={e => { e.stopPropagation();
                  void move({ id: t.id, to: "waiting", expectedModifiedTime: t.version ?? null }); }}>Waiting on them</button> : null}
                <button className="chip on" onClick={e => { e.stopPropagation();
                  void move({ id: t.id, to: "closed", expectedModifiedTime: t.version ?? null }); }}>Close it</button>
              </div>}
      {t.state !== "closed" && !watched && canWork ? <TkReply s={s} me={me} dispatch={dispatch} t={t} /> : null}
    </div>
  );
}

/* M13-S02-W1: the rows, the tiles and the tab counts are GET /api/cases (lib/data/endpoints/cases) — never the store's ticket list.
   The seat rules on each row (who may close, hand on, reply) are still the book's own until the Investors seat book is wired. */
export function ImTkt({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(caseList, { s, me }, undefined);
  const KFILT = s.ui.KFILT;
  if (r.state === "idle" || r.state === "loading") return <div className="empty">Reading the tickets…</div>;
  if (r.state === "error") return r.err.status === 403 ? null : <div className="note bad" role="alert">{r.err.error}</div>;
  const { rows: all, cuts, mine, readOnly, offersMine } = r.data;
  const num = cuts.state === "error" ? null : cuts.value;
  const F: Record<string, [string, (t: ImTicket) => boolean, number]> = {
    open: ["Open", t => t.state !== "closed", num ? num.open : all.filter(t => t.state !== "closed").length],
    ...(offersMine ? { mine: ["Mine", t => t.state !== "closed" && t.own === me, mine] as [string, (t: ImTicket) => boolean, number] } : {}),
    all: ["Everything", () => true, num ? num.all : all.length],
    closed: ["Closed", t => t.state === "closed", num ? num.closed : all.filter(t => t.state === "closed").length],
  };
  const f = F[KFILT] ? KFILT : "open", rows = all.filter(F[f]![1]);
  const late = num ? num.high : all.filter(t => t.state !== "closed" && t.pri === "high").length;
  const count = (st: ImTicket["state"]) => all.filter(t => t.state === st).length;
  return (
    <>
      <div className="ph"><h1>Tickets</h1>
        <span className="sub">what an investor asks for after they have paid</span><div className="sp"></div>
        {!readOnly ? <button className="act" onClick={() => dispatch({ type: "openDrawer", k: "tkt", id: null,
          seed: { TK: { inv: (readBook(s, me)[0] || { id: null }).id || null, cat: "Query", t: "", d: "", pri: "normal" } } })}>＋ Open a ticket</button>
          : <span className="tag">read only</span>}</div>
      <div className="stats">
        <div className={`stat ${late ? "bad" : ""}`}><b>{late}</b><span>high priority open</span></div>
        <div className="stat"><b>{count("open")}</b><span>open</span></div>
        <div className="stat"><b>{num ? num.waiting : count("waiting")}</b><span>waiting on the investor</span></div>
        <div className="stat"><b>{num ? num.closed : count("closed")}</b><span>closed</span></div>
      </div>
      <div className="secbar">{Object.entries(F).map(([k, [t, , n]]) =>
        <button key={k} className={`sc ${f === k ? "on" : ""}`}
          onClick={() => dispatch({ type: "setFilter", patch: { KFILT: k } })}>{t}<i>{n}</i></button>)}</div>
      <div className="secw"><div className="card fill"><div className="cb">
        {rows.length ? rows.map(t => <TkRow key={t.id} s={s} me={me} dispatch={dispatch} t={t} watched={!!t.watched} />)
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
