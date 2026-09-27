"use client";

/* p:me.reach and p:me.roster — the door panels behind Profile's "Team availability, permissions
   and access history" disclosure. redesigned prototype `ir-console-redesigned.html` 10413-10419
   (panel("me.roster",...), panel("me.reach",...)). Panels, not per-page sections: same registry,
   same drawer frame, reached with dispatch({type:"openDrawer", k:"p:me.roster"|"p:me.reach"}).
   me.roster is its own panel (ids profile-roster*) distinct from the account menu's shared
   "presence" drawer (ids team-roster*, src/components/shell/drawers/presence.tsx) — the prototype
   registers both, one per opener, off the same availabilityRoster/ownAvailabilityAction bodies. */

import { CAPT, PAGECAPS, SEAT, TSTATE } from "@/domain";
import type { ColourSlot, TempStateRead } from "@/domain";
import { avail, capsFor, everyone, mgrOf, P, roleOf, tState } from "@/lib/selectors";
import { tMine } from "@/features/people/helpers";
import type { ConsoleState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers";
import { AvailabilityAction, AvailabilityRoster } from "@/components/shell/availability";
import { useConsole } from "@/lib/store";
import { meScreens } from "./reach";

function RosterBody(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  return <AvailabilityRoster state={state} dispatch={dispatch} keyPrefix="profile-roster" />;
}

function RosterFoot(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  return <AvailabilityAction state={state} dispatch={dispatch} id="profile-roster-self" />;
}

registerDrawer("p:me.roster", {
  w: 480,
  title: () => "Team availability",
  sub: (state) => `${everyone(state).filter((k) => avail(state, k)).length} in · ${everyone(state).filter((k) => !avail(state, k)).length} out`,
  Body: RosterBody,
  Foot: RosterFoot,
});

function Body(_: DrawerProps) {
  const { state } = useConsole();
  const k = state.WHO;
  const mgr = mgrOf(state.PEOPLE, k);
  const reach = meScreens(state, k);
  return (
    <div className="ux-availability">
      <p className="ux-av-intro">
        {(SEAT as Record<string, string>)[roleOf(state.PEOPLE, k) || ""] || ""}
        {mgr ? " · reporting to " + P(state.PEOPLE, mgr).n : ""}
      </p>
      <ul className="ux-access-list">
        {reach.map((pg) => (
          <li className="ux-access-row" key={pg}>
            <b>{PAGECAPS[pg]!.t}</b>
            <span>{capsFor(state, k, pg).map((c) => CAPT[c] || c).join(" · ")}</span>
          </li>
        ))}
      </ul>
      <p className="ux-av-footnote">
        {mgr ? `Ask ${P(state.PEOPLE, mgr).n} to review a change.` : "Ask Digital Infrastructure to review a change."}
      </p>
    </div>
  );
}

registerDrawer("p:me.reach", {
  w: 480,
  title: () => "Your page access",
  sub: (state) => `${meScreens(state, state.WHO).length} pages`,
  Body,
});

/* panel("me.badge") / panel("me.past") — ir-merged.js:7989-8011 */
const badgeClash = (state: ConsoleState, k: string) => {
  const p = P(state.PEOPLE, k);
  return Object.keys(state.PEOPLE).filter(
    (x) => x !== k && state.PEOPLE[x].on && state.PEOPLE[x].c === p.c && !!state.PEOPLE[x].sq === !!p.sq,
  );
};

function BadgeBody(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  const k = state.WHO, p = P(state.PEOPLE, k), clash = badgeClash(state, k);
  return (
    <>
      <p className="sm" style={{ margin: "0 0 8px" }}>
        Pick a badge that is easy to tell apart from your teammates.
      </p>
      <div className="chips">
        {[false, true].map((sq) =>
          ([1, 2, 3, 4, 5, 6, 7, 8] as ColourSlot[]).map((c) => {
            const taken = Object.keys(state.PEOPLE).filter(
              (x) => x !== k && state.PEOPLE[x].on && state.PEOPLE[x].c === c && !!state.PEOPLE[x].sq === sq,
            );
            const on = p.c === c && !!p.sq === sq;
            return (
              <button
                type="button"
                key={`${sq}-${c}`}
                className={`sw2 ${on ? "on" : ""}`}
                aria-pressed={on ? "true" : "false"}
                aria-label={`Badge colour ${c}${sq ? ", square" : ", round"}${on ? ", in use by you" : ""}`}
                title={on ? "In use by you" : taken.length ? "Also " + taken.map((x) => P(state.PEOPLE, x).n).join(", ") : "Nobody is using this one"}
                onClick={() => dispatch({ type: "setMyStyle", c, sq })}
              >
                <span className={`pav ${sq ? "sq" : ""}`} style={{ ["--pc" as string]: `var(--c${c})` }}>
                  {p.i}
                </span>
              </button>
            );
          }),
        )}
      </div>
      <p className="sm" style={{ margin: "8px 0 0" }}>
        {clash.length ? `Same badge as ${clash.map((x) => P(state.PEOPLE, x).n).join(", ")}.` : "Nobody else has this badge."}
      </p>
    </>
  );
}

registerDrawer("p:me.badge", {
  w: 480,
  title: () => "Badge colour and shape",
  sub: (state) => (badgeClash(state, state.WHO).length ? "shared with a teammate" : "unique"),
  Body: BadgeBody,
});

function PastBody(_: DrawerProps) {
  const { state } = useConsole();
  const past = tMine(state).filter((g) => tState(state, g) !== "live");
  return past.length ? (
    <>
      {past.map((g) => {
        const st = tState(state, g) as TempStateRead;
        return (
          <div className="mini" style={{ alignItems: "flex-start" }} key={g.id}>
            <span style={{ minWidth: 0 }}>
              <b>{(PAGECAPS as Record<string, { t: string } | undefined>)[g.page]?.t ?? g.page}</b>
              <div className="sm">{g.caps.map((c) => CAPT[c] || c).join(", ")}</div>
              <div className="sm">
                Granted by {P(state.PEOPLE, g.by).n} · {g.why} ·{" "}
                {st === "revoked" ? "revoked " + (g.on || "") : "ended " + g.until} · {g.acts || 0} recorded actions
              </div>
            </span>
            <span className="tag">{TSTATE[st]}</span>
          </div>
        );
      })}
    </>
  ) : (
    <div className="empty">No previous temporary access.</div>
  );
}

registerDrawer("p:me.past", {
  w: 520,
  title: () => "Previous temporary access",
  sub: (state) => tMine(state).filter((g) => tState(state, g) !== "live").length + " closed",
  Body: PastBody,
});
