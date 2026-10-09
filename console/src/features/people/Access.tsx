"use client";

/* TEMPORARY ACCESS, READ AS A LIST RATHER THAN A SETTING — vAccess,
   ir-console-redesigned.html:10902-10933.

   Live grants first, because those are the ones somebody could still be using; then everything that
   has ever been lent, with the number of actions taken under it, because that number is the reason
   the feature exists. A login is never shared: the page is lent, to one named person, for a stated
   window, with a reason — and never more than the lender holds. */

import { Tw } from "@/components/ui";
import { CAPT, PAGECAPS, TSTATE } from "@/domain";
import type { NavKey, TempGrant, TempStateRead } from "@/domain";
import { Pname } from "@/components/ui";
import { canManage, tLive, tState } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { tCanLend, tSeen } from "./helpers";

const HEAD = (
  <thead>
    <tr>
      <th>Member</th>
      <th>Page and reason</th>
      <th>Window</th>
      <th>Status</th>
      <th>Action</th>
    </tr>
  </thead>
);

export function Access() {
  const { state, dispatch } = useConsole();
  const seen = tSeen(state);
  const live = seen.filter((g) => tLive(state, g));
  const past = seen.filter((g) => !tLive(state, g));
  const lend = tCanLend(state);

  const Row = ({ g }: { g: TempGrant }) => {
    const st = tState(state, g) as TempStateRead;
    const n = g.acts || 0;
    const pc = (PAGECAPS as Record<string, { t: string } | undefined>)[g.page];
    return (
      <tr>
        <td>
          <Pname k={g.to} b nw />
          {g.to === state.WHO ? <> <span className="tag br">you</span></> : null}
          <div className="sm">Granted by {state.PEOPLE[g.by]?.n}</div>
        </td>
        <td className="sm">
          {pc ? pc.t : g.page}
          <div className="sm">{g.caps.map((c) => CAPT[c] || c).join(", ")}</div>
          <div className="sm">{g.why}</div>
        </td>
        <td className="sm mono">
          {String(g.from).slice(0, 6)} → {g.until}
        </td>
        <td>
          <span className={`tag ${st === "live" ? "go" : st === "revoked" ? "late" : ""}`}>
            <span className="dot" />
            {TSTATE[st]}
          </span>
          {st === "revoked" && g.on ? <div className="sm mono">{g.on}</div> : null}
          <div className="sm">{n} recorded actions</div>
        </td>
        <td style={{ textAlign: "right" }}>
          {st === "live" &&
          (g.by === state.WHO || g.to === state.WHO || (lend && canManage(state, g.to))) ? (
            <button
              type="button"
              className="chip"
              onClick={() => dispatch({ type: "revokeTemp", id: g.id })}
            >
              End access
            </button>
          ) : (
            <span className="sm">—</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="secw ux-team">
      <div className="card">
        <div className="ch">
          <h3>Active temporary access</h3>
          <div className="sp" />
          {lend ? (
            <button
              type="button"
              className="act"
              id="tlend"
              onClick={() => dispatch({ type: "startTemp", to: "" })}
            >
              Grant access
            </button>
          ) : (
            <span className="tag">view only</span>
          )}
        </div>
        <div className="cb">
          <p className="sm" style={{ margin: "0 0 10px" }}>
            Grant one page for a limited time. The member activates it from Profile; their actions
            keep an audit record.
          </p>
          {live.length ? (
            <Tw>
              <table>
                {HEAD}
                <tbody>
                  {live.map((g) => (
                    <Row g={g} key={g.id} />
                  ))}
                </tbody>
              </table>
            </Tw>
          ) : (
            <div className="empty">No active temporary access.</div>
          )}
        </div>
      </div>

      <details className="ux-disclosure" data-ux-key="teams-past-access">
        <summary>Previous grants · {past.length}</summary>
        <div className="card" style={{ marginTop: "8px" }}>
          <div className="ch">
            <h3>Access history</h3>
            <div className="sp" />
            <span className="sm">
              {past.length} closed ·{" "}
              {seen.reduce((a, g) => a + (g.acts || 0), 0)} actions recorded while a grant was on
            </span>
          </div>
          {past.length ? (
            <Tw>
              <table>
                {HEAD}
                <tbody>
                  {past.map((g) => (
                    <Row g={g} key={g.id} />
                  ))}
                </tbody>
              </table>
            </Tw>
          ) : (
            <div className="empty">No previous grants.</div>
          )}
        </div>
      </details>
    </div>
  );
}

/* the page's title, kept here so the tab count and the drawer read one name */
export const pageTitle = (p: string): string =>
  (PAGECAPS as Record<string, { t: string } | undefined>)[p as NavKey]?.t ?? p;
