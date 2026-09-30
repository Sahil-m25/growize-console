"use client";

/* TEAMS — the org, the people in it, and what each of them may do. vTeamPage,
   ir-console-redesigned.html:10869-10901.

   Availability used to be the first tab here and is not a tab at all now: it is read twenty times a
   day and changed once, so it belongs to the people count in the top bar, where it is already in
   front of everybody (the shell's presence drawer and the account menu — both outside this
   directory). What is left is the work this page was actually for — the shape of the team, the list
   of people, and what has been lent. What ONE person may do stays in their own row, so this screen
   never splits into two columns the eye has to choose between. Authority over people is never
   borrowed, so the controls follow `own` and never `may`. */

import { canManage, clashOf, manageable, own, teamsList, tLive } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import { useConsole } from "@/lib/store";
import type { DrawerKind } from "@/lib/store";
import { registerDrawer } from "@/components/shell/drawers/registry";
import { DoorRow } from "@/features/today/doors";
import { Access } from "./Access";
import { Members } from "./Members";
import { Teams } from "./Teams";
import { psel } from "./reducer";
import { tSeen } from "./helpers";
import "./drawers";
import { useApiRead } from "@/lib/data/api";
import { teamsRead } from "@/lib/data/endpoints/teams";

/* D59 (g8): Members is the page. The org chart and what has been lent are rarer jobs, so they
   sit behind ONE row of doors instead of three view chips. The panels render the same vTeams and
   vAccess the tabs did. ir-merged.js:8407-8434 */
const g8Scope = (s: ConsoleState) => [s.WHO].concat(manageable(s));

function selOf(state: ConsoleState): string | null {
  const scope = g8Scope(state);
  const stored = psel(state);
  return stored && canManage(state, stored) && state.PEOPLE[stored]?.on
    ? stored
    : (scope.filter((k) => state.PEOPLE[k].on && canManage(state, k))[0] ?? null);
}

function TeamsPanel() {
  const { state } = useConsole();
  return <Teams scope={g8Scope(state)} sel={selOf(state)} />;
}

registerDrawer("p:people.teams" as DrawerKind, {
  w: 680,
  title: () => "Teams",
  sub: (state) => {
    const n = g8Scope(state).filter((k) => state.PEOPLE[k].on && clashOf(state.PEOPLE, k).length).length;
    return n ? n + " beyond their manager's reach" : "the org and access changes";
  },
  Body: TeamsPanel,
});
registerDrawer("p:people.access" as DrawerKind, {
  w: 720,
  title: () => "Temporary access",
  sub: (state) => {
    const n = tSeen(state).filter((g) => tLive(state, g)).length;
    return n ? n + " live" : "none live";
  },
  Body: () => <Access />,
});

export function PeoplePage() {
  const { state, dispatch } = useConsole();
  /* M17-S01-W1: the members and the count come from GET /api/teams (fixture: the same rows from the book) */
  const r = useApiRead(teamsRead, state, undefined);
  const edit = own(state, "people", "seats");   /* authority over people is never borrowed */
  const scope = g8Scope(state);
  const clashes = scope.filter((k) => state.PEOPLE[k].on && clashOf(state.PEOPLE, k).length).length;
  const live = tSeen(state).filter((g) => tLive(state, g)).length;
  const inScope = (k: string) => scope.indexOf(k) >= 0;
  const nTeams = teamsList(state.PEOPLE).filter((t) => inScope(t.mgr) || t.members.some(inScope)).length;

  return (
    <>
      <div className="ph rd-page-heading">
        <div>
          <h1>Teams</h1>
          <p className="sub">{r.state === "ok" ? r.data.view.activeMembers + " active members" : r.state === "loading" ? "Reading the team…" : ""}</p>
        </div>
        <div className="sp" />
        {edit ? (
          <button type="button" className="act" id="addm" onClick={() => dispatch({ type: "startPerson" })}>
            Add member
          </button>
        ) : (
          <span className="tag">View only</span>
        )}
      </div>
      <DoorRow
        items={[
          { k: "people.teams", t: "Teams", i: "people", v: clashes ? clashes + " beyond reach" : nTeams + " team" + (nTeams === 1 ? "" : "s"), cls: clashes ? "bad" : "" },
          { k: "people.access", t: "Temporary access", i: "lock", v: live ? live + " live" : "none live" },
        ]}
      />
      {r.state === "error" ? <p className="note bad" role="alert">{r.err.error}</p>
        : r.state === "ok" && r.data.view.members ? <Members rows={r.data.view.members} /> : null}
    </>
  );
}
