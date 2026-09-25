"use client";

/* TEAM AVAILABILITY — DRAWERS.presence, redesigned prototype ~12774. Reached from the account
   menu (drawers/account.tsx); the top bar's own #whoin button ships `hidden` and stays that way —
   see the note in TopBar.tsx. */

import { avail, everyone } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { AvailabilityAction, AvailabilityRoster } from "../availability";
import { registerDrawer, type DrawerProps } from "./registry";

function Body(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  return <AvailabilityRoster state={state} dispatch={dispatch} keyPrefix="team-roster" />;
}

function Foot(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  return <AvailabilityAction state={state} dispatch={dispatch} id="team-roster-self" />;
}

registerDrawer("presence", {
  w: 480,
  title: () => "Team availability",
  sub: (state) => `${everyone(state).filter((k) => avail(state, k)).length} in · ${everyone(state).filter((k) => !avail(state, k)).length} out`,
  Body,
  Foot,
});
