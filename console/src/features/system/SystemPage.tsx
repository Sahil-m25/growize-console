"use client";

/* SYSTEM — what the machine is doing. vSystem, ir-merged.js:8059-8294.

   D59 (g8): System opens on what is broken and who owns the fix — the Not working and Needs
   attention cards appear only while they have something in them. Everything else is ONE row of
   doors, directly under the counts: the working checks, the role presets, the activity log (which
   carries the logged-action count that used to be a tile you could not click) and, for the page
   owner, the failed-write test. */

import { Tw } from "@/components/ui";
import { CAPT, CKDAYS, CKS, DEFSEATS, NOSIGN, PAGECAPS, SEAT, SEATCAPS } from "@/domain";
import type { Check, PersonKey, SeatKey } from "@/domain";
import { useRouter } from "next/navigation";
import { ActLegend, Ag, Pname } from "@/components/ui";
import { pathOf } from "@/components/shell/routes";
import { registerDrawer } from "@/components/shell/drawers/registry";
import type { DrawerKind } from "@/lib/store";
import { may, openable, own, P, systemRows } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useApiRead, type Read } from "@/lib/data/api";
import { logsRead } from "@/lib/data/endpoints/logs";
import { systemRead } from "@/lib/data/endpoints/system";
import { DoorRow } from "@/features/today/doors";
import { ckDays, ckFromT } from "./checks";
import "./drawers";

function Row({ c }: { c: Check }) {
  const { state, dispatch } = useConsole();
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
  }

const G8Demo = () => (
  <span className="prov demo" title="Prototype status data — the states and dates are the prototype's own record, not a live poll">
    demo
  </span>
);

function OkBody() {
  const { state } = useConsole();
  return (
    <div className="cb" style={{ padding: 0 }}>
      {state.CHECKS.filter((c) => c.st === "ok").map((c) => <Row c={c} key={c.k} />)}
      <p className="sm" style={{ margin: "12px 0 0" }}>
        Prototype status data, not a live poll. Open a check for its history and owner.
      </p>
    </div>
  );
}

function GridBody() {
  const seats = Object.keys(SEAT) as SeatKey[];
  const def = DEFSEATS as readonly string[], nos = NOSIGN as readonly string[];
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        Each role&apos;s default. Only IR, IR Manager and Digital Infrastructure sign in by default; anybody
        else has no access until Digital Infrastructure grants them pages, person by person. Finance,
        Account Management and the Auditor sign in to the Investors pages and hold no lead pages.
      </p>
      {seats.map((seat) => {
        const caps = (SEATCAPS[seat] || {}) as Record<string, string[]>;
        return (
          <details className="ux-disclosure" data-ux-key={`system-role-${seat}`} key={seat}>
            <summary>
              {SEAT[seat]}
              {def.includes(seat) ? "" : nos.includes(seat) ? " · Investors pages only" : " · by grant only"}
            </summary>
            {def.includes(seat) ? (
              <Tw>
                <table>
                  <thead>
                    <tr>
                      <th>Page or capability group</th>
                      <th>Allowed actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(caps)
                      .filter((pg) => (caps[pg] || []).length)
                      .map((pg) => (
                        <tr key={pg}>
                          <td>{(PAGECAPS as Record<string, { t: string } | undefined>)[pg]?.t ?? pg}</td>
                          <td className="sm">{caps[pg]!.map((c) => CAPT[c as keyof typeof CAPT] || c).join(" · ")}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </Tw>
            ) : (
              <p className="sm" style={{ margin: "8px 0" }}>
                {nos.includes(seat)
                  ? "No lead pages. They sign in to the Investors pages; their seat there is set on the Investors side of Teams."
                  : "No access by default. Digital Infrastructure grants pages to a named person; they reach only those, plus their Profile."}
              </p>
            )}
          </details>
        );
      })}
    </>
  );
}

/* "2026-09-28T11:30:00+05:30" (the route) as "28 Sep 11:30"; the demo trail's own stamps pass through */
const whenText = (w: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(w);
  return m ? `${m[2]} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+m[1]! - 1]} ${m[3]}` : w;
};

/* M15-S05-W1: the rows, the actor chips, the reveal count, the headroom and the sign-in note come from GET /api/logs */
function LogBody() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const book = openable(state);
  const LOGWHO = state.ui.LOGWHO as PersonKey | null;
  const r: Read<import("@/lib/data/endpoints/logs").LogsView> = useApiRead(logsRead, state, { actor: LOGWHO });
  if (r.state !== "ok") return r.state === "error" ? <div className="note" role="alert">{r.err.error}</div> : <p className="sm" style={{ margin: "8px 0" }}>Loading…</p>;
  const d = r.data, rows = d.rows, actors = Object.keys(d.byActor);
  return (
    <>
            <div>
              <label className="fi" style={{ maxWidth: "300px", margin: "0 0 10px" }}>
                <span>Activity by</span>
                <select
                  className="selw"
                  id="g8-logwho"
                  value={LOGWHO ?? ""}
                  onChange={(e) => dispatch({ type: "setUi", patch: { LOGWHO: e.target.value || null } })}
                >
                  <option value="">Accessible activity</option>
                  {actors.map((k) => (
                    <option value={k} key={k}>
                      {P(state.PEOPLE, k as PersonKey).n}
                    </option>
                  ))}
                </select>
              </label>
              {d.identityReveals ? (
                <span className="tag late" style={{ marginLeft: "10px" }}>
                  <span className="dot" />
                  {d.identityReveals} identity reveal{d.identityReveals === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <Tw>
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
                      const id = e.recordIds[0] ?? null;
                      const l = id ? book.find((x) => x.id === id) : undefined;
                      const note = e.note ?? "";
                      return (
                        <tr
                          key={`${e.when}-${i}`}
                          {...(l
                            ? { className: "k", tabIndex: 0, onClick: () => router.push(pathOf("lead", l.id)) }
                            : {})}
                        >
                          <td className="sm mono" style={{ width: "110px" }}>
                            {whenText(e.when)}
                          </td>
                          <td style={{ width: "24px" }}>
                            <Ag k={e.kind} t={e.label ?? e.action} />
                          </td>
                          <td className="sm">
                            <Pname k={e.actorId as PersonKey} nw cls="xs" />
                          </td>
                          <td>
                            <b>{e.label ?? e.action}</b>
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
            </Tw>
      {rows.length ? (
        <div style={{ paddingTop: "8px" }}>
          <ActLegend />
        </div>
      ) : null}
      <p className="sm" style={{ paddingTop: "8px" }}>
        Zoho calls in this range: {d.headroom.calls}
        {d.headroom.r429 ? ` · ${d.headroom.r429} refused for rate (429)` : ""}
        {d.headroom.creditsWarning ? ` · credits remaining ${d.headroom.lastCreditsRemaining ?? "low"} — past half the day's allowance` : ""}
        {" · "}Sign-in history is not here: {d.signInHistory.where} ({d.signInHistory.who}).
      </p>
    </>
  );
}

function TestBody() {
  const { state, dispatch } = useConsole();
  return own(state, "system", "edit") ? (
    <>
      <p className="sm" style={{ margin: "0 0 10px" }}>
        Prototype test: the next write is refused once, so its retry state can be seen. Nothing is logged.
      </p>
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
    </>
  ) : (
    <p className="sm">Only the owner of this page can run it.</p>
  );
}

registerDrawer("p:system.ok" as DrawerKind, {
  w: 640,
  title: () => "Working checks",
  sub: (state) => state.CHECKS.filter((c) => c.st === "ok").length + " checks · last " + CKDAYS + " days",
  Body: OkBody,
});
registerDrawer("p:system.grid" as DrawerKind, {
  w: 560,
  title: () => "Role permissions",
  sub: () => Object.keys(SEAT).length + " roles",
  Body: GridBody,
});
registerDrawer("p:system.log" as DrawerKind, {
  w: 720,
  title: () => "System activity",
  sub: (state) => {
    const base = systemRows(state), who = state.ui.LOGWHO as PersonKey | null;
    return who ? base.filter((e) => e.who === who).length + " of " + base.length + " entries" : base.length + " entries";
  },
  Body: LogBody,
});
registerDrawer("p:system.test" as DrawerKind, {
  w: 440,
  title: () => "Failed-write test",
  sub: (state) => (state.FAILNEXT ? "armed" : "off"),
  Body: TestBody,
});

/* M15-S05-NOTE-2: the live checks (Zoho credits, 429s, failed calls, audit archive, investor-app delivery) come from
   GET /api/system. A seat without the `sys` capability is refused 403 and sees nothing here; fixture mode answers empty. */
function LiveChecks() {
  const { state } = useConsole();
  const r = useApiRead(systemRead, state, undefined);
  if (r.state === "loading" || r.state === "idle") return null;
  if (r.state === "error") return r.err.code === "not-a-system-reader" ? null : <div className="note" role="alert">{r.err.error}</div>;
  const d = r.data;
  if (!d.all.length) return null;
  const tag = { working: "go", attention: "due", down: "late" } as const;
  return (
    <div className="card" id="live-checks">
      <div className="ch">
        <h3>Live checks</h3>
        <span className="sm">{d.working} working · {d.attention} need attention · {d.down} not working</span>
      </div>
      <div className="cb">
        {d.all.map((c) => (
          <div className="ckrow" key={c.key}>
            <span className={`tag ${tag[c.state]}`}>{c.state === "working" ? "working" : c.state === "attention" ? "attention" : "not working"}</span>
            <span className="cn"><b>{c.t}</b><span className="sm">{c.state === "working" ? c.owner : c.fix}</span></span>
            <span className="sm nw" style={{ textAlign: "right" }}>{c.figure}</span>
            <span className="sm">{c.owner}</span>
          </div>
        ))}
        {d.crm && (
          <p className="sm" id="crm-org" style={{ margin: "10px 0 0" }}>
            Zoho CRM: <b>{d.crm.environment}</b>
            {" · expected org "}{d.crm.expectedOrgId ?? "not pinned"}
            {" · verified org "}{d.crm.verifiedOrgId ?? "none yet"}
          </p>
        )}
        <p className="sm" style={{ margin: "10px 0 0" }}>
          Service-token expiry, cache load errors, the Zoho licence date and the last Zoho Sign event are not read here yet.
        </p>
      </div>
    </div>
  );
}

export function SystemPage() {
  const { state } = useConsole();
  const okC = state.CHECKS.filter((c) => c.st === "ok");
  const warnC = state.CHECKS.filter((c) => c.st === "warn");
  const failC = state.CHECKS.filter((c) => c.st === "fail");
  return (
    <>
      <div className="ph">
        <h1>System</h1>
        <span className="sub">{may(state, "system", "edit") ? "you own this page" : "read only"}</span>
      </div>

      <div className="stats" style={{ marginBottom: "8px", gridTemplateColumns: "repeat(3,1fr)" }}>
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
      </div>
      <DoorRow
        items={[
          { k: "system.ok", t: "Working checks", i: "today", v: "last " + CKDAYS + " days" },
          { k: "system.grid", t: "Role permissions", i: "people", v: Object.keys(SEAT).length + " roles" },
          { k: "system.log", t: "System activity", i: "activity", v: systemRows(state).length + " logged" },
          own(state, "system", "edit")
            ? { k: "system.test", t: "Failed-write test", i: "system", v: state.FAILNEXT ? "armed" : "off", cls: state.FAILNEXT ? "bad" : "" }
            : null,
        ]}
      />

      <div className="secw ux-system">
        <LiveChecks />
        {failC.length ? (
          <div className="card">
            <div className="ch">
              <h3>Not working</h3>
              <G8Demo />
            </div>
            <div className="cb">
              {failC.map((c) => <Row c={c} key={c.k} />)}
            </div>
          </div>
        ) : null}
        {warnC.length ? (
          <div className="card">
            <div className="ch">
              <h3>Needs attention</h3>
              <G8Demo />
            </div>
            <div className="cb">
              {warnC.map((c) => <Row c={c} key={c.k} />)}
            </div>
          </div>
        ) : null}
        {!failC.length && !warnC.length ? (
          <div className="card">
            <div className="cb">
              <div className="empty">Every recorded check is working.</div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
