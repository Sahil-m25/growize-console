"use client";

/* Insights — imx.js section 13, vIns (lines 2116–2294), plus amCards (lines 1394–1411), which the
   Service section draws for an Account Management seat. In the console this is the Investors half
   of Numbers. The money view, and only the money view — the funnel belongs to the lead side. */

import type { KeyboardEvent } from "react";
import {
  ageing, banked, bookOf, cadence, cared, cOf_all, forfeitExposure, I, inr, isAM, KAMS, lastC, may,
  money, needsKam, outstandingReserved, overdue, pageReadable, poolBook, PROGRAMME_UNITS, quiet,
  readBook, ROLE, secOf, signChip, stuckDocs, tierOf, TIERS, UNIT, who, FORFEIT, aged, day6,
} from "@/lib/im";
import type { ImInvestor, ImState } from "@/lib/im";
import { ImPname, ImSecBar, KycTag, ProvIR, type ImPageProps } from "../common";

const pct = (v: number, target: number) => Math.round(v / target * 100);

/* amCards(book, mine) — imx.js 1394–1411 */
function AmCards({ s, me, book, mine }: { s: ImState; me: string; book: ImInvestor[]; mine: boolean }) {
  const nK = KAMS(s).length;
  const l = Math.round(book.reduce((a, y) => a + 30 / cadence(y), 0) * 10) / 10;
  const pl = Math.round(poolBook(s, me).reduce((a, y) => a + 30 / cadence(y), 0) * 10) / 10;
  return (
    <div>
      <div className="card"><div className="ch"><h3>The cadence</h3><div className="sp"></div>
        <span className="sm">{mine ? "your book, by tier" : "the whole book, by tier"}</span></div><div className="cb">
        {TIERS.map(t => {
          const n = book.filter(x => (tierOf(x) || { k: "" }).k === t.k).length;
          return (
            <div className="led" key={t.k}><span className={`tag ${t.k === "A" ? "br" : ""}`}>{t.t}</span>
              <span style={{ minWidth: 0 }}><b>{t.min}{t.k === "A" ? "+" : t.k === "B" ? "–3" : ""} unit{t.min > 1 ? "s" : ""}</b>
                <div className="sm">{t.t2}</div></span><span className="amt">{n}</span></div>
          );
        })}
        <p className="sm" style={{ margin: "10px 0 0" }}>{"A tier is not a judgement about the investor. It is a statement about what "
          + nK + " " + (nK === 1 ? "person" : "people") + " can deliver, written down before it is promised — which is the only version of a service promise anybody keeps. "
          + (mine ? "That is" : "Across the whole book that is") + " "
          + l + " conversation" + (l === 1 ? "" : "s") + " a month" + (mine ? " of yours" : "") + "."
          + (mine ? "" : " " + pl + " of them sit in the pool, which means they belong to whoever "
            + "is free — the arrangement that works until it does not.")}</p>
      </div></div>
    </div>
  );
}

export function ImIns({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "ins")) return null;
  const am = isAM(s, me);
  const D = s.data;
  const SECS = (am ? [] : [{ k: "cash", t: "Collection" }, { k: "risk", t: "At risk" }, { k: "paper", t: "Paper" },
    { k: "comp", t: "Compliance", n: D.INV.filter(x => x.kyc !== "passed" || x.fema === "outstanding").length, warn: true }])
    .concat([{ k: "svc", t: "Service", n: readBook(s, me).filter(x => cared(x) && quiet(s, me, x)).length, warn: true }]);
  const S = secOf(s.ui.SEC, "ins", SECS);
  const target = PROGRAMME_UNITS * UNIT, got = banked(s);
  const due = outstandingReserved(s, me);
  const goTxn = () => dispatch({ type: "go", v: "txn" });
  const goInv = (id: string) => dispatch({ type: "go", v: "inv", id });

  return (
    <>
      <div className="ph"><h1>Numbers</h1>
        <span className="sub">{am ? "how well the book is being looked after"
          : "the money side and the service side — the funnel lives on the lead side"}</span></div>
      <ImSecBar s={s} dispatch={dispatch} v="ins" list={SECS} />
      <div className="secw">
        {S === "cash" ? <Cash got={got} due={due} target={target} goTxn={goTxn} /> : null}
        {S === "risk" ? <Risk s={s} me={me} /> : null}
        {S === "paper" ? <Paper s={s} me={me} goInv={goInv} /> : null}
        {S === "svc" ? <Svc s={s} me={me} /> : null}
        {S === "comp" ? <Comp s={s} goInv={goInv} /> : null}
      </div>
    </>
  );
}

function Cash({ got, due, target, goTxn }: { got: number; due: number; target: number; goTxn: () => void }) {
  const rows: [string, number, string][] = [["Banked", got, "var(--go)"], ["Committed and outstanding", due, "var(--due)"],
    ["Not yet sold", Math.max(0, target - got - due), "var(--card-2)"]];
  return (
    <div className="card"><div className="ch"><h3>Against the plan</h3><div className="sp"></div>
      <span className="prov demo">the 208-unit target is the BU plan&apos;s, not the Investors side&apos;s</span></div><div className="cb">
      <div className="stats" style={{ margin: "0 0 12px" }}><div className="stat"><b>{pct(got, target)}%</b><span>of the programme collected</span></div>
        <div className="stat"><b>{pct(due, target)}%</b><span>committed, not yet in</span></div>
        <div className="stat"><b>{pct(Math.max(0, target - got - due), target)}%</b><span>not yet sold</span></div></div>
      <p className="sm" style={{ margin: "0 0 10px" }}>Shares of the 208-unit programme. The rupee amounts are on{" "}
        <a className="lnk" role="button" tabIndex={0} onClick={goTxn}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") goTxn(); }}>Payments</a>.</p>
      {rows.map(([t, v, c]) => (
        <div className="led" key={t}><span style={{ minWidth: 0 }}><b>{t}</b>
          <div className="bar" style={{ height: "8px", borderRadius: "5px", background: "var(--card-2)", overflow: "hidden", marginTop: "5px", width: "min(320px,100%)" }}>
            <i style={{ display: "block", height: "100%", width: pct(v, target) + "%", background: c }}></i></div></span>
          <span className="amt">{pct(v, target)}%</span></div>
      ))}
      <p className="sm" style={{ margin: "11px 0 0" }}>{"Banked is what has cleared. Committed is an advance held against a balance that has not — it is a liability until the rest lands, and it is never shown inside the banked figure."}</p>
    </div></div>
  );
}

function Risk({ s, me }: { s: ImState; me: string }) {
  return (
    <div className="card"><div className="ch"><h3>Balance ageing</h3><div className="sp"></div>
      <span className="sm">{inr(forfeitExposure(s))} forfeit exposure</span></div><div className="cb">
      {ageing(s, me).filter(g => g.n || g.a <= 1).map(g => (
        <div className="led" key={g.a}>
          <span className={`tag ${g.b <= 0 ? "late" : g.a === 1 ? "late" : g.a === 8 ? "due" : ""}`}>
            {g.b <= 0 ? "overdue" : g.a === 31 ? "31 days +" : g.a + "–" + g.b + " days"}</span>
          <span style={{ minWidth: 0 }}><b>{g.n} reservation{g.n === 1 ? "" : "s"}</b>
            <div className="sm">{g.b <= 0 ? "the hold has already run out"
              : g.a === 1 ? "the hold ends inside a week" : "hold ends in this window"}</div></span>
          <span className="amt">{money(g.v)}</span></div>
      ))}
      <p className="sm" style={{ margin: "11px 0 0" }}>{"Every reservation that lapses costs the investor " + inr(FORFEIT)
        + " a unit and costs Growize a sale it had already counted. The first band is the only one worth anybody's morning."}</p>
    </div></div>
  );
}

function Paper({ s, me, goInv }: { s: ImState; me: string; goInv: (id: string) => void }) {
  const stuck = stuckDocs(s);
  return (
    <div className="card fill"><div className="ch"><h3>Out for signature, oldest first</h3></div><div className="cb">
      {stuck.length ? stuck.map(({ d, age }) => (
        <div className="led" key={d.id}>
          <span className={`tag ${age >= 10 ? "late" : age >= 5 ? "due" : ""}`}>{age}d</span>
          <span style={{ minWidth: 0 }}><b>{d.t}</b>
            <div className="sm">{((I(s, me, d.inv) || { n: "" }).n || d.inv) + " · sent " + day6(d.sent) + " by "
              + who(s, d.by).n.split(" ")[0] + " · " + (d.sig || "—") + (d.exp ? " · link expires " + d.exp : "")}</div></span>
          <button className="chip" onClick={() => goInv(d.inv)}>Open</button>
          {signChip(s, d) ? <span className="sm"> {signChip(s, d)!.t}</span> : null}</div>
      )) : <p className="sm" style={{ margin: 0 }}>Nothing is out.</p>}
      <p className="sm" style={{ margin: "11px 0 0" }}>An expiring link that expires is a second send, a second
        chase and a fortnight. <ProvIR t="The chasing itself" /> belongs to the IR — this is the list
        that tells you when to ask them how it is going.</p>
    </div></div>
  );
}

function Svc({ s, me }: { s: ImState; me: string }) {
  /* Scoped the same way the queue is. A quiet-account list a manager cannot act on is not
     oversight, it is a list of other people's problems with a link on each row. */
  const D = s.data;
  const mgr = may(s, me, "assign"), book = readBook(s, me).filter(cared);
  const late = book.filter(x => quiet(s, me, x));
  const moodOf = (x: ImInvestor) => { const l = lastC(s, me, x.id); return l ? l.mood : "never"; };
  const MOODN: Record<string, number> = { good: 0, ok: 0, concern: 0, never: 0 };
  book.forEach(x => { MOODN[moodOf(x)]++; });
  const kept = book.filter(x => { const o = overdue(s, me, x); return o != null && o <= 0; }).length;
  const tk = D.TKT.filter(t => I(s, me, t.inv) && (!isAM(s, me) || (mgr ? (ROLE[(D.P[t.own] || { r: "audit" }).r] || {}).tm === "am" : t.own === me)))
    .filter(t => t.state !== "closed");
  const slaLate = tk.filter(t => (aged(D.NOW, t.opened) || 0) > (t.pri === "high" ? 2 : 5)).length;
  return (
    <>
      <div className="stats">
        <div className={`stat ${late.length ? "bad" : ""}`}><b>{late.length}</b><span>accounts gone quiet</span></div>
        <div className="stat"><b>{book.length ? Math.round(kept / book.length * 100) : 100}%</b><span>inside their cadence</span></div>
        <div className={`stat ${slaLate ? "bad" : ""}`}><b>{slaLate}</b><span>tickets past their window</span></div>
        <div className={`stat ${MOODN.concern ? "bad" : ""}`}><b>{MOODN.concern}</b><span>ended on a concern</span></div>
      </div>
      {mgr ? (
        <div className="card"><div className="ch"><h3>By manager</h3><div className="sp"></div>
          <span className="sm">the load, and whether it is being carried</span></div><div className="tw"><table>
          <thead><tr><th>Manager</th><th className="n">Accounts</th><th className="n">Tier A</th>
            <th className="n">Gone quiet</th><th className="n">Conversations</th><th className="n">Open tickets</th>
            <th>Read of the book</th></tr></thead>
          <tbody>{KAMS(s).concat(["__pool"]).map(k => {
            const b = k === "__pool" ? poolBook(s, me) : bookOf(s, me, k);
            if (!b.length && k === "__pool") return null;
            const q = b.filter(y => quiet(s, me, y)).length, a = b.filter(y => (tierOf(y) || { k: "" }).k === "A").length;
            const cs = cOf_all(s, me).filter(c => k !== "__pool" && c.by === k).length;
            const conc = b.filter(y => { const l = lastC(s, me, y.id); return !!l && l.mood === "concern"; }).length;
            const nk = b.filter(needsKam).length;
            const flags = [conc ? <span key="c" className="tag late">{conc} on a concern</span> : null,
              nk ? <span key="n" className="tag late">{nk} should be named</span> : null].filter(Boolean);
            return (
              <tr key={k}><td>{k === "__pool" ? <><b>The shared pool</b><div className="sm">no named manager</div></>
                : <ImPname s={s} k={k} b />}</td>
                <td className="n">{b.length}</td><td className="n">{a}</td>
                <td className="n"><span className={`tag ${q ? "late" : "go"}`}>{q || "none"}</span></td>
                <td className="n">{k === "__pool" ? "—" : cs}</td>
                <td className="n">{k === "__pool" ? "—" : D.TKT.filter(t => I(s, me, t.inv) && t.state !== "closed" && t.own === k).length}</td>
                <td className="sm">{flags.length ? (flags.length === 2 ? <>{flags[0]} {flags[1]}</> : flags[0])
                  : (b.length ? <span className="tag go">nothing flagged</span> : "—")}</td></tr>
            );
          })}
          </tbody></table></div>
          <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}><b>What this measures,
            and what it does not.</b>{" Every column here is service — was the conversation had, was the ticket answered, did the account end the call warm. None of it is outcome: a manager can score perfectly on this table while not one of their accounts ever buys a second unit. That is a deliberate choice for now, and it is the same objection that was put to the lead side before it started naming the work — worth revisiting once this team has a year behind it."}</p>
          </div></div>
      ) : null}
      {isAM(s, me) ? <AmCards s={s} me={me} book={book} mine={!mgr} /> : null}
    </>
  );
}

function Comp({ s, goInv }: { s: ImState; goInv: (id: string) => void }) {
  return (
    <div className="card fill"><div className="ch"><h3>Who is not compliant</h3></div><div className="tw"><table>
      <thead><tr><th>Investor</th><th>KYC</th><th>PAN</th><th>Aadhaar</th><th>Bank match</th>
        <th>FEMA</th><th>Blocks</th></tr></thead>
      <tbody>{s.data.INV.map(x => (
        <tr className="k" key={x.id} onClick={() => goInv(x.id)} tabIndex={0}>
          <td><b>{x.n}</b><div className="sm mono">{x.id}</div></td>
          <td><KycTag x={x} /></td>
          <td>{x.pan ? <span className="tag go"><span className="dot"></span>on file</span> : <span className="tag late">missing</span>}</td>
          <td>{x.aadh ? <span className="sm mono">•••• {x.aadh}</span>
            : x.nri ? <span className="sm">n/a — non-resident</span> : <span className="tag late">missing</span>}</td>
          <td>{(x.bank || { drop: "" }).drop === "matched" ? <span className="tag go"><span className="dot"></span>matched</span>
            : <span className="tag due"><span className="dot"></span>{(x.bank || { drop: "" }).drop || "—"}</span>}</td>
          <td>{x.nri ? (x.fema === "outstanding" ? <span className="tag late"><span className="dot"></span>outstanding</span>
            : <span className="tag go"><span className="dot"></span>on file</span>) : <span className="sm">n/a</span>}</td>
          <td className="sm">{x.kyc !== "passed" ? "allotment" : x.fema === "outstanding" ? "allotment" : "—"}</td></tr>
      ))}
      </tbody></table></div>
      <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}>{"The last column is the point of the table: what is actually held up. Nothing here blocks a conversation or a reservation — it blocks "}<b>allotment</b>{", and it does so silently unless somebody reads this."}</p>
      </div></div>
  );
}
