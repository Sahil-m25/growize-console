"use client";

/* ── Marketing's numbers — `vNumbersMkt()`, `ref/03-app.js` 4197–4296 ───────────────────────
   Marketing does not own a lead and cannot see an investor's money, so the whole commercial half of
   Numbers is noise to them. What they own is the top of the funnel: an event, a channel, a campaign,
   and the question "did it work". So they get one screen: what each thing produced, what it cost to
   produce it, and — the only line that changes a decision — WHERE IT BREAKS. Not "conversion is 12%"
   but "Koramangala Club: 26 names, 9 qualified, nothing reserved — it breaks at reservation."
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Tw } from "@/components/ui";
import { SOURCES, SPREAD } from "@/domain";
import type { EventRec } from "@/domain";
import {
  baseRates, breakOf, evStats, srcStats, stepsOf,
} from "@/lib/selectors";
import type { Break, Stats } from "@/lib/selectors";
import { secOf, useConsole } from "@/lib/store";
import type { Section } from "@/components/ui";
import { Brk, NumbersFocus, srcColor } from "./bits";
import { useGo } from "@/features/pay/common";

const rupee = (n: number): string => "₹" + Math.round(n).toLocaleString("en-IN");

export function NumbersMkt() {
  const { state } = useConsole();
  const go = useGo();

  const evRaw = state.EVENTS.filter(e => e.state === "done").map(e => ({ e, st: evStats(state, e) }));
  const evBase = baseRates(state.PLAN, evRaw.map(x => x.st));
  const evs = evRaw.map(x => ({ ...x, b: breakOf(state.PLAN, x.st, evBase) }));
  const srcRaw = (SOURCES as readonly string[]).map(x => ({ x, st: srcStats(state, x) }))
    .filter(x => x.st.captured);
  const srcBase = baseRates(state.PLAN, srcRaw.map(x => x.st));
  const srcs = srcRaw.map(x => ({ ...x, b: breakOf(state.PLAN, x.st, srcBase) }));

  /* the step everything is losing at — one finding, not one per event. `touched` is absent on an
     event's stats, so its two steps read NaN and drop out, exactly as the prototype's do. */
  const sum: Stats = evRaw.reduce((a, x) => ({
    captured: a.captured + x.st.captured, tagged: a.tagged + x.st.tagged,
    touched: (a.touched as number) + (x.st.touched as number),
    qual: a.qual + x.st.qual, res: a.res + x.st.res, paid: a.paid + x.st.paid,
  }), { captured: 0, tagged: 0, touched: 0, qual: 0, res: 0, paid: 0 } as Stats);
  const shared = stepsOf(state.PLAN, sum).filter(x => x.of > 0)
    .map(x => ({ ...x, pc: Math.round(x.have / x.of * 100) }))
    .map(x => ({ ...x, gap: x.want - x.pc })).filter(x => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)[0] || null;

  const spend = evs.reduce((a, x) => a + (x.e.cost || 0), 0);
  const capt = evs.reduce((a, x) => a + x.st.captured, 0);
  const qual = evs.reduce((a, x) => a + x.st.qual, 0);
  const worst = evs.filter(x => x.b && !x.b.ok && !x.b.shared)
    .sort((a, b) => (b.b as Break).own - (a.b as Break).own);

  const SECS: Section[] = [{ k: "events", t: "By event" }, { k: "channels", t: "By channel" },
    { k: "breaks", t: "Where it breaks", n: worst.length, warn: true }];
  const S = secOf(state, "numbers:mkt", SECS);

  return (
    <div className="ux-numbers rd-page rd-numbers">
      <div className="ph rd-page-heading"><div><span className="rd-eyebrow">Performance</span><h1>Numbers</h1>
        <p className="sub">Event and channel results</p></div></div>
      <div className="stats ux-numbers-summary">
        {([["Captured", capt], ["Qualified", qual], ["Spend", rupee(spend)],
          ["Cost per qualified", qual ? rupee(spend / qual) : "—"]] as const)
          .map(([t, v]) => <div className="stat" key={t}><b>{v}</b><span>{t}</span></div>)}
      </div>
      <NumbersFocus v="numbers:mkt" list={SECS} label="Compare" />
      <div className="secw">

        {S === "events" && (
          <div className="card fill"><div className="ch"><h3>By event</h3><div className="sp" />
            <span className="sm">every figure counted off the lead records, not typed</span></div>
            <Tw><table>
              <thead><tr><th>Event</th><th>When</th><th className="n">Captured</th><th className="n">In the book</th>
                <th className="n">Qualified</th><th className="n">Reserved</th><th className="n">Cost / capture</th>
                <th>Where it breaks</th></tr></thead>
              <tbody>{evs.map(({ e, st, b }) => (
                <tr className="k" key={e.id} tabIndex={0} onClick={() => go("event", e.id)}
                  onKeyDown={ev => { if (ev.key === "Enter") go("event", e.id); }}>
                  <td><b>{e.n}</b><div className="sm">{e.type} · {e.ch}</div></td>
                  <td className="sm mono">{e.date}</td>
                  <td className="n">{st.captured}</td><td className="n">{st.tagged}</td>
                  <td className="n">{st.qual}</td><td className="n">{st.res}</td>
                  <td className="n mono">{st.captured ? rupee(e.cost / st.captured) : "—"}</td>
                  <td><Brk b={b} /></td></tr>
              ))}</tbody></table></Tw></div>
        )}

        {S === "channels" && (
          <div className="card fill"><div className="ch"><h3>By channel</h3><div className="sp" />
            <span className="sm">where the name came from, at capture</span></div>
            <Tw><table>
              <thead><tr><th>Channel</th><th className="n">Captured</th><th className="n">Touched</th>
                <th className="n">Qualified</th><th className="n">Reserved</th><th className="n">Closed lost</th>
                <th>Where it breaks</th></tr></thead>
              <tbody>{srcs.map(({ x, st, b }) => (
                <tr key={x}>
                  <td><span className="sw" style={{ background: srcColor(x) }} />{x}</td>
                  <td className="n">{st.captured}</td><td className="n">{st.touched}</td>
                  <td className="n">{st.qual}</td><td className="n">{st.res}</td>
                  <td className="n">{st.lost || "—"}</td>
                  <td><Brk b={b} /></td></tr>
              ))}</tbody></table></Tw></div>
        )}

        {S === "breaks" && (
          <div className="card fill"><div className="ch"><h3>Where it breaks</h3><div className="sp" />
            <span className={`tag ${worst.length ? "late" : "go"}`}>{worst.length || "none"}</span></div>
            <div className="cb">
              {shared && (
                <div className={`note ${shared.gap >= 40 ? "bad" : ""}`} style={{ margin: "0 0 11px" }}>
                  <b>Every event is losing at the same step: {shared.t}.</b>{" "}
                  Across all {evRaw.length} events, {shared.have} of {shared.of} get through —{" "}
                  <b>{shared.pc}%</b> where the plan assumes {shared.want}%. A leak this even is not any one
                  event&#39;s fault and no amount of better targeting fixes it; it is the process, and it is{" "}
                  {shared.t === "reaching a record"
                    ? "the gap between a name written on a stall and a record somebody can work — the shortest fix there is, and the one worth doing first."
                    : shared.t === "first touch"
                      ? "the follow-up, not the audience."
                      : "the same at every source, so look at the offer and the script before the channel."}</div>
              )}
              <p className="sm" style={{ margin: "0 0 11px" }}>Below is only what is <b>this event&#39;s own</b> problem — a step
                it runs at least {SPREAD} points worse than every other event. Anything reading “in line with
                the rest” is on the table above and belongs to the finding at the top, not to the event.</p>
              {worst.length ? worst.map(({ e, st, b }) => (
                <WorstCard key={e.id} e={e} st={st} b={b as Break} base={evBase[(b as Break).t] ?? 0} />
              )) : (
                <div className="empty">No event is materially worse than the others.
                  {shared ? <><br />The loss is shared, and the finding above is the one to act on.</> : null}</div>
              )}
            </div></div>
        )}
      </div>
    </div>
  );
}

function WorstCard({ e, st, b, base }: { e: EventRec; st: Stats; b: Break; base: number }) {
  const n = b.of - b.have;
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "12px 13px", marginBottom: 8 }}>
      <div className="hd"><b style={{ fontSize: 15 }}>{e.n}</b>
        <span className="tag">{e.type} · {e.ch}</span><div className="sp" />
        <span className={`tag ${b.gap >= 40 ? "late" : "due"}`}>breaks at {b.t}</span></div>
      <p className="sm" style={{ margin: 0 }}>{st.captured} captured · {st.tagged} reached a record ·{" "}
        {st.qual} qualified · {st.res} reserved. At {b.t} it runs at <b>{b.pc}%</b> — the plan
        assumes {b.want}% and the rest average {base}%, so {n === 1 ? "one name stops" : n + " names stop"} here that would not have stopped
        elsewhere.</p>
      <p className="sm" style={{ margin: "6px 0 0" }}>{
        b.t === "reaching a record" ? "Names collected on the day that were never entered. This is a stall-process fix, not a marketing one — a shorter form, or somebody entering as they collect."
          : b.t === "first touch" ? "They were entered and then nobody called. The list is fine; the follow-up is the leak."
            : b.t === "qualifying" ? "The people coming are not the people who buy. Change who the event is put in front of, not how many."
              : b.t === "reserving" ? "They qualify and then stop. That is a price, a lock-in or a proof problem, and the closed-lost reasons on these leads say which."
                : "Reserved and never paid — that is Finance's clock, not the channel's."}</p>
    </div>
  );
}
