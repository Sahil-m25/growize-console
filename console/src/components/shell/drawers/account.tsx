"use client";

/* YOUR ACCOUNT — DRAWERS.account, redesigned prototype ~12043–12051. Opened from the top bar's
   `who` button. The only place Profile, Team availability, Help and appearance are one click from
   every screen, and the one door out: Sign out. */

import type { NavKey } from "@/domain";
import { accountAllowed, avail, everyone, P } from "@/lib/selectors";
import { titleOf } from "../SignIn";
import { useConsole, useSession } from "@/lib/store";
import { AppearanceControls, Icon, Pav } from "@/components/ui";
import { useRouter } from "next/navigation";
import { AvailabilityAction, availabilityStatus } from "../availability";
import { pathOf, type View } from "../routes";
import { registerDrawer, type DrawerProps } from "./registry";

function Body(_: DrawerProps) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const me = state.WHO;
  const p = P(state.PEOPLE, me);
  /* an Investors-only seat has no lead-side account: no availability, no Profile, no Team availability, no lead help —
     the person, the appearance and (below) Sign out */
  const lead = accountAllowed(state);
  const s = availabilityStatus(state, me);
  const goAndClose = (view: View) => {
    dispatch({ type: "closeDrawer" });
    dispatch({ type: "go", v: view as NavKey });   /* the shell draws the page at once, before the route lands */
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
          <span>{titleOf(state, me)}</span>
          {p.em ? <span>{p.em}</span> : null}
        </div>
      </div>

      {lead ? <><section className="ux-account-availability">
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

      </> : null}

      <section className="rd-account-appearance">
        <h3>Appearance</h3>
        <AppearanceControls place="account" />
      </section>
    </div>
  );
}

/* THE FOOTER — the prototype's is one button, "Sign out" (`<button class="act ghost"
   onclick="signOut('chose')">Sign out</button>`, 03-app.js:9647), the only place it lives. It ends
   the session (the cookie and everything the seat had open) and returns to the sign-in screen. */
function Foot(_: DrawerProps) {
  const { signOut } = useSession();
  const router = useRouter();
  return (
    <button
      type="button"
      className="act ghost"
      onClick={() => {
        signOut("chose");
        router.replace("/");
      }}
    >
      Sign out
    </button>
  );
}

registerDrawer("account", {
  w: 400,
  title: () => "Your account",
  sub: () => "Profile and availability",
  Body,
  Foot,
});
