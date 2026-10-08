"use client";

/* Team — imx.js section 14, vTeam (lines 2544–2587). Who holds which seat on the Investors pages,
   and what each seat holds. In the merged console this is the "Investors side seats" section on
   Teams: merge-glue.js strips the leading .ph block and wraps the rest — that is ImTeamBody. */

import { useState } from "react";
import { activityActors, activityBase, CAN, may, pageReadable, ROLE } from "@/lib/im";
import type { ImCan, ImRoleKey } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { teamSeats } from "@/lib/data/endpoints/teams";
import { imSeatChange } from "@/lib/data/endpoints/access";
import { kamMoveBook } from "@/lib/data/endpoints/investors";
import { ImPname, type ImPageProps } from "../common";

export function ImTeam(p: ImPageProps) {
  const { s, me } = p;
  if (!pageReadable(s, me, "team")) return null;
  return (
    <>
      <div className="ph"><h1>Teams</h1>
        <span className="sub">who holds which seat on the Investors pages</span><div className="sp"></div>
        <span className={`tag ${may(s, me, "team") ? "br" : ""}`}>{may(s, me, "team") ? "you can change seats" : "read only"}</span></div>
      <ImTeamBody {...p} />
    </>
  );
}

/** vTeam without its heading block — what the merged console embeds as a section.
 *  M17-S01-W1: the rows and the rights grid are GET /api/teams' (endpoints/teams teamSeats); M03-S04-W1: a seat
 *  dropdown is PUT /api/users/{id} {seat} (endpoints/access imSeatChange), labelled "Seat for <name>", and offered
 *  only where the route lists seats to move to — never on the super admin's or the viewer's own row, never root/di. */
export function ImTeamBody({ s, me, dispatch }: ImPageProps) {
  const r = useApiRead(teamSeats, { s, me }, undefined);
  const seat = useApiWrite(imSeatChange, { s, me }, dispatch);
  const [err, setErr] = useState<string | null>(null);
  /* M18-S09-NOTE-3: a big KAM book goes back to the pool over several requests; how many so far while it continues */
  const [pooling, setPooling] = useState<{ name: string; returned: number } | null>(null);
  const rows = r.state === "ok" ? r.data.investorsSide ?? [] : [];
  const mv = useApiWrite(kamMoveBook, { s, me }, dispatch);
  /* R5: a KAM's book — moved to another KAM, on its own ("Move book") or before they leave the seat */
  const [plan, setPlan] = useState<{ whom: string; name: string; n: number; to: ImRoleKey | null } | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (!pageReadable(s, me, "team")) return null;
  const moveBook = async (): Promise<boolean> => {
    if (!plan || !target) return false;
    let x = await mv({ from: plan.whom, to: target });
    let moved = x.ok ? x.data.moved : 0, left = x.ok ? x.data.notMoved : 0;
    for (let n = 0; x.ok && x.data.continueFrom && n < 50; n++) {
      setPooling({ name: plan.name, returned: moved });
      x = await mv({ from: plan.whom, to: target, continueFrom: x.data.continueFrom });
      if (x.ok) { moved += x.data.moved; left += x.data.notMoved; }
    }
    setPooling(null);
    if (!x.ok) { setErr(x.error); return false; }
    const toName = rows.find(r => r.id === target)?.name ?? "the other manager";
    if (left) { setErr(left + " of " + plan.name + "'s accounts could not be moved (changed meanwhile or not allotted). Nothing else was changed; try again or return them to the pool."); return false; }
    setErr(null); setDone("Moved " + moved + " account" + (moved === 1 ? "" : "s") + " from " + plan.name + " to " + toName + ".");
    return true;
  };
  const apply = async (withBook: boolean) => {
    if (!plan) return;
    setBusy(true); setDone(null);
    const ok = withBook ? await moveBook() : true;
    if (ok && plan.to) await move(plan.whom, plan.name, plan.to);
    setBusy(false);
    if (ok) { setPlan(null); setTarget(""); }
  };
  const move = async (whom: string, name: string, to: ImRoleKey) => {
    let x = await seat({ whom, seat: to });
    let returned = x.ok ? x.data.returned : 0;
    for (let n = 0; x.ok && x.data.continueFrom && n < 50; n++) {
      setPooling({ name, returned });
      x = await seat({ whom, seat: to, continueFrom: x.data.continueFrom });
      if (x.ok) returned += x.data.returned;
    }
    setPooling(null);
    setErr(x.ok ? null : x.error);
  };
  const activity = activityBase(s, me), actors = activityActors(s, me);
  const cols = r.state === "ok" ? r.data.grid.columns : [];
  const order = Object.keys(ROLE) as ImRoleKey[];
  return (
    <>
      <div className="note" style={{ marginBottom: "8px" }}><b>Three teams, one wall.</b> Finance holds the money, the paper and the identity. Account Management holds the relationship after allotment — the requests, the app, the farm. Digital Infrastructure runs the software, holds every page and puts people in seats, but only Finance sees a PAN, an Aadhaar reference or a bank account. The IRs work the lead side; on the Investors side they read only the investors who came from their own leads.</div>
      {r.state === "loading" ? <p className="sm">Reading the team…</p> : null}
      {r.state === "error" ? <p className="note bad" role="alert">{r.err.error}</p> : null}
      {err ? <p className="note bad" role="alert">{err}</p> : null}
      {pooling ? <p className="note" role="status">Returning {pooling.name}&apos;s accounts to the pool — {pooling.returned} so far; continuing…</p> : null}
      {done ? <p className="note" role="status">{done}</p> : null}
      {plan ? (
        <div className="note warn" role="group" aria-label={"Move " + plan.name + "'s accounts"}>
          <b>{plan.to ? plan.name + " is leaving the Key Account Manager seat." : "Move " + plan.name + "'s accounts."}</b>{" "}
          They hold {plan.n} account{plan.n === 1 ? "" : "s"}. Each one is handed to the new manager as a new introduction.
          <div className="chips" style={{ marginTop: 8, alignItems: "center" }}>
            <label className="fi"><span>Move their accounts to</span>
              <select className="selw" aria-label="Move their accounts to" value={target} onChange={e => setTarget(e.target.value)}>
                <option value="">Choose a manager</option>
                {rows.filter(x => x.role === "kam" && x.id !== plan.whom && x.status === "active").map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <button type="button" className="act" disabled={!target || busy} onClick={() => void apply(true)}>
              {plan.to ? "Move their accounts, then change the seat" : "Move their accounts"}</button>
            {plan.to ? <button type="button" className="chip" disabled={busy} onClick={() => void apply(false)}>Return their accounts to the pool and change the seat</button> : null}
            <button type="button" className="chip" disabled={busy} onClick={() => { setPlan(null); setTarget(""); }}>Cancel</button>
          </div>
        </div>
      ) : null}
      <div className="secw">
        <div className="card"><div className="ch"><h3>Who is here</h3><div className="sp" />
          {rows.some(w => w.seatOptions.length)
            ? <button type="button" className="chip" onClick={() => document.getElementById("seat-rights")?.scrollIntoView({ block: "start" })}>See what each seat may do</button>
            : null}</div><div className="tw"><table>
          <thead><tr><th>Name</th><th>Team</th><th>Seat</th><th>May</th><th className="n">Actions logged</th><th></th></tr></thead>
          <tbody>{rows.map(w => {
            const k = w.id, tm = w.role ? (ROLE[w.role] || {}).tm : null;
            const pii = activity.filter(e => e.who === k && e.kind === "pii").length;
            const opts = w.role ? order.filter(x => x === w.role || w.seatOptions.includes(x)) : [];
            return (
              <tr key={k}>
                <td>{s.data.P[k] ? <ImPname s={s} k={k} b /> : <b>{w.name}</b>}{w.you ? <> <span className="tag br">you</span></> : null}
                  {w.email ? <div className="sm mono">{w.email}</div> : null}</td>
                <td><span className={`tag ${tm === "am" ? "br" : tm === "sys" ? "due" : ""}`}>{w.team}</span>
                  {w.accounts !== null ? <div className="sm">{w.accounts} account{w.accounts === 1 ? "" : "s"}</div> : null}
                  {w.accounts !== null && w.accounts > 0 && may(s, me, "assign") ? <button type="button" className="chip" disabled={!!pooling || busy}
                    onClick={() => { setDone(null); setPlan({ whom: k, name: w.name, n: w.accounts ?? 0, to: null }); }}>Move book</button> : null}</td>
                <td>{w.seatOptions.length && w.role
                  ? <select className="selw" title={"Seat — " + w.name} aria-label={"Seat for " + w.name} style={{ maxWidth: "100%", minWidth: "200px" }} value={w.role}
                    disabled={!!pooling || busy} onChange={e => {
                      const to = e.target.value as ImRoleKey;
                      /* a KAM with a book is offered a home for it first (R5); with none, or without the assign right, the seat just changes */
                      if (w.role === "kam" && to !== "kam" && (w.accounts ?? 0) > 0 && may(s, me, "assign")) { setDone(null); setPlan({ whom: k, name: w.name, n: w.accounts ?? 0, to }); }
                      else void move(k, w.name, to);
                    }}>
                    {opts.map(x => <option key={x} value={x}>{ROLE[x].t}</option>)}</select>
                  : <><b>{w.seatLabel}</b>{w.otherTeam ? <div className="sm">another team&apos;s seat</div> : null}</>}</td>
                <td className="sm">{w.may.map(c => CAN[c]).join(" · ") || "read only"}</td>
                <td className="n">{actors.has(k) ? activity.filter(e => e.who === k).length : "—"}</td>
                <td style={{ textAlign: "right" }}>{pii ? <span className="tag late">{pii} reveal{pii === 1 ? "" : "s"}</span> : null}</td></tr>
            );
          })}
          </tbody></table></div></div>
        <div className="card fill" id="seat-rights"><div className="ch"><h3>What each seat holds</h3></div><div className="tw"><table>
          <thead><tr><th>Right</th>{cols.map(c => <th key={c.seat} style={{ textAlign: "center" }}>{
            c.label.replace(" — read only", "")}<div className="sm" style={{ fontWeight: 400 }}>{c.zohoRole}</div></th>)}</tr></thead>
          <tbody>{(Object.keys(CAN) as ImCan[]).map(c => (
            <tr key={c}><td><b>{CAN[c]}</b></td>
              {cols.map(col => {
                const on = col.rights.includes(c);
                return <td key={col.seat} style={{ textAlign: "center", fontWeight: 700, color: on ? "var(--go)" : "var(--ink-3)", opacity: on ? 1 : .35 }}>{on ? "●" : "○"}</td>;
              })}</tr>
          ))}
          </tbody></table></div>
          <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}><b>Seeing a bank account
            and revealing a PAN are deliberately different rights.</b>{" Finance Operations moves money and needs the account; Compliance checks identity and needs the PAN; neither needs both, and the Auditor needs no write at all. A seat that quietly carried every right would make the log unreadable, because everything would be explicable."}</p></div></div>
      </div>
    </>
  );
}
