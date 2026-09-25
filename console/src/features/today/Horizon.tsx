"use client";

/* ── THE HORIZON — vHorizon. ir-console-redesigned.html 6868–6939 ──────────────────────────────
   A queue answers "what now". It cannot answer "I am out from the 25th, what moves?" or "what does
   October actually look like?" — and those are the questions somebody asks when they plan a week, a
   month or their leave. So the same book is readable forward, day by day, with the roster laid
   over it.

   The month is a rolling one — the next five weeks, as a calendar of load — because it crosses the
   month end, and a plan does.

   Unlike the port's earlier draft, vHorizon draws no side rail of its own: `vDayside` only ever
   appears inside Today's collapsed "Your week" / "Weekly progress & planning" disclosure
   (`vTodayWork`'s `weekly()`), never here. See `./TodayPage.tsx`'s `weekly` for that.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { Lead } from "@/domain";
import { DAY, dAdd, dISO, dLabel, MON } from "@/lib/format";
import { canPlan, dueOn, isIR, outOn, P, type DueRow } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useGoLead } from "@/features/leads/nav";
import { uiCalday, uiHorizon } from "@/features/leads/ui";

export function Horizon({ book, team }: { book: Lead[]; team: boolean }) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const HORIZON = uiHorizon(state.ui);
  const CALDAY = uiCalday(state.ui);

  const days = HORIZON === "week" ? 7 : 31;
  const all: Date[] = [];
  for (let i = 0; i < days; i++) all.push(dAdd(state.NOW, i));
  const load = (d: Date) => dueOn(state, book, d).length;
  const peak = Math.max(1, ...all.map(load));
  const outAll = [...new Set(all.flatMap((d) => outOn(state, book, d)))];
  const inAbsence = all
    .filter((d) => outOn(state, book, d).length)
    .flatMap((d) => dueOn(state, book, d).filter((x) => x.l.own && outOn(state, book, d).includes(x.l.own)));

  const item = (x: DueRow, d: Date, key: string) => {
    const out = outOn(state, book, d);
    const ownerOut = !!x.l.own && out.includes(x.l.own);
    const pull =
      x.kind === "next" &&
      canPlan(state, x.l) &&
      (Math.round((d.getTime() - state.NOW.getTime()) / DAY) >= 3 || ownerOut);
    return (
      <div key={key} className="qc rd-calendar-row">
        <span className={`tag ${x.kind === "hold" ? "late" : x.kind === "fc" ? "go" : ""}`}>
          {x.kind === "hold" ? "balance" : x.kind === "fc" ? "forecast" : "next step"}
        </span>
        <div className="who">
          <button type="button" className="work-name" onClick={() => goLead(x.l.id)}>
            {x.l.n}
          </button>
          <span>
            {x.t}
            {(team || !isIR(state.ROLE)) && x.l.own ? " · " + P(state.PEOPLE, x.l.own).n : ""}
          </span>
        </div>
        {ownerOut ? (
          <span className="tag late" title={`${P(state.PEOPLE, x.l.own).n} is rostered out that day`}>
            owner out
          </span>
        ) : null}
        {pull ? (
          <button
            type="button"
            className="chip"
            title={
              ownerOut
                ? "Move it to the working day before " + P(state.PEOPLE, x.l.own).n.split(" ")[0] + " goes out"
                : "Move it two days earlier"
            }
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "pullIn", id: x.l.id });
            }}
          >
            Pull it earlier
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {outAll.length ? (
        <div className={`note ${inAbsence.length ? "bad" : "due"}`} style={{ marginBottom: "10px" }}>
          <b>
            {outAll.map((k) => P(state.PEOPLE, k).n).join(", ")} {outAll.length === 1 ? "is" : "are"} rostered out
            inside this window.
          </b>{" "}
          {inAbsence.length
            ? inAbsence.length +
              " dated item" +
              (inAbsence.length === 1 ? " falls" : "s fall") +
              " on a day the owner is away — pull them earlier or arrange cover before the window starts."
            : "Nothing dated lands on those days."}
        </div>
      ) : null}

      <section className="ux-section rd-followup-calendar" aria-label="Follow-up appointments">
        {HORIZON === "week" ? (
          <Week all={all} book={book} team={team} item={item} />
        ) : (
          <Month book={book} peak={peak} all={all} CALDAY={CALDAY} item={item} />
        )}
      </section>
    </>
  );
}

/* the week view — one <section class="rd-agenda-day"> per day that actually has something dated,
   or the empty card when none of the seven do. 6906-6913 */
function Week({
  all,
  book,
  team,
  item,
}: {
  all: Date[];
  book: Lead[];
  team: boolean;
  item: (x: DueRow, d: Date, key: string) => React.ReactNode;
}) {
  const { state } = useConsole();
  const load = (d: Date) => dueOn(state, book, d).length;
  const days = all.filter((d) => load(d));
  if (!days.length)
    return (
      <section className="card ux-empty">
        <h2>No appointments in the next 7 days</h2>
        <p>Choose the next 31 days to look further ahead.</p>
      </section>
    );
  return (
    <>
      {days.map((d) => {
        const items = dueOn(state, book, d);
        const out = outOn(state, book, d);
        const isToday = dISO(d) === dISO(state.NOW);
        return (
          <section className="rd-agenda-day" key={dISO(d)}>
            <h3 className="lbl rd-agenda-date">
              {isToday ? "Today · " : ""}
              {dLabel(d)}
              {items.length ? (
                <span className="rd-agenda-count">
                  {items.length} item{items.length === 1 ? "" : "s"}
                </span>
              ) : null}
              {out.length ? <span className="tag late">{out.map((k) => P(state.PEOPLE, k).i).join(" ")} out</span> : null}
            </h3>
            {items.length ? (
              items.map((x, i) => item(x, d, dISO(d) + "-" + i))
            ) : (
              <p className="sm" style={{ margin: "0 0 4px" }}>
                Nothing dated.
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

/* the next five weeks, as a calendar of load — it crosses the month end, because a plan does */
function Month({
  book,
  peak,
  all,
  CALDAY,
  item,
}: {
  book: Lead[];
  peak: number;
  all: Date[];
  CALDAY: string | null;
  item: (x: DueRow, d: Date, key: string) => React.ReactNode;
}) {
  const { state, dispatch } = useConsole();
  const NOW = state.NOW;
  const load = (d: Date) => dueOn(state, book, d).length;
  const start = dAdd(NOW, -NOW.getDay()); /* the Sunday of this week */
  const nCells = Math.ceil((NOW.getDay() + 31) / 7) * 7; /* whole weeks, covering all 31 days */
  /* the first loaded day, or NOW, is selected by default — 6926 */
  const sel = CALDAY ? new Date(CALDAY + "T00:00:00") : all.find((d) => load(d)) || NOW;
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < nCells; i++) {
    const d = dAdd(start, i);
    const past = d < NOW && dISO(d) !== dISO(NOW);
    const beyond = (d.getTime() - NOW.getTime()) / DAY > 30;
    const n = past || beyond ? 0 : load(d);
    const out = past || beyond ? [] : outOn(state, book, d);
    const lvl = !n ? "" : n >= peak * 0.75 ? "d4" : n >= peak * 0.5 ? "d3" : n >= peak * 0.25 ? "d2" : "d1";
    const on = !!(sel && dISO(sel) === dISO(d));
    const pick = () => dispatch({ type: "setUi", patch: { CALDAY: dISO(d) } });
    cells.push(
      <button
        type="button"
        key={dISO(d)}
        className={`cel ${lvl} ${on ? "on" : ""} ${past || beyond ? "off" : ""}`}
        disabled={past || beyond}
        aria-pressed={past || beyond ? undefined : on}
        title={
          past || beyond
            ? undefined
            : `${dLabel(d)} — ${n} dated${out.length ? " · " + out.map((k) => P(state.PEOPLE, k).i).join(" ") + " out" : ""}`
        }
        onClick={past || beyond ? undefined : pick}
      >
        <b>{d.getDate() === 1 ? MON[d.getMonth()] + " 1" : d.getDate()}</b>
        <i>{past || beyond ? "" : n || ""}</i>
        {out.length && !past && !beyond ? <span className="dotn" /> : null}
      </button>,
    );
  }
  const chosen = sel ? dueOn(state, book, sel) : [];
  const endD = dAdd(NOW, 30);
  return (
    <>
      <div className="card rd-month-calendar">
        <div className="ch">
          <h3>
            {NOW.getDate() + " " + MON[NOW.getMonth()]} – {endD.getDate() + " " + MON[endD.getMonth()]}
          </h3>
          <div className="sp" />
          <span className="sm">{all.reduce((a, d) => a + load(d), 0)} dated in the next 31 days</span>
        </div>
        <div className="cb cal-fill">
          <div className="cal big">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => (
              <div className="dow" key={x}>
                {x}
              </div>
            ))}
            {cells}
          </div>
          <p className="sm" style={{ margin: "10px 0 0" }}>
            Darker is busier. A dot means somebody on this book is rostered out that day. Pick a day
            to see what is on it.
          </p>
        </div>
      </div>
      {sel ? (
        <section className="rd-agenda-day rd-selected-day">
          <h3 className="lbl rd-agenda-date">
            {dLabel(sel)}
            {outOn(state, book, sel).length ? (
              <span className="tag late" style={{ marginLeft: "6px" }}>
                {outOn(state, book, sel)
                  .map((k) => P(state.PEOPLE, k).n.split(" ")[0])
                  .join(", ")}{" "}
                out
              </span>
            ) : null}
          </h3>
          {chosen.length ? (
            chosen.map((x, i) => item(x, sel, "sel-" + i))
          ) : (
            <p className="sm" style={{ margin: 0 }}>
              Nothing dated on that day.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
