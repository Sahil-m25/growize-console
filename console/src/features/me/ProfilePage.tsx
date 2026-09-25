"use client";

/* PROFILE — the only screen whose subject is the person reading it. vMe, redesigned prototype
   `ir-console-redesigned.html` 10422–10475.

   Their own availability leads, because that is the one fact about them everybody else on the
   console can already see and only they can change. Everything else — badge, appearance, who else
   is at their desk, what they reach and why, what has been lent to them — is one line worth
   reading plus a door into the rest, so the page does not become the thing it is describing. */

import { useState } from "react";
import { CAPT, PAGECAPS, TSTATE } from "@/domain";
import type { ColourSlot, PersonKey, TempStateRead } from "@/domain";
import { Card, Icon, Pav } from "@/components/ui";
import {
  active,
  avail,
  covOf,
  everyone,
  isMgr,
  lost,
  mgrOf,
  openable,
  outFor,
  outFromD,
  outTo,
  P,
  planFor,
  secOK,
  secondaryHolds,
  tempOn,
  titleOf,
  tState,
} from "@/lib/selectors";
import { useConsole, type ConsoleState } from "@/lib/store";
import { absOpen, tMine } from "@/features/people/helpers";
import { AppearanceControls } from "./AppearanceControls";
import { meScreens } from "./reach";
import "./drawers";

/* availabilityStatus(k) / availabilityCover(k) — 10358–10370. Read here off the selectors the
   D37–D44 work already ported (`outFor`, `planFor`, `covOf`, `secOK`), never re-derived. */
function availabilityStatus(state: ConsoleState, k: PersonKey) {
  const out = outFor(state, k);
  const soon = planFor(state, k);
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

function availabilityCoverText(state: ConsoleState, k: PersonKey): string {
  if (avail(state, k)) return "";
  const names = Array.from(
    new Set(
      state.LEADS.filter((l) => l.own === k && active(l) && !lost(l))
        .map((l): PersonKey | null => {
          const cov = covOf(state, l);
          return cov ? cov.by : secOK(state, l) ? l.sec ?? null : null;
        })
        .filter((x): x is PersonKey => !!x),
    ),
  );
  return names.length ? "Cover: " + names.map((x) => P(state.PEOPLE, x).n).join(", ") : "";
}

type MeBad = { f: "n" | "ph" | "i"; v: string; m: string };

export function ProfilePage() {
  const { state, dispatch } = useConsole();
  const k = state.WHO;
  const p = P(state.PEOPLE, k);
  const mgr = mgrOf(state.PEOPLE, k);
  const mine = state.LEADS.filter((l) => l.own === k);
  const all = everyone(state);
  const inN = all.filter((x) => avail(state, x)).length;
  const outN = all.filter((x) => !avail(state, x)).length;
  const reach = meScreens(state, k);
  const grants = tMine(state);
  const liveGrants = grants.filter((g) => tState(state, g) === "live");
  const pastGrants = grants.filter((g) => tState(state, g) !== "live");
  const on = tempOn(state);
  const selfAvailability = availabilityStatus(state, k);
  const selfCover = availabilityCoverText(state, k);
  const activeCover = openable(state).filter((l) => secondaryHolds(state, l, k)).length;

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
    dispatch({ type: "setMe", f, v });
  };

  const badgeClash = Object.keys(state.PEOPLE).filter(
    (x) => x !== k && state.PEOPLE[x].on && state.PEOPLE[x].c === p.c && !!state.PEOPLE[x].sq === !!p.sq,
  );

  return (
    <>
      <div className="ph rd-page-heading">
        <div>
          <h1>Profile</h1>
          <p className="sub">Your details, availability and preferences.</p>
        </div>
      </div>

      <section className="card ux-availability ux-av-self">
        <div className="cb">
          <div className="ux-av-self-head">
            <h2>Your availability</h2>
            <span className={`tag ${selfAvailability.out ? "cov" : "go"}`}>
              <span className="dot" />
              {selfAvailability.t}
            </span>
          </div>
          <div className="ux-av-self-body">
            <div>
              <b>{selfAvailability.detail}</b>
              {selfCover ? <p>{selfCover}</p> : null}
            </div>
            <button type="button" className="act" id="profile-availability" onClick={() => dispatch(absOpen(state, k))}>
              {selfAvailability.out
                ? "Change your return date"
                : selfAvailability.soon
                  ? "Change planned absence"
                  : "Set your availability"}
            </button>
          </div>
        </div>
      </section>

      <div className="ux-toolbar ux-profile">
        <span className="sm">
          {mine.filter(active).length} active leads · {activeCover} active cover · {reach.length} accessible screens
        </span>
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
              const st = tState(state, g) as TempStateRead;
              const using = state.TEMPON === g.id && st === "live";
              const pc = (PAGECAPS as Record<string, { t: string } | undefined>)[g.page];
              return (
                <div className="mini" style={{ alignItems: "flex-start" }} key={g.id}>
                  <span style={{ minWidth: 0 }}>
                    <b>{pc ? pc.t : g.page}</b> <span className="sm">{g.caps.map((c) => CAPT[c] || c).join(", ")}</span>
                    <div className="sm">
                      {P(state.PEOPLE, g.by).n} · {g.why} ·{" "}
                      {st === "live"
                        ? `until ${g.until}`
                        : st === "revoked"
                          ? `revoked ${g.on || ""}`
                          : `ended ${g.until}`}{" "}
                      · {g.acts || 0} action{(g.acts || 0) === 1 ? "" : "s"} recorded while it was on
                    </div>
                  </span>
                  <span>
                    {st !== "live" ? (
                      <span className="tag">{TSTATE[st]}</span>
                    ) : using ? (
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
              Activate access when needed and stop using it when finished. Actions during that time
              keep the grant in their audit record.
            </p>
          </div>
        </div>
      ) : null}

      <div className="secw ux-profile">
        <Card title="Your details">
          <div style={{ display: "flex", gap: "13px", alignItems: "center", marginBottom: "14px" }}>
            <Pav k={k} size="lg" />
            <div style={{ minWidth: 0 }}>
              <b style={{ fontSize: "var(--text-body)" }}>{p.n}</b>
              <div className="sm">
                {titleOf(state.PEOPLE, k)}
                {mgr ? " · under " + P(state.PEOPLE, mgr).n : isMgr(state.PEOPLE, k) ? " · you lead it" : ""}
              </div>
            </div>
          </div>
          <div className="frow">
            <label className="fi">
              <span>Display name</span>
              <input
                className="inp"
                id="myn"
                key={`myn-${p.n}`}
                defaultValue={p.n}
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
                onBlur={(e) => commit("ph", e.currentTarget)}
              />
            </label>
            <label className="fi">
              <span>
                Work email{" "}
                <i style={{ fontStyle: "normal", textTransform: "none", letterSpacing: 0 }}>the sign-in</i>
              </span>
              <input className="inp mono" value={p.em || "—"} disabled readOnly />
            </label>
            <label className="fi">
              <span>Initials</span>
              <input
                className="inp mono"
                id="myi"
                maxLength={2}
                style={{ width: "70px" }}
                key={`myi-${p.i}`}
                defaultValue={p.i}
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
          <p className="sm" style={{ margin: "12px 0 0" }}>
            Changes save when you leave a field. Your work email is managed by an administrator.
          </p>
          <details className="ux-disclosure" data-ux-key="profile-badge">
            <summary>Change badge colour and shape</summary>
            <div className="ux-section">
              <p className="sm" style={{ margin: "0 0 8px" }}>
                Choose a badge that is easy to distinguish from teammates.
              </p>
              <div className="chips">
                {[false, true].map((sq) =>
                  ([1, 2, 3, 4, 5, 6, 7, 8] as ColourSlot[]).map((c) => {
                    const taken = Object.keys(state.PEOPLE).filter(
                      (x) => x !== k && state.PEOPLE[x].on && state.PEOPLE[x].c === c && !!state.PEOPLE[x].sq === sq,
                    );
                    const isOn = p.c === c && !!p.sq === sq;
                    return (
                      <button
                        type="button"
                        key={`${sq}-${c}`}
                        className={`sw2 ${isOn ? "on" : ""}`}
                        aria-pressed={isOn ? "true" : "false"}
                        title={
                          isOn
                            ? "In use by you"
                            : taken.length
                              ? "Also " + taken.map((x) => P(state.PEOPLE, x).n).join(", ")
                              : "Nobody is using this one"
                        }
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
                {badgeClash.length
                  ? `Same badge as ${badgeClash.map((x) => P(state.PEOPLE, x).n).join(", ")}.`
                  : "Nobody else has this badge."}
              </p>
            </div>
          </details>
        </Card>

        <section className="card rd-preferences">
          <div className="ch">
            <h3>Appearance</h3>
          </div>
          <div className="cb">
            <p className="sm">Choose the theme that feels comfortable for your day.</p>
            <AppearanceControls place="profile" />
          </div>
        </section>

        <details className="ux-disclosure" data-ux-key="profile-reference">
          <summary>Team availability, permissions and access history</summary>
          <div className="doors">
            <button
              type="button"
              className={`door ${state.DRW?.k === "p:me.roster" ? "on" : ""}`}
              id="door-me-roster"
              aria-haspopup="dialog"
              aria-expanded={state.DRW?.k === "p:me.roster" ? "true" : "false"}
              title="Opens below"
              onClick={() => dispatch({ type: "openDrawer", k: "p:me.roster" })}
            >
              <span className="dt">
                <Icon name="people" />
                Team availability
              </span>
              <span className={`dv ${outN ? "" : "q"}`}>
                {inN} in · {outN} out
              </span>
            </button>
            <button
              type="button"
              className={`door ${state.DRW?.k === "p:me.reach" ? "on" : ""}`}
              id="door-me-reach"
              aria-haspopup="dialog"
              aria-expanded={state.DRW?.k === "p:me.reach" ? "true" : "false"}
              title="Opens below"
              onClick={() => dispatch({ type: "openDrawer", k: "p:me.reach" })}
            >
              <span className="dt">
                <Icon name="system" />
                Your page access
              </span>
              <span className="dv">{reach.length} pages</span>
            </button>
          </div>

          {pastGrants.length ? (
            <div className="ux-section">
              <h3 style={{ fontSize: "var(--text-body)", margin: "0 0 10px" }}>
                Previous temporary access · {pastGrants.length}
              </h3>
              {pastGrants.map((g) => {
                const pc = (PAGECAPS as Record<string, { t: string } | undefined>)[g.page];
                const st = tState(state, g) as TempStateRead;
                return (
                  <div className="mini" style={{ alignItems: "flex-start" }} key={g.id}>
                    <span style={{ minWidth: 0 }}>
                      <b>{pc ? pc.t : g.page}</b>
                      <div className="sm">{g.caps.map((c) => CAPT[c] || c).join(", ")}</div>
                      <div className="sm">
                        Granted by {P(state.PEOPLE, g.by).n} · {g.why} ·{" "}
                        {st === "revoked" ? `revoked ${g.on || ""}` : `ended ${g.until}`} · {g.acts || 0} recorded
                        actions
                      </div>
                    </span>
                    <span className="tag">{TSTATE[st]}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </details>
      </div>
    </>
  );
}
