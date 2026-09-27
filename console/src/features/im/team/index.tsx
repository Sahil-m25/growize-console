"use client";

/* Team — imx.js section 14, vTeam (lines 2544–2587). Who holds which seat on the Investors pages,
   and what each seat holds. In the merged console this is the "Investors side seats" section on
   Teams: merge-glue.js strips the leading .ph block and wraps the rest — that is ImTeamBody. */

import {
  activityActors, activityBase, bookOf, CAN, isSys, may, maySeat, pageReadable, role, ROLE, teamOf, who,
} from "@/lib/im";
import type { ImCan, ImRoleKey } from "@/lib/im";
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

/** vTeam without its heading block — what the merged console embeds as a section */
export function ImTeamBody({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "team")) return null;
  const activity = activityBase(s, me), actors = activityActors(s, me);
  const roles = Object.keys(ROLE) as ImRoleKey[];
  return (
    <>
      <div className="note" style={{ marginBottom: "8px" }}><b>Three teams, one wall.</b> Finance holds the money, the paper and the identity. Account Management holds the relationship after allotment — the requests, the app, the farm. Digital Infrastructure runs the software, holds every page and puts people in seats, but only Finance sees a PAN, an Aadhaar reference or a bank account. The IRs work the lead side and hold no Investors pages.</div>
      <div className="secw">
        <div className="card"><div className="ch"><h3>Who is here</h3></div><div className="tw"><table>
          <thead><tr><th>Name</th><th>Team</th><th>Seat</th><th>May</th><th className="n">Actions logged</th><th></th></tr></thead>
          <tbody>{s.data.SIGNINS.map(k => {
            const w = who(s, k), tm = (ROLE[w.r] || {}).tm;
            const pii = activity.filter(e => e.who === k && e.kind === "pii").length;
            const nb = bookOf(s, me, k).length;
            return (
              <tr key={k}>
                <td><ImPname s={s} k={k} b />{k === me ? <> <span className="tag br">you</span></> : null}
                  {k === me || may(s, me, "team") ? <div className="sm mono">{w.em}</div> : null}</td>
                <td><span className={`tag ${tm === "am" ? "br" : tm === "sys" ? "due" : ""}`}>{teamOf(s, k)}</span>
                  {w.r === "kam" && (k === me || (!isSys(s, me) && may(s, me, "assign")))
                    ? <div className="sm">{nb} account{nb === 1 ? "" : "s"}</div> : null}</td>
                <td>{roles.some(r => maySeat(s, me, k, r))
                  ? <select className="selw" aria-label={"Seat — " + w.n} style={{ maxWidth: "100%", minWidth: "200px" }} value={w.r}
                    onChange={e => dispatch({ type: "setSeat", k, r: e.target.value as ImRoleKey })}>
                    {roles.filter(r => r === w.r || maySeat(s, me, k, r)).map(r => <option key={r} value={r}>{ROLE[r].t}</option>)}</select>
                  : <><b>{role(s, k).t}</b>{may(s, me, "team") && k !== me ? <div className="sm">another team&apos;s seat</div> : null}</>}</td>
                <td className="sm">{role(s, k).can.filter(c => c !== "view").map(c => CAN[c]).join(" · ") || "read only"}</td>
                <td className="n">{actors.has(k) ? activity.filter(e => e.who === k).length : "—"}</td>
                <td style={{ textAlign: "right" }}>{pii ? <span className="tag late">{pii} reveal{pii === 1 ? "" : "s"}</span> : null}</td></tr>
            );
          })}
          </tbody></table></div></div>
        <div className="card fill"><div className="ch"><h3>What each seat holds</h3></div><div className="tw"><table>
          <thead><tr><th>Right</th>{roles.map(r => <th key={r} style={{ textAlign: "center" }}>{
            ROLE[r].t.replace("Finance ", "").replace(" — read only", "")}</th>)}</tr></thead>
          <tbody>{(Object.keys(CAN) as ImCan[]).map(c => (
            <tr key={c}><td><b>{CAN[c]}</b></td>
              {roles.map(r => {
                const on = ROLE[r].can.includes(c);
                return <td key={r} style={{ textAlign: "center", fontWeight: 700, color: on ? "var(--go)" : "var(--ink-3)", opacity: on ? 1 : .35 }}>{on ? "●" : "○"}</td>;
              })}</tr>
          ))}
          </tbody></table></div>
          <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}><b>Seeing a bank account
            and revealing a PAN are deliberately different rights.</b>{" Finance Operations moves money and needs the account; Compliance checks identity and needs the PAN; neither needs both, and the Auditor needs no write at all. A seat that quietly carried every right would make the log unreadable, because everything would be explicable."}</p></div></div>
      </div>
    </>
  );
}
