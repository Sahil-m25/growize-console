"use client";

/* ── UPDATES — generic until you ask for specifics ───────────────────────────────────────────
   Ports `prototype/ir-console-redesigned.html` 8442–8493 (`vUpdates`) and 8495–8514 (`vFeed`).
   The groups themselves are `updates()` in `@/lib/selectors`; `markRead` is the store's. The bell
   drawer (`DRAWERS.updates`, 12053–12064) and the `updates.feed` panel (`PANELS`, 8434) both live
   in `./drawer`, registered from there and imported below for the side effect.

   "You are told THAT something happened and to how many leads. Names, amounts and documents stay
   one tap away, on the lead itself — this screen is for knowing, not for working." Nothing here is
   a second store: every group is derived from the audit log and from lead state, so it can never
   disagree with the record. Unread is "since you last looked" (`NSEEN`), not a counter that drifts —
   which is what the rail's hot badge counts.

   The redesign dropped the two-column layout: `vUpdatesSide` (line 8515, `vDayside(...)`) is never
   called from the redesigned prototype's render loop (`pane.innerHTML = V[VIEW]()`, line 13168) —
   it is dead code left behind — so this page is single-column now, and a handful of the "state, not
   history" groups (owner/move/team) stay open and unhideable, labelled "Needs attention" instead of
   toggling like the rest.

   The merged prototype (ir-merged.js:6190 `vUpdates`) puts the chronological feed behind a
   "History · n" chip in the heading — see `./Feed`, the `updates.feed` panel's body.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Tw } from "@/components/ui";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { gNew, P, feedRows, feedScope, unread, updateCount, updates } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { UiState } from "@/lib/store";
import { pathOf } from "@/components/shell/routes";
import { Chip } from "@/components/ui";
import { useGoLead } from "@/features/leads/nav";
import { useMarkRead } from "@/lib/data/endpoints/ownership";
import "./drawer";

/* groups that are true right now, not history — "Needs attention" rather than "View updates" */
const ACTIONABLE = new Set(["owner", "move", "team", "access"]);

export function UpdatesPage() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const goLead = useGoLead("updates");
  /* C3: reading a group is POST /api/leads/updates/read (the person's own bookmark); fixture: the reducer's markRead */
  const markRead = useMarkRead();
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });

  const g = updates(state), n = updateCount(state), u = unread(state);
  const fn = feedRows(state).length;
  const NOPEN = state.ui.NOPEN ?? null;
  const feedOpen = state.DRW?.k === "p:updates.feed";
  /* D59 g3 (ir-merged.js:6194): a state group stays open only while it has something unread (or you
     opened it); once read — one group or "Mark all as read" — it folds like every other group. */
  const isOpen = (x: (typeof g)[number]) => NOPEN === x.k || (ACTIONABLE.has(x.k) && gNew(state, x) > 0);
  const anyRows = g.some((x) => isOpen(x) && x.rows.some((r) => r.lead));

  /* say(msg) writes only into the visually hidden live region — nothing appears on screen. */
  useEffect(() => {
    if (!state.ui.NOTICE) return;
    const t = setTimeout(() => set({ NOTICE: null }), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ui.NOTICE]);

  return (
    <>
      <div className="ph">
        <h1>Updates</h1>
        <span className="sub">
          {n ? "last 7 days on " + feedScope(state) + (u ? " · " + u + " new" : "") : "nothing new"}
        </span>
        <div className="sp" />
        {!!u && <Chip onClick={() => markRead()}>Mark all as read</Chip>}
        {!!fn && (
          <button type="button" className="chip" id="door-updates-feed" aria-haspopup="dialog"
            aria-expanded={feedOpen ? "true" : "false"}
            onClick={() => dispatch({ type: "openDrawer", k: "p:updates.feed" })}>
            History · {fn}
          </button>
        )}
      </div>

      {state.ui.NOTICE && (
        <p className="vh" role="status" aria-live="polite" aria-atomic="true">{state.ui.NOTICE}</p>
      )}

      <section className="ux-updates ux-section">
      {!g.length
        ? (
          <div className="card">
            <div className="empty">
              No new changes from the team. Finance confirmations,
              cover and ownership changes appear here.
            </div>
          </div>
        )
        : (
          <>
            <div className="card"><div className="cb" style={{ padding: 0 }}>
              {g.map((x) => {
                const actionable = ACTIONABLE.has(x.k);
                const expanded = isOpen(x);
                /* openGroup(k) — ir-merged.js:6187. Closing reads nothing; opening is reading it. A
                   state group held open only by its unread rows is read in place, not toggled. */
                const toggle = () => {
                  if (expanded && NOPEN !== x.k) { markRead(x.k); return; }
                  if (NOPEN === x.k) { set({ NOPEN: null }); return; }
                  set({ NOPEN: x.k });
                  markRead(x.k);
                };
                return (
                  <div className={`upg ${expanded ? "open" : ""}`} id={`upg-${x.k}`} key={x.k}>
                    <div className="uph" role="button" tabIndex={0} aria-expanded={expanded} onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
                      }}>
                      <span className={`upi ${x.tone}`}>{x.icon}</span>
                      <b>
                        {x.title} <span className="cnt">{x.rows.length}</span> {x.unit || "lead"}
                        {x.rows.length === 1 ? "" : "s"}
                      </b>
                      {!!gNew(state, x) && <span className="dotn" />}
                      <div className="sp" />
                      <span className="sm">
                        {actionable ? "Needs attention" : expanded ? "Collapse" : "View updates"}
                      </span>
                      <span className="chev">{expanded ? "▴" : "▾"}</span>
                    </div>
                    {expanded && (x.k === "owner" || x.k === "team") ? (
                      <div className="cb upl">
                        <span className="sm">{x.k === "owner"
                          ? "They are listed once, on Leads under 'Needs an owner'."
                          : "They are listed once, on Today in the team's queue."}</span>{" "}
                        <Chip onClick={() => {
                          if (x.k === "owner") { dispatch({ type: "go", v: "leads" }); router.push(pathOf("leads")); return; }
                          dispatch({ type: "setScope", view: "today", to: "team" });
                          dispatch({ type: "go", v: "today" });
                          router.push(pathOf("today"));
                        }}>{x.k === "owner" ? "Open Leads" : "Open Today"}</Chip>
                      </div>
                    ) : expanded ? (
                      <Tw><table><tbody>
                        {x.rows.map((r, i) => {
                          const l = r.lead ? state.LEADS.find((y) => y.id === r.lead) : undefined;
                          return (
                            <tr key={(r.lead ?? r.n ?? "row") + "-" + i}
                              {...(l
                                ? {
                                  className: "k", tabIndex: 0,
                                  onClick: () => goLead(l.id),
                                }
                                : {})}>
                              <td style={{ width: "190px" }}><b>{l ? l.n : r.n || "—"}</b></td>
                              <td className="sm">{r.what}{r.note ? " — " + r.note : ""}</td>
                              <td className="sm">
                                {r.who ? P(state.PEOPLE, r.who).n.split(" ")[0] : ""}
                              </td>
                              <td className="sm mono n" style={{ width: "96px" }}>{r.at || ""}</td>
                            </tr>
                          );
                        })}
                      </tbody></table></Tw>
                    ) : null}
                  </div>
                );
              })}
            </div></div>

            {anyRows && (
              <p className="sm" style={{ marginTop: "10px" }}>
                Open an investor to review the change or resolve the request.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
