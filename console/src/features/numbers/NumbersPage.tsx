"use client";

/* ── Numbers — the merged prototype's `vNumbers()` (ir-merged.js 7281–7336).
   ONE chooser for the whole page (g6, D59): a single row of sections, each one tap away.
   Assignments by IR is the IR manager's report and comes first. Marketing gets its own screen. ── */

import { TOUCHCHANNELS, ST } from "@/domain";
import { dayGap, when } from "@/lib/format";
import {
  active, canRecov, canSeeOwners, cold, conFor, fcBad, inReservation, kCol, kRag, kScore, kpis, lost, numBook, P,
} from "@/lib/selectors";
import type { Kpi as KpiMetric } from "@/lib/selectors";
import { secOf, useConsole } from "@/lib/store";
import { SecBar, type Section } from "@/components/ui";
import { AssignReport } from "./AssignReport";
import { NumbersLive } from "./NumbersLive";
import { NumbersMkt } from "./NumbersMkt";
import { Demo, Live, MINRATE, Recorded } from "./bits";
import "./drawers";

const fmtOf = (m: KpiMetric) => (v: number): string =>
  m.unit === "%" ? v + "%" : m.unit === "h" ? v + " h" : m.unit ? v + m.unit : String(v);

export function NumbersPage() {
  const { state } = useConsole();
  /* Marketing sees only numbers based on events or campaigns, and where it breaks */
  return state.ROLE === "mkt" ? <NumbersMkt /> : <NumbersMgmt />;
}

function NumbersMgmt() {
  const { state, dispatch } = useConsole();
  const NOW = state.NOW;
  /* the plan's period lines live in kpis() so the Plan page can hang a recovery action on one;
     they belong to that page's rows, never to this scorecard */
  const M = kpis(state).filter(m => m.grp !== "Plan").sort((a, b) => kScore(a) - kScore(b));
  const bad = M.filter(m => kRag(m) !== "green"), naked = bad.filter(m => !state.RECOV[m.k]);
  const B = numBook(state), live = B.filter(active);
  const nChecks = [live.filter(l => !TOUCHCHANNELS.some(k => conFor(l, k))).length,
    B.filter(l => cold(state, l, NOW)).length, B.filter(l => fcBad(l, NOW)).length,
    B.filter(l => !l.own && !lost(l) && l.done < ST.ONBOARDED).length,
    B.filter(l => inReservation(state, l)).filter(l =>
      Math.round(dayGap(NOW, when((state.PAY[l.id] || { hold: null }).hold, NOW)) ?? 0) <= 7).length]
    .reduce((a, b) => a + b, 0);
  const SECS: Section[] = [{ k: "assign", t: "Assignments by IR" },
    { k: "review", t: "Review", n: naked.length, warn: true },
    { k: "checks", t: "Checks", n: nChecks, warn: true },
    { k: "funnel", t: "Funnel" }, { k: "speed", t: "Speed" }, { k: "effort", t: "Effort" },
    ...(canSeeOwners(state) ? [{ k: "owners", t: "Owners" }] : []),
    { k: "forecast", t: "Forecast" }, { k: "source", t: "Sources" },
    { k: "lost", t: "Why we lose", n: B.filter(lost).length }];
  const S = secOf(state, "numbers:g6", SECS);
  const all = !!state.ui.G6REVALL;

  const review = () => {
    const shown = all ? M : M.slice(0, 5);
    return (
      <div className="card g6-review" {...(naked.length ? { style: { borderColor: "var(--late)" } } : {})}>
        <div className="ch"><h3>Recovery priorities</h3><Demo /><div className="sp" />
          <span className={`tag ${naked.length ? "late" : "go"}`}>{naked.length
            ? naked.length + " without a recovery action" : "every amber and red line covered"}</span></div>
        <div className="cb">{shown.map(m => {
          const r = state.RECOV[m.k], f = fmtOf(m), rag = kRag(m), red = rag !== "green";
          return (
            <div className="g6-kpi" key={m.k}>
              <span className={`rag ${rag}`} />
              <div className="g6-kpi-l"><b>{m.t}</b> <span className="sm">{m.grp}</span>{m.built ? null
                : <> <span className="prov nb" title={m.why ?? ""}>not built</span></>}
                <p className="sm">{m.read}</p></div>
              <div className="g6-kpi-v"><b className="mono" style={{ color: kCol(m) }}>{f(m.have)}</b> <Demo />
                <span className="sm mono">want {f(m.want)}</span></div>
              <div className="g6-kpi-r">{r ? <><span>{r.act}</span><span className="sm">{P(state.PEOPLE, r.who).n.split(" ")[0]} · by {r.by}</span></>
                : red ? <span className="tag late"><span className="dot" />no recovery action</span> : <span className="sm">on track</span>}
                {red && canRecov(state) ? (
                  <button type="button" className="chip" id={`rc-${m.k}`} aria-label={`${r ? "Change action" : "Set action"} — ${m.t}`} onClick={() => dispatch({
                    type: "openDrawer", k: "recov", id: m.k,
                    seed: { RCACT: (state.RECOV[m.k] || {}).act ?? null, RCWHO: (state.RECOV[m.k] || {}).who ?? null,
                      RCDATE: "", RCERR: "" } })}>{r ? "Change" : "Set action"}</button>
                ) : null}</div>
            </div>
          );
        })}
        {M.length > 5 ? (
          <button type="button" className="btn g6-more" aria-expanded={all}
            onClick={() => dispatch({ type: "setUi", patch: { G6REVALL: !all } })}>{all ? "Show the worst 5" : "Show all " + M.length}</button>
        ) : null}
        <p className="sm" style={{ margin: "10px 0 0" }}>One owner, one action, one date on every amber and red line — the weekly BU review.{" "}
          {M.filter(m => !m.built).length} of {M.length} lines cannot be measured yet; every “Now” figure is a demo literal.</p></div></div>
    );
  };

  return (
    <div className="ux-numbers rd-page rd-numbers g6-numbers">
      <div className="ph rd-page-heading"><div><h1>Numbers</h1></div></div>
      <SecBar v="numbers:g6" list={SECS} />
      <div className="secw g6-sec" id="section-numbers:g6" role="tabpanel">
        {S === "assign" ? <div className="g6-assign"><AssignReport /></div>
          : S === "review" ? review()
          : <NumbersLive sec={S} />}
      </div>
      <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-data-labels">
        <summary>How to read the figures</summary>
        <div className="ux-section sm"><Live /> comes from the current records. <Recorded /> was entered
          by the responsible team. <Demo /> is sample data for the prototype and belongs in no report.
          Rates use counts when fewer than {MINRATE} records support a percentage.</div>
      </details>
    </div>
  );
}
