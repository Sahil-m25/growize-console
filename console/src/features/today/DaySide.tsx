"use client";

/* ── vDayside(team) — ir-merged.js:4720. In the merged prototype the day's side column shrank to one
   card: the three first-touch service levels, for every seat that is not personal (isIR()). The
   "Needs a next step", "Reservation clocks" and "Your book" cards of the older prototype are gone —
   each is already true somewhere else in the product (the queue, Finance's day, Leads).
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { ST, TOUCHSLA } from "@/domain";
import { active, isFin, isIR, myWork, openable, tCount, teamBook, visible } from "@/lib/selectors";
import { useConsole } from "@/lib/store";

export function DaySide({ team: requestedTeam }: { team: boolean }) {
  const { state } = useConsole();
  const team = !["ir", "cp"].includes(state.ROLE) && requestedTeam;
  const ids = new Set(openable(state).map((l) => l.id));
  const book = (team ? teamBook(state) : isFin(state.ROLE) ? visible(state) : myWork(state)).filter((l) => ids.has(l.id));
  const personal = isIR(state.ROLE);
  const live = book.filter((l) => active(l));
  const slas = TOUCHSLA.map((x) => ({
    ...x,
    n: live.filter((l) => l.done <= ST.TOUCH && !tCount(l, x.k)).length,
  }));
  if (personal) return null;
  return (
    <div className="card">
      <div className="ch">
        <h3>First touch outstanding</h3>
      </div>
      <div className="cb">
        {slas.map((x) => (
          <div className="mini" key={x.k}>
            <span className={`rag ${x.n ? "amber" : "green"}`} title={x.n ? x.n + " outstanding" : "all done"} />
            <span>
              <b>{x.t}</b> <span className="sm">{x.due}</span>
            </span>
            <span className="n2">{x.n}</span>
          </div>
        ))}
        <p className="sm" style={{ margin: "9px 0 0" }}>
          The three service levels inside first touch. They are the next action until the touch lands.
        </p>
      </div>
    </div>
  );
}
