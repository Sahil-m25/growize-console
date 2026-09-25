"use client";

/* SYSTEM — what the machine is doing. vSystem, redesigned prototype `ir-console-redesigned.html`
   10643–10768.

   Every check is here — the ones that pass first, because they are the majority — each with WHO
   owns it, WHAT breaks if it stops, and the last three weeks drawn out. A health page that opens on
   the good news is not a health page, so this one opens on whatever is amber or red and lands on
   Working only when there is nothing else to land on. "Who can do what" is no longer a hand-kept
   grid: it reads the same SEATCAPS preset every seat is actually built from, one role at a time, so
   the page and the access model can never drift apart. Reached by Digital Infrastructure and
   Corporate Operations, and nobody else. */

import { CAPT, CHECKS, CKDAYS, CKS, IMP, PAGECAPS, SEAT, SEATCAPS } from "@/domain";
import type { Check, PersonKey, SeatKey } from "@/domain";
import { useRouter } from "next/navigation";
import { ActLegend, Ag, Card, Empty, Pname } from "@/components/ui";
import { pathOf } from "@/components/shell/routes";
import { logNote, may, openable, own, P, systemRows } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { ckDays, ckFromT } from "./checks";
import "./drawers";

type SC = "ok" | "bad" | "grid" | "log";

export function SystemPage() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const okC = CHECKS.filter((c) => c.st === "ok");
  const warnC = CHECKS.filter((c) => c.st === "warn");
  const failC = CHECKS.filter((c) => c.st === "fail");
  const SECS: { k: SC; t: string; n: number }[] = [
    { k: "ok", t: "Working", n: okC.length },
    { k: "bad", t: "Findings", n: warnC.length + failC.length },
    { k: "grid", t: "Who can do what", n: 0 },
    { k: "log", t: "Activity", n: 0 },
  ];
  /* A health page that opens on the good news is not a health page: until somebody has picked a
     section for themselves this one opens on whatever is amber or red. 10648–10653. */
  const raw = state.SEC.system;
  const SC: SC = SECS.some((s) => s.k === raw)
    ? (raw as SC)
    : warnC.length + failC.length
      ? "bad"
      : "ok";
  const logs = systemRows(state);
  const book = openable(state);
  const LOGWHO = state.ui.LOGWHO as PersonKey | null;
  const actors = Array.from(new Set(logs.map((e) => e.who)));
  const rows = logs.filter((e) => !LOGWHO || e.who === LOGWHO);

  const Row = ({ c }: { c: Check }) => {
    const d = ckDays(c, state.NOW);
    const tip =
      c.st === "ok"
        ? "Days since the last day this check's own record says was not clean. Nothing on this page "
          + "is polled yet, so this is a run counted off the record — not a run of successful runs, "
          + "and not a time this check last succeeded."
        : "Days since the date on this check's own record. Nothing on this page is polled yet.";
    return (
      <div className="ckrow ux-checkrow">
        <span className={`tag ${CKS[c.st].c}`} title={CKS[c.st].t}>
          {CKS[c.st].g}
        </span>
        <span className="cn">
          <b>{c.t}</b>
          <span className="sm">{c.fix || c.w}</span>
        </span>
        <span className="sm nw" style={{ width: "150px", textAlign: "right" }} title={tip}>
          {d == null ? "—" : d + " day" + (d === 1 ? "" : "s") + (c.st === "ok" ? " clean" : " like this")}
          <br />
          <span>since {ckFromT(c, state.NOW)}</span>
        </span>
        <span className="sm ux-check-owner">{P(state.PEOPLE, c.own).n}</span>
        <button
          type="button"
          className="chip"
          style={{ padding: "2px 8px", fontSize: "var(--text-small)" }}
          id={`ck-${c.k}`}
          onClick={() => dispatch({ type: "openDrawer", k: "check", id: c.k })}
        >
          Details
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="ph">
        <h1>System</h1>
        <span className="sub">{may(state, "system", "edit") ? "you own this page" : "read only"}</span>
      </div>

      <div className="stats" style={{ marginBottom: "8px", gridTemplateColumns: "repeat(4,1fr)" }}>
        <div className="stat">
          <b style={{ color: "var(--go)" }}>{okC.length}</b>
          <span>working</span>
        </div>
        <div className={`stat ${warnC.length ? "bad" : ""}`}>
          <b>{warnC.length}</b>
          <span>need attention</span>
        </div>
        <div className={`stat ${failC.length ? "bad" : ""}`}>
          <b>{failC.length}</b>
          <span>not working</span>
        </div>
        <div className="stat">
          <b>{logs.length}</b>
          <span>logged actions</span>
        </div>
      </div>

      <div className="ux-toolbar ux-system" role="group" aria-label="System view">
        {SECS.slice(0, 2)
          .slice()
          .reverse()
          .map((s) => (
            <button
              type="button"
              key={s.k}
              className={`chip ${SC === s.k ? "on" : ""}`}
              aria-pressed={SC === s.k ? "true" : "false"}
              onClick={() => dispatch({ type: "setSec", view: "system", k: s.k })}
            >
              {s.t} · {s.n}
            </button>
          ))}
        <span className="sm">Prototype status data · no live polling</span>
      </div>

      <details className="ux-disclosure ux-system" data-ux-key="system-reference" open={SC === "grid" || SC === "log"}>
        <summary>Reference and admin tools</summary>
        <div className="ux-toolbar">
          <button
            type="button"
            className={`chip ${SC === "grid" ? "on" : ""}`}
            onClick={() => dispatch({ type: "setSec", view: "system", k: "grid" })}
          >
            Role permissions
          </button>
          <button
            type="button"
            className={`chip ${SC === "log" ? "on" : ""}`}
            onClick={() => dispatch({ type: "setSec", view: "system", k: "log" })}
          >
            System activity
          </button>
        </div>
        {own(state, "system", "edit") ? (
          <div className="ux-toolbar">
            <span className="sm">Prototype test: reject one write and show its retry state.</span>
            <button
              type="button"
              className={`chip ${state.FAILNEXT ? "on" : ""}`}
              id="failnext"
              role="switch"
              aria-checked={state.FAILNEXT}
              onClick={() => dispatch({ type: "armFail", v: !state.FAILNEXT })}
            >
              {state.FAILNEXT ? "Cancel failed-write test" : "Test a failed write"}
            </button>
          </div>
        ) : null}
      </details>

      <div className="secw ux-system">
        {SC === "ok" ? (
          <Card
            className="fill"
            title="Working"
            head={
              <>
                <span className="prov demo" title="The states and dates are the prototype's own record, not a live poll">
                  demo
                </span>
                <div className="sp" />
                <span className="sm">last {CKDAYS} days · oldest on the left</span>
              </>
            }
          >
            {okC.map((c) => (
              <Row c={c} key={c.k} />
            ))}
            <p className="sm" style={{ margin: "12px 0 0" }}>
              Open a check for its recorded history and owner.
            </p>
          </Card>
        ) : null}

        {SC === "bad" ? (
          <Card
            title="Not working"
            head={
              <>
                <div className="sp" />
                <span className="tag late">{failC.length}</span>
              </>
            }
          >
            {failC.length ? (
              failC.map((c) => <Row c={c} key={c.k} />)
            ) : (
              <div className="empty">
                No recorded check is failing.
                <br />
                <button
                  type="button"
                  className="chip"
                  style={{ marginTop: "10px" }}
                  onClick={() => dispatch({ type: "setSec", view: "system", k: "ok" })}
                >
                  Show the checks that work
                </button>
              </div>
            )}
          </Card>
        ) : null}

        {SC === "bad" ? (
          <Card
            className="fill"
            title="Needs attention"
            head={
              <>
                <div className="sp" />
                <span className="tag due">{warnC.length}</span>
              </>
            }
          >
            {warnC.length ? warnC.map((c) => <Row c={c} key={c.k} />) : <Empty>No recorded check needs attention.</Empty>}
          </Card>
        ) : null}

        {SC === "grid" ? (
          <Card className="fill" title="Role permissions">
            <p className="sm" style={{ margin: "0 0 12px" }}>
              Expand a role to see its preset. Member access also depends on their manager and individual
              grants. Finance works in the {IMP}.
            </p>
            {(Object.keys(SEAT) as SeatKey[]).map((seat) => {
              const caps = SEATCAPS[seat] || {};
              const pages = Object.keys(caps).filter((pg) => (caps[pg as keyof typeof caps] || []).length);
              return (
                <details className="ux-disclosure" data-ux-key={`system-role-${seat}`} key={seat}>
                  <summary>{SEAT[seat]}</summary>
                  <div className="tw">
                    <table>
                      <thead>
                        <tr>
                          <th>Page or capability group</th>
                          <th>Allowed actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pages.map((pg) => (
                          <tr key={pg}>
                            <td>{(PAGECAPS as Record<string, { t: string } | undefined>)[pg]?.t ?? pg}</td>
                            <td className="sm">
                              {(caps[pg as keyof typeof caps] || []).map((c) => CAPT[c] || c).join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              );
            })}
          </Card>
        ) : null}

        {SC === "log" ? (
          <Card
            className="fill"
            plain
            title="Activity — who did what"
            head={
              <>
                <div className="sp" />
                <span className="sm mono">
                  {LOGWHO ? `${rows.length} of ${logs.length} entries` : `${logs.length} entries`}
                </span>
              </>
            }
          >
            <div className="cb" style={{ paddingBottom: "6px" }}>
              <label className="fi" style={{ maxWidth: "300px" }}>
                <span>Activity by</span>
                <select
                  className="selw"
                  value={LOGWHO ?? ""}
                  onChange={(e) => dispatch({ type: "setUi", patch: { LOGWHO: e.target.value || null } })}
                >
                  <option value="">Accessible activity</option>
                  {actors.map((k) => (
                    <option value={k} key={k}>
                      {P(state.PEOPLE, k).n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th />
                    <th>Who</th>
                    <th>Did what</th>
                    <th>Lead</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? (
                    rows.slice(0, 60).map((e, i) => {
                      const l = book.find((x) => x.id === e.lead);
                      const note = logNote(state, e);
                      return (
                        <tr
                          key={`${e.at}-${i}`}
                          {...(l
                            ? { className: "k", tabIndex: 0, onClick: () => router.push(pathOf("lead", e.lead as string)) }
                            : {})}
                        >
                          <td className="sm mono" style={{ width: "110px" }}>
                            {e.at}
                          </td>
                          <td style={{ width: "24px" }}>
                            <Ag k={e.kind} t={e.what} />
                          </td>
                          <td className="sm">
                            <Pname k={e.who as PersonKey} nw cls="xs" />
                          </td>
                          <td>
                            <b>{e.what}</b>
                            {note ? <div className="sm">{note}</div> : null}
                          </td>
                          <td className="sm">{l ? l.n : "—"}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty">
                        {LOGWHO ? (
                          <>
                            {P(state.PEOPLE, LOGWHO).n} has written nothing into this console. That is not the
                            same as having done nothing — a seat that only reads leaves no line here.
                            <br />
                            <button
                              type="button"
                              className="chip"
                              style={{ marginTop: "10px" }}
                              onClick={() => dispatch({ type: "setUi", patch: { LOGWHO: null } })}
                            >
                              Show everyone
                            </button>
                          </>
                        ) : (
                          "Nothing has been written yet."
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="cb" style={{ paddingTop: "8px" }}>
              <ActLegend />
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
