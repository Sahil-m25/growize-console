"use client";

/* THE SAME PEOPLE AS A LIST — vMembers, ir-merged.js:8372-8406. D59 (g8): one way to open a
   member — the name is the button (keyboard and screen reader), the row is the same target for a mouse. Everything about
   ONE of them opens in the drawer, so this screen never splits into two columns the eye has to
   choose between. */

import { PAGECAPS, SEAT } from "@/domain";
import type { PersonKey } from "@/domain";
import { Pname } from "@/components/ui";
import {
  avail,
  canManage,
  clashOf,
  mgrOf,
  P,
  teamName,
  teamOfPerson,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { capDev, devWhy, openPerson, screensOf } from "./helpers";
import { LockIcon } from "./icons";

export function Members({ scope }: { scope: PersonKey[] }) {
  const { state, dispatch } = useConsole();

  return (
    <div className="secw ux-team">
      <div className="card fill">
        <div className="ch">
          <h3>Members</h3>
          <div className="sp" />
          <span className="sm">Open a member for availability, role and access</span>
        </div>
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Seat</th>
                <th>Team</th>
                <th>Reaches</th>
                <th className="n">Leads</th>
                <th>
                  <span className="vh">Access</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {scope.map((k) => {
                const pp = state.PEOPLE[k];
                const t = teamOfPerson(state.PEOPLE, k);
                const cl = clashOf(state.PEOPLE, k);
                const dev = capDev(state, k);
                const open = pp.on && canManage(state, k);
                const mgr = mgrOf(state.PEOPLE, k);
                return (
                  <tr
                    key={k}
                    style={pp.on ? undefined : { opacity: 0.5 }}
                    className={open ? "k" : ""}
                    {...(open ? { onClick: () => dispatch(openPerson(k)) } : {})}
                  >
                    <td>
                      {open ? (
                        <button
                          type="button"
                          className="row-open g8-open"
                          id={`pm-${k}`}
                          aria-label={`Open ${P(state.PEOPLE, k).n}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch(openPerson(k));
                          }}
                        >
                          <Pname k={k} b nw />
                        </button>
                      ) : (
                        <Pname k={k} b nw />
                      )}
                      {pp.on ? null : <> <span className="tag">left</span></>}
                      {k === state.WHO ? <> <span className="tag br">you</span></> : null}
                      {!avail(state, k) && pp.on ? <> <span className="tag cov">out</span></> : null}
                      {pp.ext ? (
                        <>
                          {" "}
                          <span
                            className="tag"
                            title="Works the Investors pages of this console and holds no lead pages"
                          >
                            Investors side
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="sm">{SEAT[pp.seat]}</td>
                    <td className="sm">
                      {t ? (
                        <>
                          {teamName(state.PEOPLE, t)}{" "}
                          <span>· {mgr ? P(state.PEOPLE, mgr).n.split(" ")[0] : "manager"}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sm">
                      {screensOf(state, k).length} screens
                      {cl.length ? (
                        <>
                          {" "}
                          <span
                            className="tag late"
                            title={`Their seat asks for ${cl
                              .map((x) => (PAGECAPS as Record<string, { t: string }>)[x]?.t ?? x)
                              .join(", ")}, which their team cannot reach`}
                          >
                            −{cl.length}
                          </span>
                        </>
                      ) : null}
                      {dev.length ? (
                        <>
                          {" "}
                          <span className="tag br" title={devWhy(state, k)}>
                            {dev.length} changed
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="n">{state.LEADS.filter((l) => l.own === k).length}</td>
                    <td style={{ textAlign: "right" }}>
                      {pp.on && !canManage(state, k) && k !== state.WHO ? (
                        <span className="tag" title="Above your own access" aria-label="Above your own access">
                          <LockIcon />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
