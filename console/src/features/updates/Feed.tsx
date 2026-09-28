"use client";

/* the specific version, kept under the generic one: every action somebody else took on this book in
   the last seven days, in order, one tap from the record. It reads the same book the groups on
   `UpdatesPage` do, so the two halves of one screen cannot describe two different weeks.
   ir-console-redesigned.html:8495 (`vFeed`).

   Its own file, not a function inside `UpdatesPage.tsx`: the redesign moved it behind a door
   (`doorRow`, 8487-8488) into `PANELS["updates.feed"]`, so both `UpdatesPage` (for the door's
   count) and `./drawer` (for the panel body) need it, and neither should import the other. */

import { Fragment } from "react";
import { useRouter } from "next/navigation";
import { dLabel } from "@/lib/format";
import { P, feedRows, feedScope, logNote, navFor } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { Chip } from "@/components/ui";
import { useGoLead } from "@/features/leads/nav";

/* vFeed() — ir-merged.js:6260. D59 g3: the drawer title is the only heading; the subtitle carries
   the scope and the count, so the body no longer repeats "Update history" inside itself. */
export function Feed() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const goLead = useGoLead("updates");
  const rows = feedRows(state);
  const canActivity = navFor(state).some((x) => x.k === "activity");
  let day = "";

  return rows.length
    ? (
      <div className="tw"><table><tbody>
        {rows.map((e, i) => {
          const note = logNote(state, e);
          const l = state.LEADS.find((x) => x.id === e.lead);
          const hd = e.d !== day ? (day = e.d, true) : false;
          const go = () => { if (l) goLead(l.id); };
          return (
            <Fragment key={e.d + e.at + i}>
              {hd && (
                <tr><td colSpan={3} className="lbl"
                  style={{ padding: "10px 12px 3px", border: 0 }}>
                  {dLabel(new Date(e.d + "T00:00:00"))}
                </td></tr>
              )}
              <tr className="k" tabIndex={0} onClick={go}
                onKeyDown={(ev) => { if (ev.key === "Enter") go(); }}>
                <td className="sm mono" style={{ width: "54px" }}>{e.at.slice(7)}</td>
                <td>
                  <b>{e.what}</b>{note ? <> <span className="sm">{note}</span></> : null}
                  <div className="sm">
                    {P(state.PEOPLE, e.who).n.split(" ")[0]} · {l ? l.n : "—"}
                  </div>
                </td>
                <td className="sm" style={{ width: "24px", textAlign: "right", color: "var(--ink-3)" }}>›</td>
              </tr>
            </Fragment>
          );
        })}
      </tbody></table></div>
    )
    : (
      <div className="empty">
        Nobody else has touched {feedScope(state)} in the last seven days. Your own work is on Activity.
        {canActivity && (
          <>
            <br />
            <Chip style={{ marginTop: "10px" }} onClick={() => {
              dispatch({ type: "closeDrawer" }); dispatch({ type: "go", v: "activity" }); router.push(pathOf("activity"));
            }}>
              Open activity
            </Chip>
          </>
        )}
      </div>
    );
}
