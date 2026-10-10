"use client";

/* =================================================================================================
   THE SHELL — the prototype's <div class="app"> and its draw(). 02-body.html, and 03-app.js
   7022–7093 (draw), 7099–7112 (fillLast), 7113–7121 (go), 7161–7198 (the global keys).

   The prototype was one pane and a V[VIEW]() lookup. Here the URL is the router and this component
   is what the URL renders into: the rail, the top bar, the pane, and the drawer. VIEW is mirrored
   from the path into the store because a dozen reads in the prototype ask for it by name.
   ============================================================================================== */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { NavKey, PersonKey } from "@/domain";
import { RAGT } from "@/domain";
import { mgrOf, P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Drawer, DRW_DEFAULT_W } from "./Drawer";
import { drawerDef } from "./drawers";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { DataErrorBlock } from "./DataStatus";   /* M01-S03 */
import { findInvestor, landSafe, mayReach, navFor } from "./nav";
import { NAV_EVT, parentOf, pathOf, viewOf, type View } from "./routes";
import { useThemeSync } from "./ThemeButton";
import { curSide, MNote, useIm } from "@/features/im/host";
import { ImDrawer, DRAWERS as IMDRAWERS } from "@/features/im/drawers";
import { useDocked } from "./useDocked";
import { releaseStaleDocTitle } from "./useDocTitle";
import { Live } from "./Live";
import { LiveRoster } from "./LiveRoster";
import { LeadPage } from "@/features/lead/LeadPage";
import { EventPage } from "@/features/events";
import TodayRoute from "@/app/today/page";
import LeadsRoute from "@/app/leads/page";
import ActivityRoute from "@/app/activity/page";
import DocsRoute from "@/app/docs/page";
import PayRoute from "@/app/pay/page";
import NumbersRoute from "@/app/numbers/page";
import PeopleRoute from "@/app/people/page";
import SystemRoute from "@/app/system/page";
import XferRoute from "@/app/xfer/page";
import InvRoute from "@/app/inv/page";
import FarmsRoute from "@/app/farms/page";
import TktRoute from "@/app/tkt/page";
import InvupdRoute from "@/app/invupd/page";
import EventsRoute from "@/app/events/page";
import GoalsRoute from "@/app/goals/page";
import UpdatesRoute from "@/app/updates/page";
import MeRoute from "@/app/me/page";

/* the client routes the shell can draw ahead of their navigation (see pendingView below) */
const PENDING: Partial<Record<string, () => ReactNode>> = {
  today: TodayRoute, leads: LeadsRoute, activity: ActivityRoute, docs: DocsRoute, pay: PayRoute,
  numbers: NumbersRoute, people: PeopleRoute, system: SystemRoute, xfer: XferRoute,
  inv: InvRoute, farms: FarmsRoute, tkt: TktRoute, invupd: InvupdRoute, events: EventsRoute,
  goals: GoalsRoute, updates: UpdatesRoute, me: MeRoute,
};

/* the Investors drawer in the console's drawer slot — merge-glue.js vDrawer override */
function ImDrawerSlot() {
  const p = useIm();
  const docked = useDocked();
  useEffect(() => {
    if (!p.s.ui.DRW) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") p.dispatch({ type: "closeDrawer" }); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p]);
  return <ImDrawer {...p} docked={docked} />;
}

/* 03-app.js:7005 — which screens get the wide pane, and which get the narrow reading column */
const WIDE: readonly string[] = [
  "inv",
  "farms",
  "tkt",
  "invupd",
  "numbers",
  "system",
  "pay",
  "docs",
  "events",
  "event",
  "people",
  "goals",
  "activity",
  "updates",
  "leads",
];
const SOLO: readonly string[] = ["lead", "add", "me"];

export function Shell({ children }: { children: ReactNode }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const pathname = usePathname();
  const { view, id } = viewOf(pathname ?? "/");
  /* W6-KAM-2: a record's tab title never outlives its page, whichever way the person left it */
  useEffect(() => { releaseStaleDocTitle(pathname); }, [pathname]);
  /* THEME — reads/writes localStorage (try/catch) and the <html data-theme> attribute. Mounted
     once, here, rather than by whatever control happens to open the account menu. */
  useThemeSync();

  const nav = navFor(state);
  /* the route the signed-in person may not reach, and where they go instead */
  const blocked = view !== null && !mayReach(state, view);
  const land = landSafe(state, view);

  /* ---------------------------------------------------------------------------------------------
     THE ACCESS GATE. navFor() is the prototype's gate and go() applies it as a seat check, not just
     a hidden link (03-app.js:7116) — a person whose seat does not reach a screen is put back on
     their own landing page rather than shown a page with the controls greyed out.

     TODO(week-1 §1.3): this guard is the front end's half; the backend must refuse the same
     identity. A redirect in a layout keeps an honest person out of a screen that is not theirs; it
     does not keep anybody out of the data behind it, and STAGE-1 §1.3 is explicit that a role check
     must not be front-end-only. When the API exists, every route this redirects must also be
     refused server-side for the same person.
     ------------------------------------------------------------------------------------------ */
  /* (the effect itself sits below pendingView: a page already asked for — a rail press, or a
     "try them" chip that signs in as somebody else and opens a page — is not bounced back to the
     landing page while its own route is still on the way) */

  /* mirror the path into VIEW — a record screen reports the nav key it sits under, which is what
     navFor(), count() and the help drawer all read.

     This only corrects a mismatch that the URL itself caused (back/forward, a bare link) — it must
     not fight a `go()` a click handler already dispatched ahead of `router.push` (useGoLead sets
     VIEW to the destination before the route lands, so the drawer it opens in the meantime
     survives). Keyed on the path-derived `mirrored`/`view`/`id` only, so a VIEW change from that
     kind of go() does not by itself re-run this effect; state.VIEW is read from a ref instead of a
     dependency for exactly that reason — depending on it would re-fire on every such go() while the
     path is still stale, "correct" VIEW back, and drop whatever that go() just set. */
  const mirrored: NavKey | null = view === null ? null : parentOf(view);
  const viewSeenRef = useRef(state.VIEW);
  useEffect(() => {
    viewSeenRef.current = state.VIEW;
  });
  useEffect(() => {
    if (mirrored !== null && mirrored !== viewSeenRef.current) {
      dispatch({ type: "go", v: mirrored, ...(view === "lead" && id ? { id } : {}), ...(view === "event" && id ? { ev: id } : {}) });
    }
  }, [mirrored, view, id, dispatch]);

  /* the global keys — 03-app.js:7161. Escape and Tab belong to the drawer and live there. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName ?? "").toLowerCase();
      const typing = ["input", "textarea", "select"].includes(tag) || !!t?.isContentEditable;
      if (e.key === "?" && !typing) {
        e.preventDefault();
        dispatch({ type: "openDrawer", k: "help", id: view });
        return;
      }
      if (!((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing))) return;
      /* never leave a half-written anything behind */
      if (typing && !["lq", "fq"].includes(t?.id ?? "")) return;
      e.preventDefault();
      findInvestor(state, dispatch, (href) => router.push(href));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state, view, router, dispatch]);

  /* fillLast() — 03-app.js:7099. Dead space is a card problem, not a column problem: the last card
     in a column that is NOT already scrolling takes the slack, measured once per render after the
     DOM exists. Only a `.fill` THIS effect added is cleared before every measurement — unlike the
     prototype's innerHTML, this DOM survives the render that put it there, so an authored
     `class="card fill"` written directly in a page's own JSX (the prototype's static "card fill"
     markup, e.g. /system's checks-working card) must not be stripped by a later run that decides
     some other card is now the column's last one; `data-fillauto` marks only the cards this effect
     itself is responsible for. */
  useEffect(() => {
    const run = () => {
      document
        .querySelectorAll<HTMLElement>("#pane .card[data-fillauto]")
        .forEach((n) => {
          n.classList.remove("fill");
          n.removeAttribute("data-fillauto");
        });
      document
        .querySelectorAll<HTMLElement>(
          "#pane > .secw, #pane .cols>div, #pane .cols3>div, #pane .colsw>div," +
            " #pane .colsp>div, #pane .colst>div, #pane .colsl>div",
        )
        .forEach((c) => {
          if (c.scrollHeight > c.clientHeight + 1) return; /* already full — it scrolls */
          const cards = [...c.children].filter(
            (n): n is HTMLElement => n instanceof HTMLElement && n.classList.contains("card"),
          );
          if (!cards.length) return;
          const last = cards[cards.length - 1]!;
          /* only a card that holds a list can usefully take the slack */
          if (
            !last.querySelector(
              "table, .scroll, .notes, .q, .ticks, .lc, .hrow, .ckrow, .mini," +
                " .srow, .cal, .dialrow, .tpr, .upg",
            )
          )
            return;
          last.classList.add("fill");
          last.setAttribute("data-fillauto", "1");
        });
    };
    run();
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  });

  /* paneA11y() — 03-app.js:10804. Two things the markup cannot say for itself, said once over the
     rendered pane and drawer rather than at ninety call sites: a `tr.k` (a row that opens something
     on click) gets a real `button.row-open` inside its text cell, so a keyboard or screen-reader
     user has an actual control rather than a row with a stray click handler; and a lone `.rag` dot
     that carries neither a title nor adjacent words gets a visually-hidden `span.vh` naming its
     colour, using the same three words the legend uses everywhere else in this console. Ported
     without the prototype's `.secbar`/tabpanel wiring — SecBar.tsx already writes that pairing
     itself in JSX (see crossOwnerRequests if a page's secbar is found not to). */
  useEffect(() => {
    const run = () => {
      const roots = [document.getElementById("pane"), document.getElementById("drw")].filter(
        (n): n is HTMLElement => n != null,
      );
      roots.forEach((r) => {
        r.querySelectorAll<HTMLTableRowElement>("tr.k").forEach((tr) => {
          if (tr.querySelector("button.row-open")) return;
          const bold = tr.querySelector<HTMLElement>("td b,td strong");
          const cell = bold ? bold.closest<HTMLElement>("td") : tr.querySelector<HTMLElement>("td");
          if (!cell) return;
          const b = tr.ownerDocument.createElement("button");
          b.type = "button";
          b.className = "row-open";
          b.style.cssText =
            "font:inherit;color:var(--brand);background:none;border:0;padding:3px 0;cursor:pointer;text-align:left;min-height:24px";
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            tr.click();
          });
          if (bold && !bold.closest("button,a,[role=button]")) {
            b.setAttribute("aria-label", `Open ${bold.textContent?.trim() ?? ""}`);
            bold.parentNode?.insertBefore(b, bold);
            b.appendChild(bold);
          } else {
            b.textContent = "Open";
            b.setAttribute("aria-label", `Open ${tr.textContent?.trim().slice(0, 100) ?? ""}`);
            cell.appendChild(b);
          }
        });
        r.querySelectorAll<HTMLElement>(".rag").forEach((d) => {
          if (d.firstElementChild || d.textContent?.trim()) return;
          const title = d.getAttribute("title");
          const t =
            title ||
            (d.closest("td")
              ? d.classList.contains("green")
                ? RAGT.green
                : d.classList.contains("amber")
                  ? RAGT.amber
                  : d.classList.contains("red")
                    ? RAGT.red
                    : ""
              : "");
          if (!t) return;
          const near = (d.parentElement?.textContent ?? "").toLowerCase();
          if (near.includes(t.toLowerCase())) return;
          const s = d.ownerDocument.createElement("span");
          s.className = "vh";
          s.textContent = t;
          d.appendChild(s);
        });
      });
    };
    run();
  });

  /* railSync()'s two measurements — 03-app.js:13010. The rail's own height is content, not a
     constant (it wraps differently per seat and per width), and the header the pane scrolls under
     is sticky at its own measured height, not a guess. Both are read off the live DOM, same as
     fillLast above, and both default sensibly in console.css (`var(--railh,0px)`,
     `var(--top-h,72px)`) for the one frame before this runs. */
  useEffect(() => {
    const run = () => {
      const rail = document.querySelector<HTMLElement>(".rail");
      const top = document.querySelector<HTMLElement>(".top");
      const railSticky = !!rail && getComputedStyle(rail).position === "sticky" && window.innerWidth <= 900;
      document.documentElement.style.setProperty("--railh", `${railSticky ? Math.round(rail!.getBoundingClientRect().height) : 0}px`);
      if (top) document.documentElement.style.setProperty("--top-h", `${Math.ceil(top.getBoundingClientRect().height)}px`);
    };
    run();
    window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  });

  /* A lead opened by go() is drawn at once, ahead of its route: the prototype's go() was synchronous,
     while a dev-server navigation to /leads/[id] takes one to two seconds (lead page lane). Pending
     = a go() with a lead id happened since this path was reached, and the path is not a lead yet. */
  const seqAtPath = useRef<{ p: string | null; seq: unknown }>({ p: null, seq: null });
  if (seqAtPath.current.p !== pathname) seqAtPath.current = { p: pathname, seq: state.ui.NAVSEQ };
  const navLead = state.ui.NAVLEAD as string | null | undefined;
  const pendingLead = view !== "lead" && !blocked && navLead && state.ui.NAVSEQ !== seqAtPath.current.seq ? navLead : null;
  /* the same for a rail entry: Rail's onClick dispatches go(k) before its <Link> lands, so VIEW
     already names the page the person asked for — draw it rather than the one being left. The
     shell draws these pages itself before AND after the route lands, so the arrival does not
     remount the page under the person's pointer. */
  /* a seat whose go() the store refuses (an Investors-only seat) still clicked a rail <Link>: the
     link's own path names the page, until the route lands */
  const [clicked, setClicked] = useState<{ from: string | null; to: string } | null>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("nav a[href^='/']") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      setClicked({ from: window.location.pathname, to: a.getAttribute("href") || "" });
    };
    const onNav = (e: Event) => {
      const to = (e as CustomEvent<string>).detail;
      if (typeof to === "string") setClicked({ from: window.location.pathname, to });
    };
    /* capture phase: next/link's own onClick (run from React's root listener, before a bubbling
       document listener) calls preventDefault to navigate client-side, which would hide the press */
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_EVT, onNav);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NAV_EVT, onNav);
    };
  }, []);
  /* a click is about the path it was made on: once the path moves (the link landed, or back/forward
     went somewhere else) it is spent, so returning to that path later never replays it */
  useEffect(() => {
    if (clicked && clicked.from !== pathname) setClicked(null);
  }, [clicked, pathname]);
  const clickedView = clicked && clicked.from === pathname ? viewOf(clicked.to).view : null;
  const wantView = clickedView && clickedView !== view ? clickedView
    : state.ui.NAVSEQ !== seqAtPath.current.seq ? state.VIEW : null;   /* a go() since this path landed */
  const pendingView = !pendingLead && wantView && (!view || wantView !== parentOf(view)) && PENDING[wantView] && mayReach(state, wantView)
    ? wantView : null;
  const Pending = pendingView ? PENDING[pendingView]! : null;
  /* an event opened from the Events list is drawn by the shell both while its route is on the way and
     after it lands (the lead page's idiom), so the arrival does not remount the page and wipe what
     the person has already typed or picked on it */
  const evPend = state.ui.EVPEND as { id: string; seq: unknown } | null | undefined;
  const pendingEvent = view !== "event" && !blocked && evPend && evPend.seq === (state.ui.NAVSEQ ?? 0) && state.EVENTS.some((x) => x.id === evPend.id)
    ? evPend.id : null;
  const heading = !!(pendingLead || pendingView || pendingEvent);
  useEffect(() => {
    if (blocked && !heading) router.replace(pathOf(land, land === "lead" || land === "event" ? id ?? undefined : undefined));
  }, [blocked, heading, land, id, router]);
  const shown = pendingLead ? "lead" : pendingView || view;
  const side = shown ? curSide(state, parentOf(shown)) : "ir";
  const paneCls =
    "pane" + (side !== "ir" ? " wide" : shown && SOLO.includes(shown) ? " solo" : shown && WIDE.includes(shown) ? " wide" : "");
  const imW = !state.DRW && state.IMUI.DRW ? (IMDRAWERS[state.IMUI.DRW.k]?.w ?? 440) : null;
  const dw = state.DRW ? (drawerDef(state.DRW.k)?.w ?? DRW_DEFAULT_W) : imW;

  return (
    <>
      {/* the skip link — redesigned markup, above everything else in the DOM so it is the very
         first stop for a keyboard or screen-reader user, and invisible until it has focus */}
      <a className="rd-skip" href="#pane">
        Skip to main content
      </a>
      <div
        className={`app${state.DRW || imW != null ? " dk" : ""}${state.ui.RAILMIN ? " rc" : ""}`}
        style={dw != null ? ({ ["--dw" as string]: `${dw}px` } as CSSProperties) : undefined}
      >
        <Rail view={shown} />
        <div className="main">
          <TopBar side={side} view={shown ? parentOf(shown) : state.VIEW} />
          <main className={paneCls} id="pane" tabIndex={-1} key={state.WHO} data-side={side === "im" ? "im" : undefined}>
            <MNote />
            <DataErrorBlock />
            {nav.length === 0 && view !== "me" ? <NoScreens /> : blocked && !Pending ? null : pendingLead || (shown === "lead" && id) ? <LeadPage id={(pendingLead || id)!} />
              : pendingEvent || (view === "event" && id) ? <EventPage id={(pendingEvent || id)!} />
              : shown && PENDING[shown] ? (() => { const C = PENDING[shown]!; return <C />; })() : children}
          </main>
        </div>
        {state.DRW ? <Drawer /> : <ImDrawerSlot />}
      </div>
      {/* body.html: one polite live region for the whole console, outside the pane */}
      <Live />
      <LiveRoster />
    </>
  );
}

/* draw() — ir-merged.js 10769-10777: a screen the seat does not reach draws this, and says whose it
   is to change; the button opens the seat's first destination, when it has one */
function NoScreens() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const first = navFor(state).filter((n) => !n.bell)[0];
  return (
    <>
      <div className="ph">
        <h1>Nothing to show</h1>
      </div>
      <div className="card">
        <div className="empty">
          This screen is not one your seat reaches, so there is nothing on it to draw. A manager is the ceiling on
          what anybody reaches, which makes it {mgrOf(state.PEOPLE, state.WHO) ? P(state.PEOPLE, mgrOf(state.PEOPLE, state.WHO)!).n : "Digital Infrastructure"}
          &apos;s to change — there is no request to raise and no desk to ring.
          {first ? (
            <>
              <br />
              <button
                type="button"
                className="chip"
                style={{ marginTop: "10px" }}
                onClick={() => {
                  dispatch({ type: "go", v: first.k });
                  router.push(pathOf(first.k as View));
                }}
              >
                {`Open ${first.t.toLowerCase()}`}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
