"use client";

/* PROFILE — the only screen whose subject is the person reading it. vMe, ir-merged.js:8013-8057.
   D59 (g8): Profile keeps one job on its face — your own details. Your availability, the team
   roster and the theme each have one home in the top-bar account menu, so the Profile copies are
   gone rather than shown twice. The rare things — badge, page access, past grants — sit behind ONE
   row of doors.

   Their own availability leads, because that is the one fact about them everybody else on the
   console can already see and only they can change. Everything else — badge, appearance, who else
   is at their desk, what they reach and why, what has been lent to them — is one line worth
   reading plus a door into the rest, so the page does not become the thing it is describing. */

import { useState } from "react";
import { CAPT, PAGECAPS } from "@/domain";
import { Pav } from "@/components/ui";
import { isMgr, mgrOf, P, tempOn, tState } from "@/lib/selectors";
import { titleOf } from "@/components/shell/SignIn";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiWrite } from "@/lib/data/api";
import { myDetails, myStyle } from "@/lib/data/endpoints/me";
import { tMine } from "@/features/people/helpers";
import { DoorRow } from "@/features/today/doors";
import { meScreens } from "./reach";
import "./drawers";

type MeBad = { f: "n" | "ph" | "i"; v: string; m: string };

export function ProfilePage() {
  const { state, dispatch, reloadData } = useConsole();
  const live = useApiMode() === "live";
  const saveDetails = useApiWrite(myDetails, state, dispatch);
  const saveStyle = useApiWrite(myStyle, state, dispatch);
  const k = state.WHO;
  const p = P(state.PEOPLE, k);
  const mgr = mgrOf(state.PEOPLE, k);
  const reach = meScreens(state, k);
  const grants = tMine(state);
  const liveGrants = grants.filter((g) => tState(state, g) === "live");
  const pastGrants = grants.filter((g) => tState(state, g) !== "live");
  const on = tempOn(state);

  const [bad, setBad] = useState<MeBad | null>(null);

  /* setMe(f,v) — the reducer (src/features/people/reducer.ts) refuses a blank name or blank
     initials silently; the field belongs the complaint, not a window.alert. 10328–10346. */
  const commit = (f: "n" | "ph" | "i", el: HTMLInputElement) => {
    const v = el.value.trim();
    setBad(null);
    if (f === "n" && v.length < 2) {
      setBad({ f, v, m: "A display name is how every list finds you — two characters at least." });
      return;
    }
    if (f === "i") {
      const t2 = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
      if (!t2) {
        setBad({
          f,
          v,
          m: v
            ? `Initials are letters and numbers — “${v}” leaves nothing to put on the badge.`
            : "Initials are the identifier on your badge; they cannot be blank.",
        });
        return;
      }
    }
    const next = f === "i" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2) : f === "n" ? v.slice(0, 40) : v.slice(0, 24);
    if (next === (f === "n" ? p.n : f === "i" ? p.i : p.ph || "")) return;
    /* C4: name and mobile are PATCH /api/me (my own Zoho user, my own token); initials are PUT /api/me/style (the console's
       own state store, J15). Live, the screen shows the change only after the route said yes; a refusal is said at the field.
       Fixture: the endpoint half runs the same setMe the page always dispatched. */
    const done = (r: { ok: true } | { ok: false; error: string }) => {
      if (!r.ok) { setBad({ f, v, m: r.error }); return; }
      if (live) { dispatch({ type: "setMe", f, v }); reloadData(); }
    };
    if (f === "i") void saveStyle({ kind: "initials", v }).then(done);
    else void saveDetails({ f, v, name: p.n }).then(done);
  };

  const badgeClash = Object.keys(state.PEOPLE).filter(
    (x) => x !== k && state.PEOPLE[x].on && state.PEOPLE[x].c === p.c && !!state.PEOPLE[x].sq === !!p.sq,
  );

  return (
    <>
      <div className="ph rd-page-heading g8-me-head">
        <div className="g8-me-id">
          <Pav k={k} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h1>{p.n}</h1>
            <p className="sub">
              {titleOf(state, k)}
              {mgr ? " · under " + P(state.PEOPLE, mgr).n : isMgr(state.PEOPLE, k) ? " · you lead it" : ""}
              {p.em ? (
                <>
                  {" · "}
                  <span className="mono">{p.em}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </div>

      {liveGrants.length ? (
        <div className="card" style={{ marginBottom: "8px", ...(on ? { borderColor: "var(--brand-line)" } : {}) }}>
          <div className="ch">
            <h3>Temporary access available</h3>
            <div className="sp" />
            {on ? (
              <span className="tag br">
                <span className="dot" />
                in use
              </span>
            ) : null}
          </div>
          <div className="cb">
            {liveGrants.map((g) => {
              const using = state.TEMPON === g.id;
              const pc = (PAGECAPS as Record<string, { t: string } | undefined>)[g.page];
              return (
                <div className="mini" style={{ alignItems: "flex-start" }} key={g.id}>
                  <span style={{ minWidth: 0 }}>
                    <b>{pc ? pc.t : g.page}</b>
                    <span className="sm">{g.caps.map((c) => CAPT[c] || c).join(", ")}</span>
                    <div className="sm">
                      {P(state.PEOPLE, g.by).n} · {g.why} · until {g.until} · {g.acts || 0} action
                      {(g.acts || 0) === 1 ? "" : "s"} recorded
                    </div>
                  </span>
                  <span>
                    {using ? (
                      <button type="button" className="chip on" onClick={() => dispatch({ type: "dropTemp" })}>
                        Stop using it
                      </button>
                    ) : (
                      <button type="button" className="act" onClick={() => dispatch({ type: "useTemp", id: g.id })}>
                        Activate access
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
            <p className="sm" style={{ margin: "9px 0 0" }}>
              Actions taken while it is on are recorded against the grant.
            </p>
          </div>
        </div>
      ) : null}

      <div className="secw ux-profile">
        <div className="card g8-me-card">
          <div className="cb">
            <div className="frow">
              <label className="fi">
                <span>Display name</span>
                <input
                  className="inp"
                  id="myn"
                  key={`myn-${p.n}`}
                  defaultValue={bad?.f === "n" ? bad.v : p.n}
                  aria-invalid={bad?.f === "n" ? "true" : undefined}
                  aria-errormessage={bad?.f === "n" ? "mebad-n" : undefined}
                  aria-describedby={bad?.f === "n" ? "mebad-n" : undefined}
                  onBlur={(e) => commit("n", e.currentTarget)}
                />
                {bad?.f === "n" ? (
                  <p className="sm" id="mebad-n" role="alert" style={{ margin: "5px 0 0", color: "var(--late)" }}>
                    {bad.m}
                  </p>
                ) : null}
              </label>
              <label className="fi">
                <span>Mobile</span>
                <input
                  className="inp mono"
                  id="myph"
                  key={`myph-${p.ph || ""}`}
                  defaultValue={p.ph || ""}
                  placeholder="+91 …"
                  aria-invalid={bad?.f === "ph" ? "true" : undefined}
                  aria-errormessage={bad?.f === "ph" ? "mebad-ph" : undefined}
                  aria-describedby={bad?.f === "ph" ? "mebad-ph" : undefined}
                  onBlur={(e) => commit("ph", e.currentTarget)}
                />
                {bad?.f === "ph" ? (
                  <p className="sm" id="mebad-ph" role="alert" style={{ margin: "5px 0 0", color: "var(--late)" }}>
                    {bad.m}
                  </p>
                ) : null}
              </label>
              <label className="fi">
                <span>Initials</span>
                <input
                  className="inp mono"
                  id="myi"
                  maxLength={2}
                  key={`myi-${p.i}`}
                  defaultValue={bad?.f === "i" ? bad.v : p.i}
                  aria-invalid={bad?.f === "i" ? "true" : undefined}
                  aria-errormessage={bad?.f === "i" ? "mebad-i" : undefined}
                  aria-describedby={bad?.f === "i" ? "mebad-i" : undefined}
                  onBlur={(e) => commit("i", e.currentTarget)}
                />
                {bad?.f === "i" ? (
                  <p className="sm" id="mebad-i" role="alert" style={{ margin: "5px 0 0", color: "var(--late)" }}>
                    {bad.m}
                  </p>
                ) : null}
              </label>
            </div>
            <p className="sm g8-me-hint">Saves when you leave the field.</p>
          </div>
        </div>
        <DoorRow
          items={[
            {
              k: "me.badge",
              t: "Badge",
              i: "me",
              v: badgeClash.length
                ? "same as " + badgeClash.map((x) => P(state.PEOPLE, x).n.split(" ")[0]).join(", ")
                : "unique",
              cls: badgeClash.length ? "bad" : "",
            },
            { k: "me.reach", t: "Your page access", i: "system", v: reach.length + " pages" },
            pastGrants.length
              ? { k: "me.past", t: "Previous temporary access", i: "lock", v: pastGrants.length + " closed" }
              : null,
          ]}
        />
      </div>
    </>
  );
}
