"use client";

/* ── today.closers / today.owed / today.why — panel("today.*", …), ir-console-redesigned.html
   7071–7150. The redesigned Gap card (`./Gap.tsx`) reads these three off doors instead of inlining
   the closers list, the per-person table and the funnel arithmetic on the card itself; this module
   registers the three panel bodies so `DoorRow` (`./doors`) has somewhere to open them. Import this
   module once, for its registration side effect, before any door can be clicked — `TodayPage.tsx`
   does that the same way it already does for `@/features/lead/drawers`. ─────────────────────────── */

import { Tw } from "@/components/ui";
import { Pname } from "@/components/ui";
import {
  avail,
  canReach,
  canWork,
  capturedBy,
  closers,
  myWork,
  nextUp,
  openable,
  P,
  quota,
  roleOf,
  scopeOf,
  supervisedActors,
  teamBook,
  whyClose,
} from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { useLogTouch } from "@/features/leads/actions";
import { useGoLead, useGoView } from "@/features/leads/nav";

const gapTeam = (state: ConsoleState) => scopeOf(state, "today") === "team";

function ClosersBody(_props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const goLead = useGoLead("today");
  const logTouch = useLogTouch();
  const team = gapTeam(state);
  const ids = new Set(openable(state).map((l) => l.id));
  const book = (team ? teamBook(state) : myWork(state)).filter((l) => ids.has(l.id));
  const list = closers(state, book, team ? 5 : 4);
  return (
    <>
      <p className="lbl" style={{ marginTop: "12px" }}>
        Work these first — they are the shortest route to a unit
      </p>
      {list.length ? (
        <div className="q">
          {list.map((l) => {
            const u = nextUp(state, l);
            const touchRec = u.rec && u.rec.kind === "touch" ? u.rec : null;
            return (
              <div
                key={l.id}
                className={`qc ${u.urg === "now" ? "now" : u.urg === "soon" ? "soon" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => goLead(l.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goLead(l.id);
                }}
              >
                <div className="who">
                  <b>{l.n}</b>
                  <span>
                    {whyClose(state, l)}
                    {team && l.own ? " · " + P(state.PEOPLE, l.own).n.split(" ")[0] : ""}
                  </span>
                </div>
                <span className="tag">{l.units}u</span>
                {touchRec && canWork(state, l) ? (
                  <button
                    type="button"
                    className="act"
                    onClick={(e) => {
                      e.stopPropagation();
                      /* a refusal (consent, or the route's own words live) is said in the page's live region */
                      void logTouch(l, touchRec.k).then((why) => { if (why) dispatch({ type: "setUi", patch: { NOTICE: why } }); });
                    }}
                  >
                    {u.act}
                  </button>
                ) : canWork(state, l) ? (
                  <button
                    type="button"
                    className="act"
                    onClick={(e) => {
                      e.stopPropagation();
                      goLead(l.id);
                    }}
                  >
                    {u.act || "Open the record"}
                  </button>
                ) : (
                  <span className="tag br">{u.act || "Open the record"}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="sm" style={{ margin: 0 }}>
          No active investors to review for closing.
        </p>
      )}
    </>
  );
}

function WhyBody(_props: DrawerProps) {
  const { state } = useConsole();
  const goView = useGoView();
  if (state.ROLE === "ir") return null;
  const q = quota(state);
  const done = state.EVENTS.filter((e) => e.state === "done");
  const take = done.length ? Math.round(done.reduce((a, e) => a + (e.off || 0), 0) / done.length) : 0;
  const evWk = take ? q.teamWeek / take : 0;
  const better = Math.min(80, state.PLAN.rates.lead2qual + 15);
  const alt = (() => {
    const r = state.PLAN.rates;
    const res = Math.ceil((q.unitsLeft / Math.max(1, r.res2paid)) * 100);
    const qu = Math.ceil((res / Math.max(1, r.qual2res)) * 100);
    const cp = Math.ceil((qu / better) * 100);
    return Math.ceil(Math.max(0, cp - q.inHand) / q.weeks / q.people);
  })();
  const jump = (v: "events" | "goals", t: string) =>
    canReach(state, v) ? (
      <span
        style={{ color: "var(--brand)", cursor: "pointer", fontWeight: 600 }}
        role="button"
        tabIndex={0}
        onClick={() => goView(v)}
        onKeyDown={(e) => {
          if (e.key === "Enter") goView(v);
        }}
      >
        {t}
      </span>
    ) : null;
  return (
    <>
      <p className="sm" style={{ margin: "9px 0 0" }}>
        {q.cap.toLocaleString("en-IN")} captures stand behind {q.unitsLeft} unit{q.unitsLeft === 1 ? "" : "s"} at
        the plan&apos;s rates and {q.inHand.toLocaleString("en-IN")} {q.inHand === 1 ? "is" : "are"} already in the
        book — which is the number above once it is divided by {q.weeks} week{q.weeks === 1 ? "" : "s"} and{" "}
        {q.people} {q.people === 1 ? "person" : "people"}.
      </p>
      <p className="sm" style={{ margin: "6px 0 0" }}>
        <b>That is not a call list.</b>{" "}
        {take ? (
          <>
            At the {take} names a field event has actually taken, {q.teamWeek} a week is about{" "}
            <b>
              {evWk < 1 ? evWk.toFixed(1) : Math.round(evWk)} event{evWk >= 1.5 ? "s" : ""} a week
            </b>{" "}
            across the team — so the honest question is how many are booked, not who is behind.
          </>
        ) : (
          <>Nothing has been captured at an event yet, so there is no take to divide by.</>
        )}{" "}
        The other lever is the rate: at {better}% qualifying instead of {state.PLAN.rates.lead2qual}%, the same{" "}
        {q.unitsLeft} unit{q.unitsLeft === 1 ? "" : "s"} need <b>{alt} a week each</b> —{" "}
        {Math.max(0, q.perWeek - alt)} fewer, for no extra events at all. {jump("events", "Events ›")}{" "}
        {jump("goals", "The plan ›")}
      </p>
    </>
  );
}

function OwedBody(_props: DrawerProps) {
  const { state } = useConsole();
  const goLead = useGoLead("today");
  const q = quota(state);
  const supervised = new Set(supervisedActors(state));
  const people = Object.keys(state.PEOPLE).filter(
    (k) => state.PEOPLE[k].on && roleOf(state.PEOPLE, k) === "ir" && supervised.has(k),
  );
  const book = openable(state);
  return (
    <div className="card">
      <div className="cb">
        <Tw>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th className="n">New names this week</th>
                <th className="n">Owed</th>
                <th className="n">Short by</th>
                <th>Nearest thing to a unit</th>
              </tr>
            </thead>
            <tbody>
              {people.map((k) => {
                const c = capturedBy(state, k);
                const sh = Math.max(0, q.perWeek - c);
                const nx = closers(
                  state,
                  book.filter((l) => l.own === k),
                  1,
                )[0];
                return (
                  <tr key={k} className={nx ? "k" : ""} {...(nx ? { tabIndex: 0, onClick: () => goLead(nx.id) } : {})}>
                    <td>
                      <Pname k={k} b nw />
                      {avail(state, k) ? null : (
                        <>
                          {" "}
                          <span className="tag cov">out</span>
                        </>
                      )}
                    </td>
                    <td className="n">{c}</td>
                    <td className="n">{q.perWeek}</td>
                    <td className="n">
                      <span className={`tag ${sh ? "late" : "go"}`}>{sh || "met"}</span>
                    </td>
                    <td className="sm">
                      {nx ? (
                        <>
                          <b>{nx.n}</b> — {whyClose(state, nx)}
                        </>
                      ) : (
                        "nothing open"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Tw>
        <p className="sm" style={{ margin: "10px 0 0" }}>
          The week is the plan divided by the weeks left — <b>{q.teamWeek}</b> names across {q.people}, which is{" "}
          {q.perWeek} each once it is rounded up so nobody is asked for a fraction. Nobody types either number. A
          row opens the lead nearest a unit for that person.
        </p>
      </div>
    </div>
  );
}

registerDrawer("p:today.closers" as DrawerKind, {
  w: 560,
  title: () => "Closest to closing",
  sub: (state) => (gapTeam(state) ? "across the team" : "in your book"),
  Body: ClosersBody,
});

registerDrawer("p:today.why" as DrawerKind, {
  w: 600,
  title: () => "Where the number comes from",
  sub: () => "the same quota, said two other ways",
  Body: WhyBody,
});

registerDrawer("p:today.owed" as DrawerKind, {
  w: 760,
  title: () => "Who is short this week",
  sub: (state) => {
    const q = quota(state);
    return q.teamWeek + " new names this week · " + q.weeks + " week" + (q.weeks === 1 ? "" : "s") + " left · " + q.people + " capturing";
  },
  Body: OwedBody,
});
