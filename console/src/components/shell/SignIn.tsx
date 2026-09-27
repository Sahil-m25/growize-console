"use client";

/* THE SIGN-IN SCREEN — the merged prototype's vSignin() (ir-merged.js 11267-11298), zohoSignIn()
   (11106-11113), SIGNOUTMSG (11098) and merge-glue.js mergedPages()/imTitle(). One button in the
   product; in fixture mode the same door also lists the demo people who hold console access right
   now, so a demo — and the UI-case runner — can still sign in as anybody. Nothing here is a
   password field: staff sign in with Zoho and this screen never sees a credential.

   It renders outside the rail and the shell (`#signin`), at every route, whenever nobody is
   signed in, so no count, name or lead is on screen behind the door. */

import { useEffect, useRef, useState } from "react";
import { BYGRANT, IM2M, SEAT, SIGNOUTMSG } from "@/domain";
import type { PersonKey } from "@/domain";
import { admitted, leadAccount } from "@/lib/data/admission";
import { imHas, imReach, imTitle } from "@/lib/im";
import { P, roleOf } from "@/lib/selectors";
import { useConsole, useSession, type ConsoleState } from "@/lib/store";
import { screensOf } from "@/features/people/helpers";
import { Pav } from "@/components/ui";
import { Shell } from "./Shell";

/* titleOf(k) — ir-merged.js:1591 with merge-glue.js imTitle(k): the Investors title for a seat that
   works there (D68 names the super user), the lead seat's otherwise. */
export function titleOf(state: ConsoleState, k: PersonKey): string {
  const seat = roleOf(state.PEOPLE, k);
  const has = imHas(state.IM, k);
  const im = seat === "ops" && has ? "Super user · Digital Infrastructure"
    : state.PEOPLE[k]?.ext && has ? imTitle(state.IM, k) : "";
  return im || (seat ? SEAT[seat] : "") || "";
}

/* mergedPages(k) — merge-glue.js:43. Every screen the person reaches on either side, a two-sided
   page counted once, their own profile not counted. */
export function mergedPages(state: ConsoleState, k: PersonKey): number {
  const keys = new Set<string>(leadAccount(state.PEOPLE, state.CAPS, k) ? screensOf(state, k).filter((p) => p !== "me") : []);
  imReach({ data: state.IM }, k).forEach((v) => keys.add(IM2M[v] || v));
  return keys.size;
}

export function SignIn() {
  const { state } = useConsole();
  const { signIn } = useSession();
  const [hint, setHint] = useState<string | null>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const m = state.SIGNOUT ? SIGNOUTMSG[state.SIGNOUT] : null;
  /* D60: exactly the people who hold console access right now — both sides */
  const who = state.FIXTURES ? admitted({ PEOPLE: state.PEOPLE, GRANT: state.CAPS, SIGNINS: state.SIGNINS, im: state.IM }) : [];

  /* signOut() claims the heading so a keyboard or screen-reader user lands on the door */
  useEffect(() => {
    if (state.SIGNOUT) h1.current?.focus();
  }, [state.SIGNOUT]);

  /* zohoSignIn() — the real button hands off to Zoho (phase 2: /api/auth/zoho becomes OAuth). It
     cannot re-enter a seat by guessing; until it is wired it says what it is waiting for. */
  const zoho = async () => {
    const r = await fetch("/api/auth/zoho", { method: "POST" }).catch(() => null);
    const body = r ? ((await r.json().catch(() => null)) as { wired?: boolean; message?: string } | null) : null;
    if (body?.wired) return;
    const msg = body?.message || "Zoho sign-in is connected in phase 2.";
    setHint(state.FIXTURES ? msg.replace(/\.$/, "") + " — pick a person below." : msg);
  };

  return (
    <div className="sicard">
      <div className="sibrand">
        <div className="mark">GZ</div>
        <div>
          <b>Growize</b>
          <span>Console</span>
        </div>
      </div>
      {m ? (
        <div className="note" style={{ marginBottom: 16 }}>
          <b>{m[0]}</b>
          <br />
          <span className="sm">{m[1]}</span>
        </div>
      ) : null}
      <h1 ref={h1} tabIndex={-1}>Sign in to the Growize Console</h1>
      <p className="sisub">Use your Growize work account.</p>
      <button type="button" className="act siact" onClick={() => void zoho()}>
        Continue with Zoho
      </button>
      <p className="sifine">You finish signing in on zoho.in. This console never sees your password.</p>
      <p className="sifine" id="sihint" hidden={!hint} style={{ color: "var(--late)" }}>
        {hint}
      </p>
      {state.FIXTURES ? (
        <>
          <div className="sisep">
            <span>Prototype — sign in as anybody with access</span>
          </div>
          <p className="sisub" style={{ margin: "0 0 10px" }}>
            Each person sees a different console. That is the point: pick one and you get their pages, their
            leads and nothing else.
          </p>
          <div className="silist">
            {who.map((k) => {
              const pages = mergedPages(state, k);
              const seat = roleOf(state.PEOPLE, k);
              return (
                <button type="button" className="sirow" key={k} onClick={() => signIn(k)}>
                  <Pav k={k} size="lg" />
                  <span className="sit">
                    <b>{P(state.PEOPLE, k).n}</b>
                    <span className="sm">
                      {titleOf(state, k)}
                      {seat && (BYGRANT as readonly string[]).includes(seat) ? " · by grant" : ""}
                    </span>
                  </span>
                  <span className="sm nw">
                    {pages} page{pages === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
      <p className="sifoot">
        Growize — a business unit of AgResearch Labs.
        <br />
        IR, IR Manager and Digital Infrastructure sign in for the leads; Finance, Compliance, Account Management
        and the Auditor sign in for the investors. Anybody else needs a page granted by Digital Infrastructure
        first.
        <br />
        Trouble signing in? Ask Sahil Mohite, Digital Infrastructure &amp; Data.
      </p>
    </div>
  );
}

/* The door every route renders through: the sign-in screen while nobody is signed in, the console
   (rail, top bar, pane, drawer) once somebody is. */
export function Door({ children }: { children: React.ReactNode }) {
  const { state } = useConsole();
  if (!state.authed) {
    return (
      <div id="signin">
        <SignIn />
      </div>
    );
  }
  return <Shell>{children}</Shell>;
}
