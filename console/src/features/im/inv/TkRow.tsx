"use client";

/* tkRow(t) — imx.js 2028–2056 (section 11). The investor record's Tickets section renders it; the
   Tickets page owns its own copy, since page folders do not import from each other.
   D132: the buttons are the Tickets page's own writes — PATCH /api/cases/[id] (waiting / closed) and
   POST /api/cases/[id]/handover (lib/data/endpoints/cases), guarded by the Case's version; fixture mode still runs the
   reducer's moveTicket / handToFinance. A success re-reads every live read (the record's ticket list included). */

import { useState, type MouseEvent } from "react";
import { aged, day6, fmtAt, I, isAM, isSuper, may, mayTkt, needsFin, safeNote, watchedTkt, who } from "@/lib/im";
import type { ImTicket } from "@/lib/im";
import { useApiMode, useApiWrite } from "@/lib/data/api";
import { caseHandover, caseMove } from "@/lib/data/endpoints/cases";
import { ImPname } from "../common";
import type { ImPageProps } from "../common";

export function TkRow({ s, me, dispatch, t, investorName, watched }: ImPageProps & { t: ImTicket; investorName?: string; watched?: boolean }) {
  const live = useApiMode() === "live";
  const move = useApiWrite(caseMove, { s, me }, dispatch);
  const hand = useApiWrite(caseHandover, { s, me }, dispatch);
  const [pending, setPending] = useState(false), [err, setErr] = useState<string | null>(null);
  if (!t || (!live && !I(s, me, t.inv))) return null;
  const x = I(s, me, t.inv), d = aged(s.data.NOW, t.opened);
  const press = (run: () => Promise<{ ok: true } | { ok: false; error: string }>) => (e: MouseEvent) => {
    e.stopPropagation();
    if (pending) return;
    setPending(true); setErr(null);
    void run().then(r => { setPending(false); if (!r.ok) setErr(r.error); });
  };
  const version = t.version ?? null;
  /* live, the row is the register's (GET /api/cases) and the investor is not in the demo book mayTkt looks in: the seat rule
     alone decides what is offered, and the route re-checks it (server/cases/writes: a KAM works only its own tickets) */
  const canTkt = live ? may(s, me, "tkt") && (!isAM(s, me) || t.own === me) : mayTkt(s, me, t);
  const first = (k: string | null | undefined) => who(s, k).n.split(" ")[0];
  return (
    <div className={`qc ${t.state === "closed" ? "" : t.pri === "high" ? "now" : "soon"}`} style={{ marginBottom: 6 }}>
      <div className="who2"><b>{t.t}</b>
        <span><span className="mono">{t.id}</span>{" · " + t.cat + " · " + (x ? x.n : investorName || t.inv) + " · "}
          <ImPname s={s} k={t.own} first />{" · opened "}<span className="mono">{day6(t.opened)}</span>
          {t.state === "closed" ? <>{" · closed "}<span className="mono">{day6(t.closed)}</span></>
            : " · " + d + " day" + (d === 1 ? "" : "s") + " old, SLA " + (t.sla ? fmtAt(t.sla) : "not set")}</span>
        {t.d ? <span className="sm" style={{ marginTop: 4, display: "block" }}>{safeNote(s, me, t.d)}</span> : null}</div>
      {t.handed ? <span className="tag br">{"handed to " + first(t.own) + " by " + first(t.handed.by) + " · " + day6(t.handed.at)}</span> : null}
      {(watched ?? watchedTkt(s, me, t)) ? <span className="sm">Yours until you handed it on. You can see where it has got to and tell them; you cannot work it, which is the point.</span> : null}
      {t.state === "closed" ? <span className="tag go"><span className="dot" />closed</span>
        : needsFin(s, t) && ((isAM(s, me) && t.own === me) || isSuper(s, me)) && may(s, me, "tkt") ? (
          <div className="chips">
            <button className="chip on" disabled={pending} aria-busy={pending} onClick={press(() => hand({ id: t.id, expectedModifiedTime: version }))}>Hand it to Finance</button>
            <span className="sm">{t.cat === "Bank" ? "a bank account cannot be changed from this side, and should not be"
              : "a compliance answer comes from the seat that holds the paper"}</span></div>
        ) : !canTkt ? (
          <><span className="tag">{t.state}</span>{may(s, me, "tkt") && isAM(s, me)
            ? <span className="sm">{" · " + first(t.own) + "'s"}</span> : null}</>
        ) : t.cat === "Bank" && !may(s, me, "bank") ? <span className="tag">a bank ticket needs a seat that can see the account</span>
          : (
            <div className="chips">
              {t.state !== "waiting" ? <button className="chip" disabled={pending} onClick={press(() => move({ id: t.id, to: "waiting", expectedModifiedTime: version }))}>Waiting on them</button> : null}
              <button className="chip on" disabled={pending} aria-busy={pending} onClick={press(() => move({ id: t.id, to: "closed", expectedModifiedTime: version }))}>Close it</button>
            </div>
          )}
      {err ? <p className="sm" role="alert" style={{ margin: "6px 0 0" }}>{err}</p> : null}
    </div>
  );
}
