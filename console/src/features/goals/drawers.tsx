"use client";

/* ── the five reference panels off Plan's "Planning assumptions & reference" disclosure ─────────
   Ports `ref/03-app.js` (redesigned) `panel("goals.rates"…)` through `panel("goals.who"…)`,
   11175–11180, and `uxPlanDial`, 11175. Registered from here, the documented pattern for a
   page-owned "p:<key>" panel — no shell change needed (`registry.ts`'s note on `DrawerKind`'s
   `p:${string}`).

   Each panel is a `.card.ux-plan-panel`, same as the prototype's, so a page that used to inline
   five of these keeps the exact same card markup — just behind a door instead of always rendered. */

import type { PlanScalar } from "@/domain";
import { canInv, invAlloc, invFree, invRes, may, P, perEventNeed, planTotals } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { registerDrawer } from "@/components/shell/drawers/registry";
import { goalsAskText, usePlanBump } from "./logic";

/* uxPlanDial(k,label,val,suffix,d,lo,hi) — 03-app.js(redesigned):11175. The −/+ pair shows
   whenever the seat may edit the plan at all — unlike the period table, it does not wait for the
   page's own "Edit periods" toggle. */
function PlanDial({
  k, label, val, suffix, d, lo, hi,
}: { k: PlanScalar; label: string; val: number; suffix: string; d: number; lo: number; hi: number }) {
  const { state } = useConsole();
  const bump = usePlanBump();
  const edit = may(state, "goals", "edit");
  return (
    <div className="dialrow ux-plan-dial">
      <span>{label}</span>
      <div className="sp" />
      <div className="ux-plan-dial-value">
        {edit && (
          <button type="button" className="chip" aria-label={`Lower ${label}`} onClick={() => bump(k, -d, lo, hi)}>−</button>
        )}
        <b className="mono">{val}{suffix}</b>
        {edit && (
          <button type="button" className="chip" aria-label={`Raise ${label}`} onClick={() => bump(k, d, lo, hi)}>+</button>
        )}
      </div>
    </div>
  );
}

function RatesBody() {
  const { state } = useConsole();
  const g = state.PLAN.rates;
  return (
    <div className="card ux-plan-panel">
      <div className="ch"><h3>Funnel assumptions</h3></div>
      <div className="cb">
        <PlanDial k="lead2qual" label="Lead → qualified" val={g.lead2qual} suffix="%" d={1} lo={5} hi={90} />
        <PlanDial k="qual2res" label="Qualified → reserved" val={g.qual2res} suffix="%" d={1} lo={2} hi={60} />
        <PlanDial k="res2paid" label="Reserved → fully paid" val={g.res2paid} suffix="%" d={1} lo={30} hi={100} />
        <p className="sm ux-plan-panel-note">Provisional rates. Review them when pilot results are available.</p>
      </div>
    </div>
  );
}

function MixBody() {
  const { state } = useConsole();
  const g = state.PLAN;
  const T = planTotals(g);
  const per = perEventNeed(g);
  const other = T.target - Math.round(T.target * g.eventShare / 100);
  return (
    <div className="card ux-plan-panel">
      <div className="ch"><h3>Demand mix</h3></div>
      <div className="cb">
        <PlanDial k="eventDays" label="Field-event days" val={g.eventDays} suffix="" d={1} lo={1} hi={60} />
        <PlanDial k="eventShare" label="Share carried by events" val={g.eventShare} suffix="%" d={5} lo={0} hi={100} />
        <div className="ux-plan-panel-grid">
          <div><span className="sm">Leads needed per event</span><b className="mono">{per}</b></div>
          <div><span className="sm">Other channels</span><b className="mono">{other} units · {100 - g.eventShare}%</b></div>
        </div>
        <p className="sm ux-plan-panel-note">
          {per > 60 ? "Review event capacity before committing this mix." : "The remaining demand comes from digital, referrals and large-ticket channels."}
        </p>
      </div>
    </div>
  );
}

function SlaBody() {
  const { state } = useConsole();
  const g = state.PLAN;
  return (
    <div className="card ux-plan-panel">
      <div className="ch"><h3>Contact deadlines</h3></div>
      <div className="ux-overflow">
        <table className="ux-plan-reference">
          <thead><tr><th>Follow-up</th><th>Expected by</th></tr></thead>
          <tbody>
            <tr><td>Personal WhatsApp</td><td>{g.sla.firstTouch} · same day</td></tr>
            <tr><td>Intro email</td><td>Day 1</td></tr>
            <tr><td>Call connected</td><td>Day 3</td></tr>
            <tr><td>Produce pack for field-event leads</td><td>{g.sla.packWeeks} weekly sends</td></tr>
            <tr><td>Post-engagement follow-up</td><td>1 working day</td></tr>
          </tbody>
        </table>
      </div>
      <div className="cb"><p className="sm ux-plan-panel-note">Outbound deadlines apply to channels with recorded permission.</p></div>
    </div>
  );
}

function InvBody() {
  const { state, dispatch } = useConsole();
  const a = invAlloc(state), r = invRes(state), f = Math.max(0, invFree(state));
  const T = planTotals(state.PLAN);
  const gap = Math.max(0, T.target - state.INV.released);
  return (
    <div className="card ux-plan-panel">
      <div className="ch">
        <h3>Sellable inventory</h3>
        <div className="sp" />
        <span className="sm mono">{state.INV.released} of {state.INV.total} released</span>
      </div>
      <div className="cb">
        <div className="ux-plan-panel-grid ux-plan-inventory">
          <div><span className="sm">Allocated</span><b className="mono">{a}</b></div>
          <div><span className="sm">Reserved</span><b className="mono">{r}</b></div>
          <div><span className="sm">Free to sell</span><b className="mono">{f}</b></div>
        </div>
        <div className="dialrow ux-plan-dial">
          <span>Released for sale</span>
          <div className="sp" />
          <div className="ux-plan-dial-value">
            {canInv(state.ROLE) ? (
              <button type="button" className="chip" aria-label="Release one unit fewer" onClick={() => dispatch({ type: "setReleased", d: -1 })}>−</button>
            ) : null}
            <b className="mono">{state.INV.released}</b>
            {canInv(state.ROLE) ? (
              <button type="button" className="chip" aria-label="Release one unit more" onClick={() => dispatch({ type: "setReleased", d: 1 })}>+</button>
            ) : null}
          </div>
        </div>
        <p className="sm ux-plan-panel-note">
          {f <= 0
            ? "Every released unit is reserved or allocated. Confirm more inventory before taking an advance."
            : gap
              ? `${gap} more released units are needed to cover the total plan.`
              : `${f} unit${f === 1 ? " is" : "s are"} available to reserve.`}
        </p>
        <p className="sm ux-plan-panel-note">{state.INV.src} · {P(state.PEOPLE, state.INV.by).n} · <span className="mono">{state.INV.at}</span></p>
      </div>
    </div>
  );
}

function WhoBody() {
  return (
    <div className="card ux-plan-panel">
      <div className="ch"><h3>Planning responsibilities</h3></div>
      <div className="ux-overflow">
        <table className="ux-plan-reference">
          <thead><tr><th>Information</th><th>Maintained by</th></tr></thead>
          <tbody>
            <tr><td>Period targets</td><td>BU Owner</td></tr>
            <tr><td>Fully-paid units</td><td>Calculated from receipts</td></tr>
            <tr><td>Banked collections</td><td>Finance</td></tr>
            <tr><td>Released inventory</td><td>Finance · Digital</td></tr>
            <tr><td>Funnel assumptions and mix</td><td>Planning editors</td></tr>
            <tr><td>Recovery actions</td><td>BU Owner · Operations</td></tr>
          </tbody>
        </table>
      </div>
      <div className="cb">
        <p className="sm ux-plan-panel-note">Units are counted in the receipt period. Collections use the actual money received, so advances and balances can fall in different periods.</p>
        <p className="sm ux-plan-panel-note">Changing the baseline requires a recorded reason and approval.</p>
      </div>
    </div>
  );
}

registerDrawer("p:goals.rates", { w: 540, title: () => "Funnel assumptions", Body: RatesBody });
registerDrawer("p:goals.mix", { w: 540, title: () => "Demand mix", Body: MixBody });
registerDrawer("p:goals.sla", { w: 540, title: () => "Contact deadlines", Body: SlaBody });
registerDrawer("p:goals.inv", { w: 540, title: () => "Sellable inventory", Body: InvBody });
registerDrawer("p:goals.who", { w: 540, title: () => "Planning responsibilities", Body: WhoBody });

/* p:goals.ask — the port's stand-in for the prototype's shared `askFirst`/`DRAWERS.ask`
   (ir-console-redesigned.html ~12712), scoped to this feature's three callers. Same pattern as
   `features/events/drawer.tsx`'s `p:event.drop`: a panel needs no shell change to exist, so the
   confirm door lives beside the writes it guards instead of waiting on a shell-wide "ask" kind
   (see crossOwnerRequests). */
function GoalsAskBody() {
  const { state } = useConsole();
  const text = goalsAskText(state, state.ui.GOALSASK);
  if (!text) return <p className="sm">This drawer is unavailable.</p>;
  return (
    <>
      <p className="lbl">What this does</p>
      <p className="sm" style={{ margin: "0 0 12px" }}>{text.what}</p>
      <div className="drwsec">
        <p className="lbl">What it does not do</p>
        <p className="sm" style={{ margin: 0 }}>{text.not}</p>
      </div>
    </>
  );
}

function GoalsAskFoot() {
  const { state, dispatch } = useConsole();
  const ask = state.ui.GOALSASK;
  const text = goalsAskText(state, ask);
  if (!ask || !text) return null;
  const run = () => {
    if (ask.kind === "grain") dispatch({ type: "setGrain", g: ask.g });
    else if (ask.kind === "drop") dispatch({ type: "dropPeriod", pk: ask.pk as unknown as number });
    else dispatch({ type: "bump", k: ask.k, d: ask.d, lo: ask.lo, hi: ask.hi });
    dispatch({ type: "closeDrawer" });
  };
  return (
    <>
      <button type="button" className="act" onClick={run}>{text.btn}</button>
      <button type="button" className="act ghost" onClick={() => dispatch({ type: "closeDrawer" })}>Leave it as it is</button>
    </>
  );
}

registerDrawer("p:goals.ask", {
  w: 440,
  ok: (state) => !!goalsAskText(state, state.ui.GOALSASK),
  title: (state) => goalsAskText(state, state.ui.GOALSASK)?.title ?? "",
  Body: GoalsAskBody,
  Foot: GoalsAskFoot,
});

/* imported for its side effect; the module has to export something for `isolatedModules` */
export const GOALS_DRAWERS = "p:goals.rates" as const;
