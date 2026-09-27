"use client";

/* PLAN — vGoals, redesigned `ref/03-app.js` 11187–11244 (`vGoals`), 11182 (`uxPlanPhase`),
   11245–11340 (`bump`, `setNum`, `setPeriodDate`, `setGrain`, `addPeriod`, `dropPeriod`,
   `setBaseline`), 11374–11375 (`planRag`/`supplyShort`/`planRagAll`). The five reference panels
   (funnel rates, demand mix, service levels, inventory, permissions) are `./drawers.tsx`, opened
   from the door row this file renders — 11241 `doorRow(...)`, panels at 11176–11180.

   THREE NUMBERS THAT LOOK ALIKE ARE KEPT APART ON PURPOSE. The master target is a commitment, the
   planning baseline is what was sold before this plan, and the Finance-verified actual is what
   Finance has actually seen — the manual is explicit that they must never be merged, so each has
   its own column, its own writer and its own log line. A period is a DURATION, not a label:
   `from`/`to` are what every figure in the row is scoped by, and the grain rebuilds them.

   Only Finance enters a verified figure or a banked amount — `isFin` is hard-wired false in this
   console (Finance writes only in its own portal, D24/D42), so those two columns and the baseline
   stepper are permanently read-only here; the gates below are kept exactly as the prototype writes
   them, in case that ever changes.

   The redesign's own change: everything but the period table is behind a disclosure, a single
   "Decisions needed" card surfaces what wants attention without reading the whole page, and edits
   are behind an explicit "Edit periods" toggle instead of always-on inputs. */

import { BASEWHY, GRAINS } from "@/domain";
import type { Grain, PlanPeriod } from "@/domain";
import { dISOtoDisp, dOf, dayOf, iso } from "@/lib/format";
import {
  invAlloc, invFree, isFin, may, needFor, planTotals, supplyShort, seeMoney,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";
import { askb } from "@/features/people/reducer";
import { RecovRow } from "@/features/numbers/Kpi";
import { Chip } from "@/components/ui";
import { planDateError } from "./logic";
import "./drawers";
import "./state";

const cr = (n: number): string => "₹" + (n / 1e7).toFixed(2) + " Cr";

/* uxPlanPhase(p) — redesigned 03-app.js:11182. Which of a period's four states this row is in. */
function planPhase(p: PlanPeriod, NOW: Date): "dates" | "future" | "closed" | "current" {
  const from = dOf(p.from), to = dOf(p.to), today = dayOf(NOW);
  if (!from || !to || from > to) return "dates";
  return from > today ? "future" : to < today ? "closed" : "current";
}

/* one plan row (or the plan's total) as a Kpi-shaped scorecard line, so the recovery disclosure can
   reuse `RecovRow` — the same amber/red-line-owes-an-action component Numbers already renders with.
   redesigned 03-app.js:9321 `planLines`/`planLine`. */
function planKpi(t: string, have: number, want: number, key: string) {
  return {
    k: "plan_" + key, t, grp: "Plan", have, want, unit: "", built: true, why: null,
    read: `${have} of ${want} units verified ${key === "total" ? "across every period" : "by Finance in " + t.split(" — ")[0]}.`,
  };
}

/* removes one key from a ui error map without mutating it — the omit half of `resetPlanDate`,
   03-app.js(redesigned):11334. */
const omit = <T,>(o: Record<string, T>, k: string): Record<string, T> => {
  const next = { ...o };
  delete next[k];
  return next;
};

export function PlanPage() {
  const { state, dispatch } = useConsole();
  const edit = may(state, "goals", "edit");
  const fin = isFin(state.ROLE);
  const tgt = may(state, "goals", "target");
  const canEdit = edit || fin || tgt;
  const editing = !!state.ui.UXPLANEDIT && canEdit;
  const T = planTotals(state.PLAN);
  const g = state.PLAN;
  const ASKB = askb(state);
  const ps = g.periods;
  const past = ps.filter((p) => planPhase(p, state.NOW) === "closed" && p.actual < p.target);
  const last = ps.length ? dOf(ps[ps.length - 1].to) : null;
  const short = supplyShort(state);
  const free = Math.max(0, invFree(state));

  const dateErrors = state.ui.PLANDATEERR ?? {};
  const resetGen = state.ui.PLANDATERESETGEN ?? 0;
  const setPeriodDate = (pk: string, field: "from" | "to", value: string, other: string) => {
    const from = field === "from" ? value : other;
    const to = field === "to" ? value : other;
    const message = planDateError(from, to);
    if (message) {
      dispatch({ type: "setUi", patch: { PLANDATEERR: { ...dateErrors, [pk]: { field, message } } } });
      return;
    }
    if (dateErrors[pk]) dispatch({ type: "setUi", patch: { PLANDATEERR: omit(dateErrors, pk) } });
    dispatch({ type: "setPeriodDate", pk: pk as unknown as number, f: field, v: value });
  };
  const resetPlanDate = (pk: string) => dispatch({ type: "setUi",
    patch: { PLANDATEERR: omit(dateErrors, pk), PLANDATERESETGEN: resetGen + 1 } });

  const issues: { t: string; d: string; rec?: ReturnType<typeof planKpi> }[] = [];
  if (g.baseline.units + T.target !== g.masterUnits) {
    issues.push({
      t: "Align the master target",
      d: `${g.baseline.units} baseline + ${T.target} planned = ${g.baseline.units + T.target}; master target ${g.masterUnits}.`,
    });
  }
  if (!last || last < new Date(2027, 2, 31)) {
    issues.push({
      t: "Complete the plan window",
      d: last
        ? `The last period ends ${dISOtoDisp(iso(last), state.NOW)}; add coverage through ${g.byWhen}.`
        : "Add the first planning period.",
    });
  }
  if (short) {
    issues.push({
      t: "Confirm more deliverable units",
      d: `${Math.max(0, T.target - T.actual)} units remain in the plan; ${Math.max(0, state.INV.released - invAlloc(state))} released units are not allocated.`,
      rec: planKpi("The plan — fully paid against target", T.actual, T.target, "total"),
    });
  }
  past.forEach((p) => issues.push({
    t: `Review ${p.t}`, d: `The period has ended with ${p.target - p.actual} units below target.`,
    rec: planKpi(p.t + " — fully paid against target", p.actual, p.target, String(p.k)),
  }));

  const active = ps.find((p) => planPhase(p, state.NOW) === "current");
  const next = ps.find((p) => planPhase(p, state.NOW) === "future");
  const focus = active || next;

  const setEditing = (v: boolean) => dispatch({ type: "setUi", patch: { UXPLANEDIT: v, G6PLAN: "periods" } });
  const G6PLAN = state.ui.G6PLAN ?? null;
  const open = editing ? "periods" : (ASKB && fin) ? "baseline" : G6PLAN;
  const g6PlanOpen = (k: string) => {
    dispatch({ type: "setUi", patch: { G6PLAN: G6PLAN === k ? null : k } });
    dispatch({ type: "closeDrawer" });
  };
  const MORE: { k: string; t: string; n?: number }[] = [{ k: "periods", t: "Period targets", n: ps.length },
    { k: "capture", t: "Capture needs" }, { k: "assume", t: "Assumptions" }, { k: "baseline", t: "Baseline" }];

  const doors: { k: string; t: string; v: string }[] = [
    { k: "goals.rates", t: "Funnel rates", v: `${g.rates.lead2qual}% → ${g.rates.qual2res}% → ${g.rates.res2paid}%` },
    { k: "goals.mix", t: "Demand mix", v: `${g.eventDays} event days · ${g.eventShare}% from events` },
    { k: "goals.sla", t: "Service levels", v: "Contact and follow-up timing" },
    { k: "goals.inv", t: "Inventory", v: `${free} units free to sell` },
    { k: "goals.who", t: "Permissions", v: "Target, actual and banked" },
  ];

  return (
    <div className="ux-plan rd-page rd-plan g6-plan">
      <div className="ph rd-page-heading">
        <div><h1>Plan</h1></div>
        <div className="sp" />
        {canEdit ? (
          <button type="button" className={`btn ${editing ? "on" : ""}`} aria-pressed={editing}
            onClick={() => setEditing(!editing)}>
            {editing ? "Finish editing" : "Edit periods"}
          </button>
        ) : <span className="tag">Read only</span>}
      </div>

      <div className="stats ux-plan-summary">
        {focus ? (
          <div className="stat" title={`${dISOtoDisp(focus.from, state.NOW)} → ${dISOtoDisp(focus.to, state.NOW)}`}>
            <b>{focus.actual} of {focus.target}</b><span>Fully paid · {active ? "current" : "next"} period, {focus.t}</span></div>
        ) : null}
        <div className="stat"><b>{T.actual} of {T.target}</b><span>Fully paid · whole plan, FY26–27</span></div>
        <div className="stat"><b>{Math.max(0, T.target - T.actual)}</b><span>Still to close</span></div>
        {seeMoney(state) ? <div className="stat"><b>{cr(T.coll)}</b><span>Banked in plan</span></div> : null}
      </div>

      {issues.length > 0 && (
        <section className="card ux-plan-attention">
          <div className="ch"><h2>Decisions needed</h2><span className="tag due">{issues.length}</span></div>
          <div className="cb">
            {issues.map((x, i) => (
              <div className="ux-plan-issue" key={i}><b>{x.t}</b><div className="g6-issue-d"><span>{x.d}</span>{x.rec ? <RecovRow m={x.rec} /> : null}</div></div>
            ))}
          </div>
        </section>
      )}

      <div className="secbar g6-plan-more" role="group" aria-label="More on the plan">{MORE.map(x => (
        <button type="button" key={x.k} className={`sc ${open === x.k ? "on" : ""}`} aria-expanded={open === x.k}
          aria-controls="g6-plan-sec" onClick={() => g6PlanOpen(x.k)}>{x.t}{x.n ? <i>{x.n}</i> : null}</button>
      ))}</div>
      <div id="g6-plan-sec">
      {open === "periods" ? <section className="card ux-primary ux-plan-periods">
        <div className="ch">
          <div><h2>Period targets</h2><p className="sm rd-table-caption">Actuals come from confirmed payments</p></div>
        </div>
        {editing ? (
          <div className="ux-toolbar ux-plan-edit-tools">
            {edit ? (
              <>
                <span className="sm">Period length</span>
                {(Object.entries(GRAINS) as [Grain, { t: string }][]).map(([k, v]) => (
                  <Chip key={k} on={g.grain === k} onClick={() => {
                    if (g.grain !== k) {
                      dispatch({
                        type: "openDrawer", k: "p:goals.ask", id: null,
                        seed: { GOALSASK: { kind: "grain", g: k } },
                      });
                      return;
                    }
                    dispatch({ type: "setGrain", g: k });
                  }}>{v.t}</Chip>
                ))}
                <button type="button" className="btn" onClick={() => dispatch({ type: "addPeriod" })}>Add period</button>
              </>
            ) : null}
            <span className="sm">{tgt ? "Targets are editable." : fin ? "Banked amounts are editable." : "Dates are editable; the BU Owner sets targets."}</span>
          </div>
        ) : null}
        <div className="ux-overflow">
          <table className="ptab ux-plan-table">
            <thead>
              <tr>
                <th>Period</th><th>Window</th><th className="n">Target</th><th className="n">Paid</th>
                <th className="n">Remaining</th><th className="n">Banked, Cr</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ps.map((p) => {
                const phase = planPhase(p, state.NOW);
                const remaining = Math.max(0, p.target - p.actual);
                const status = phase === "future" ? "Planned"
                  : phase === "current" ? "In progress"
                  : phase === "dates" ? "Check dates"
                  : remaining ? "Below target" : "Complete";
                const statusCls = phase === "closed" && remaining ? "due" : phase === "closed" ? "go" : "";
                const dateError = dateErrors[p.k];
                return (
                  <tr key={p.k} className={`ux-plan-${phase}`} data-plan-phase={phase}>
                    <td className="pn" title={p.emph || undefined}>
                      <b>{p.t}</b>
                      {editing && edit && ps.length > 1 ? (
                        <button type="button" className="btn" aria-label={`Remove ${p.t}`} onClick={() => {
                          dispatch({
                            type: "openDrawer", k: "p:goals.ask", id: null,
                            seed: { GOALSASK: { kind: "drop", pk: p.k } },
                          });
                        }}>×</button>
                      ) : null}
                    </td>
                    <td>
                      {editing && edit ? (
                        <div className="ux-plan-window">
                          <input className="di" type="date" key={`f-${p.k}-${p.from}-${resetGen}`} defaultValue={p.from} max={p.to}
                            id={`plan-${p.k}-from`} aria-label={`${p.t} starts`}
                            aria-invalid={dateError?.field === "from"}
                            aria-describedby={dateError ? `plan-error-${p.k}` : undefined}
                            onChange={(e) => setPeriodDate(String(p.k), "from", e.target.value, p.to)} />
                          <span>→</span>
                          <input className="di" type="date" key={`t-${p.k}-${p.to}-${resetGen}`} defaultValue={p.to} min={p.from}
                            id={`plan-${p.k}-to`} aria-label={`${p.t} ends`}
                            aria-invalid={dateError?.field === "to"}
                            aria-describedby={dateError ? `plan-error-${p.k}` : undefined}
                            onChange={(e) => setPeriodDate(String(p.k), "to", e.target.value, p.from)} />
                        </div>
                      ) : (
                        <span className="ux-plan-window-text">{dISOtoDisp(p.from, state.NOW)} → {dISOtoDisp(p.to, state.NOW)}</span>
                      )}
                      {dateError && (
                        <p className="ux-date-error" id={`plan-error-${p.k}`} role="alert">
                          {dateError.message}{" "}
                          <button type="button" className="btn" onClick={() => resetPlanDate(String(p.k))}>Keep saved dates</button>
                        </p>
                      )}
                    </td>
                    <td className="n">
                      {editing && tgt ? (
                        <input className="ni" type="number" min={0} max={400} key={`tg-${p.k}-${p.target}`}
                          defaultValue={p.target} aria-label={`${p.t} target units`}
                          onBlur={(e) => { dispatch({ type: "setNum", pk: p.k as unknown as number, f: "target", v: e.target.value }); }} />
                      ) : <span className="mono">{p.target}</span>}
                    </td>
                    <td className="n mono">{p.actual}</td>
                    <td className="n mono">{phase === "future" ? "—" : remaining}</td>
                    <td className="n">
                      {seeMoney(state) ? (
                        editing && fin ? (
                          <input className="ni" type="number" min={0} step={0.25} key={`co-${p.k}-${p.coll}`}
                            defaultValue={((p.coll || 0) / 1e7).toFixed(2)} aria-label={`${p.t} banked in crore`}
                            onBlur={(e) => { dispatch({ type: "setNum", pk: p.k as unknown as number, f: "coll", v: e.target.value }); }} />
                        ) : <span className="mono">{((p.coll || 0) / 1e7).toFixed(2)}</span>
                      ) : "•••"}
                    </td>
                    <td><span className={`tag ${statusCls}`}>{status}</span></td>
                  </tr>
                );
              })}
              <tr className="ux-plan-total">
                <td><b>Total</b></td>
                <td className="sm">{ps.length ? `${dISOtoDisp(ps[0].from, state.NOW)} → ${dISOtoDisp(ps[ps.length - 1].to, state.NOW)}` : "No periods"}</td>
                <td className="n mono"><b>{T.target}</b></td>
                <td className="n mono"><b>{T.actual}</b></td>
                <td className="n mono"><b>{Math.max(0, T.target - T.actual)}</b></td>
                <td className="n mono"><b>{seeMoney(state) ? (T.coll / 1e7).toFixed(2) : "•••"}</b></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section> : null}

      {open === "capture" ? <section className="card"><div className="ch"><h2>Capture requirements by period</h2></div><div className="cb">
          <p className="sm" style={{ margin: "0 0 8px" }}>Calculated from each period target and the funnel assumptions.</p>
          <div className="ux-overflow">
            <table className="ptab ux-plan-table">
              <thead>
                <tr>
                  <th>Period</th><th className="n">Paid target</th><th className="n">Reserved</th>
                  <th className="n">Qualified</th><th className="n">Captured</th><th className="n">Leads / workday</th>
                </tr>
              </thead>
              <tbody>
                {ps.map((p) => {
                  const n = needFor(g, p);
                  const days = Math.max(1, Math.round(((new Date(p.to).getTime() - new Date(p.from).getTime()) / 864e5) * 5 / 7));
                  return (
                    <tr key={p.k}>
                      <td><b>{p.t}</b></td>
                      <td className="n mono">{p.target}</td>
                      <td className="n mono">{n.res}</td>
                      <td className="n mono">{n.qual.toLocaleString("en-IN")}</td>
                      <td className="n mono">{n.cap.toLocaleString("en-IN")}</td>
                      <td className="n mono">{Math.round(n.cap / days)}</td>
                    </tr>
                  );
                })}
                <tr className="ux-plan-total">
                  <td><b>Total</b></td>
                  <td className="n mono">{T.target}</td>
                  <td className="n mono">{T.res}</td>
                  <td className="n mono">{T.qual.toLocaleString("en-IN")}</td>
                  <td className="n mono">{T.cap.toLocaleString("en-IN")}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div></section> : null}

      {open === "assume" ? <div className="ux-plan-settings"><PlanDoors items={doors} /></div> : null}

      {open === "baseline" ? <section className="card"><div className="cb ux-plan-baseline">
          <div>
            <b>{g.baseline.units} baseline units · {g.masterUnits} master target</b>
            <p className="sm">{g.baseline.src}. Baseline is prior stock, separate from new sales. Finance records a reason when replacing it.</p>
          </div>
          {fin ? (
            <div className="chips">
              <button type="button" className="chip" aria-label="Lower baseline one unit" onClick={() => dispatch({ type: "setBaseline", d: -1, why: "" })}>−</button>
              <b className="mono">{g.baseline.units}</b>
              <button type="button" className="chip" aria-label="Raise baseline one unit" onClick={() => dispatch({ type: "setBaseline", d: 1, why: "" })}>+</button>
            </div>
          ) : null}
          {ASKB && fin ? (
            <div className="chips">
              {BASEWHY.map((w) => (
                <button type="button" className="chip" key={w} onClick={() => dispatch({ type: "setBaseline", d: 0, why: w })}>{w}</button>
              ))}
              <button type="button" className="btn" onClick={() => dispatch({ type: "setUi", patch: { ASKB: false } })}>Cancel change</button>
            </div>
          ) : null}
        </div></section> : null}
      </div>
    </div>
  );
}

/* doorRow(items) — 03-app.js:2522, unchanged by the redesign. Every door here is a leadless panel
   (`id: null`), so — unlike `features/lead/Doors.tsx` — "open" is a plain kind match on `state.DRW`. */
function PlanDoors({ items }: { items: { k: string; t: string; v: string }[] }) {
  const { state, dispatch } = useConsole();
  const open = (k: string) => !!(state.DRW && state.DRW.k === `p:${k}`);
  return (
    <div className="doors">
      {items.map((x) => (
        <button type="button" key={x.k} className={`door ${open(x.k) ? "on" : ""}`}
          id={`door-${x.k.replace(/\./g, "-")}`}
          onClick={() => dispatch({ type: "openDrawer", k: `p:${x.k}` as DrawerKind, id: null })}
          aria-haspopup="dialog" aria-expanded={open(x.k) ? "true" : "false"} title="Opens below">
          <span className="dt">{x.t}</span>
          <span className="dv">{x.v}</span>
        </button>
      ))}
    </div>
  );
}
