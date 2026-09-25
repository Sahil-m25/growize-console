"use client";

/* AVAILABILITY, SHARED — the redesigned prototype's availabilityStatus/availabilityCover/
   availabilityRow/availabilityRoster/ownAvailabilityAction, ~10358–10406. One roster, drawn by both
   the presence drawer (everyone) and the account menu (yourself), and one "open the editor" action
   the absence drawer's own Foot, the account menu and the roster's own rows all call the same way. */

import type { Dispatch } from "react";
import { useState } from "react";
import type { PersonKey } from "@/domain";
import { SEAT } from "@/domain";
import { dAdd, dLabel, dayOf, dOf, iso, when } from "@/lib/format";
import {
  active,
  avail,
  canManage,
  canRosterFor,
  everyone,
  gone,
  lost,
  may,
  outFor,
  outFromD,
  outTo,
  P,
  planFor,
  roleOf,
  secOK,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";
import { Icon, Pav } from "@/components/ui";

export type Availability = { out: boolean; soon: boolean; t: string; detail: string };

/* availabilityStatus(k) — 03-app.js:10358 */
export function availabilityStatus(state: ConsoleState, k: PersonKey): Availability {
  const out = outFor(state, k), soon = planFor(state, k);
  return {
    out: !!out,
    soon: !!soon,
    t: out ? "Out" : "In",
    detail: out
      ? `Back ${outTo(state, k)}`
      : soon
        ? `Away ${outFromD(state, k)} · back ${outTo(state, k)}`
        : "Available for follow-ups",
  };
}

/* availabilityCover(k) — 03-app.js:10364. Who is actually carrying this person's book right now,
   read off their own open leads rather than off a standing arrangement that may have moved on. */
export function availabilityCover(state: ConsoleState, k: PersonKey): string {
  if (avail(state, k)) return "";
  const names = [
    ...new Set(
      state.LEADS.filter((l) => l.own === k && active(l) && !lost(l))
        .map((l): PersonKey | null => {
          const cover = l.cov || state.COVER[k];
          const date = cover ? when(cover.to, state.NOW) : null;
          if (cover && date && date >= dayOf(state.NOW) && state.PEOPLE[cover.by]?.on && avail(state, cover.by)) {
            return cover.by;
          }
          return secOK(state, l) ? (l.sec ?? null) : null;
        })
        .filter((x): x is PersonKey => !!x),
    ),
  ];
  return names.length ? "Cover: " + names.map((x) => P(state.PEOPLE, x).n).join(", ") : "";
}

/* absOpen(k) — 03-app.js:905. Opens the absence drawer seeded from the roster row rather than
   blank, so the dates in it are the ones already recorded. */
export function openAbsenceDrawer(dispatch: Dispatch<Action>, state: ConsoleState, k: PersonKey): void {
  const a = state.AVAIL[k];
  dispatch({
    type: "openDrawer",
    k: "absence",
    id: k,
    seed: {
      ABWHY: a ? a.why : null,
      ABFROM: a && dOf(a.from) ? a.from : iso(state.NOW),
      ABTO: a && dOf(a.to) ? a.to : iso(dAdd(state.NOW, 1)),
    },
  });
}

/* ownAvailabilityAction(id) — 03-app.js:10394 */
export function AvailabilityAction({ state, dispatch, id }: { state: ConsoleState; dispatch: Dispatch<Action>; id?: string }) {
  const s = availabilityStatus(state, state.WHO);
  return (
    <button type="button" className="act" id={id} onClick={() => openAbsenceDrawer(dispatch, state, state.WHO)}>
      {s.out ? "Change your return date" : s.soon ? "Change planned absence" : "Set your availability"}
    </button>
  );
}

/* availabilityRow(k) — 03-app.js:10371 */
function AvailabilityRow({ state, dispatch, k, keyPrefix }: { state: ConsoleState; dispatch: Dispatch<Action>; k: PersonKey; keyPrefix: string }) {
  const s = availabilityStatus(state, k);
  const cover = availabilityCover(state, k);
  const you = k === state.WHO;
  const canChange = !you && canRosterFor(state, k) && !gone(state, k);
  const canOpen = !you && !canChange && may(state, "people", "seats") && canManage(state, k);
  return (
    <li className="ux-av-row" data-person={k} data-availability={s.out ? "out" : "in"}>
      <Pav k={k} size="lg" />
      <div className="ux-av-person">
        <b>
          {P(state.PEOPLE, k).n}
          {you ? <> <span className="ux-av-you">you</span></> : null}
        </b>
        <span className="ux-av-role">{SEAT[roleOf(state.PEOPLE, k)!] ?? ""}</span>
        {s.out || s.soon ? <span className="ux-av-detail">{s.detail}</span> : null}
        {cover ? <span className="ux-av-cover">{cover}</span> : null}
      </div>
      <span className={`tag ${s.out ? "cov" : "go"} ux-av-state`}>
        <span className="dot" />
        {s.t}
      </span>
      <div className="ux-av-action">
        {canChange ? (
          <button
            type="button"
            className="btn"
            id={`${keyPrefix}-change-${k}`}
            aria-label={`Change availability for ${P(state.PEOPLE, k).n}`}
            onClick={() => openAbsenceDrawer(dispatch, state, k)}
          >
            Change
          </button>
        ) : canOpen ? (
          <button
            type="button"
            className="btn"
            id={`${keyPrefix}-member-${k}`}
            aria-label={`Open member details for ${P(state.PEOPLE, k).n}`}
            onClick={() => dispatch({ type: "openDrawer", k: "person", id: k })}
          >
            Details
          </button>
        ) : null}
      </div>
    </li>
  );
}

/* availabilityRoster(key) — 03-app.js:10375. Searchable, Out first, then In. */
export function AvailabilityRoster({ state, dispatch, keyPrefix }: { state: ConsoleState; dispatch: Dispatch<Action>; keyPrefix: string }) {
  const [q, setQ] = useState("");
  const all = everyone(state);
  const query = q.trim().toLowerCase();
  const match = (k: PersonKey) => !query || (P(state.PEOPLE, k).n + " " + (SEAT[roleOf(state.PEOPLE, k)!] ?? "")).toLowerCase().includes(query);
  const rows = all.filter(match);
  const out = rows.filter((k) => !avail(state, k));
  const ins = rows.filter((k) => avail(state, k));
  return (
    <div className="ux-availability">
      <p className="ux-av-intro">Availability for {dLabel(state.NOW)}. Return dates update status automatically.</p>
      <div className="srch ux-av-search">
        <Icon name="search" />
        <input
          id={`${keyPrefix}-search`}
          type="search"
          aria-label="Find a teammate"
          placeholder="Find a teammate"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {query ? (
          <button type="button" className="x" aria-label="Clear teammate search" onClick={() => setQ("")}>
            <Icon name="x" />
          </button>
        ) : null}
      </div>
      {out.length ? (
        <section className="ux-av-group">
          <h3>
            Out <span>{out.length}</span>
          </h3>
          <ul className="ux-av-list">
            {out.map((k) => (
              <AvailabilityRow key={k} state={state} dispatch={dispatch} k={k} keyPrefix={keyPrefix} />
            ))}
          </ul>
        </section>
      ) : null}
      {ins.length ? (
        <section className="ux-av-group">
          <h3>
            In <span>{ins.length}</span>
          </h3>
          <ul className="ux-av-list">
            {ins.map((k) => (
              <AvailabilityRow key={k} state={state} dispatch={dispatch} k={k} keyPrefix={keyPrefix} />
            ))}
          </ul>
        </section>
      ) : null}
      {!rows.length ? (
        <div className="ux-av-empty">
          <b>No teammate matches this search</b>
          <button type="button" className="btn" onClick={() => setQ("")}>
            Clear search
          </button>
        </div>
      ) : null}
      <p className="ux-av-footnote">Absence reasons stay with the member and authorised roster managers.</p>
    </div>
  );
}
