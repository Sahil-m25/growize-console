"use client";

/* YOUR ACCOUNT — DRAWERS.account, redesigned prototype ~12043–12051. Opened from the top bar's
   `who` button. The only place Profile, Team availability, Help and appearance are one click from
   every screen — and, in this stage of the port, the only place left to switch who is signed in:
   see the note on the footer below. */

import type { PersonKey } from "@/domain";
import { SEAT } from "@/domain";
import { avail, consoleAccount, everyone, P, roleOf } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { AppearanceControls, Field, Icon, Pav } from "@/components/ui";
import { useRouter } from "next/navigation";
import { AvailabilityAction, availabilityStatus } from "../availability";
import { pathOf, type View } from "../routes";
import { registerDrawer, type DrawerProps } from "./registry";

function Body(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const me = state.WHO;
  const p = P(state.PEOPLE, me);
  const s = availabilityStatus(state, me);
  const titleOf = (k: PersonKey) => SEAT[roleOf(state.PEOPLE, k)!] ?? "";
  const goAndClose = (view: View) => {
    dispatch({ type: "closeDrawer" });
    router.push(pathOf(view));
  };
  const openAndClose = (k: "presence" | "help") => {
    dispatch({ type: "closeDrawer" });
    dispatch({ type: "openDrawer", k, id: k === "help" ? state.VIEW : undefined });
  };

  return (
    <div className="ux-availability ux-account">
      <div className="ux-account-person">
        <Pav k={me} size="lg" />
        <div>
          <b>{p.n}</b>
          <span>{titleOf(me)}</span>
          {p.em ? <span>{p.em}</span> : null}
        </div>
      </div>

      <section className="ux-account-availability">
        <div>
          <b>Your availability</b>
          <span className={`tag ${s.out ? "cov" : "go"}`}>
            <span className="dot" />
            {s.t}
          </span>
        </div>
        <p>{s.detail}</p>
        <AvailabilityAction state={state} dispatch={dispatch} id="account-availability" />
      </section>

      <div className="ux-account-menu">
        <button type="button" className="ux-account-row" onClick={() => goAndClose("me" as View)}>
          <Icon name="me" />
          <span>
            Profile
            <span className="ux-account-hint">Personal details and page access</span>
          </span>
          <Icon name="next" />
        </button>
        <button type="button" className="ux-account-row" onClick={() => openAndClose("presence")}>
          <Icon name="people" />
          <span>
            Team availability
            <span className="ux-account-hint">
              {everyone(state).filter((k) => avail(state, k)).length} in · {everyone(state).filter((k) => !avail(state, k)).length} out
            </span>
          </span>
          <Icon name="next" />
        </button>
        <button type="button" className="ux-account-row" onClick={() => openAndClose("help")}>
          <Icon name="help" />
          <span>Help with this page</span>
          <Icon name="next" />
        </button>
      </div>

      <section className="rd-account-appearance">
        <h3>Appearance</h3>
        <AppearanceControls place="account" />
      </section>
    </div>
  );
}

/* THE FOOTER — the prototype's is one button, "Sign out" (`<button class="act ghost"
   onclick="signOut('chose')">Sign out</button>`, 03-app.js:9647), the only place it lives. This
   build has no sign-in yet (README: "no sign-in, no job") — `signOut()` ends a real session
   (03-app.js:10977, `endSession()`) that this port never opens, so there is nothing behind the
   label to port. What is added beside it is this port's own stand-in for the prototype's sign-in
   screen — "pick a person below to see their console" — since that is the one thing a no-auth
   demo would otherwise have no way to do once the top bar's old persona switcher is gone.

   The button itself is kept, not dropped, because the task that owns this stage of the port asked
   for it to stay next to the demo picker rather than be replaced by it. Lacking a session to end,
   it does the nearest honest thing a demo can: closes the menu and returns the console to its
   default seat (`WHO0`, 03-app.js:935 — `let WHO="rohit"`), the same seat this app opens on. */
const DEFAULT_WHO = "rohit" as PersonKey;

function Foot(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  return (
    <>
      <Field label="Viewing as · demo only">
        <select
          className="selw"
          value={state.WHO}
          onChange={(e) => dispatch({ type: "setPerson", k: e.target.value as PersonKey })}
        >
          {Object.keys(state.PEOPLE)
            .filter((k) => consoleAccount(state.PEOPLE, k as PersonKey))
            .map((k) => (
              <option value={k} key={k}>
                {`${P(state.PEOPLE, k as PersonKey).n} — ${SEAT[roleOf(state.PEOPLE, k as PersonKey)!] ?? ""}`}
              </option>
            ))}
        </select>
      </Field>
      <button
        type="button"
        className="act ghost"
        onClick={() => {
          dispatch({ type: "setPerson", k: DEFAULT_WHO });
          dispatch({ type: "closeDrawer" });
        }}
      >
        Sign out
      </button>
    </>
  );
}

registerDrawer("account", {
  w: 400,
  title: () => "Your account",
  sub: () => "Profile and availability",
  Body,
  Foot,
});
