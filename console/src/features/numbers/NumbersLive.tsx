"use client";

/* ── Numbers, from the book — `vNumbersLive()`, redesigned `ir-console-redesigned.html` 9795–10420
   NOTHING ON THIS TAB IS TYPED. Every figure is computed from the records the console holds — the
   ladder stamps, the touch lists, the receipts, the log — so it is small, honest and changes the
   moment somebody records something. The same arithmetic runs on real records the day leads-db
   exists; the plan tab's figures stay demo until then.

   The figures are the whole book — a manager asking how the funnel is doing is asking about all of
   it. The NAMES are only ever leads this seat may already open, because a screen that prints a name
   behind a link that refuses to open it has leaked the name and lost the click.

   The redesign replaces the old eight-tile summary row with one "Focus" select (`NumbersFocus`)
   and a summary strip scoped to whichever section is focused, opens on a new "Action needed"
   section that reads like Today's queue, folds the six-week chart / owner table / month table /
   city table behind `<details>` disclosures, and floors every rate under `MINRATE` leads to a
   count instead of a percentage (`rateOf`/`tooFew`, in `./bits`).

   "Time in stage" and "Age of the active book" are doors onto their own panels
   (`panel("numbers.stage", …)`, `panel("numbers.age", …)`, redesigned 9532–9576) — registered as
   `p:numbers.stage`/`p:numbers.age` drawers in `./drawers.tsx`, off the shared arithmetic in
   `./panels.ts` so the door's face (`numSlowest`/`numAged`) can never disagree with the table
   behind it.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Tw } from "@/components/ui";
import { Fragment, type CSSProperties } from "react";
import {
  FCAT, FORFEIT, GOALS, LADDER, LOSTWHY, ST, TOUCHDONE, TOUCHSLA,
} from "@/domain";
import type { Channel, Lead, PersonKey } from "@/domain";
import {
  DAY, MON, dAdd, dLabel, dayGap, money, monday, when, whenT,
} from "@/lib/format";
import {
  active, avail, canSeeOwners, fcRoll, planTotals, cold, conFor, fcBad, fcDate, fcOf, fcOK, fmtD, hasLeads as hasLeadsGate,
  inReservation, lost, median, noNext, numBook, numNamed, nxDue, onTime, seeMoney, seesTeam,
  stageAtLeast, tCount, tFirst, tList, touches,
} from "@/lib/selectors";
import type { FcRoll } from "@/lib/selectors";
import { useConsole, type UiState } from "@/lib/store";
import { Icon, Pname } from "@/components/ui";
import { HRow, Hd, MINRATE, bandC, pctR, rateOf, rateTx, srcColor, tooFew, useJumpToLeads } from "./bits";
import { numAged, numSlowest } from "./panels";
import { useGo } from "@/features/pay/common";

const cssv = (o: Record<string, string>): CSSProperties => o as CSSProperties;

/* TOUCHCHANNELS — redesigned line 2638. Every channel a touch can be logged in, including Visit
   (no first-touch SLA, so it is absent from `TOUCHSLA`, but `conFor`/`tCount`/`tList` all already
   read it off `Channel`). */
const TOUCHCHANNELS: readonly Channel[] = ["msg", "email", "call", "visit"];

export function NumbersLive({ sec }: { sec: string }) {
  const { state, dispatch } = useConsole();
  const go = useGo();
  const NOW = state.NOW;

  const B = numBook(state), live = B.filter(active), owned = B.filter(l => l.own);
  const ids = new Set(B.map(l => l.id));
  /* Finance's list is Reserved+ only */
  const hasLeads = hasLeadsGate(state);
  const toLeads = useJumpToLeads();

  const tile = (v: number, t: string, patch: Partial<UiState>, bad?: boolean) => (
    <div key={t}
      {...(hasLeads
        ? { className: "stat k", role: "button", tabIndex: 0, onClick: () => toLeads(patch),
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") toLeads(patch); } }
        : { className: "stat" })}
      {...(bad && v ? { "data-bad": "1" } : {})}>
      <b {...(bad && v ? { style: { color: "var(--late)" } } : {})}>{v}</b><span>{t}</span></div>
  );

  /* ---- 1. hygiene checks. Overdue, due today and no next step live on Today and the Leads list
     ("Needs attention"); the rarer book checks stay here, each one tap into the same Leads cut. ---- */
  const unev = B.filter(l => fcBad(l, NOW)).length;
  const chill = B.filter(l => cold(state, l, NOW)).length;
  const noCons = live.filter(l => !TOUCHCHANNELS.some(k => conFor(l, k))).length;
  const unown = B.filter(l => !l.own && !lost(l) && l.done < ST.ONBOARDED).length;
  const holds = B.filter(l => inReservation(state, l))
    .map(l => ({ l, d: Math.round(dayGap(NOW, when(state.PAY[l.id].hold, NOW)) ?? 0) }));
  const hot = holds.filter(h => h.d <= 7);

  /* ---- 2. the funnel, from the ladder stamps ---- */
  /* Change 5 — `reached[]` reads `stageAtLeast`, the same primitive the Leads stage filter reads,
     so a rung's count on this bar and the count behind its click can never disagree. */
  const reached = LADDER.map((s, i) => B.filter(l => stageAtLeast(l, i + 1)).length);
  const here = LADDER.map((s, i) => B.filter(l => l.done === i + 1).length);
  const top = Math.max(1, reached[0]);

  /* ---- 4. the three first-touch service levels, measured ---- */
  const sla = TOUCHSLA.map(x => {
    const withCh = owned.filter(l => tCount(l, x.k));
    const ok = withCh.filter(l => onTime(l, x, NOW)).length;
    const hrs = median(withCh.map(l => {
      const g = dayGap(whenT(l.at[0], NOW), whenT(tFirst(l, x.k), NOW));
      return g == null ? null : g * 24;
    }));
    return { ...x, n: withCh.length, ok, hrs, of: owned.length };
  });

  /* ---- 5. touches and replies ---- */
  const hist: [string, number][] = [0, 1, 2, 3, 4, 5].map(k =>
    [k === 5 ? "5 +" : String(k),
      live.filter(l => (k === 5 ? touches(state, l) >= 5 : touches(state, l) === k)).length]);
  const replied = live.filter(l => l.reply), touched = live.filter(l => touches(state, l) > 0);
  const beforeReply = median(replied.map(l => TOUCHCHANNELS.reduce((a, k) =>
    a + tList(l, k).filter(t => {
      const a2 = when(t, NOW), b2 = when(l.reply ?? null, NOW);
      return !!a2 && !!b2 && a2.getTime() <= b2.getTime();
    }).length, 0)));
  const byCh: [string, number][] = TOUCHCHANNELS.map(k =>
    [TOUCHDONE[k], B.reduce((a, l) => a + tCount(l, k), 0)]);
  const chTot = Math.max(1, byCh.reduce((a, x) => a + x[1], 0));

  /* ---- 6. weeks: touches logged, rungs ticked ---- */
  const w0 = monday(dAdd(NOW, -35)), weeks: Date[] = [];
  for (let i = 0; i < 6; i++) weeks.push(dAdd(w0, i * 7));
  const inWeek = (d: Date | null, w: Date): boolean =>
    !!d && d.getTime() >= w.getTime() && d.getTime() < dAdd(w, 7).getTime();
  const touchWk = weeks.map(w => state.LOG.filter(e =>
    !!e.lead && ids.has(e.lead) && ["msg", "call", "email"].includes(e.kind)
    && inWeek(new Date(e.d + "T00:00:00"), w)).length);
  const rungWk = weeks.map(w =>
    B.reduce((a, l) => a + l.at.filter(t => inWeek(when(t, NOW), w)).length, 0));
  const wkChart = (vals: number[]) => {
    const peak = Math.max(1, ...vals);
    return (
      <div className="wk br" style={{ height: 64 }}>{vals.map((v, i) => (
        <div className="wkb" key={i} title={`${v} in the week of ${dLabel(weeks[i])}`}>
          <i className={v ? "" : "z"}
            style={{ height: `${v ? Math.max(6, Math.round(v / peak * 100)) : 0}%` }} />
          <span>{weeks[i].getDate()} {MON[weeks[i].getMonth()]}</span></div>
      ))}</div>
    );
  };

  /* ---- 7. by source and by owner ---- */
  const srcMap: Record<string, Lead[]> = {};
  B.forEach(l => { const k = l.src || "—"; (srcMap[k] = srcMap[k] || []).push(l); });
  const srcRows = Object.keys(srcMap).map(s => {
    const L = srcMap[s];
    return { s, n: L.length, q: L.filter(l => l.done >= ST.QUALIFIED).length,
      y: L.filter(l => l.done >= ST.CONVERTED).length,
      r: L.filter(l => l.done >= ST.RESERVED).length,
      u: L.filter(active).reduce((a, l) => a + l.units, 0) };
  }).sort((a, b) => b.n - a.n);
  const ownRows = [...new Set(owned.map(l => l.own as PersonKey))].map(k => {
    const L = B.filter(l => l.own === k), A = L.filter(active);
    return { k, n: L.length, a: A.length, u: A.reduce((x, l) => x + l.units, 0),
      cu: A.filter(l => fcOf(l) === "commit" && fcOK(l, NOW)).reduce((x, l) => x + l.units, 0),
      bare: A.filter(noNext).length, late: A.filter(l => nxDue(l, NOW) === "overdue").length,
      cold: A.filter(l => cold(state, l, NOW)).length, out: !avail(state, k) };
  }).sort((a, b) => b.u - a.u || b.n - a.n);

  /* ---- 8. expected full payments by month, against the period target ---- */
  const months: Date[] = [];
  for (let i = 0; i < 7; i++) months.push(new Date(2026, 8 + i, 1));
  const mKey = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  type FcMonth = { m: Date; realised: number; commit: number; probable: number; plan: number };
  const fcBy: FcMonth[] = months.map(m => {
    const k = mKey(m);
    const r = { realised: 0, commit: 0, probable: 0, plan: 0 };
    B.forEach(l => {
      const d = fcDate(l, NOW), c = fcOf(l);
      if (!d || !c || c === "pipeline" || mKey(d) !== k) return;
      if (l.done >= ST.PAID) r.realised += l.units;
      else if (fcOK(l, NOW)) r[c as "commit" | "probable"] += l.units;
    });
    state.PLAN.periods.forEach(p => {
      if (!p.from || !p.to) return;
      const a = new Date(p.from + "T00:00:00"), b = new Date(p.to + "T00:00:00");
      const tot = Math.round((b.getTime() - a.getTime()) / DAY) + 1;
      if (tot <= 0) return;
      let inM = 0;
      for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (mKey(d) === k) inM++;
      r.plan += p.target * inM / tot;
    });
    r.plan = Math.round(r.plan);
    return { m, ...r };
  });
  const fcPeak = Math.max(1, ...fcBy.map(x => Math.max(x.plan, x.realised + x.commit + x.probable)));

  /* ---- 10. cities, objections, the commercial close ---- */
  const cityMap: Record<string, { n: number; u: number }> = {};
  B.forEach(l => { const k = l.city || "—"; cityMap[k] = cityMap[k] || { n: 0, u: 0 }; cityMap[k].n++; cityMap[k].u += l.units; });
  const cities = Object.keys(cityMap).map(c => [c, cityMap[c]] as const).sort((a, b) => b[1].n - a[1].n);
  const objCount: Record<string, number> = {};
  Object.keys(state.CALLS).filter(id => ids.has(id)).forEach(id => (state.CALLS[id].obj || []).forEach(o => { objCount[o] = (objCount[o] || 0) + 1; }));
  const objs = Object.keys(objCount).map(o => [o, objCount[o]] as const).sort((a, b) => b[1] - a[1]);
  const outCount: Record<string, number> = {};
  Object.keys(state.CALLS).filter(id => ids.has(id)).forEach(id => { const o = state.CALLS[id].o; if (o) outCount[o] = (outCount[o] || 0) + 1; });
  const outcomes = Object.keys(outCount).map(o => [o, outCount[o]] as const).sort((a, b) => b[1] - a[1]);
  const pays = Object.keys(state.PAY)
    .map(id => ({ l: B.find(x => x.id === id) as Lead, p: state.PAY[id] }))
    .filter(x => !!x.l);
  const advIn = pays.filter(x => x.p.state === "part").reduce((a, x) => a + x.p.got, 0);
  const fullIn = pays.filter(x => x.p.state === "full").reduce((a, x) => a + x.p.got, 0);
  /* D138 (B-10): the balance outstanding is not worked out from the prototype's unit price — units still owing are counted */
  const balUnits = pays.filter(x => x.p.state === "part").reduce((a, x) => a + x.l.units, 0);
  const risk = hot.reduce((a, h) => a + FORFEIT * h.l.units, 0);

  /* ---- why leads are lost — counted off the closes, not remembered ---- */
  const gone = B.filter(lost);
  const lostRows = LOSTWHY.map(w => {
    const L = gone.filter(l => l.lost!.why === w);
    return { w, n: L.length, u: L.reduce((a, l) => a + l.units, 0),
      stage: L.length ? Math.round(L.reduce((a, l) => a + (l.lost!.stage || 1), 0) / L.length) : 0,
      srcs: [...new Set(L.map(l => l.src || "—"))]};
  }).filter(r => r.n).sort((a, b) => b.n - a.n);
  const lostTop = Math.max(1, ...lostRows.map(r => r.n));
  const lostUnits = gone.reduce((a, l) => a + l.units, 0);
  const S = (k: string) => sec === k;
  const T = planTotals(state.PLAN);
  const need: Partial<Record<number, number>> = { [ST.CAPTURE]: T.cap, [ST.QUALIFIED]: T.qual, [ST.RESERVED]: T.res, [ST.PAID]: T.target };
  const r = fcRoll(state);
  const fcTot = Math.max(1, r.commit.u + r.probable.u + r.pipeline.u + r.out.u + r.bare.u);
  const fcRow = (k: keyof FcRoll, t: string, c: string, d?: string) => (
    <Fragment key={k}>
      <div className="g6-fc">
        <span>{t}</span>
        <div className="bar" style={{ height: 12 }}><i style={{ width: `${r[k].u / fcTot * 100}%`, background: c }} /></div>
        <span className="sm mono" style={{ textAlign: "right" }}>{r[k].u} unit{r[k].u === 1 ? "" : "s"}<br />
          <span style={{ opacity: 0.65 }}>{r[k].n} lead{r[k].n === 1 ? "" : "s"}</span></span></div>
      {d ? <p className="sm" style={{ margin: "-2px 0 6px" }}>{d}</p> : null}
    </Fragment>
  );
  const checks: [number, string, Partial<UiState>][] = ([
    [noCons, "Permission missing", { LFILT: "consent" }], [chill, "Going cold", { LFILT: "cold" }],
    [unev, "Forecast date missing", { LFILT: "fcgap" }], [unown, "Owner missing", { LQ: "unassigned" }],
    [hot.length, "Holds end within 7 days", { LFILT: "hold7" }]] as [number, string, Partial<UiState>][]).filter(x => x[0] > 0);
  const doorOn = (k: "p:numbers.stage" | "p:numbers.age") => !!(state.DRW && state.DRW.k === k);

  return (
    <>
      {S("checks") && (
        <div className="card fill"><Hd t="Book checks" right={hasLeads && (noCons || chill || unev || unown || hot.length)
          ? <span className="sm">tap a figure to see the leads</span> : undefined} /><div className="cb">
          {checks.length ? <div className="stats ux-numbers-summary g6-checks">{checks.map(([v, t, p]) => tile(v, t, p, true))}</div>
            : <p className="g6-none">Nothing to check.</p>}
          <p className="sm" style={{ margin: 0 }}>Overdue, due-today and no-next-step investors are worked from Today and the Leads list.</p></div></div>
      )}

      {S("lost") && (
        <div className="card fill"><Hd t="Why we lose" right={
          <span className="sm">{gone.length} closed · {lostUnits} unit{lostUnits === 1 ? "" : "s"}</span>} />
          <div className="cb">
            {lostRows.length ? (<>
              {lostRows.map(r => (
                <div className="mini" key={r.w} style={{ alignItems: "center" }}>
                  <span style={{ minWidth: 150 }}><b>{r.w}</b></span>
                  <span style={{ flex: 1, minWidth: 0 }}><span className="bar2" style={{ display: "block", height: 9,
                    borderRadius: 5, background: "var(--card-2)", overflow: "hidden" }}>
                    <i style={{ display: "block", height: "100%", width: `${Math.round(r.n / lostTop * 100)}%`,
                      background: "var(--late)", opacity: 0.72 }} /></span>
                    <span className="sm">lost on average at “{LADDER[Math.max(0, r.stage - 1)].t}” ·{" "}
                      {r.srcs.join(", ")}</span></span>
                  <span className="n2">{r.n}</span></div>
              ))}
              <p className="sm" style={{ margin: "11px 0 0" }}>Counted from the reason recorded on every close. A reason that clusters on one
                source is a targeting problem; one that appears everywhere is a product or price problem.</p>
            </>) : <div className="empty">Nothing has been closed as lost yet.</div>}
          </div></div>
      )}

      {S("funnel") && (<>
        <div className="stats ux-numbers-summary">
          {([[B.length, "Captured"], [live.length, "Active"],
            [B.filter(l => l.done >= ST.RESERVED).length, "Reserved +"],
            [B.filter(l => l.done >= ST.PAID).length, "Fully paid +"]] as const)
            .map(([v, t]) => <div className="stat" key={t}><b>{v}</b><span>{t}</span></div>)}
        </div>
        <div className="card g6-funnel"><Hd t="The funnel, from the ladder"
          right={<span className="sm">plan needs: <b>Plan</b> targets and rates</span>} />
          <div className="cb" style={cssv({ "--lw": "230px", "--nw": "92px" })}>
            {LADDER.map((s, i) => {
              const n = need[i + 1];
              return (
                <HRow key={s.t} label={<>{s.t}{n != null ? <> <i className="sm g6-need">needs {n.toLocaleString("en-IN")}</i></> : null}</>}
                  plain={s.t} w={reached[i] / top * 100}
                  col={`color-mix(in srgb,var(--brand) ${100 - i * 6}%,var(--card))`}
                  v={<>{reached[i]} <i>{i ? rateOf(reached[i], reached[i - 1]) : " "}</i></>}
                  title={`${reached[i]} reached ${s.t}${i ? " — " + rateTx(reached[i], reached[i - 1]) + " of those who reached " + LADDER[i - 1].t : ""}; ${here[i]} sitting here now${n != null ? "; the plan needs " + n + " across all periods" : ""}`}
                  click={hasLeads && here[i] ? () => toLeads({ LSTAGE: i + 1 }) : null} />
              );
            })}
            <p className="sm" style={{ margin: "8px 0 0" }}>Bars count leads that reached each rung; the grey figure is the step conversion
              (a count under {MINRATE}). “Needs” is what the whole plan requires. Tap a rung to see who is on it.</p>
          </div></div>
        {(() => {
          const slow = numSlowest(state), aged = numAged(state);
          return (
            <div className="doors">
              <button type="button" className={`door ${doorOn("p:numbers.stage") ? "on" : ""}`}
                id="door-numbers-stage" aria-haspopup="dialog"
                aria-expanded={doorOn("p:numbers.stage") ? "true" : "false"} title="Opens below"
                onClick={() => dispatch({ type: "openDrawer", k: "p:numbers.stage", id: null })}>
                <span className="dt"><Icon name="today" />Time in stage</span>
                <span className={`dv ${slow ? "" : "q"}`}>{slow ? `${fmtD(slow.med)} at the slowest step` : "nothing measured yet"}</span>
              </button>
              <button type="button" className={`door ${doorOn("p:numbers.age") ? "on" : ""}`}
                id="door-numbers-age" aria-haspopup="dialog"
                aria-expanded={doorOn("p:numbers.age") ? "true" : "false"} title="Opens below"
                onClick={() => dispatch({ type: "openDrawer", k: "p:numbers.age", id: null })}>
                <span className="dt"><Icon name="leads" />Age of the active book</span>
                <span className={`dv ${aged ? "bad" : "q"}`}>{aged ? `${aged} over 30 d` : "none over 30 d"}</span>
              </button>
            </div>
          );
        })()}
      </>)}

      {S("speed") && (<>
        <div className="card"><Hd t="First touch against the three service levels" />
          <div className="cb" style={cssv({ "--lw": "150px", "--nw": "130px" })}>
            {sla.map(x => {
              const p = pctR(x.ok, x.n);
              return <HRow key={x.k}
                label={<>{TOUCHDONE[x.k]} <i className="sm" style={{ fontStyle: "normal" }}>{x.due}</i></>}
                plain={TOUCHDONE[x.k] + " " + x.due}
                w={p || 0} col={p == null ? "var(--line)" : bandC(p)}
                v={<>{rateOf(x.ok, x.n)} <i>{tooFew(x.n) ? "too few" : x.ok + "/" + x.n}</i></>}
                title={`${tooFew(x.n) ? "Too few to rate — " : ""}${x.n} of ${x.of} owned leads have a ${x.t.toLowerCase()} logged; ${x.ok} inside "${x.due}"; median ${x.hrs == null ? "—" : fmtD(x.hrs / 24)} after capture`} />;
            })}
            <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 10 }}>
              {sla.map(x => (
                <div className="stat" key={x.k}><b>{x.hrs == null ? "—" : fmtD(x.hrs / 24)}</b>
                  <span>median to first {x.k === "msg" ? "WhatsApp" : x.k}</span></div>
              ))}
            </div>
            <p className="sm" style={{ margin: "8px 0 0" }}>On time = first entry in that channel inside the service level, from capture.
              Green at 100%, amber from 90%, red below; under {MINRATE} leads the bar stays grey.</p>
          </div></div>
        <div className="card fill"><Hd t="The last six weeks" />
          <div className="cb"><div className="cols" style={{ gap: 14 }}>
            <div style={{ overflow: "visible", padding: 0 }}><p className="lbl">Touches logged{" "}
              <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{touchWk.reduce((a, b) => a + b, 0)}</span></p>
              {wkChart(touchWk)}</div>
            <div style={{ overflow: "visible", padding: 0 }}><p className="lbl">Rungs ticked{" "}
              <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{rungWk.reduce((a, b) => a + b, 0)}</span></p>
              {wkChart(rungWk)}</div>
          </div>
            <p className="sm" style={{ margin: "10px 0 0" }}>Touches rising while rungs do not is effort without movement.</p></div>
        </div>
      </>)}

      {S("effort") && (
        <div className="card fill">
          <Hd t="Touches and replies" right={<span className="sm">{touched.length} of {live.length} active leads touched</span>} />
          <div className="cb">
            <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)", marginBottom: 10 }}>
              <div className="stat"><b>{rateOf(replied.length, touched.length)}</b><span>came back</span></div>
              <div className="stat"><b>{beforeReply == null ? "—" : beforeReply}</b><span>touches before a reply</span></div>
              <div className="stat"><b>{chill ? <span style={{ color: "var(--late)" }}>{chill}</span> : 0}</b><span>going cold</span></div>
              <div className="stat"><b>{B.reduce((a, l) => a + touches(state, l), 0)}</b><span>touches on the book</span></div>
            </div>
            <div className="cols" style={{ gap: 24 }}><div style={{ overflow: "visible", padding: 0 }}>
              <p className="lbl">Touches per active lead</p>
              <div style={cssv({ "--lw": "34px", "--nw": "34px" })}>{hist.map(([k, n]) => (
                <HRow key={k} label={<span className="mono">{k}</span>} plain={k}
                  w={n / Math.max(1, live.length) * 100} col="var(--brand)" v={n} />
              ))}</div>
            </div><div className="g6-col2">
              <p className="lbl">By channel</p>
              <div style={cssv({ "--lw": "118px", "--nw": "34px" })}>{byCh.map(([t, n]) => (
                <HRow key={t} label={t} plain={t} w={n / chTot * 100} col="var(--brand)" v={n} />
              ))}</div>
              {outcomes.length ? (<>
                <p className="lbl" style={{ marginTop: 10 }}>Last call went</p>
                <div style={cssv({ "--lw": "118px", "--nw": "34px" })}>{outcomes.map(([t, n]) => (
                  <HRow key={t} label={t} plain={t} w={n / Math.max(1, outcomes[0][1]) * 100} col="var(--brand)" v={n} />
                ))}</div>
              </>) : null}
            </div></div>
          </div></div>
      )}

      {S("owners") && canSeeOwners(state) && (() => {
        const can = seesTeam(state) && hasLeads;
        return (
          <div className="card fill"><Hd t="Owner books" right={can ? <span className="sm">tap a row to see their book</span> : undefined} />
            <Tw><table className="ttab">
              <thead><tr><th>Owner</th><th className="n">Leads</th><th className="n">Active</th>
                <th className="n">Units</th><th className="n" title="Evidenced Commit, in units">Commit</th>
                <th className="n">No next</th><th className="n">Overdue</th><th className="n">Cold</th></tr></thead>
              <tbody>{ownRows.map(r => (
                <tr key={r.k} {...(can ? { className: "g6-row", onClick: () => toLeads({ LOWN: r.k }) } : {})}>
                  <td className="nw">{can
                    ? <button type="button" className="g6-name" onClick={e => { e.stopPropagation(); toLeads({ LOWN: r.k }); }}><Pname k={r.k} first nw b /></button>
                    : <Pname k={r.k} first nw b />}{r.out ? <> <span className="tag cov">out</span></> : null}</td>
                  <td className="n">{r.n}</td><td className="n">{r.a}</td><td className="n">{r.u}</td>
                  <td className="n">{r.cu || "—"}</td>
                  <td className="n" {...(r.bare ? { style: { color: "var(--late)" } } : {})}>{r.bare || "—"}</td>
                  <td className="n" {...(r.late ? { style: { color: "var(--late)" } } : {})}>{r.late || "—"}</td>
                  <td className="n" {...(r.cold ? { style: { color: "var(--late)" } } : {})}>{r.cold || "—"}</td></tr>
              ))}</tbody></table></Tw>
            <div className="cb" style={{ paddingTop: 8 }}><p className="sm" style={{ margin: 0 }}>The state of each book, not the volume of work —
              who has leads needing attention. Work done is on Activity; assignments are in <b>Assignments by IR</b>.</p></div>
          </div>
        );
      })()}

      {S("forecast") && (<>
        <div className="card"><Hd t="Forecast — Commit, Probable, Pipeline"
          right={<span className="sm">{state.LEADS.filter(l => active(l) && !fcOf(l)).length} active leads not categorised</span>} />
          <div className="cb">
            {fcRow("commit", "Commit", "var(--go)", FCAT.commit.d)}
            {fcRow("probable", "Probable", "var(--due)", FCAT.probable.d)}
            {fcRow("pipeline", "Pipeline", "var(--brand-line)", FCAT.pipeline.d)}
            {r.bare.u ? fcRow("bare", "Not evidenced", "var(--late)",
              "Commit or Probable with no investor-specific evidence or no date — counted as neither.") : null}
            {r.out.u ? fcRow("out", "Outside FY", "var(--late)",
              "Expected full payment after 31 March 2027 — cannot count toward this year.") : null}
            <div className={`note ${r.commit.u + r.probable.u < T.target - T.actual ? "due" : ""}`} style={{ marginTop: 8 }}>
              <b>{r.commit.u + r.probable.u} units of credible near-term commitment</b> against{" "}
              {T.target - T.actual} still to find. Pipeline is coverage, never achievement.</div>
          </div></div>
        <div className="card"><Hd t="Full payments expected, by month" right={<span className="sm">units · against the period target</span>} />
          <div className="cb" style={cssv({ "--lw": "64px", "--nw": "86px" })}>
            {fcBy.map(x => {
              const got = x.realised + x.commit + x.probable;
              return (
                <div className="hrow" key={mKey(x.m)}
                  title={`${MON[x.m.getMonth()] + " " + x.m.getFullYear()}: target ${x.plan} · realised ${x.realised} · commit ${x.commit} · probable ${x.probable}`}>
                  <span className="l">{MON[x.m.getMonth()]} <i className="sm" style={{ fontStyle: "normal" }}>{String(x.m.getFullYear()).slice(2)}</i></span>
                  <div><div className="bar" style={{ height: 7, marginBottom: 3 }}>
                    <i style={{ width: `${x.plan / fcPeak * 100}%`, background: "var(--line)" }} /></div>
                    <div className="bar seg" style={{ height: 10 }}>
                      {([["realised", "var(--ink-3)"], ["commit", "var(--go)"], ["probable", "var(--due)"]] as const)
                        .filter(([k]) => x[k]).map(([k, c]) => (
                          <i key={k} style={{ width: `${x[k] / fcPeak * 100}%`, background: c }} />
                        ))}</div></div>
                  <span className="v">{got} <i>of {x.plan || "—"}</i></span></div>
              );
            })}
            <div className="leg" style={{ marginTop: 8 }}>
              <span><span className="sw" style={{ background: "var(--line)" }} />period target</span>
              <span><span className="sw" style={{ background: "var(--ink-3)" }} />realised</span>
              <span><span className="sw" style={{ background: "var(--go)" }} />commit</span>
              <span><span className="sw" style={{ background: "var(--due)" }} />probable</span></div>
            <p className="sm" style={{ margin: "8px 0 0" }}>From each lead&#39;s expected full-payment date; only evidenced Commit and Probable count.</p>
          </div></div>
        {holds.length || seeMoney(state) ? (
          <div className="card fill"><Hd t={seeMoney(state) ? "The commercial close" : "Reservation holds"} />
            <div className="cb">
              {seeMoney(state) ? (
                <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
                  <div className="stat"><b>{money(advIn)}</b><span>advances held</span></div>
                  <div className="stat"><b>{balUnits}</b><span>unit{balUnits === 1 ? "" : "s"} with a balance outstanding</span></div>
                  <div className="stat"><b>{money(fullIn)}</b><span>fully paid receipts</span></div>
                  <div className={`stat ${hot.length ? "bad" : ""}`}><b>{money(risk)}</b><span>forfeit at stake in 7 days</span></div>
                </div>
              ) : null}
              {holds.length ? (
                <div {...(seeMoney(state) ? { style: { marginTop: 10 } } : {})}>{holds.slice().sort((a, b) => a.d - b.d).map(h => {
                  const mine = numNamed(state, h.l);
                  return (
                    <div className="mini" key={h.l.id} {...(mine ? {
                      role: "button", tabIndex: 0, style: { cursor: "pointer" },
                      onClick: () => go("lead", h.l.id),
                      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") go("lead", h.l.id); },
                    } : {})}>
                      <span className={`rag ${h.d <= 3 ? "red" : h.d <= 7 ? "amber" : "green"}`}
                        title={h.d < 0 ? (-h.d) + " days over" : h.d + " days left on the hold"} />
                      <span>{mine ? <b>{h.l.n}</b> : <b style={{ color: "var(--ink-3)" }}>A lead in somebody else&#39;s book</b>}
                        {" "}<span className="sm">{h.l.units} unit{h.l.units === 1 ? "" : "s"} · hold ends {state.PAY[h.l.id].hold}</span></span>
                      <span className="n2 sm">{h.d < 0 ? (-h.d) + "d over" : h.d + "d left"}</span></div>
                  );
                })}</div>
              ) : null}
              <p className="sm" style={{ margin: "9px 0 0" }}>Receipts as Finance recorded them. Inventory and banked collections are on <b>Plan</b>.</p>
            </div></div>
        ) : null}
      </>)}

      {S("source") && (<>
        <div className="card"><Hd t="By source" right={hasLeads ? <span className="sm">tap a row to see the leads</span> : undefined} />
          <Tw><table className="ttab">
            <thead><tr><th>Source</th><th className="n">Leads</th><th className="n">Qualified +</th>
              <th className="n">Said yes +</th><th className="n">Reserved +</th><th className="n">Units</th>
              <th className="n">→ Qualified</th></tr></thead>
            <tbody>{srcRows.map(r => (
              <tr key={r.s} {...(hasLeads ? { className: "g6-row", onClick: () => toLeads({ LSRC: r.s }) } : {})}>
                <td><span className="sw" style={{ background: srcColor(r.s) }} />{hasLeads
                  ? <button type="button" className="g6-name" onClick={e => { e.stopPropagation(); toLeads({ LSRC: r.s }); }}>{r.s}</button> : r.s}</td>
                <td className="n">{r.n}</td><td className="n">{r.q || "—"}</td><td className="n">{r.y || "—"}</td>
                <td className="n">{r.r || "—"}</td>
                <td className="n">{r.u || "—"}</td><td className="n"><b>{rateOf(r.q, r.n)}</b></td></tr>
            ))}</tbody></table></Tw>
          <div className="cb" style={{ paddingTop: 8 }}><p className="sm" style={{ margin: 0 }}>“+” counts leads at that rung or past it.
            The plan needs {GOALS(state.PLAN).lead2qual}% of captures to qualify.</p></div>
        </div>
        <div className="card fill"><Hd t="Where the book is" />
          <div className="cb" style={cssv({ "--lw": "96px", "--nw": "70px" })}>
            {cities.map(([c, v]) => (
              <HRow key={c} label={c} plain={c} w={v.n / Math.max(1, cities[0][1].n) * 100}
                col="var(--brand)" v={<>{v.n} <i>{v.u} u</i></>} />
            ))}
            {objs.length ? (<>
              <p className="lbl" style={{ marginTop: 12 }}>Objections recorded</p>
              {objs.map(([o, n]) => (
                <HRow key={o} label={o} plain={o} w={n / objs[0][1] * 100} col="var(--due)" v={n} />
              ))}
            </>) : null}
          </div></div>
      </>)}
    </>
  );
}
