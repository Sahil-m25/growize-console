"use client";

/* tkRow(t) — imx.js 2028–2056 (section 11). The investor record's Tickets section renders it; the
   Tickets page owns its own copy, since page folders do not import from each other. */

import type { MouseEvent } from "react";
import { aged, day6, I, isAM, isSuper, may, mayTkt, needsFin, safeNote, watchedTkt, who } from "@/lib/im";
import type { ImTicket } from "@/lib/im";
import { ImPname } from "../common";
import type { ImPageProps } from "../common";

export function TkRow({ s, me, dispatch, t }: ImPageProps & { t: ImTicket }) {
  if (!t || !I(s, me, t.inv)) return null;
  const x = I(s, me, t.inv), d = aged(s.data.NOW, t.opened);
  const stop = (run: () => void) => (e: MouseEvent) => { e.stopPropagation(); run(); };
  const first = (k: string | null | undefined) => who(s, k).n.split(" ")[0];
  return (
    <div className={`qc ${t.state === "closed" ? "" : t.pri === "high" ? "now" : "soon"}`} style={{ marginBottom: 6 }}>
      <div className="who2"><b>{t.t}</b>
        <span><span className="mono">{t.id}</span>{" · " + t.cat + " · " + (x ? x.n : t.inv) + " · "}
          <ImPname s={s} k={t.own} first />{" · opened "}<span className="mono">{day6(t.opened)}</span>
          {t.state === "closed" ? <>{" · closed "}<span className="mono">{day6(t.closed)}</span></>
            : " · " + d + " day" + (d === 1 ? "" : "s") + " old, SLA " + t.sla}</span>
        {t.d ? <span className="sm" style={{ marginTop: 4, display: "block" }}>{safeNote(s, me, t.d)}</span> : null}</div>
      {t.handed ? <span className="tag br">{"handed to " + first(t.own) + " by " + first(t.handed.by) + " · " + day6(t.handed.at)}</span> : null}
      {watchedTkt(s, me, t) ? <span className="sm">Yours until you handed it on. You can see where it has got to and tell them; you cannot work it, which is the point.</span> : null}
      {t.state === "closed" ? <span className="tag go"><span className="dot" />closed</span>
        : needsFin(s, t) && ((isAM(s, me) && t.own === me) || isSuper(s, me)) && may(s, me, "tkt") ? (
          <div className="chips">
            <button className="chip on" onClick={stop(() => dispatch({ type: "handToFinance", id: t.id }))}>Hand it to Finance</button>
            <span className="sm">{t.cat === "Bank" ? "a bank account cannot be changed from this side, and should not be"
              : "a compliance answer comes from the seat that holds the paper"}</span></div>
        ) : !mayTkt(s, me, t) ? (
          <><span className="tag">{t.state}</span>{may(s, me, "tkt") && isAM(s, me)
            ? <span className="sm">{" · " + first(t.own) + "'s"}</span> : null}</>
        ) : t.cat === "Bank" && !may(s, me, "bank") ? <span className="tag">a bank ticket needs a seat that can see the account</span>
          : (
            <div className="chips">
              {t.state !== "waiting" ? <button className="chip" onClick={stop(() => dispatch({ type: "moveTicket", id: t.id, state: "waiting" }))}>Waiting on them</button> : null}
              <button className="chip on" onClick={stop(() => dispatch({ type: "moveTicket", id: t.id, state: "closed" }))}>Close it</button>
            </div>
          )}
    </div>
  );
}
