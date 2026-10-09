"use client";

/* ── the recovery-action drawer — redesigned `ir-console-redesigned.html` 12571–12596 ───────
   One of the two drawers that are not about a lead. It is reachable from exactly one place — an
   amber or red line on Numbers — so it is registered from here.

   The redesign trades the old "By when" quick-pick-only chips for a real calendar deadline: a
   date input, three shortcut chips that fill it, inline validation, and a `<details>` holding the
   previous action's "set by" line and the clear button (was a fixed footer button). Body and Foot
   are two separate registered components (registerDrawer wires them independently), so the
   in-progress date and its error live in the shared `ui` bag — the same `declare module` pattern
   `@/features/pay/reducer` already uses for RCACT/RCWHO, just declared from here since Numbers,
   not pay, owns this drawer in this split. ────────────────────────────────────────────────── */

import { Tw } from "@/components/ui";
import { BANDS, RECOVACTS } from "@/domain";
import type { PersonKey, RecovAction } from "@/domain";
import { dAdd, dOf, dayGap, dayOf, iso } from "@/lib/format";
import { canRecov, fmtD, kpis, numNamed, P, roleOf } from "@/lib/selectors";
/* titleOf with the Investors title (merge-glue.js imTitle) — the sign-in screen's own */
import { titleOf } from "@/components/shell/SignIn";
import type { ConsoleState } from "@/lib/store";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { RCACT, RCWHO } from "@/features/pay/reducer";
import { useGo } from "@/features/pay/common";
import { Hd } from "./bits";
import { numAgeBands, numStageSteps } from "./panels";

/* the recov drawer's own owner list — `everyone()`, redesigned line 4068:
   `roleOf(me())==="cp"?[me()]:Object.keys(PEOPLE).filter(k=>PEOPLE[k].on&&roleOf(k)!=="mkt")`.
   The shared `everyone()` (src/lib/selectors/leads.ts) filters by `consoleAccount` instead, which
   drops an ext Finance seat like Harsha Bhat; kept local here rather than edited — see
   `crossOwnerRequests`. */
const recovOwners = (s: ConsoleState): PersonKey[] =>
  roleOf(s.PEOPLE, s.WHO) === "cp" ? [s.WHO]
    : (Object.keys(s.PEOPLE) as PersonKey[]).filter(k => s.PEOPLE[k].on && roleOf(s.PEOPLE, k) !== "mkt");

declare module "@/lib/store" {
  interface UiState {
    /** The recovery-action drawer's deadline field, as typed/picked — "" until touched. */
    RCDATE?: string;
    /** The recovery-action drawer's inline validation message. */
    RCERR?: string;
  }
}
const RCDATE = (s: ConsoleState): string => s.ui.RCDATE ?? "";
const RCERR = (s: ConsoleState): string => s.ui.RCERR ?? "";
/* the field's working value: whatever was picked, or a week from today until it is */
const rcDeadline = (s: ConsoleState): string => RCDATE(s) || iso(dAdd(s.NOW, 7));

const BY: readonly (readonly [string, number])[] = [["7 days", 7], ["14 days", 14], ["30 days", 30]];

function Body({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const m = kpis(state).find(x => x.k === id);
  if (!m || id == null) return null;
  const r = state.RECOV[id];

  if (!canRecov(state)) return (
    <p className="sm" style={{ margin: 0 }}>
      {r ? <><b>{P(state.PEOPLE, r.who).n}</b> — {r.act},
        by <span className="mono">{r.by}</span>.</> : "No recovery action set."}
      <br /><br />The BU Owner and
      Operations set these; the weekly review runs from them.</p>
  );

  const act = RCACT(state), who = RCWHO(state), dateStr = rcDeadline(state), err = RCERR(state);
  const pickDate = (v: string) => dispatch({ type: "setUi", patch: { RCDATE: v, RCERR: "" } });

  return (
    <>
      <p className="sm" style={{ margin: "0 0 14px" }}>Choose an action, its owner and a deadline.</p>
      {r && (
        <div className="hd1"><span><b>{P(state.PEOPLE, r.who).n}</b> — {r.act}, by{" "}
          <span className="mono">{r.by}</span></span></div>
      )}
      <p className="lbl">Action</p>
      <select className="selw" id="rcact" aria-label="The action" value={act ?? ""}
        onChange={e => dispatch({ type: "setUi", patch: { RCACT: e.target.value || null } })}>
        <option value="">Choose an action…</option>
        {RECOVACTS.map(a => <option value={a} key={a}>{a}</option>)}
      </select>
      <p className="lbl" style={{ marginTop: 14 }}>Owner</p>
      <select className="selw" id="rcwho" aria-label="The owner" value={who ?? ""}
        onChange={e => dispatch({ type: "setUi",
          patch: { RCWHO: (e.target.value || null) as PersonKey | null } })}>
        <option value="">Choose a person…</option>
        {recovOwners(state).map(w => (
          <option value={w} key={w}>{P(state.PEOPLE, w).n} — {titleOf(state, w)}</option>
        ))}
      </select>
      <label className="fi" style={{ marginTop: 14 }}><span>Deadline</span>
        <input className="di2" id="rcdeadline" type="date" min={iso(state.NOW)} value={dateStr}
          aria-describedby="rcdeadline-help" onChange={e => pickDate(e.target.value)} /></label>
      <div className="ux-primary" style={{ marginTop: 8 }}>{BY.map(([t, d]) => (
        <button type="button" key={t} className="chip" onClick={() => pickDate(iso(dAdd(state.NOW, d)))}>
          {t}</button>
      ))}</div>
      <p className="sm" id="rcdeadline-help" style={{ margin: "9px 0 0" }}>Choose a calendar date, or use a shortcut from today.</p>
      {err ? <p className="sm" role="alert" style={{ color: "var(--late)", marginTop: 10 }}>{err}</p> : null}
      {r && (
        <details className="ux-disclosure" data-ux-key={`recovery-existing-${id}`}>
          <summary>Previous action and removal</summary>
          <div className="ux-section">
            <p className="sm">Set by {P(state.PEOPLE, r.set).n} · {r.at}</p>
            <button type="button" className="chip"
              onClick={() => { dispatch({ type: "clearRecov", k: id }); dispatch({ type: "closeDrawer" }); }}
            >Clear the action</button>
          </div>
        </details>
      )}
    </>
  );
}

function Foot({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  if (!canRecov(state) || id == null) return null;
  const act = RCACT(state), who = RCWHO(state), dateStr = rcDeadline(state);

  const save = () => {
    if (!act || !who) return;
    const d = dOf(dateStr);
    if (!d || !Number.isFinite(d.getTime()) || iso(d) !== dateStr || dayOf(d) < dayOf(state.NOW)) {
      dispatch({ type: "setUi", patch: { RCERR: "Choose a real date today or later." } });
      return;
    }
    const person = state.PEOPLE[who];
    if (!(RECOVACTS as readonly string[]).includes(act) || !person || !person.on) {
      dispatch({ type: "setUi", patch: { RCERR: "Choose an action and an active owner." } });
      return;
    }
    const days = Math.max(0, Math.round(dayGap(dayOf(state.NOW), d) ?? 0));
    dispatch({ type: "setRecov", k: id, act: act as RecovAction, who, days });
    dispatch({ type: "closeDrawer" });
  };

  return (
    <button type="button" className="act" disabled={!(act && who && dateStr)} onClick={save}>
      Save recovery action</button>
  );
}

registerDrawer("recov", {
  w: 440,
  title: () => "Recovery action",
  sub: (s, a) => { const m = kpis(s).find(x => x.k === a.id); return m ? m.t : ""; },
  Body,
  Foot,
});

/* ── the two doors off Numbers · Funnel — `panel("numbers.stage", …)` / `panel("numbers.age", …)`,
   redesigned lines 9532–9576. A panel is a drawer with no lead, opened as "p:<key>" (registry.ts's
   `DrawerKind`); the door row that opens these lives in `NumbersLive`, off the same `./panels`
   arithmetic so the door's face can never disagree with what is behind it. ─────────────────── */

function StageBody() {
  const { state } = useConsole();
  const go = useGo();
  const trans = numStageSteps(state);
  return (
    <div className="card ux-numbers-panel">
      <Hd t="Time in stage" />
      <Tw><table className="ttab">
        <thead><tr><th>From → to</th><th className="n">Median</th><th className="n">Range</th>
          <th className="n">Made it</th><th>Longest waiting now</th></tr></thead>
        <tbody>{trans.filter(t => t.n || t.sitting.length).map(t => (
          <tr key={t.from}>
            <td className="nw"><b>{t.from}</b><div className="sm">→ {t.to}</div></td>
            <td className="n"><b>{fmtD(t.med)}</b></td>
            <td className="n sm">{t.n ? fmtD(t.lo) + " – " + fmtD(t.hi) : "—"}</td>
            <td className="n">{t.n || "—"}</td>
            <td className="sm">{t.sitting.length ? (<>
              {numNamed(state, t.sitting[0].l)
                ? <b className="nw" style={{ cursor: "pointer" }} role="button" tabIndex={0}
                    onClick={() => go("lead", t.sitting[0].l.id)}
                    onKeyDown={e => { if (e.key === "Enter") go("lead", t.sitting[0].l.id); }}
                  >{t.sitting[0].l.n}</b>
                : <b className="nw" style={{ color: "var(--ink-3)" }} title="Not in your book">somebody else&#39;s</b>}
              {" "}<span className="mono">{fmtD(t.sitting[0].d)}</span>
              {t.sitting.length > 1 ? <> <span style={{ color: "var(--ink-3)" }}>+{t.sitting.length - 1}</span></> : null}
              {t.med != null && t.sitting[0].d > t.med * 2
                ? <> <span className="tag late" title="More than twice the median for this step">stuck</span></> : null}
            </>) : "—"}</td>
          </tr>
        ))}</tbody></table></Tw>
      <div className="cb"><p className="sm" style={{ margin: 0 }}>A stuck investor has waited over twice the
        usual time for this step. Open the relationship to review the blocker and next follow-up.</p></div>
    </div>
  );
}

registerDrawer("p:numbers.stage", { w: 680, title: () => "Time in stage", Body: StageBody });

function AgeBody() {
  const { state } = useConsole();
  const ageRows = numAgeBands(state);
  return (
    <div className="card ux-numbers-panel">
      <Hd t="Age of the active book" />
      <Tw><table className="ttab">
        <thead><tr><th>Since last touch</th>
          {BANDS.slice(0, 3).map(b => (
            <th className="n" key={b.t}><span className="sw" style={{ background: b.c }} />{b.t}</th>))}
          <th className="n">All</th></tr></thead>
        <tbody>{ageRows.map(row => (
          <tr key={String(row[0])}><td>{row[0]}</td>
            {row.slice(1).map((v, i) => (
              <td className="n" key={i}
                {...(i === 0 && row[0] === "31 d +" && v ? { style: { color: "var(--late)" } } : {})}
              >{v || "—"}</td>
            ))}</tr>
        ))}</tbody></table></Tw>
      <div className="cb"><p className="sm" style={{ margin: 0 }}>Review older relationships for an unresolved
        blocker or missing next step. Choose the follow-up using the investor’s recorded contact
        permissions.</p></div>
    </div>
  );
}

registerDrawer("p:numbers.age", { w: 680, title: () => "Age of the active book", Body: AgeBody });

/* imported for its side effect; the module has to export something for `isolatedModules` */
export const RECOV_DRAWER = "recov" as const;
