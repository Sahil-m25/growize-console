"use client";

/* ── Numbers — `vNumbers()`, redesigned `ir-console-redesigned.html` 9577–9773 ──────────────
   Management only. Three views, chosen from one "View" select rather than three chips: the book,
   the plan, and where it is breaking — plus Marketing's own screen, which is a different screen
   rather than a cut-down one, because Marketing owns the top of the funnel and none of the
   commercial half.

   Everything on the RELATIONSHIP OVERVIEW view is computed; every figure on PLAN COMPARISON is
   demo until leads-db exists, and every value says so on its own back — `Live`/`Recorded`/`Demo`
   from `./bits` — never on the tab. The two are never mixed on one card.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Fragment, type ReactNode } from "react";
import { FCAT, GOALS, ST, UNIT } from "@/domain";
import {
  active, fcOf, fcRoll, hasLeads, invAlloc, invFree, invRes, kCol, kRag, kScore, kpis, numBook,
  planTotals, seeMoney, P,
} from "@/lib/selectors";
import type { FcRoll, Kpi as KpiMetric } from "@/lib/selectors";
import { secOf, useConsole } from "@/lib/store";
import type { Section } from "@/components/ui";
import { KpiRow } from "./Kpi";
import { NumbersLive } from "./NumbersLive";
import { NumbersMkt } from "./NumbersMkt";
import { Demo, Live, MINRATE, NumbersFocus, Phd, Recorded, crStr, useJumpToLeads } from "./bits";
import { NTAB } from "@/features/pay/reducer";
import "./drawers";

const GRPS = ["Speed", "Funnel", "Demand", "Effort", "Learning"];

const fmtOf = (m: KpiMetric) => (v: number): string =>
  m.unit === "%" ? v + "%" : m.unit === "h" ? v + " h" : m.unit ? v + m.unit : String(v);

export function NumbersPage() {
  const { state } = useConsole();
  /* Marketing sees only numbers based on events or campaigns, and where it breaks */
  return state.ROLE === "mkt" ? <NumbersMkt /> : <NumbersMgmt />;
}

function NumbersMgmt() {
  const { state, dispatch } = useConsole();
  const HL = hasLeads(state);
  const toLeads = useJumpToLeads();
  const g = GOALS(state.PLAN), T = planTotals(state.PLAN), u = T.target;
  /* the plan column is the period plan, summed — never recomputed annually */
  const F: [string, number, number][] = [
    ["Captured", T.cap, 817], ["First touch", Math.round(T.cap * 0.85), 712],
    ["Qualified", T.qual, 301], ["Engagement", Math.round(T.qual * 0.56), 158],
    ["Investor said yes", Math.round(T.qual * 0.33), 96],
    ["Reserved", T.res, 41], ["Fully paid", u, T.actual]];
  const max = F[0][1];
  /* Change 6 — the funnel-shaped rows only, the ladder rungs the Leads stage filter already knows
     by number; "First touch", "Engagement" and "Investor said yes" are interpolated fractions of
     those, not a rung of their own, so they stay plain. Money rows (below, in the Money view) are
     never in this map and so never become buttons. */
  const FSTAGE: Partial<Record<string, number>> = {
    Captured: ST.CAPTURE, Qualified: ST.QUALIFIED, Reserved: ST.RESERVED, "Fully paid": ST.PAID,
  };
  /* the plan's own period lines live in kpis() so the Plan page can hang a recovery action on
     one; they belong to that page's rows, never to this scorecard — this filter is a no-op today
     (kpis() has no "Plan" group yet) and starts working the day it does */
  const M = kpis(state).filter(m => m.grp !== "Plan").sort((a, b) => kScore(a) - kScore(b));
  const worst = M[0];
  /* one group at a time, worst-first inside it, so a review works down a list rather than across two */
  const KSECS: Section[] = GRPS.map(x => ({ k: x.toLowerCase(), t: x,
    n: M.filter(m => m.grp === x && kRag(m) !== "green").length, warn: true }));
  const KG = GRPS[Math.max(0, GRPS.map(x => x.toLowerCase()).indexOf(secOf(state, "numbers:kpi", KSECS)))];
  const PSECS: Section[] = [{ k: "funnel", t: "Funnel" }, { k: "speed", t: "Speed" },
    ...(seeMoney(state) ? [{ k: "money", t: "Money" }] : []), { k: "source", t: "Sources" }];
  const PS = secOf(state, "numbers:plan", PSECS), PP = (k: string) => PS === k;

  const tab = NTAB(state);
  const setTab = (v: string) => {
    dispatch({ type: "setUi", patch: { NTAB: v } });
    dispatch({ type: "closeDrawer" });
  };

  const bad = M.filter(m => kRag(m) !== "green"), top5 = bad.slice(0, 5);
  const naked = bad.filter(m => !state.RECOV[m.k]).length;
  const topNaked = top5.filter(m => !state.RECOV[m.k]).length;

  const r = fcRoll(state);
  const fcTot = Math.max(1, r.commit.u + r.probable.u + r.pipeline.u + r.out.u + r.bare.u);
  /* row(k,t,c,d) — 03-app.js:4391. A plain function, not a component: it is the prototype's own
     helper and nothing about it holds state. */
  const fcRow = (k: keyof FcRoll, t: string, c: string, d?: string): ReactNode => (
    <Fragment key={k}>
      <div style={{ display: "grid", gridTemplateColumns: "104px 1fr 96px", gap: 11,
        alignItems: "center", padding: "5px 0" }}>
        <span style={{ fontSize: "13.5px" }}>{t}</span>
        <div className="bar" style={{ height: 12 }}>
          <i style={{ width: `${r[k].u / fcTot * 100}%`, background: c }} /></div>
        <span className="sm mono" style={{ textAlign: "right" }}>{r[k].u} unit{r[k].u === 1 ? "" : "s"}<br />
          <span style={{ opacity: 0.65 }}>{r[k].n} lead{r[k].n === 1 ? "" : "s"}</span></span></div>
      {d ? <p className="sm" style={{ margin: "-2px 0 6px" }}>{d}</p> : null}
    </Fragment>
  );

  const a = invAlloc(state), rsv = invRes(state), free = Math.max(0, invFree(state)),
    it = Math.max(1, state.INV.released);

  return (
    <div className="ux-numbers rd-page rd-numbers">
      <div className="ph rd-page-heading">
        <div><span className="rd-eyebrow">Performance</span><h1>Numbers</h1>
          <p className="sub">{tab === "book" ? "Relationship health and progress"
            : tab === "kpi" ? "Metrics that need a recovery action" : "Period targets and forecast"}</p></div>
        <div className="sp" />
        <label className="ux-numbers-view"><span className="sm">View</span>
          <select className="sel" aria-label="Numbers view" value={tab} onChange={e => setTab(e.target.value)}>
            <option value="book">Relationship overview</option>
            <option value="kpi">Review exceptions</option>
            <option value="plan">Plan comparison</option>
          </select></label>
      </div>
      <p className="ux-numbers-context">{tab === "book"
        ? `${numBook(state).length} lead records · computed from recorded activity and receipts.`
        : "Figures are labeled computed, recorded or demo beside each value."}</p>

      {tab === "book" ? <NumbersLive /> : tab === "kpi" ? (
        <>
          <div className="card" style={{ marginBottom: 8, ...(naked ? { borderColor: "var(--late)" } : {}) }}>
            <div className="ch"><h3>Recovery priorities</h3>
              <span className="sm">the constraint is {worst.t.toLowerCase()}</span><div className="sp" />
              <span className={`tag ${topNaked ? "late" : "go"}`}>{topNaked
                ? topNaked + " of these five without a recovery action"
                : "all five covered"}</span>{naked > topNaked
                  ? <span className="sm">{naked - topNaked} more below</span> : null}</div>
            <div className="tw"><table>
              <thead><tr><th></th><th>Line</th><th className="n">Now</th><th className="n">Want</th>
                <th>Recovery action</th><th>Owner</th><th>By</th></tr></thead>
              <tbody>{top5.map(m => {
                const rv = state.RECOV[m.k], fmt = fmtOf(m);
                return (
                  <tr key={m.k}><td style={{ width: 14 }}><span className={`rag ${kRag(m)}`} /></td>
                    <td><b>{m.t}</b></td>
                    {/* kpis() has no `.src` field to gate this on yet — every current line is a demo
                        literal (see the note below), so the mark is unconditional; once kpis()
                        distinguishes a live plan line, gate this on `m.src === "demo"`. */}
                    <td className="n" style={{ color: kCol(m) }}><b>{fmt(m.have)}</b> <Demo /></td>
                    <td className="n">{fmt(m.want)}</td>
                    <td>{rv ? rv.act : <span className="tag late"><span className="dot" />none set</span>}</td>
                    <td className="sm">{rv ? P(state.PEOPLE, rv.who).n.split(" ")[0] : "—"}</td>
                    <td className="sm mono">{rv ? rv.by : "—"}</td></tr>
                );
              })}</tbody></table></div>
            <div className="cb" style={{ paddingTop: 0 }}><p className="sm" style={{ margin: 0 }}>The weekly BU review runs from
              this block: one owner, one recovery action, one date on every amber and red line below.{" "}
              {M.filter(m => !m.built).length} of {M.length} of these cannot be measured yet — each
              is named against the console field that fixes it, which makes this a build list, not a
              complaint. Every figure in the &ldquo;Now&rdquo; column is still a demo literal, including the
              two whose field exists, which is why the mark sits on the number and not on the tab.</p></div>
          </div>
          <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-kpi-review">
            <summary>Review metrics by category</summary>
            <div className="ux-section">
              <NumbersFocus v="numbers:kpi" list={KSECS} label="Category" />
              <div className="secw">
                <div className="card fill"><div className="ch"><h3>{KG}</h3><div className="sp" />
                  <span className="sm">{M.filter(m => m.grp === KG && kRag(m) !== "green").length} of{" "}
                    {M.filter(m => m.grp === KG).length} amber or red</span></div><div className="cb">
                  {M.filter(m => m.grp === KG).map(m => <KpiRow key={m.k} m={m} />)}
                </div></div>
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <NumbersFocus v="numbers:plan" list={PSECS} label="Compare" />
          <div className="secw">

            {PP("funnel") && (
              <div className="card">
                <Phd t="Funnel — plan against actual"
                  right={<span className="sm">plan <Live /> · actual <Demo /> above Fully paid</span>} />
                <div className="cb">
                {F.map(([n, plan, act], i) => {
                  const real = i === F.length - 1; /* only Fully paid is Finance-verified */
                  const stage = FSTAGE[n];
                  return (
                  <div key={n} style={{ display: "grid", gridTemplateColumns: "150px 1fr 108px", gap: 12,
                    alignItems: "center", padding: "5px 0", ...(stage != null && HL ? { cursor: "pointer" } : {}) }}
                    {...(stage != null && HL ? {
                      role: "button", tabIndex: 0,
                      onClick: () => toLeads({ LSTAGE: stage, LSTAGEMODE: "from" }),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter") toLeads({ LSTAGE: stage, LSTAGEMODE: "from" });
                      },
                    } : {})}>
                    <span style={{ fontSize: "13.5px" }}>{n}</span>
                    <div>
                      <div className="bar" style={{ height: 16, marginBottom: 3 }}>
                        <i style={{ width: `${plan / max * 100}%` }} /></div>
                      <div className="bar" style={{ height: 16 }}>
                        <i style={{ width: `${act ? Math.max(1, act / max * 100) : 0}%`, background: "var(--due)" }} /></div>
                    </div>
                    <span className="sm mono" style={{ textAlign: "right" }}>{act.toLocaleString("en-IN")}{" "}
                      {real ? <Recorded /> : <Demo />}<br />
                      <span style={{ opacity: 0.6 }}>{plan.toLocaleString("en-IN")}</span></span>
                  </div>
                  );
                })}
                <p className="sm" style={{ margin: "10px 0 0" }}><span style={{ color: "var(--brand)" }}>■</span> needed for{" "}
                  {u} units across {g.months} periods, at the rates on Plan
                  {"   "}<span style={{ color: "var(--due)" }}>■</span> actual. Fully paid is the{" "}
                  <b>Finance-verified</b> figure; every actual above it is invented for the prototype and says so
                  on the number. A zero draws no bar at all — a bar is progress, and none has been made.</p>
              </div></div>
            )}

            {PP("funnel") && (
              <div className="card fill">
                <Phd t="Forecast — Commit, Probable, Pipeline" mark={<Live />}
                  right={<span className="sm">{state.LEADS.filter(l => active(l) && !fcOf(l)).length} active leads not categorised</span>} />
                <div className="cb">
                  {fcRow("commit", "Commit", "var(--go)", FCAT.commit.d)}
                  {fcRow("probable", "Probable", "var(--due)", FCAT.probable.d)}
                  {fcRow("pipeline", "Pipeline", "var(--brand-line)", FCAT.pipeline.d)}
                  {r.bare.u ? fcRow("bare", "Not evidenced", "var(--late)",
                    "Categorised as Commit or Probable with no investor-specific evidence or no date. It is "
                    + "not coverage and it is not a commitment, so it counts as neither — but it is here, "
                    + "because units that vanish from a chart are how a forecast quietly inflates.") : null}
                  {r.out.u ? fcRow("out", "Outside FY", "var(--late)",
                    "Categorised, but the expected full-payment date falls after 31 March 2027 — it cannot count toward this year.") : null}
                  <div className={`note ${r.commit.u + r.probable.u < T.target - T.actual ? "due" : ""}`}
                    style={{ marginTop: 8 }}>
                    <b>{r.commit.u + r.probable.u} units of credible near-term commitment</b> against{" "}
                    {T.target - T.actual} still to find. Pipeline is coverage; it is never achievement.</div>
                </div></div>
            )}

            {PP("speed") && (
              <div className="card fill">
                <Phd t="Speed of first reply — demo figures" mark={<Demo />} />
                <div className="cb">
                {([["Under 30 min", 41, "var(--go)"], ["30 min – 4 h", 30, "var(--brand)"],
                  ["4 – 24 h", 18, "var(--due)"], ["Over 24 h", 7, "var(--due)"],
                  ["Never", 4, "var(--late)"]] as const).map(([b, p, c]) => (
                  <div key={b} style={{ display: "grid", gridTemplateColumns: "98px 1fr 84px", gap: 10,
                    alignItems: "center", marginBottom: 8 }}>
                    <span className="sm">{b}</span>
                    <div className="bar"><i style={{ width: `${p}%`, background: c }} /></div>
                    <span className="sm mono" style={{ textAlign: "right" }}>{p}% <Demo /></span></div>
                ))}
                <p className="sm" style={{ margin: "8px 0 0" }}>The service level is {GOALS(state.PLAN).firstTouch}, same day.{" "}
                  <span className="prov nb">not built</span></p>
              </div></div>
            )}

            {PP("money") && (
              <div className="card">
                <Phd t="Sellable inventory" mark={<Recorded />}
                  right={<span className="sm mono">{state.INV.released} of {state.INV.total} released</span>} />
                <div className="cb">
                  <div className="invb"><i className="a" style={{ width: `${a / it * 100}%` }} />
                    <i className="r" style={{ width: `${rsv / it * 100}%` }} />
                    <i className="f" style={{ width: `${free / it * 100}%` }} /></div>
                  <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                    {([["Allocated", a], ["Reserved", rsv], ["Free to sell", free]] as const).map(([n, v]) => (
                      <div className="stat" key={n}><b>{v}</b><span>{n}</span></div>))}</div>
                  <p className="sm" style={{ margin: "9px 0 0" }}>No unit can be reserved or allocated twice — an advance
                    is refused when nothing is free. {state.INV.src}.</p>
                </div></div>
            )}

            {PP("money") && seeMoney(state) && (
              <div className="card fill">
                <Phd t="Collections against plan" mark={<Recorded />} />
                <div className="cb">
                {state.PLAN.periods.map(p => {
                  const want = p.target * UNIT, got = p.coll || 0;
                  return (
                    <div key={p.k} style={{ display: "grid", gridTemplateColumns: "96px 1fr 84px", gap: 10,
                      alignItems: "center", marginBottom: 8 }}>
                      <span className="sm">{p.t}</span>
                      <div className="bar"><i style={{ width: `${Math.min(100, got / Math.max(1, want) * 100)}%`,
                        background: got >= want ? "var(--go)" : got >= want * 0.9 ? "var(--due)" : "var(--late)" }} /></div>
                      <span className="sm mono" style={{ textAlign: "right" }}>{seeMoney(state) ? crStr(got) : "•••"}</span></div>
                  );
                })}
                <p className="sm" style={{ margin: "8px 0 0" }}>₹ banked in the window, Finance-verified — not units × ₹25L.
                  A reservation banks 10% in one period and the balance in another.</p>
              </div></div>
            )}

            {PP("source") && (
              <div className="card">
                <Phd t="Why we lose — demo figures" mark={<Demo />} />
                <div className="cb">
                {([["Price too high", 28], ["Went cold", 24], ["Lock-in too long", 19], ["Timing", 14],
                  ["Yield", 9], ["KYC / FEMA", 6]] as const).map(([rw, n]) => (
                  <div key={rw} style={{ display: "grid", gridTemplateColumns: "1fr 84px", gap: 10,
                    alignItems: "center", marginBottom: 9 }}>
                    <div><div style={{ fontSize: 13, marginBottom: 4 }}>{rw}</div>
                      <div className="bar"><i style={{ width: `${n * 3.2}%`, background: "var(--due)" }} /></div></div>
                    <span className="sm mono" style={{ textAlign: "right" }}>{n}% <Demo /></span></div>
                ))}
                <p className="sm" style={{ margin: "8px 0 0" }}>Both fields are mandatory on close. The same question is
                  answered from the book on <b>From the book · Why we lose</b>, where it is counted off the
                  closes; these six figures are invented and belong in no report.{" "}
                  <span className="prov nb">not built</span></p>
              </div></div>
            )}

            {PP("source") && (
              <div className="card fill">
                <Phd t="By source — demo figures" mark={<Demo />}
                  right={<span className="sm">the counted version is on <b>From the book · Sources</b></span>} />
                <div className="tw"><table>
                <thead><tr><th>Source</th><th>Leads <Demo /></th><th>Units <Demo /></th><th>Rate <Demo /></th></tr></thead>
                <tbody>{([["Founder network", 22, 6, "27%"], ["Referral — investor", 31, 5, "16%"],
                  ["Channel partner", 28, 1, "3.6%"], ["Events", 139, 3, "2.2%"],
                  ["Website", 64, 1, "1.6%"], ["LinkedIn", 41, 0, "0%"]] as const).map(([s, l, u2, rt]) => (
                  <tr key={s}><td>{s}</td><td className="n">{l}</td><td className="n">{u2}</td>
                    <td className="n"><b>{rt}</b></td></tr>
                ))}</tbody></table></div></div>
            )}
          </div>
        </>
      )}
      <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-data-labels">
        <summary>How to read the figures</summary>
        <div className="ux-section sm"><Live /> comes from the current records. <Recorded /> was entered
          by the responsible team. <Demo /> is sample data for the prototype and belongs in no report.
          Rates use counts when fewer than {MINRATE} records support a percentage.</div>
      </details>
    </div>
  );
}
