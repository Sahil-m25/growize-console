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

import { avail, canManage, clashOf, manageable, own, tLive } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Access } from "./Access";
import { Members } from "./Members";
import { Teams } from "./Teams";
import { psel, ptab } from "./reducer";
import { tSeen } from "./helpers";
import "./drawers";

export function PeoplePage() {
  const { state, dispatch } = useConsole();
  const edit = own(state, "people", "seats");
  const scope = [state.WHO].concat(manageable(state));

  /* the prototype corrects PSEL as it draws — a selection that has left your access, or left the
     org, falls back to the first person you can manage. Derived rather than written: what the seat
     control reads is set when the drawer opens, and this is only what the card highlights. */
  const stored = psel(state);
  const sel =
    stored && canManage(state, stored) && state.PEOPLE[stored]?.on
      ? stored
      : (scope.filter((k) => state.PEOPLE[k].on && canManage(state, k))[0] ?? null);

  const clashes = scope.filter((k) => state.PEOPLE[k].on && clashOf(state.PEOPLE, k).length).length;
  const liveN = tSeen(state).filter((g) => tLive(state, g)).length;
  const active = scope.filter((k) => state.PEOPLE[k].on).length;
  const tabStored = ptab(state);
  const tab = ["teams", "members", "access"].includes(tabStored) ? tabStored : "members";

  /* changing tab closes the drawer — it was about something on the tab you just left */
  const toTab = (k: string) => {
    dispatch({ type: "setUi", patch: { PTAB: k } });
    dispatch({ type: "closeDrawer" });
  };

  return (
    <>
      <div className="ph rd-page-heading">
        <div>
          <h1>Teams</h1>
          <p className="sub">
            {active} active members ·{" "}
            {edit ? "Manage people, roles and access." : "People and teams you can view."}
          </p>
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

      <div className="ux-toolbar ux-team rd-team-views" role="group" aria-label="Team view">
        <button
          type="button"
          className={`chip ${tab === "members" ? "on" : ""}`}
          aria-pressed={tab === "members"}
          id="pt-members"
          onClick={() => toTab("members")}
        >
          Members
        </button>
        <button
          type="button"
          className={`chip ${tab === "teams" ? "on" : ""}`}
          aria-pressed={tab === "teams"}
          id="pt-teams"
          onClick={() => toTab("teams")}
        >
          Teams
          {clashes ? <> <b style={{ color: "var(--late)" }}>{clashes}</b></> : null}
        </button>
        <button
          type="button"
          className={`chip ${tab === "access" ? "on" : ""}`}
          aria-pressed={tab === "access"}
          id="pt-access"
          onClick={() => toTab("access")}
        >
          Temporary access
          {liveN ? <> <b>{liveN}</b></> : null}
        </button>
      </div>

      {tab === "access" ? <Access /> : tab === "teams" ? <Teams scope={scope} sel={sel} /> : <Members scope={scope} />}
    </>
  );
}
