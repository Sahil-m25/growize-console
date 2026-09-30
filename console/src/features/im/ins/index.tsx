"use client";

/* Insights — imx.js section 13, vIns (lines 2116–2294), plus amCards (lines 1394–1411), which the
   Service section draws for an Account Management seat. In the console this is the Investors half
   of Numbers. The money view, and only the money view — the funnel belongs to the lead side. */

import type { KeyboardEvent } from "react";
import {
  bookOf, cadence, cared, cOf_all, fmtDay, I, inr, isAM, KAMS, lastC, may,
  money, needsKam, overdue, pageReadable, poolBook, quiet,
  readBook, ROLE, secOf, tierOf, TIERS, FORFEIT, aged,
} from "@/lib/im";
import type { ImInvestor, ImState } from "@/lib/im";
import { useApiRead, type Read } from "@/lib/data/api";
import { investorsSection, investorsSideOffer, type SectionValue } from "@/lib/data/endpoints/numbers";
import type { InvestorsSideSection } from "@/server/numbers/investors-side";
import { ImPname, ImSecBar, ProvIR, type ImPageProps } from "../common";

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

const LABEL: Record<InvestorsSideSection, string> = { cash: "Collection", risk: "At risk", paper: "Paper", comp: "Compliance", svc: "Service" };
/** a date from the route ("2026-08-26T…") or the book ("26 Aug 10:00") as "26 Aug" */
const dayText = (t: string | null | undefined): string =>
  !t ? "—" : /^\d{4}-\d{2}-\d{2}/.test(t) ? fmtDay(Date.parse(t.slice(0, 10) + "T00:00:00Z")) : t.slice(0, 6);
const Wait = ({ r }: { r: Read<unknown> }) => r.state === "error"
  ? <div className="note" role="alert">{r.err.error}</div> : <p className="sm" style={{ margin: "8px 0" }}>Loading…</p>;

export function ImIns({ s, me, dispatch }: ImPageProps) {
  const book = { s, me };
  const offer = useApiRead(investorsSideOffer, book, undefined);
  const sections = offer.state === "ok" && offer.data.side ? offer.data.side.sections : [];
  const S = secOf(s.ui.SEC, "ins", sections.map(k => ({ k })));
  /* Compliance is read whenever it is offered (its tab carries the count); the open section is read on its own */
  const compRead = useApiRead(investorsSection, book, sections.includes("comp") ? "comp" : null);
  const secRead = useApiRead(investorsSection, book, S === "comp" ? null : (S as InvestorsSideSection));
  if (!pageReadable(s, me, "ins")) return null;
  const am = isAM(s, me);
  const D = s.data;
  const SECS = sections.map(k => k === "svc" ? { k, t: LABEL[k], n: readBook(s, me).filter(x => cared(x) && quiet(s, me, x)).length, warn: true }
    : k === "comp" ? { k, t: LABEL[k], ...(compRead.state === "ok" && compRead.data.section === "comp" ? { n: compRead.data.count } : {}), warn: true }
      : { k, t: LABEL[k] });
  const goTxn = () => dispatch({ type: "go", v: "txn" });
  const goInv = (id: string) => dispatch({ type: "go", v: "inv", id });
  const r: Read<SectionValue> = S === "comp" ? compRead : secRead;
  void D;

  return (
    <>
      <div className="ph"><h1>Numbers</h1>
        <span className="sub">{am ? "how well the book is being looked after"
          : "the money side and the service side — the funnel lives on the lead side"}</span></div>
      {offer.state !== "ok" ? <Wait r={offer} /> : null}
      {SECS.length ? <ImSecBar s={s} dispatch={dispatch} v="ins" list={SECS} /> : null}
      <div className="secw">
        {S === "svc" ? <Svc s={s} me={me} /> : SECS.length && r.state !== "ok" ? <Wait r={r} />
          : r.state === "ok" && r.data.section === "cash" ? <Cash v={r.data} goTxn={goTxn} />
            : r.state === "ok" && r.data.section === "risk" ? <Risk v={r.data} />
              : r.state === "ok" && r.data.section === "paper" ? <Paper v={r.data} goInv={goInv} />
                : r.state === "ok" && r.data.section === "comp" ? <Comp v={r.data} goInv={goInv} /> : null}
      </div>
    </>
  );
}

const pct = (v: number, target: number) => (target > 0 ? Math.round(v / target * 100) : 0);

function Cash({ v, goTxn }: { v: Extract<SectionValue, { section: "cash" }>; goTxn: () => void }) {
  const c = v.collection, target = c.programme, got = c.banked, due = c.outstanding;
  const rows: [string, number, string][] = [["Banked", got, "var(--go)"], ["Committed and outstanding", due, "var(--due)"],
    ["Not yet sold", Math.max(0, target - got - due), "var(--card-2)"]];
  return (
    <div className="card"><div className="ch"><h3>Against the plan</h3><div className="sp"></div>
      <span className="prov demo">the {c.programmeUnits}-unit target is the BU plan&apos;s, not the Investors side&apos;s</span></div><div className="cb">
      <div className="stats" style={{ margin: "0 0 12px" }}>
        <div className="stat"><b>{money(got)}</b><span>banked</span></div>
        <div className="stat"><b>{money(due)}</b><span>committed, not yet in</span></div>
        <div className="stat"><b>{money(target)}</b><span>the full programme</span></div></div>
      <div className="stats" style={{ margin: "0 0 12px" }}><div className="stat"><b>{pct(got, target)}%</b><span>of the programme collected</span></div>
        <div className="stat"><b>{pct(due, target)}%</b><span>committed, not yet in</span></div>
        <div className="stat"><b>{pct(Math.max(0, target - got - due), target)}%</b><span>not yet sold</span></div></div>
      <p className="sm" style={{ margin: "0 0 10px" }}>Shares of the {c.programmeUnits}-unit programme. The receipts behind them are on{" "}
        <a className="lnk" role="button" tabIndex={0} onClick={goTxn}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") goTxn(); }}>Payments</a>.</p>
      {rows.map(([t, x, col]) => (
        <div className="led" key={t}><span style={{ minWidth: 0 }}><b>{t}</b>
          <div className="bar" style={{ height: "8px", borderRadius: "5px", background: "var(--card-2)", overflow: "hidden", marginTop: "5px", width: "min(320px,100%)" }}>
            <i style={{ display: "block", height: "100%", width: pct(x, target) + "%", background: col }}></i></div></span>
          <span className="amt">{pct(x, target)}%</span></div>
      ))}
      <p className="sm" style={{ margin: "11px 0 0" }}>{"Banked is what has cleared. Committed is an advance held against a balance that has not — it is a liability until the rest lands, and it is never shown inside the banked figure."}</p>
    </div></div>
  );
}

function Risk({ v }: { v: Extract<SectionValue, { section: "risk" }> }) {
  return (
    <div className="card"><div className="ch"><h3>Balance ageing</h3><div className="sp"></div>
      <span className="sm">{money(v.due)} still due on money already part-paid</span></div><div className="cb">
      {v.rows.length ? v.rows.map(g => (
        <div className="led" key={g.allotmentId}>
          <span className={`tag ${g.days !== null && g.days >= 30 ? "late" : g.days !== null && g.days >= 14 ? "due" : ""}`}>{g.days === null ? "—" : g.days + "d"}</span>
          <span style={{ minWidth: 0 }}><b>{g.investor.name ?? g.allotmentId}</b>
            <div className="sm">{money(g.received)} of {money(g.committed)} in · last receipt {dayText(g.lastReceiptOn)}</div></span>
          <span className="amt">{money(g.due)}</span></div>
      )) : <p className="sm" style={{ margin: 0 }}>No reservation has a balance still due against money already received.</p>}
      <p className="sm" style={{ margin: "11px 0 0" }}>{"Every reservation that lapses costs the investor " + inr(FORFEIT)
        + " a unit and costs Growize a sale it had already counted. The longest since a receipt is the first worth anybody's morning."}</p>
    </div></div>
  );
}

function Paper({ v, goInv }: { v: Extract<SectionValue, { section: "paper" }>; goInv: (id: string) => void }) {
  return (
    <div className="card fill"><div className="ch"><h3>Out for signature, oldest first</h3></div><div className="cb">
      {v.rows.length ? v.rows.map(d => (
        <div className="led" key={d.key}>
          <span className={`tag ${(d.daysOut ?? 0) >= 10 ? "late" : (d.daysOut ?? 0) >= 5 ? "due" : ""}`}>{d.daysOut === null ? "—" : d.daysOut + "d"}</span>
          <span style={{ minWidth: 0 }}><b>{d.document}</b>
            <div className="sm">{(d.party || d.recordId) + " · sent " + dayText(d.sentAt) + (d.sentBy ? " by " + d.sentBy.split(" ")[0] : "") + " · " + (d.method || "—")
              + (d.expiresAt ? " · link expires " + dayText(d.expiresAt) : "") + (d.status ? " · " + d.status : "")}</div></span>
          {d.contactId ? <button className="chip" onClick={() => goInv(d.contactId!)}>Open</button> : null}</div>
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

function Comp({ v, goInv }: { v: Extract<SectionValue, { section: "comp" }>; goInv: (id: string) => void }) {
  return (
    <div className="card fill"><div className="ch"><h3>Who is not compliant</h3></div><div className="tw"><table>
      <thead><tr><th>Investor</th><th>KYC</th><th>PAN</th><th>Bank match</th>
        <th>FEMA</th><th>Blocks</th></tr></thead>
      <tbody>{v.rows.map(x => (
        <tr className="k" key={x.contactId} onClick={() => goInv(x.contactId)} tabIndex={0}>
          <td><b>{x.name ?? x.contactId}</b><div className="sm mono">{x.arlId ?? ""}</div></td>
          <td>{x.kyc === "passed" || x.kyc === "na" ? <span className="tag go"><span className="dot" />KYC passed</span>
            : x.kyc === "failed" ? <span className="tag late"><span className="dot" />KYC failed</span> : <span className="tag due"><span className="dot" />KYC pending</span>}</td>
          <td>{x.missing.includes("pan-proof") ? <span className="tag late">missing</span> : <span className="tag go"><span className="dot"></span>on file</span>}</td>
          <td>{x.missing.includes("bank-proof") ? <span className="tag due"><span className="dot"></span>not matched</span>
            : <span className="tag go"><span className="dot"></span>matched</span>}</td>
          <td>{x.nri ? (x.missing.includes("fema") ? <span className="tag late"><span className="dot"></span>outstanding</span>
            : <span className="tag go"><span className="dot"></span>on file</span>) : <span className="sm">n/a</span>}</td>
          <td className="sm">{x.blocks ?? "—"}</td></tr>
      ))}
      </tbody></table></div>
      <div className="cb" style={{ paddingTop: "9px" }}><p className="sm" style={{ margin: 0 }}>{"The last column is the point of the table: what is actually held up. Nothing here blocks a conversation or a reservation — it blocks "}<b>allotment</b>{", and it does so silently unless somebody reads this."}</p>
      </div></div>
  );
}
