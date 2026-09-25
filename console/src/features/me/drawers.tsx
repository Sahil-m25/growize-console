"use client";

/* p:me.reach and p:me.roster — the door panels behind Profile's "Team availability, permissions
   and access history" disclosure. redesigned prototype `ir-console-redesigned.html` 10413-10419
   (panel("me.roster",...), panel("me.reach",...)). Panels, not per-page sections: same registry,
   same drawer frame, reached with dispatch({type:"openDrawer", k:"p:me.roster"|"p:me.reach"}).
   me.roster is its own panel (ids profile-roster*) distinct from the account menu's shared
   "presence" drawer (ids team-roster*, src/components/shell/drawers/presence.tsx) — the prototype
   registers both, one per opener, off the same availabilityRoster/ownAvailabilityAction bodies. */

import { CAPT, PAGECAPS, SEAT } from "@/domain";
import { avail, capsFor, everyone, mgrOf, P, roleOf } from "@/lib/selectors";
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
            <b>{PAGECAPS[pg].t}</b>
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
