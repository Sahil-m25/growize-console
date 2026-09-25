"use client";

/* ── one KPI line, and the recovery action it owes ──────────────────────────────────────────
   Ports `ref/03-app.js` 4805–4834 (`kpiRow`, `recovRow`).

   Manual operating rule 5 and the Table 24 scorecard: every Amber or Red line carries one owner,
   one recovery action and one date. Nothing here is optional — an amber line without a recovery
   action is itself an exception, and is drawn as one.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { canRecov, hasLeads, kCol, kRag, kScore, P } from "@/lib/selectors";
import type { Kpi as KpiMetric } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { Demo, useJumpToLeads } from "./bits";

const fmtOf = (m: KpiMetric) => (v: number): string =>
  m.unit === "%" ? v + "%" : m.unit === "h" ? v + " h" : m.unit ? v + m.unit : String(v);

export function KpiRow({ m }: { m: KpiMetric }) {
  const { state } = useConsole();
  const toLeads = useJumpToLeads();
  const pct = Math.round(kScore(m) * 100), col = kCol(m), bad = kRag(m) !== "green";
  const fmt = fmtOf(m);
  /* Change 6 — the value becomes a button onto the leads behind it exactly when this line names
     one and the seat can reach Leads; every other seat, and every line with no jump, sees the
     same plain figure as before. */
  const jump = m.jump, canJump = jump && hasLeads(state);
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontSize: "13.5px" }}>{m.t}</span>
        {m.built ? null : <span className="prov nb">not built</span>}
        <div className="sp" />
        <b className="mono" style={{ fontSize: 13, color: col }}>
          {canJump
            ? <button type="button" onClick={() => toLeads(jump)}>{fmt(m.have)}</button>
            : fmt(m.have)}
        </b>{" "}
        {/* kpis() has no `.src` field yet — every line here is still a demo literal (see the note
            on the Recovery priorities card), so the mark is unconditional; gate it on
            `m.src === "demo"` once kpis() distinguishes a live plan line from these. */}
        <Demo title={m.built
          ? "The field this needs exists, but the figure shown is still a demo literal — nothing counts it yet"
          : "Invented for the prototype — no record behind it"} />
        <span className="sm mono">of {fmt(m.want)}</span>
      </div>
      <div className="bar"><i style={{ width: `${Math.min(100, pct)}%`, background: col }} /></div>
      <p className="sm" style={{ margin: "4px 0 0" }}>{m.read}{m.built ? null : <> <i>{m.why}.</i></>}</p>
      {bad ? <RecovRow m={m} /> : null}
    </div>
  );
}

/* one amber or red line, one owner, one action, one date. Its absence is the exception. */
export function RecovRow({ m }: { m: KpiMetric }) {
  const { state, dispatch } = useConsole();
  const r = state.RECOV[m.k];
  const open = () => dispatch({
    type: "openDrawer", k: "recov", id: m.k,
    /* RCDATE/RCERR reset on every open — a stale error or a previous line's deadline must never
       carry over onto this one. `RecovRec` has no stored `date` (see `crossOwnerRequests`), so the
       deadline field has nothing to pre-fill from; `./drawers`'s `rcDeadline` defaults it to a week
       out, same as a fresh one. */
    seed: { RCACT: (state.RECOV[m.k] || {}).act ?? null, RCWHO: (state.RECOV[m.k] || {}).who ?? null,
      RCDATE: "", RCERR: "" },
  });
  return (
    <div className={`rcv ${r ? "" : "miss"}`}>
      {r ? (
        <>
          <span className="who">{P(state.PEOPLE, r.who).n.split(" ")[0]}</span>
          <span style={{ flex: 1, minWidth: 120 }}>{r.act}</span>
          <span className="mono">by {r.by}</span>
          {canRecov(state) && (
            <button type="button" className="chip" style={{ padding: "2px 8px", fontSize: 11 }}
              id={`rc-${m.k}`} onClick={open}>Change it</button>
          )}
        </>
      ) : (
        <>
          <span style={{ flex: 1, color: "var(--late)" }}><b>No recovery action</b> on{" "}
            {kRag(m) === "amber" ? "an amber" : "a red"} line.</span>
          {canRecov(state) && (
            <button type="button" className="chip" style={{ padding: "2px 8px", fontSize: 11 }}
              id={`rc-${m.k}`} onClick={open}>Set a recovery action</button>
          )}
        </>
      )}
    </div>
  );
}
