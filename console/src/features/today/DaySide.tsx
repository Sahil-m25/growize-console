"use client";

/* ── The day's side rail — vDayside and vBookMini. 03-app.js 2611–2705 ──────────────────────
   Everything on this column is already true somewhere else in the product; it is here so the day
   has a horizon longer than today and the width is not empty.

   vBookMini is where the book stands, at the foot of the day — and each stage is a way into Leads,
   already filtered, so "3 at Qualified" is never a number you then have to go and find.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { FORFEIT, LADDER, ST, TOUCHSLA } from "@/domain";
import type { Lead } from "@/domain";
import { DAY, when } from "@/lib/format";
import {
  active,
  bandOf,
  canReach,
  cold,
  fcOf,
  isFin,
  myWork,
  noNext,
  openable,
  P,
  payOf,
  tCount,
  teamBook,
  visible,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useGoLead, useToLeads } from "@/features/leads/nav";

export function DaySide({ team: requestedTeam, contentSized = false }: { team: boolean; contentSized?: boolean }) {
  const { state } = useConsole();
  const team = !["ir", "cp"].includes(state.ROLE) && requestedTeam;
  const goLead = useGoLead("today");

  const ids = new Set(openable(state).map(l => l.id));
  const book = (team ? teamBook(state) : isFin(state.ROLE) ? visible(state) : myWork(state))
    .filter(l => ids.has(l.id));
  const showSummaries = !["ir", "cp"].includes(state.ROLE);
  const live = book.filter((l) => active(l));
  const bare = live.filter(noNext);
  const slas = TOUCHSLA.map((x) => ({
    ...x,
    n: live.filter((l) => l.done <= ST.TOUCH && !tCount(l, x.k)).length,
  }));
  const holds = book
    .filter((l) => {
      const p = payOf(state, l.id);
      return l.done >= ST.RESERVED && l.done < ST.PAID && !!p && !!p.hold;
    })
    .map((l) => ({
      l,
      d: Math.round(
        ((when(payOf(state, l.id)!.hold, state.NOW) as Date).getTime() - state.NOW.getTime()) / DAY,
      ),
    }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);

  return (
    <>
      {showSummaries ? <>
      <div className="card">
        <div className="ch">
          <h3>First touch outstanding</h3>
        </div>
        <div className="cb">
          {slas.map((x) => (
            <div className="mini" key={x.k}>
              <span
                className={`rag ${x.n ? "amber" : "green"}`}
                title={x.n ? x.n + " outstanding" : "all done"}
              />
              <span>
                <b>{x.t}</b> <span className="sm">{x.due}</span>
              </span>
              <span className="n2">{x.n}</span>
            </div>
          ))}
          <p className="sm" style={{ margin: "9px 0 0" }}>
            The three service levels inside first touch. They are the next action until the touch
            lands.
          </p>
        </div>
      </div>

      <div
        className="card"
        style={{ marginTop: "8px", ...(bare.length ? { borderColor: "var(--late)" } : {}) }}
      >
        <div className="ch">
          <h3>Needs a next step</h3>
          <div className="sp" />
          <span className={`tag ${bare.length ? "late" : "go"}`}>{bare.length}</span>
        </div>
        <div className="cb">
          {bare.length ? (
            <>
              {bare.slice(0, 5).map((l) => (
                <div
                  className="mini"
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  onClick={() => goLead(l.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") goLead(l.id);
                  }}
                >
                  <span>
                    <b>{l.n}</b> <span className="sm">{LADDER[Math.max(0, l.done - 1)].t}</span>
                  </span>
                  <span className="n2 sm">{P(state.PEOPLE, l.own).i}</span>
                </div>
              ))}
              {bare.length > 5 ? (
                <p className="sm" style={{ margin: "8px 0 0" }}>
                  and {bare.length - 5} more.
                </p>
              ) : null}
            </>
          ) : (
            <p className="sm" style={{ margin: 0 }}>
              Every active lead in this book has one action and one date on it. That is the whole
              hygiene rule.
            </p>
          )}
        </div>
      </div>
      </> : null}

      {holds.length ? (
        <div className="card" style={{ marginTop: "8px" }}>
          <div className="ch">
            <h3>Reservation clocks</h3>
          </div>
          <div className="cb">
            {holds.map((x) => (
              <div
                className="mini"
                key={x.l.id}
                role="button"
                tabIndex={0}
                style={{ cursor: "pointer" }}
                onClick={() => goLead(x.l.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goLead(x.l.id);
                }}
              >
                <span
                  className={`rag ${x.d <= 3 ? "red" : x.d <= 7 ? "amber" : "green"}`}
                  title={x.d < 0 ? -x.d + " days over" : x.d + " days left on the hold"}
                />
                <span>
                  <b>{x.l.n}</b>
                </span>
                <span className="n2 sm">{x.d < 0 ? -x.d + "d over" : x.d + "d left"}</span>
              </div>
            ))}
            <p className="sm" style={{ margin: "9px 0 0" }}>
              30 days from the advance. A lapse forfeits ₹{FORFEIT.toLocaleString("en-IN")} a unit.
            </p>
          </div>
        </div>
      ) : null}

      {showSummaries ? (
        <BookMini land={(team ? teamBook(state) : visible(state)).filter(l => ids.has(l.id))}
          team={team} contentSized={contentSized} />
      ) : null}
    </>
  );
}

/* vBookMini(land, team) — 03-app.js:2683. Counted over the same list the row lands on — unowned
   leads included, so 3 means 3. */
function BookMini({ land, team, contentSized }: { land: Lead[]; team: boolean; contentSized: boolean }) {
  const { state } = useConsole();
  const toLeads = useToLeads();
  const live = land.filter(active);
  if (!land.length) return null;
  const rungs = LADDER.map((s, i) => ({
    i: i + 1,
    t: s.t,
    n: land.filter((l) => l.done === i + 1).length,
  })).filter((r) => r.n);
  const canGo = canReach(state, "leads");
  const sc = team ? "team" : "mine";
  const u = live.reduce((a, l) => a + l.units, 0);
  const fcu = (k: string) =>
    live.filter((l) => fcOf(l) === k).reduce((a, l) => a + l.units, 0);
  const chill = live.filter((l) => cold(state, l, state.NOW)).length;

  return (
    <div className={contentSized ? "card" : "card fill"} style={{ marginTop: "8px" }}>
      <div className="ch">
        <h3>{team ? "The team's book" : "Your book"}</h3>
        <div className="sp" />
        <span className="sm mono">
          {live.length} active · {u} units
        </span>
      </div>
      <div className="cb" style={{ paddingTop: "8px" }}>
        {rungs.map((r) => {
          const go = () => toLeads(`stage:${r.i}`, sc);
          return (
            <div
              key={r.i}
              className={`srow ${canGo ? "" : "static"}`}
              title={`${r.t} — ${r.n}`}
              {...(canGo
                ? {
                    role: "button",
                    tabIndex: 0,
                    onClick: go,
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter") go();
                    },
                  }
                : {})}
            >
              <span className="sw" style={{ background: bandOf(r.i).c }} />
              <span className="t">{r.t}</span>
              <div className="bar">
                <i style={{ width: `${(r.n / land.length) * 100}%`, background: bandOf(r.i).c }} />
              </div>
              <span className="n2">{r.n}</span>
            </div>
          );
        })}
        <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)", marginTop: "10px" }}>
          <div className="stat">
            <b style={{ color: "var(--go)" }}>{fcu("commit")}</b>
            <span>Commit units</span>
          </div>
          <div className="stat">
            <b>{fcu("probable")}</b>
            <span>Probable units</span>
          </div>
          <div className="stat">
            <b style={chill ? { color: "var(--late)" } : undefined}>{chill}</b>
            <span>Going cold</span>
          </div>
        </div>
        {canGo ? (
          <p className="sm" style={{ margin: "9px 0 0" }}>
            Tap a stage to open those leads.
          </p>
        ) : null}
      </div>
    </div>
  );
}
