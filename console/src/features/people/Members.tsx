"use client";

/* THE SAME PEOPLE AS A LIST — vMembers, ir-merged.js:8372-8406. D59 (g8): one way to open a
   member — the name is the button (keyboard and screen reader), the row is the same target for a mouse. Everything about
   ONE of them opens in the drawer, so this screen never splits into two columns the eye has to
   choose between. */

import { PAGECAPS } from "@/domain";
import type { PersonKey } from "@/domain";
import { Pname } from "@/components/ui";
import { avail, clashOf } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { MemberRow } from "@/lib/data/endpoints/teams";
import { capDev, devWhy, openPerson } from "./helpers";
import { LockIcon } from "./icons";

/* M17-S01-W1: the rows are GET /api/teams' members (endpoints/teams). The availability, clash and "changed"
   tags still read the book, and only where it holds the person (fixture mode; live they are absent in the
   rows — the person drawer carries them from GET /api/teams/{id}, M17-S01-W2). */
export function Members({ rows }: { rows: MemberRow[] }) {
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
              {rows.map((row) => {
                const k = row.id as PersonKey;
                const inBook = !!state.PEOPLE[k];
                const cl = inBook ? clashOf(state.PEOPLE, k) : [];
                const dev = inBook ? capDev(state, k) : [];
                const on = row.status === "active";
                const open = row.canOpen;
                const name = inBook ? <Pname k={k} b nw /> : <b>{row.name}</b>;
                return (
                  <tr
                    key={k}
                    style={on ? undefined : { opacity: 0.5 }}
                    className={open ? "k" : ""}
                    {...(open ? { onClick: () => dispatch(openPerson(k, row)) } : {})}
                  >
                    <td>
                      {open ? (
                        <button
                          type="button"
                          className="row-open g8-open"
                          id={`pm-${k}`}
                          aria-label={`Open ${row.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch(openPerson(k, row));
                          }}
                        >
                          {name}
                        </button>
                      ) : (
                        name
                      )}
                      {on ? null : <> <span className="tag">left</span></>}
                      {row.you ? <> <span className="tag br">you</span></> : null}
                      {inBook && on && !avail(state, k) ? <> <span className="tag cov">out</span></> : null}
                      {row.investorsSide ? (
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
                      {on && !row.loginHere ? <> <span className="tag">no login here</span></> : null}
                    </td>
                    <td className="sm">{row.seatLabel}</td>
                    <td className="sm">
                      {row.team ? (
                        <>
                          {row.team}{" "}
                          <span>· {row.managerName ? row.managerName.split(" ")[0] : "manager"}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="sm">
                      {row.pages} screens
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
                    <td className="n">{row.leads ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {on && !row.canOpen && !row.you ? (
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
