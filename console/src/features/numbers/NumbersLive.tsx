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

import type { CSSProperties } from "react";
import {
  FORFEIT, GOALS, LADDER, LOSTWHY, ST, TOUCHDONE, TOUCHSLA, UNIT,
} from "@/domain";
import type { Channel, Lead, PersonKey } from "@/domain";
import {
  DAY, MON, dAdd, dLabel, dayGap, money, monday, when, whenT,
} from "@/lib/format";
import {
  active, avail, canSeeOwners, cold, conFor, dormant, fcBad, fcDate, fcOf, fcOK, fmtD, hasLeads as hasLeadsGate,
  inReservation, lateOf, lost, median, nextUp, noNext, numBook, numNamed, nxDue, onTime, seeMoney, seesTeam,
  stageAtLeast, tCount, tFirst, tList, touches, workGroup,
} from "@/lib/selectors";
import { secOf, useConsole, type UiState } from "@/lib/store";
import { Icon, Pname, type Section } from "@/components/ui";
import { HRow, Hd, MINRATE, NumbersFocus, bandC, pctR, rateOf, rateTx, srcColor, tooFew, useJumpToLeads } from "./bits";
import { numAged, numSlowest } from "./panels";
import { useGo } from "@/features/pay/common";

const cssv = (o: Record<string, string>): CSSProperties => o as CSSProperties;

/* TOUCHCHANNELS — redesigned line 2638. Every channel a touch can be logged in, including Visit
   (no first-touch SLA, so it is absent from `TOUCHSLA`, but `conFor`/`tCount`/`tList` all already
   read it off `Channel`). */
const TOUCHCHANNELS: readonly Channel[] = ["msg", "email", "call", "visit"];

export function NumbersLive() {
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

  /* ---- 1. hygiene, right now ---- */
  const overdue = live.filter(l => nxDue(l, NOW) === "overdue").length;
  const dueToday = live.filter(l => nxDue(l, NOW) === "today").length;
  const bare = live.filter(noNext).length, unev = B.filter(l => fcBad(l, NOW)).length;
  const chill = B.filter(l => cold(state, l, NOW)).length;
  const noCons = live.filter(l => !TOUCHCHANNELS.some(k => conFor(l, k))).length;
  const unown = B.filter(l => !l.own && !lost(l) && l.done < ST.ONBOARDED).length;
  const holds = B.filter(l => inReservation(state, l))
    .map(l => ({ l, d: Math.round(dayGap(NOW, when(state.PAY[l.id].hold, NOW)) ?? 0) }));
  const hot = holds.filter(h => h.d <= 7);

  /* leads with an owned, dated exception due now — the "Action needed" section's own list.
     `workGroup` (redesigned line 6212, canonical port at `@/lib/selectors/leads.ts`) is the same
     classification Today's queue sorts by — imported from the shared selector, not Today's own
     copy, so the consent/wait/lateOf branches can never drift between the two screens. */
  const WGORD: Record<string, number> = { overdue: 0, today: 1 };
  const attention = B.filter(l => numNamed(state, l) && !lost(l) && l.done < ST.ONBOARDED
      && ["today", "overdue"].includes(workGroup(state, l))
      && nextUp(state, l).urg !== "ok")
    .sort((a, b) => WGORD[workGroup(state, a)] - WGORD[workGroup(state, b)]
      || lateOf(b, NOW) - lateOf(a, NOW));

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
  const balDue = pays.filter(x => x.p.state === "part")
    .reduce((a, x) => a + x.l.units * UNIT - x.p.got, 0);
  const risk = hot.reduce((a, h) => a + FORFEIT * h.l.units, 0);
  const rs = (v: number) => (seeMoney(state) ? money(v) : "•••");

  /* ---- why leads are lost — counted off the closes, not remembered ---- */
  const gone = B.filter(lost);
  /* Change 4 part 2 — `lostWas`, written by `reopenLost` and read nowhere until now: every entry
     is a prior close this book has since re-opened, so a reason with a wide grey segment is one
     that keeps coming back rather than one that stuck. */
  const reopened = B.flatMap(l => l.lostWas || []);
  const lostRows = LOSTWHY.map(w => {
    const L = gone.filter(l => l.lost!.why === w);
    return { w, n: L.length, u: L.reduce((a, l) => a + l.units, 0),
      stage: L.length ? Math.round(L.reduce((a, l) => a + (l.lost!.stage || 1), 0) / L.length) : 0,
      srcs: [...new Set(L.map(l => l.src || "—"))],
      ro: reopened.filter(x => x.why === w).length };
  }).filter(r => r.n || r.ro).sort((a, b) => b.n - a.n);
  const lostTop = Math.max(1, ...lostRows.map(r => r.n + r.ro));
  const lostUnits = gone.reduce((a, l) => a + l.units, 0);
  /* Change 4 part 3 — the funnel footnote: how much of the book that was ever closed as lost has
     since come back, counted off `lostWas` rather than a memory. */
  const reopenedLeads = B.filter(l => (l.lostWas || []).length).length;

  const SECS: Section[] = [{ k: "attention", t: "Action needed" }, { k: "funnel", t: "Funnel" },
    { k: "speed", t: "Speed" }, { k: "effort", t: "Effort", n: chill, warn: true },
    { k: "money", t: "Money", n: hot.length, warn: true },
    { k: "source", t: "Sources" }, { k: "lost", t: "Why we lose", n: gone.length }];
  const SC = secOf(state, "numbers:book", SECS), S = (k: string) => SC === k;

  return (
    <>
      <NumbersFocus v="numbers:book" list={SECS} label="Focus" />
      {S("attention") ? (
        <div className="stats ux-numbers-summary">
          {tile(overdue, "Overdue next actions", { LFILT: "overdue" }, true)}
          {tile(dueToday, "Due today", { LFILT: "due" })}
          {tile(bare, "No next step", { LFILT: "nonext" }, true)}
          {tile(noCons, "Permission missing", { LFILT: "consent" }, true)}
        </div>
      ) : S("funnel") ? (
        <div className="stats ux-numbers-summary">
          {([[B.length, "Captured"], [live.length, "Active"],
            [B.filter(l => l.done >= ST.RESERVED).length, "Reserved +"],
            [B.filter(l => l.done >= ST.PAID).length, "Fully paid +"]] as const)
            .map(([v, t]) => <div className="stat" key={t}><b>{v}</b><span>{t}</span></div>)}
        </div>
      ) : null}
      <div className="secw">

        {S("attention") && (
          <>
            <section className="card ux-primary ux-numbers-attention">
              <Hd t="Investors to review" right={<span className="sm">{attention.length} need attention</span>} />
              <div className="cb">
                {attention.length ? attention.slice(0, 5).map(l => (
                  <div className="mini" key={l.id}>
                    <span><b>{l.n}</b><span className="sm">{nextUp(state, l).t}</span></span>
                    {numNamed(state, l)
                      ? <button type="button" className="btn" onClick={() => go("lead", l.id)}>Open investor</button>
                      : <span className="sm">Outside your book</span>}
                  </div>
                )) : <div className="empty">No current exceptions in this book.</div>}
                {attention.length > 5 && hasLeads ? (
                  <button type="button" className="btn" onClick={() => toLeads({ LFILT: "overdue" })}>
                    Review overdue investors</button>
                ) : null}
              </div>
            </section>
            <details className="ux-disclosure" data-ux-key="numbers-other-exceptions">
              <summary>Other checks</summary>
              <div className="ux-section">
                <div className="stats ux-numbers-summary">
                  {tile(chill, "Going cold", { LFILT: "cold" }, true)}
                  {tile(B.filter(l => dormant(state, l)).length, "Dormant — no decision", { LFILT: "dormant" }, true)}
                  {tile(unev, "Forecast date missing", { LFILT: "fcgap" }, true)}
                  {tile(unown, "Owner missing", { LQ: "unassigned" }, true)}
                  {tile(hot.length, "Holds end within 7 days", { LFILT: "hold7" }, true)}
                </div>
              </div>
            </details>
          </>
        )}

        {S("lost") && (
          <div className="card fill"><Hd t="Why we lose — counted from the book" right={
            <span className="sm">{gone.length} closed · {lostUnits} unit{lostUnits === 1 ? "" : "s"} ·{" "}
              {money(lostUnits * UNIT)} of demand</span>} />
            <div className="cb">
              {lostRows.length ? (<>
                {lostRows.map(r => (
                  <div className="mini" key={r.w} style={{ alignItems: "center" }}>
                    <span style={{ minWidth: 150 }}><b>{r.w}</b></span>
                    <span style={{ flex: 1, minWidth: 0 }}><span className="bar2" style={{ display: "flex",
                      gap: 2, height: 9, borderRadius: 5, background: "var(--card-2)", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", width: `${Math.round(r.n / lostTop * 100)}%`,
                        background: "var(--late)", opacity: 0.72 }} />
                      {r.ro ? <i title="closed for this reason, later re-opened"
                        style={{ display: "block", height: "100%", width: `${Math.round(r.ro / lostTop * 100)}%`,
                          background: "var(--late)", opacity: 0.35 }} /> : null}</span>
                      <span className="sm">lost on average at “{LADDER[Math.max(0, r.stage - 1)].t}” ·{" "}
                        {r.srcs.join(", ")}</span></span>
                    <span className="n2">{r.n}</span></div>
                ))}
                <p className="sm" style={{ margin: "11px 0 0" }}>Every close carries a reason from a closed list, so this is
                  counted, not remembered. Read it against Sources: a reason that clusters on one channel is a
                  targeting problem, and a reason that appears everywhere is a product or a price problem. The
                  average stage is where the conversation ended — a reason that lands late costs far more work
                  than the same reason landing early.</p>
              </>) : (
                <div className="empty">Nothing has been closed as lost yet.<br />
                  <span className="sm">A lead that is going nowhere is worth more closed, with a reason, than left
                    in the queue — the reason is the only part that teaches anybody anything.</span></div>
              )}
            </div></div>
        )}

        {S("funnel") && (
          <div className="card"><Hd t="The funnel, from the ladder"
            right={<span className="sm">{B.length} captured · {live.length} active</span>} />
            <div className="cb" style={cssv({ "--lw": "150px", "--nw": "92px" })}>
              {LADDER.map((s, i) => (
                <HRow key={s.t} label={s.t} plain={s.t} w={reached[i] / top * 100}
                  col={`color-mix(in srgb,var(--brand) ${100 - i * 6}%,var(--card))`}
                  v={<>{reached[i]} <i>{i ? rateOf(reached[i], reached[i - 1]) : " "}</i></>}
                  title={`${reached[i]} reached ${s.t}${i ? " — " + rateTx(reached[i], reached[i - 1]) + " of those who reached " + LADDER[i - 1].t : ""}; ${here[i]} sitting here now`}
                  click={hasLeads && reached[i] ? () => toLeads({ LSTAGE: i + 1, LSTAGEMODE: "from" }) : null} />
              ))}
              <p className="sm" style={{ margin: "8px 0 0" }}>Each bar is how many leads have reached the rung; the grey figure is the
                step conversion from the rung before. Tap a rung to see every lead that reached it.
                A step with fewer than {MINRATE} leads behind it shows the count instead of a percentage —
                three of four is not 75%, it is three of four.</p>
              <p className="sm" style={{ margin: "4px 0 0" }}>{reopenedLeads} of the {B.length} captured were
                closed and re-opened.</p>
            </div></div>
        )}

        {S("funnel") && (() => {
          const slow = numSlowest(state), aged = numAged(state);
          const doorOn = (k: "p:numbers.stage" | "p:numbers.age") => !!(state.DRW && state.DRW.k === k);
          return (
            <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-funnel-time">
              <summary>Time in stage & age of the book</summary>
              <div className="ux-section">
                <div className="doors">
                  <button type="button" className={`door ${doorOn("p:numbers.stage") ? "on" : ""}`}
                    id="door-numbers-stage" aria-haspopup="dialog"
                    aria-expanded={doorOn("p:numbers.stage") ? "true" : "false"} title="Opens below"
                    onClick={() => dispatch({ type: "openDrawer", k: "p:numbers.stage", id: null })}>
                    <span className="dt"><Icon name="today" />Time in stage</span>
                    <span className={`dv ${slow ? "" : "q"}`}>
                      {slow ? `${fmtD(slow.med)} at the slowest step` : "nothing measured yet"}</span>
                  </button>
                  <button type="button" className={`door ${doorOn("p:numbers.age") ? "on" : ""}`}
                    id="door-numbers-age" aria-haspopup="dialog"
                    aria-expanded={doorOn("p:numbers.age") ? "true" : "false"} title="Opens below"
                    onClick={() => dispatch({ type: "openDrawer", k: "p:numbers.age", id: null })}>
                    <span className="dt"><Icon name="leads" />Age of the active book</span>
                    <span className={`dv ${aged ? "bad" : "q"}`}>
                      {aged ? `${aged} over 30 d` : "none over 30 d"}</span>
                  </button>
                </div>
              </div>
            </details>
          );
        })()}

        {S("speed") && (
          <div className="card"><Hd t="First touch, measured against the three service levels" />
            <div className="cb" style={cssv({ "--lw": "150px", "--nw": "110px" })}>
              {sla.map(x => {
                const p = pctR(x.ok, x.n);
                return <HRow key={x.k}
                  label={<>{TOUCHDONE[x.k]} <i className="sm" style={{ fontStyle: "normal" }}>{x.due}</i></>}
                  plain={TOUCHDONE[x.k] + " " + x.due}
                  w={p || 0} col={p == null ? "var(--line)" : bandC(p)}
                  v={<>{rateOf(x.ok, x.n)} <i>{tooFew(x.n) ? "on time — too few to rate" : `${x.ok}/${x.n} on time`}</i></>}
                  title={`${x.n} of ${x.of} owned leads have a ${x.t.toLowerCase()} logged; ${x.ok} inside "${x.due}"; median ${x.hrs == null ? "—" : fmtD(x.hrs / 24)} after capture`} />;
              })}
              <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: 10 }}>
                {sla.map(x => (
                  <div className="stat" key={x.k}><b>{x.hrs == null ? "—" : fmtD(x.hrs / 24)}</b>
                    <span>median to first {x.k === "msg" ? "WhatsApp" : x.k}</span></div>
                ))}
              </div>
              <p className="sm" style={{ margin: "8px 0 0" }}>On time means the first entry in that channel lands within the service
                level, counted from the capture stamp. Green at 100%, amber from 90%, red below — the manual&#39;s bands.
                A channel with fewer than {MINRATE} leads logged shows the count and keeps its bar grey: the bands
                mean nothing on a handful.</p>
            </div></div>
        )}

        {S("effort") && (
          <div className={`card ${canSeeOwners(state) ? "" : "fill"}`}>
            <Hd t="Touches and replies"
              right={<span className="sm">{touched.length} of {live.length} active leads touched</span>} />
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
              </div><div style={{ overflow: "visible", padding: "0 0 0 16px", borderLeft: "1px solid var(--line-2)" }}>
                <p className="lbl">By channel</p>
                <div style={cssv({ "--lw": "118px", "--nw": "34px" })}>{byCh.map(([t, n]) => (
                  <HRow key={t} label={t} plain={t} w={n / chTot * 100} col="var(--brand)" v={n} />
                ))}</div>
                {outcomes.length ? (<>
                  <p className="lbl" style={{ marginTop: 10 }}>Last call went</p>
                  <div style={cssv({ "--lw": "118px", "--nw": "34px" })}>{outcomes.map(([t, n]) => (
                    <HRow key={t} label={t} plain={t} w={n / Math.max(1, outcomes[0][1]) * 100}
                      col="var(--brand)" v={n} />
                  ))}</div>
                </>) : null}
              </div></div>
            </div></div>
        )}

        {S("speed") && (
          <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-speed-weeks">
            <summary>Activity over the last six weeks</summary>
            <div className="ux-section"><div className="card fill"><Hd t="The last six weeks" />
              <div className="cb"><div className="cols" style={{ gap: 14 }}>
                <div style={{ overflow: "visible", padding: 0 }}><p className="lbl">Touches logged{" "}
                  <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{touchWk.reduce((a, b) => a + b, 0)}</span></p>
                  {wkChart(touchWk)}</div>
                <div style={{ overflow: "visible", padding: 0 }}><p className="lbl">Rungs ticked{" "}
                  <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>{rungWk.reduce((a, b) => a + b, 0)}</span></p>
                  {wkChart(rungWk)}</div>
              </div>
                <p className="sm" style={{ margin: "10px 0 0" }}>Touches come from the activity log; rungs from the stamps on each lead. A week where
                  touches rise and rungs do not is effort without movement.</p></div>
            </div></div>
          </details>
        )}

        {S("source") && (
          <div className="card"><Hd t="By source — counted from the book"
            right={hasLeads ? <span className="sm">tap a row to see the leads</span> : undefined} />
            <div className="tw"><table className="ttab">
              <thead><tr><th>Source</th><th className="n">Leads</th><th className="n">Qualified +</th>
                <th className="n">Said yes +</th><th className="n">Reserved +</th><th className="n">Units</th>
                <th className="n">→ Qualified</th></tr></thead>
              <tbody>{srcRows.map(r => (
                <tr key={r.s} {...(hasLeads
                  ? { className: "k", tabIndex: 0, onClick: () => toLeads({ LSRC: r.s }) } : {})}>
                  <td><span className="sw" style={{ background: srcColor(r.s) }} />{r.s}</td>
                  <td className="n">{r.n}</td><td className="n">{r.q || "—"}</td><td className="n">{r.y || "—"}</td>
                  <td className="n">{r.r || "—"}</td>
                  <td className="n">{r.u || "—"}</td><td className="n"><b>{rateOf(r.q, r.n)}</b></td></tr>
              ))}</tbody></table></div>
            <div className="cb" style={{ paddingTop: 8 }}><p className="sm" style={{ margin: 0 }}>Each &quot;+&quot; column counts leads that reached that rung or
              went past it. The plan needs {GOALS(state.PLAN).lead2qual}% of captures to qualify. A source with fewer
              than {MINRATE} leads shows the count where its rate would be.</p></div>
          </div>
        )}

        {S("effort") && canSeeOwners(state) && (
          <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-effort-owners">
            <summary>Compare owner books</summary>
            <div className="ux-section"><div className="card fill"><Hd t="By owner"
              right={seesTeam(state) && hasLeads ? <span className="sm">tap a row to see their book</span> : undefined} />
              <div className="tw"><table className="ttab">
                <thead><tr><th>Owner</th><th className="n">Leads</th><th className="n">Active</th>
                  <th className="n">Units</th><th className="n" title="Evidenced Commit, in units">Commit</th>
                  <th className="n">No next</th><th className="n">Overdue</th><th className="n">Cold</th></tr></thead>
                <tbody>{ownRows.map(r => (
                  <tr key={r.k} {...(seesTeam(state) && hasLeads
                    ? { className: "k", tabIndex: 0, onClick: () => toLeads({ LOWN: r.k }) } : {})}>
                    <td className="nw"><Pname k={r.k} first nw b />{r.out ? <> <span className="tag cov">out</span></> : null}</td>
                    <td className="n">{r.n}</td><td className="n">{r.a}</td><td className="n">{r.u}</td>
                    <td className="n">{r.cu || "—"}</td>
                    <td className="n" {...(r.bare ? { style: { color: "var(--late)" } } : {})}>{r.bare || "—"}</td>
                    <td className="n" {...(r.late ? { style: { color: "var(--late)" } } : {})}>{r.late || "—"}</td>
                    <td className="n" {...(r.cold ? { style: { color: "var(--late)" } } : {})}>{r.cold || "—"}</td></tr>
                ))}</tbody></table></div>
              <div className="cb" style={{ paddingTop: 8 }}><p className="sm" style={{ margin: 0 }}>The state of each book, never the volume of anyone&#39;s
                work — whose leads need attention, not who was busiest. Effort is read on Activity.</p></div>
            </div></div>
          </details>
        )}

        {S("money") && (
          <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-money-months">
            <summary>Expected full payments by month</summary>
            <div className="ux-section"><div className="card"><Hd t="Full payments expected, by month"
              right={<span className="sm">units · against the period target</span>} />
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
                <p className="sm" style={{ margin: "8px 0 0" }}>From each lead&#39;s expected full-payment date. Only evidenced Commit and Probable count;
                  Pipeline is coverage, never a date.</p>
              </div></div></div>
          </details>
        )}

        {S("money") && (
          <div className="card fill"><Hd t="The commercial close" />
            <div className="cb">
              <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
                <div className="stat"><b>{rs(advIn)}</b><span>advances held</span></div>
                <div className="stat"><b>{rs(balDue)}</b><span>balance outstanding</span></div>
                <div className="stat"><b>{rs(fullIn)}</b><span>fully paid receipts</span></div>
                <div className={`stat ${hot.length ? "bad" : ""}`}><b>{rs(risk)}</b><span>forfeit at stake in 7 days</span></div>
              </div>
              {holds.length ? (
                <div style={{ marginTop: 10 }}>{holds.slice().sort((a, b) => a.d - b.d).map(h => {
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
              <p className="sm" style={{ margin: "9px 0 0" }}>Receipts as Finance recorded them. An advance is a liability until the balance lands.</p>
            </div></div>
        )}

        {S("source") && (
          <details className="ux-disclosure ux-numbers-support" data-ux-key="numbers-source-context">
            <summary>Locations &amp; recorded objections</summary>
            <div className="ux-section"><div className="card fill"><Hd t="Where the book is" />
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
              </div></div></div>
          </details>
        )}
      </div>
    </>
  );
}
