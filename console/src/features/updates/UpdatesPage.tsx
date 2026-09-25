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

   The redesign also moves the chronological feed behind a door (`doorRow`, 8487) instead of a
   second card sitting under the groups — see `./Feed`, used here only for the door's count and
   by `./drawer` as the panel's body.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { gNew, P, feedRows, navFor, unread, updateCount, updates } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { UiState } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { Chip } from "@/components/ui";
import "./drawer";

/* groups the prototype now keeps open and unhideable — they are true right now, not history, and
   only shown to the people who act on them, so there is nothing to collapse */
const ACTIONABLE = new Set(["owner", "move", "team", "access"]);

export function UpdatesPage() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });

  const g = updates(state), n = updateCount(state), u = unread(state);
  const NOPEN = state.ui.NOPEN ?? null;
  const canToday = navFor(state).some((x) => x.k === "today");

  /* say(msg) — 03-app.js:13258 writes only into the visually hidden `#live` (`class="vh"`,
     `aria-live="polite"`) — nothing appears on screen. The shell's own global one is still a
     crossOwnerRequest (see the note on `ui.NOTICE` in store.tsx); until it lands, this reads the
     string the same way — shown to a screen reader only, then cleared — rather than as a visible
     banner nobody asked for. */
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
          {n ? "the last 7 days on your leads" + (u ? " · " + u + " new" : "") : "nothing new"}
        </span>
        <div className="sp" />
        {!!u && <Chip onClick={() => dispatch({ type: "markRead" })}>Mark all as read</Chip>}
      </div>

      {state.ui.NOTICE && (
        <p className="vh" role="status" aria-live="polite" aria-atomic="true">{state.ui.NOTICE}</p>
      )}

      {/* the redesign drops the two-column layout for a single `<section>` — no more `colst`
         split (`vUpdatesSide` stays dead code, see the file note above) — and the door row below
         renders whether or not there are any groups, so it sits inside this section rather than
         inside the ternary. ir-console-redesigned.html:8449, 8487–8489. */}
      <section className="ux-updates ux-section">
      {!g.length
        ? (
          <div className="card">
            <div className="empty">
              No new changes from the team. Finance confirmations, cover and ownership changes
              appear here.
              {canToday && (
                <>
                  <br />
                  <Chip style={{ marginTop: "10px" }} onClick={() => router.push(pathOf("today"))}>
                    Open my day
                  </Chip>
                </>
              )}
            </div>
          </div>
        )
        : (
          <>
            <div className="card"><div className="cb" style={{ padding: 0 }}>
              {g.map((x) => {
                const actionable = ACTIONABLE.has(x.k);
                const expanded = actionable || NOPEN === x.k;
                /* openGroup(k) — 03-app.js:8435. Closing reads nothing; opening is reading it —
                   the only way a bell that counts news comes down without a blanket sweep. */
                const toggle = () => {
                  if (NOPEN === x.k) { set({ NOPEN: null }); return; }
                  set({ NOPEN: x.k });
                  dispatch({ type: "markRead", k: x.k });
                };
                return (
                  <div className={`upg ${expanded ? "open" : ""}`} key={x.k}>
                    <div className="uph" role="button" tabIndex={0} onClick={toggle}
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
                      {!actionable && <span className="chev">{expanded ? "▴" : "▾"}</span>}
                    </div>
                    {expanded && (
                      <div className="tw"><table><tbody>
                        {x.rows.map((r, i) => {
                          const l = r.lead ? state.LEADS.find((y) => y.id === r.lead) : undefined;
                          return (
                            <tr key={(r.lead ?? r.n ?? "row") + "-" + i}
                              {...(l
                                ? {
                                  className: "k", tabIndex: 0,
                                  onClick: () => router.push(pathOf("lead", r.lead ?? undefined)),
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
                      </tbody></table></div>
                    )}
                  </div>
                );
              })}
            </div></div>

            <p className="sm" style={{ marginTop: "10px" }}>
              Open an investor to review the change or resolve the request.
            </p>
          </>
        )}
      <FeedDoor />
      </section>
    </>
  );
}

/* the door onto the feed panel — rendered whether or not there are any groups above it.
   ir-console-redesigned.html:8487-8488 (`doorRow`), 2522 (`doorRow`'s own markup). */
function FeedDoor() {
  const { state, dispatch } = useConsole();
  const n = feedRows(state).length;
  const open = state.DRW?.k === "p:updates.feed";
  return (
    <div className="doors">
      <button type="button" className={`door ${open ? "on" : ""}`} id="door-updates-feed"
        aria-haspopup="dialog" aria-expanded={open ? "true" : "false"} title="Opens below"
        onClick={() => dispatch({ type: "openDrawer", k: "p:updates.feed" })}>
        <span className="dt">
          <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          Update history
        </span>
        <span className={`dv ${n ? "" : "q"}`}>{n ? `${n} in seven days` : "nothing yet"}</span>
      </button>
    </div>
  );
}
