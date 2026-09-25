"use client";

/* Personal IRs read back completed work and a closing shortlist, behind one door — vMyWeeklyWork,
   ir-console-redesigned.html:6989. Managers keep the weekly planning arithmetic on the card face
   only as a headline bar; the people table, the closers list and the funnel prose all moved behind
   doors onto their own panels (today.owed/today.closers/today.why — vGap, 7177, and ./panels).
   Both shortlists use openable records. */

import {
  canOperateLeads,
  capturedBy,
  closers,
  myWork,
  openable,
  quota,
  roleOf,
  supervisedActors,
  teamBook,
  weeklyWorkSummary,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { Refusal } from "@/features/leads/actions";
import { DoorRow } from "./doors";
import "./panels"; /* registers p:today.closers / p:today.owed / p:today.why before a door opens one */

export function Gap({ team: requestedTeam }: { team: boolean; onRefuse: (r: Refusal) => void }) {
  const { state } = useConsole();
  const team = !["ir", "cp"].includes(state.ROLE) && requestedTeam;

  const allowed = openable(state);
  const ids = new Set(allowed.map((l) => l.id));
  const book = (team ? teamBook(state) : myWork(state)).filter((l) => ids.has(l.id));
  const list = closers(state, book, team ? 5 : 4);

  if (["ir", "cp"].includes(state.ROLE)) {
    const work = weeklyWorkSummary(state);
    const hasWork = !!(work.leadsAdded || work.followups);
    return (
      <section className="card rd-weekly-work" aria-label="Your work this week">
        <div className="ch">
          <h3>Your work this week</h3>
        </div>
        <div className="cb">
          <div className="stats" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
            <div className="stat">
              <b>{work.leadsAdded}</b>
              <span>Leads added</span>
            </div>
            <div className="stat">
              <b>{work.followups}</b>
              <span>Follow-ups recorded</span>
            </div>
          </div>
          <p className="sm" style={{ margin: "8px 0" }}>
            {hasWork
              ? "Since Monday. Follow-ups include recorded contact attempts."
              : "No work recorded this week yet. Your follow-ups are above."}
          </p>
          {list.length ? (
            <DoorRow items={[{ k: "today.closers", t: "Closest to closing", i: "leads", v: "Review promising investors" }]} />
          ) : (
            <p className="sm">No active investors to review for closing.</p>
          )}
        </div>
      </section>
    );
  }

  const q = quota(state);
  const supervised = new Set(supervisedActors(state));
  const people = Object.keys(state.PEOPLE).filter(
    (k) => state.PEOPLE[k].on && roleOf(state.PEOPLE, k) === "ir" && supervised.has(k),
  );
  const mine = capturedBy(state, state.WHO);
  const short = Math.max(0, q.perWeek - mine);
  const pct = q.perWeek ? Math.min(100, Math.round((mine / q.perWeek) * 100)) : 100;
  const tot = people.reduce((a, k) => a + capturedBy(state, k), 0);
  const owe = team ? Math.max(0, q.teamWeek - tot) : short;
  const behind = people.filter((k) => capturedBy(state, k) < q.perWeek).length;
  const tp = q.teamWeek ? Math.min(100, Math.round((tot / q.teamWeek) * 100)) : 100;

  return (
    <div className="card" style={{ marginBottom: "8px", ...(short ? { borderColor: "var(--brand-line)" } : {}) }}>
      <div className="ch">
        <h3>{team ? "Team weekly progress" : "Weekly progress"}</h3>
        <div className="sp" />
        <span className="sm">
          {q.unitsLeft} unit{q.unitsLeft === 1 ? "" : "s"} left · {q.weeks} week
          {q.weeks === 1 ? "" : "s"} · {q.people} capturing
        </span>
      </div>
      <div className="cb">
        {team ? (
          <div className="qbar">
            <div className="qbf" style={{ width: `${tp}%` }} />
            <span>
              <b>
                {tot} of {q.teamWeek}
              </b>{" "}
              new names this week — {behind ? `${behind} of ${people.length} short of the week` : "everyone has met the week"}
            </span>
          </div>
        ) : (
          <div className="qbar">
            <div className="qbf" style={{ width: `${pct}%` }} />
            <span>
              <b>
                {mine} of {q.perWeek}
              </b>{" "}
              new names this week{short ? ` — ${short} short` : " — met"}
            </span>
          </div>
        )}

        <DoorRow
          items={[
            canOperateLeads(state)
              ? { k: "add.quick", t: "Add lead", i: "add", v: owe ? owe + " still to enter" : "met", cls: owe ? "bad" : "q" }
              : null,
            team ? { k: "today.owed", t: "Who is short this week", i: "people", v: behind ? behind + " behind" : "all met", cls: behind ? "bad" : "q" } : null,
            { k: "today.closers", t: "Closest to closing", i: "leads", v: list.length ? list.length + (team ? " across the team" : " in your book") : "nothing open", cls: list.length ? "" : "q" },
            { k: "today.why", t: "Where the number comes from", i: "numbers", v: q.cap.toLocaleString("en-IN") + " captures" },
          ]}
        />
      </div>
    </div>
  );
}
