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
  if (!pageReadable(s, me, "team")) return null;
  const activity = activityBase(s, me), actors = activityActors(s, me);
  const rows = r.state === "ok" ? r.data.investorsSide ?? [] : [];
  const cols = r.state === "ok" ? r.data.grid.columns.filter((c): c is typeof c & { im: ImRoleKey } => !!c.im) : [];
  const order = Object.keys(ROLE) as ImRoleKey[];
  return (
    <>
      <div className="note" style={{ marginBottom: "8px" }}><b>Three teams, one wall.</b> Finance holds the money, the paper and the identity. Account Management holds the relationship after allotment — the requests, the app, the farm. Digital Infrastructure runs the software, holds every page and puts people in seats, but only Finance sees a PAN, an Aadhaar reference or a bank account. The IRs work the lead side and hold no Investors pages.</div>
      {r.state === "loading" ? <p className="sm">Reading the team…</p> : null}
      {r.state === "error" ? <p className="note bad" role="alert">{r.err.error}</p> : null}
      {err ? <p className="note bad" role="alert">{err}</p> : null}
      <div className="secw">
        <div className="card"><div className="ch"><h3>Who is here</h3></div><div className="tw"><table>
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
                  {w.accounts !== null ? <div className="sm">{w.accounts} account{w.accounts === 1 ? "" : "s"}</div> : null}</td>
                <td>{w.seatOptions.length && w.role
                  ? <select className="selw" title={"Seat — " + w.name} aria-label={"Seat for " + w.name} style={{ maxWidth: "100%", minWidth: "200px" }} value={w.role}
                    onChange={e => void seat({ whom: k, seat: e.target.value as ImRoleKey }).then(x => setErr(x.ok ? null : x.error))}>
                    {opts.map(x => <option key={x} value={x}>{ROLE[x].t}</option>)}</select>
                  : <><b>{w.seatLabel}</b>{w.otherTeam ? <div className="sm">another team&apos;s seat</div> : null}</>}</td>
                <td className="sm">{w.may.map(c => CAN[c]).join(" · ") || "read only"}</td>
                <td className="n">{actors.has(k) ? activity.filter(e => e.who === k).length : "—"}</td>
                <td style={{ textAlign: "right" }}>{pii ? <span className="tag late">{pii} reveal{pii === 1 ? "" : "s"}</span> : null}</td></tr>
            );
          })}
          </tbody></table></div></div>
        <div className="card fill"><div className="ch"><h3>What each seat holds</h3></div><div className="tw"><table>
          <thead><tr><th>Right</th>{cols.map(c => <th key={c.im} style={{ textAlign: "center" }}>{
            (c.imLabel ?? ROLE[c.im].t).replace("Finance ", "").replace(" — read only", "")}</th>)}</tr></thead>
          <tbody>{(Object.keys(CAN) as ImCan[]).map(c => (
            <tr key={c}><td><b>{CAN[c]}</b></td>
              {cols.map(col => {
                const on = col.rights.includes(c);
                return <td key={col.im} style={{ textAlign: "center", fontWeight: 700, color: on ? "var(--go)" : "var(--ink-3)", opacity: on ? 1 : .35 }}>{on ? "●" : "○"}</td>;
              })}</tr>
          ))}
          </tbody></table></div>
          <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}><b>Seeing a bank account
            and revealing a PAN are deliberately different rights.</b>{" Finance Operations moves money and needs the account; Compliance checks identity and needs the PAN; neither needs both, and the Auditor needs no write at all. A seat that quietly carried every right would make the log unreadable, because everything would be explicable."}</p></div></div>
      </div>
    </>
  );
}
