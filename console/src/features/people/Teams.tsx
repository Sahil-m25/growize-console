"use client";

/* THE ORG AS IT ACTUALLY IS — a manager, and the people appointed under them. vTeams,
   ir-console-redesigned.html:10785-10848.

   Three layers decide what somebody can do and they are never mixed up: the manager bounds which
   pages they reach, the seat decides what they may do there, and a person may only hand out
   something they hold themselves. A seat that asks for a page its chain cannot reach is a CLASH —
   named here rather than quietly dropped. */

import { SEAT } from "@/domain";
import type { Person, PersonKey, SeatKey } from "@/domain";
import { Ag, Pav, Pname } from "@/components/ui";
import {
  avail,
  canManage,
  clashOf,
  isMgr,
  mgrOf,
  logNote,
  P,
  roleOf,
  teamName,
  teamAuditRows,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { openPerson, screenCount, screensOf } from "./helpers";
import { LockIcon } from "./icons";

/* the prototype's membersOf/teamsList read `PEOPLE[x].on` — anyone active, including an external
   account with no console login of their own (Harsha Bhat, Finance) shown as a locked mcard. The
   port's shared `@/lib/selectors` membersOf/teamsList filter on `consoleAccount` instead, which
   drops exactly that member from the card. Cross-owner: src/lib/selectors/access.ts:200-214 should
   read `PEOPLE[x].on` the way this local copy does. ir-console-redesigned.html:2965. */
const membersOfLocal = (PEOPLE: Record<PersonKey, Person>, k: PersonKey): PersonKey[] =>
  (Object.keys(PEOPLE) as PersonKey[]).filter((x) => PEOPLE[x].on && PEOPLE[x].mgr === k);

type TeamRowLocal = { mgr: PersonKey; members: PersonKey[]; clash: number };
const teamsListLocal = (PEOPLE: Record<PersonKey, Person>): TeamRowLocal[] =>
  (Object.keys(PEOPLE) as PersonKey[])
    .filter((k) => PEOPLE[k].on && isMgr(PEOPLE, k))
    .map((k) => ({
      mgr: k,
      members: membersOfLocal(PEOPLE, k),
      clash: membersOfLocal(PEOPLE, k).filter((x) => clashOf(PEOPLE, x).length).length,
    }))
    .sort(
      (a, b) => b.members.length - a.members.length || P(PEOPLE, a.mgr).n.localeCompare(P(PEOPLE, b.mgr).n),
    );

export function Teams({ scope, sel }: { scope: PersonKey[]; sel: PersonKey | null }) {
  const { state, dispatch } = useConsole();
  const inScope = (k: PersonKey) => scope.indexOf(k) >= 0;
  const teams = teamsListLocal(state.PEOPLE).filter((t) => inScope(t.mgr) || t.members.some(inScope));
  const loose = scope.filter(
    (k) => state.PEOPLE[k].on && !mgrOf(state.PEOPLE, k) && !isMgr(state.PEOPLE, k),
  );

  /* somebody outside your own access is still on the team card — the shape of the org is not a
     secret — but it is not a button, because opening it would do nothing */
  const MemberCard = ({ k }: { k: PersonKey }) => {
    const mine = k === state.WHO || canManage(state, k);
    const cl = clashOf(state.PEOPLE, k);
    const inner = (
      <>
        <Pav k={k} />
        <span className="mt">
          <b>{P(state.PEOPLE, k).n}</b>
          <span>{SEAT[roleOf(state.PEOPLE, k) as SeatKey] || "—"}</span>
        </span>
        {cl.length ? (
          <span className="tag late" title="Their seat asks for a page this team cannot reach">
            !
          </span>
        ) : !avail(state, k) ? (
          <span className="tag cov">out</span>
        ) : !mine ? (
          <span className="tag" title="Outside your own access" aria-label="Outside your own access">
            <LockIcon />
          </span>
        ) : null}
      </>
    );
    return mine ? (
      <button
        type="button"
        className={`mcard ${sel === k ? "on" : ""}`}
        id={`mc-${k}`}
        onClick={() => dispatch(openPerson(k))}
      >
        {inner}
      </button>
    ) : (
      <span
        className={`mcard ${sel === k ? "on" : ""}`}
        style={{ cursor: "default", opacity: 0.72 }}
        title="Outside your own access"
      >
        {inner}
      </span>
    );
  };

  /* every change to a seat, a team or somebody's grid, with a name on it — never a lead-side entry
     that happens to share the "admin" kind */
  const rows = teamAuditRows(state)
    .filter((e) => e.kind === "admin" && /seat|access|report|member|team/i.test(e.what))
    .slice(0, 12);

  return (
    <div className="secw ux-team">
      {teams.map((t) => (
        <div className="tmc" key={t.mgr}>
          <div className="tmh">
            <Pav k={t.mgr} size="lg" />
            <div style={{ minWidth: 0 }}>
              <b>{teamName(state.PEOPLE, t.mgr)}</b>
              <div className="sm">
                {P(state.PEOPLE, t.mgr).n} · {SEAT[roleOf(state.PEOPLE, t.mgr) as SeatKey] || ""}
              </div>
            </div>
            <div className="sp" />
            <span className="sm">
              {t.members.length} member{t.members.length === 1 ? "" : "s"} · reaches{" "}
              {screensOf(state, t.mgr).length} of {screenCount()} screens
            </span>
            {t.clash ? (
              <span className="tag late">
                <span className="dot" />
                {t.clash} beyond the ceiling
              </span>
            ) : null}
            {t.mgr === state.WHO || canManage(state, t.mgr) ? (
              <button
                type="button"
                className="chip"
                id={`tm-${t.mgr}`}
                onClick={() => dispatch(openPerson(t.mgr))}
              >
                Open {P(state.PEOPLE, t.mgr).n.split(" ")[0]}
              </button>
            ) : (
              <span className="tag" title="Outside your own access" aria-label="Outside your own access">
                <LockIcon />
              </span>
            )}
          </div>
          <div className="tmm">
            {t.members.length ? (
              t.members.map((k) => <MemberCard k={k} key={k} />)
            ) : (
              <span className="sm">Nobody appointed here yet.</span>
            )}
          </div>
        </div>
      ))}

      {loose.length ? (
        <div className="tmc">
          <div className="tmh">
            <b>Not on a team</b>
            <div className="sp" />
            <span className="sm">nobody above them, nobody under them</span>
          </div>
          <div className="tmm">
            {loose.map((k) => (
              <MemberCard k={k} key={k} />
            ))}
          </div>
        </div>
      ) : null}

      <details className="ux-disclosure" data-ux-key="teams-rules-history">
        <summary>Access rules and change history</summary>
        <div className="card">
          <div className="ch">
            <h3>How access works</h3>
          </div>
          <div className="cb">
            <div className="ticks">
              <div className="tk on">
                <span className="box">1</span>
                <span className="t">The manager is the ceiling on what somebody reaches</span>
                <time>pages, not permissions</time>
              </div>
              <div className="tk on">
                <span className="box">2</span>
                <span className="t">The seat decides what they may do on the pages they reach</span>
                <time>Finance records payments; their manager does not</time>
              </div>
              <div className="tk on">
                <span className="box">3</span>
                <span className="t">A person may only hand out something they hold themselves</span>
                <time>a grant is a subset, never a promotion</time>
              </div>
            </div>
            <p className="sm" style={{ margin: "12px 0 0" }}>
              A role must fit the manager&apos;s access. Incompatible appointments are refused.
            </p>
          </div>
        </div>

        <div className="card fill">
          <div className="ch">
            <h3>Changes to seats, teams and access</h3>
            <div className="sp" />
            <span className="sm">every one of them, with a name on it</span>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">
                    <span className="vh">Kind</span>
                  </th>
                  <th scope="col">Who</th>
                  <th scope="col">What changed</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td className="sm mono nw" style={{ width: "104px" }}>
                        {e.at}
                      </td>
                      <td style={{ width: "24px" }}>
                        <Ag k={e.kind} t={e.what} />
                      </td>
                      <td className="sm">
                        <Pname k={e.who} nw cls="xs" />
                      </td>
                      <td>
                        <b>{e.what}</b>
                        {logNote(state, e) ? <div className="sm">{logNote(state, e)}</div> : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      No team or access changes recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
