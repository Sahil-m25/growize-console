"use client";

/* =================================================================================================
   THE RAIL — the brand, the destinations, and the note at the bottom. 02-body.html 3–8, and the
   nav that fills it, draw() 13109–13139 of the redesigned prototype.

   Every destination carries the number that would make you open it, counted off the same list the
   screen it points at draws. Only Today and Leads ever go red — navHot() is "owned AND breached",
   never a static list — and a destination that is scoped opens, when you are on it, into the
   personal/team switch: the choice is put where the question is, rather than on a control at the
   top of the page. Eight rows or more, in three bands or more, get a heading over each band
   (NAVSEC/NAVSECT/NAVSECOF, draw() 13109–13114); a shorter rail — an IR's six rows — stays flat.
   ============================================================================================== */

import { Fragment } from "react";
import Link from "next/link";
import type { NavKey } from "@/domain";
import { scopeOf } from "@/lib/selectors";
import { sidesOf } from "@/lib/selectors/access";
import { useApiRead } from "@/lib/data/api";
import { documentsOutCount } from "@/lib/data/endpoints/documents";
import { useConsole } from "@/lib/store";
import { Icon, type IconName } from "@/components/ui";
import { dLabel } from "@/lib/format";
import { SUBSCOPES, count, navFor, navHot, navTip, scopeCount, scopedRow } from "./nav";
import { pathOf, type View } from "./routes";

/* Updates and Profile are reached from the top bar's bell and account menu, not a rail row
   (NAV's `bell`/`menu` flags — ir-console-redesigned.html:2568-2593), and Capture no longer earns
   a row at all. NAV's own `bell`/`menu` flags cover the first two already; "add" has no flag yet
   to say the same, so it is named here until that lands — see crossOwnerRequests. */
const RAIL_HIDDEN: readonly string[] = ["add"];

/* The redesign's own relabelling (ir-console-redesigned.html:2568-2593) that @/domain's NAV has
   not picked up yet — see crossOwnerRequests. Kept to the two rows that actually changed. */
const LABEL_OVERRIDE: Partial<Record<string, string>> = { today: "Today", people: "Teams" };

/* NAVSEC/NAVSECT/NAVSECOF — ir-console-redesigned.html:12999-13005 */
/* merge-glue.js:74-77 — the Investors band sits second */
const NAVSEC = ["work", "invest", "money", "measure", "admin"] as const;
const NAVSECT: Record<(typeof NAVSEC)[number], string> = {
  work: "Work",
  invest: "Investors",
  money: "Money and paper",
  measure: "Measure",
  admin: "Admin",
};
const NAVSECOF: Partial<Record<string, (typeof NAVSEC)[number]>> = {
  today: "work", leads: "work", activity: "work", events: "work",
  pay: "money", docs: "money", xfer: "money",
  goals: "measure", numbers: "measure",
  people: "admin", system: "admin", me: "admin",
  inv: "invest", farms: "invest", tkt: "invest", invupd: "invest",
};
const navSec = (k: string) => NAVSECOF[k] ?? "work";

export function Rail({ view }: { view: View | null }) {
  const { state, dispatch } = useConsole();
  /* M12-S03-W1: the Documents badge on the Investors side is the route's outCount (fixture: the book's own count) */
  const docsIm = sidesOf(state, "docs").im && !sidesOf(state, "docs").ir;
  const docsOut = useApiRead(documentsOutCount, count(state, "docs"), docsIm);
  const railMin = state.ui.RAILMIN;
  /* setRail(on) — 03-app.js:7082. A furniture choice for this visit, not domain state: it is NOT
     reset by "go", which is why it lives in ui and is written with setUi rather than a case of its
     own. Below 901px the rail is already a horizontal strip with no column to narrow — the control
     still renders (console.css hides it there) so its focus and aria-expanded stay predictable. */
  const toggleRail = () => dispatch({ type: "setUi", patch: { RAILMIN: !railMin } });

  const nrows = navFor(state).filter((n) => !n.bell && !n.menu && !RAIL_HIDDEN.includes(n.k as string));
  const nband = NAVSEC.filter((s) => nrows.some((n) => navSec(n.k as string) === s));
  /* headings only when the rail is long enough to need sorting — 03-app.js:13113. Rows always
     walk band order (nband), whether or not a heading is drawn over each band — a five-row rail
     with no headings still groups Today/Leads/Activity/Events before Pay/Docs/Xfer, it just does
     not label the groups. */
  const nhead = nrows.length >= 8 && nband.length >= 3;
  const bands = nband;
  const rowsOf = (s: string) => nrows.filter((n) => navSec(n.k as string) === s);

  return (
    <aside className="rail">
      <div className="brand">
        <div className="mark">GZ</div>
        <div>
          <b>Growize Console</b>
          <span>Leads · Investors</span>
        </div>
        <button
          type="button"
          className="railt"
          id="railt"
          aria-controls="nav"
          aria-expanded={!railMin}
          aria-label={railMin ? "Expand the sidebar" : "Collapse the sidebar"}
          title={railMin ? "Expand the sidebar" : "Collapse the sidebar"}
          onClick={toggleRail}
        >
          <Icon name="rail" />
        </button>
      </div>
      <nav id="nav" aria-label="Workspace navigation">
        {bands.map((s) => (
          <Fragment key={s}>
            {nhead ? (
              <div className="navh" role="heading" aria-level={2}>
                {NAVSECT[s]}
              </div>
            ) : null}
            {rowsOf(s).map((n) => {
              const k = n.k as NavKey;
              const here =
                view === k || (view === "lead" && k === "leads") || (view === "event" && k === "events");
              const c = k === "docs" && docsIm && docsOut.state === "ok" ? docsOut.data.outCount : count(state, k);
              const hot = navHot(state, k);
              const scoped = scopedRow(state, n);
              /* only "today" and "leads" carry the switch; NAV's `scoped` flag is what says so */
              const sk0 = k as "today" | "leads" | "activity";
              return (
                <Fragment key={k as string}>
                  <Link
                    className={here ? "on" : ""}
                    id={`nav-${k}`}
                    href={pathOf(k as View)}
                    role="button"
                    aria-current={here ? "page" : undefined}
                    aria-expanded={scoped ? here : undefined}
                    onClick={() => dispatch({ type: "go", v: k })}
                  >
                    <Icon name={k as IconName} />
                    <span className="nt">{LABEL_OVERRIDE[k as string] ?? n.t}</span>
                    {scoped && !here ? (
                      <span className="cv">{scopeOf(state, sk0) === "team" ? "Team" : "Personal"}</span>
                    ) : null}
                    {c > 0 ? (
                      <span className={`n ${hot ? "hot" : ""}`} title={navTip(state, k, c)}>
                        {c}
                      </span>
                    ) : null}
                  </Link>
                  {scoped && here ? (
                    /* open on the section you are in, so the choice is where the question is. The
                       row keeps its badge while it is open — 03-app.js:13129 */
                    <div className="sub2">
                      {SUBSCOPES.map(([sk, t]) => {
                        const on = scopeOf(state, sk0) === sk;
                        const cc = scopeCount(state, k as "today" | "leads", sk);
                        return (
                          <Link
                            key={sk}
                            className={on ? "on" : ""}
                            href={pathOf(k as View)}
                            role="button"
                            aria-pressed={on}
                            onClick={() => {
                              dispatch({ type: "setScope", view: sk0, to: sk });
                              dispatch({ type: "go", v: k });
                            }}
                          >
                            <span className="nt">{t}</span>
                            {cc > 0 ? (
                              <span className={`n ${navHot(state, k, sk) ? "hot" : ""}`} title={navTip(state, k, cc, sk)}>
                                {cc}
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </nav>
      {/* foot — draw() 13166: `Sample data · ${dLabel(NOW)}` for every seat, IR included. The
         port's own "leads-db not built" note was never in the redesign; dropped rather than kept
         beside a string the prototype does show. */}
      <div className="foot" id="foot">
        {/* the demo book is "Sample data" only in fixture mode; the product's own book is not */}
        <span>{state.FIXTURES ? `Sample data · ${dLabel(state.NOW)}` : dLabel(state.NOW)}</span>
        {/* merge-glue.js:150 — prototype documentation, shown only beside the demo book */}
        {state.FIXTURES ? (
        <a
          className="mnlink"
          role="button"
          tabIndex={0}
          onClick={() => dispatch({ type: "openDrawer", k: "p:merge.notes" })}
          onKeyDown={(e) => {
            if (e.key === "Enter") dispatch({ type: "openDrawer", k: "p:merge.notes" });
          }}
        >
          How the merge works
        </a>
        ) : null}
      </div>
    </aside>
  );
}
