"use client";

/* ── ACTIVITY — one compact toolbar, optional filters, one filtered record set ────────────────
   Ports `ref/03-app.js` (redesigned) 11367–11700: `actActors`, `actBase`, `actRows`, `actFilter`,
   `actView`, `actSets`, `actSummary`, `actScopeLabel`, `actExportData`, `actCSV`, `actLog`,
   `actTally`, `actTouch`, `actHistory` and `vActivity` itself.

   The redesign's whole point: Log, By person, By day and both exports read the SAME filtered row
   set — one month, an optional day, an optional person, an optional action kind — rather than four
   screens that can quietly disagree. There is no calendar heat-map on this page any more; the day
   is a plain date field, bounded to the chosen month.

   `activityFilters` (./logic) is this feature's own layering of the toolbar's filters on top of
   `activityRows` (selectors/activity.ts), the actor- and record-access gate. */

import type { ActKind, PersonKey } from "@/domain";
import { MON } from "@/lib/format";
import { P, openable } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { LeadActivityView } from "@/lib/data/endpoints/activity";
import { Ag, Chip } from "@/components/ui";
import { useGoLead } from "@/features/leads/nav";
import { actSummary, type ActRow } from "./csv";
import { activityUi, scopeLabel, useLeadActivity } from "./logic";
import "./drawers";
/* the declare-module block in ./state augments UiState with ACTKIND/ACTVIEW/ACTLIMIT; tsc picks
   it up from tsconfig's include, so nothing here needs to import it for side effects. */

/* ic("download") — redesigned 03-app.js:2465. Not in the shell's Icon.tsx (only the destinations
   and top-bar controls it draws are there — see that file's own header note), so this page draws
   its one extra glyph itself rather than reaching into a file it does not own. */
function DownloadIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

/** B-27: the lead actions come from Zoho's nightly audit export, so the page says when they appear, or that the export is not
 *  set up here — never a bare "0 actions" that reads as nothing done. (Same-day rows wait on an owner ruling.) */
export const archiveNote = (archive: string): string => archive === "not-configured"
  ? "The activity log is not set up on this environment yet: lead actions will show once the nightly Zoho audit export runs here."
  : "Lead actions appear here the day after, from Zoho's nightly audit export.";

export function ActivityPage() {
  const { state, dispatch } = useConsole();
  const set = (patch: { ACTM?: Date; ACTDAY?: string | null; ACTWHO?: PersonKey | null;
    ACTKIND?: string | null; ACTVIEW?: "log" | "person" | "day"; ACTLIMIT?: number }) =>
    dispatch({ type: "setUi", patch });

  const f = activityUi(state);
  const { ACTDAY, ACTWHO, ACTKIND, ACTVIEW, ACTLIMIT, mkey, days, cuts } = f;
  const reads = useLeadActivity(state, f);
  const D: LeadActivityView | null = reads.view.state === "ok" ? reads.view.data : null;
  const solo = D ? D.solo : true, rows: readonly ActRow[] = D ? D.rows : [], kinds = D ? D.kinds : {};
  const actors = (D ? [...D.people] : []).sort((a, b) => P(state.PEOPLE, a as PersonKey).n.localeCompare(P(state.PEOPLE, b as PersonKey).n));
  const historyOpen = !!(state.DRW && state.DRW.k === "p:activity.allhistory");

  return (
    <div className="rd-page rd-activity rd-activity-compact">
      <div className="ph rd-page-heading">
        <div>
          <h1>Activity</h1>
          <p className="sub">{solo ? "Your actions" : "You and your team"}, latest first.</p>
          {D?.archive ? <p className="sm" id="activity-archive-note">{archiveNote(D.archive)}</p> : null}
        </div>
        <div className="sp" />
        <div className="ux-activity-exports">
          <button type="button" className="btn" id="door-activity-allhistory" aria-haspopup="dialog"
            aria-expanded={historyOpen ? "true" : "false"}
            onClick={() => dispatch({ type: "openDrawer", k: "p:activity.allhistory", id: null })}>
            <DownloadIcon /> Export…
          </button>
        </div>
      </div>

      <section className="ux-activity ux-activity-refined ux-section card rd-activity-surface">
        <div className="rd-activity-controls">
          <label className="rd-activity-period">
            <span>Month</span>
            <input className="selw" type="month" id="actmonth" value={mkey} onChange={(e) => {
              if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
              const [y, m] = e.target.value.split("-").map(Number);
              if (m < 1 || m > 12) return;
              set({ ACTM: new Date(y, m - 1, 1), ACTDAY: null, ACTLIMIT: 40 });
            }} />
          </label>
          <div className="ux-activity-views rd-segments" role="group" aria-label="Activity view">
            {(solo
              ? [["log", "Log"], ["day", "By day"]] as const
              : [["log", "Log"], ["person", "By person"], ["day", "By day"]] as const).map(([k, t]) => (
              <Chip key={k} on={ACTVIEW === k} onClick={() => set({ ACTVIEW: k, ACTLIMIT: 40 })}>{t}</Chip>
            ))}
          </div>
          <span className="sm rd-result-count" role="status">{D ? D.total : 0} action{D && D.total === 1 ? "" : "s"}</span>
          <details className="rd-activity-filter-options" data-ux-key="activity-filters">
            <summary>Filters{cuts ? " · " + cuts : ""}</summary>
            <div className="ux-activity-filter-grid rd-activity-filters">
              <label className="fi">
                <span>Day · optional</span>
                <input className="selw" type="date" id="actday" min={`${mkey}-01`} max={`${mkey}-${String(days).padStart(2, "0")}`}
                  value={ACTDAY || ""} onChange={(e) => {
                    const v = e.target.value;
                    set({ ACTDAY: v && v.startsWith(mkey + "-") ? v : null, ACTLIMIT: 40 });
                  }} />
              </label>
              {!solo && (
                <label className="fi">
                  <span>Person</span>
                  <select className="selw" id="actperson" value={ACTWHO ?? ""} onChange={(e) => set({
                    ACTWHO: (e.target.value || null) as PersonKey | null, ACTLIMIT: 40,
                  })}>
                    <option value="">All people</option>
                    {actors.map((k) => <option key={k} value={k}>{P(state.PEOPLE, k as PersonKey).n}</option>)}
                  </select>
                </label>
              )}
              <label className="fi">
                <span>Action</span>
                <select className="selw" id="actkind" value={ACTKIND ?? ""}
                  onChange={(e) => set({ ACTKIND: e.target.value || null, ACTLIMIT: 40 })}>
                  <option value="">All actions</option>
                  {Object.keys(kinds).map((k) => (
                    <option key={k} value={k}>{kinds[k]}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </div>

        {(ACTDAY || ACTWHO || ACTKIND) && (
          <div className="ux-activity-active">
            <span className="sm">{scopeLabel(state, f, D)}</span>
            <button type="button" className="chip" onClick={() => set({ ACTWHO: null, ACTDAY: null, ACTKIND: null, ACTLIMIT: 40 })}>
              Clear day, person and action
            </button>
          </div>
        )}

        <div className="card ux-activity-results">
          {reads.view.state === "error" ? <div className="note" role="alert" style={{ margin: 12 }}>{reads.view.err.error}</div>
            : !D ? <p className="sm" style={{ margin: 12 }}>Loading…</p>
            : ACTVIEW === "log"
              ? <ActLog state={state} solo={solo} rows={rows} kinds={kinds} total={D.total} limit={ACTLIMIT} onMore={() => set({ ACTLIMIT: ACTLIMIT + 40 })} />
              : <ActTally state={state} rows={rows} kinds={kinds} view={ACTVIEW} />}
        </div>
      </section>

      {rows.some((e) => e.human && e.touch) && (
        <details className="ux-disclosure" data-ux-key="activity-repeats">
          <summary>Repeat contacts · {rows.filter((e) => e.human && (e.touch ?? 0) >= 4).length} fourth or later</summary>
          <ActTouch rows={rows} />
        </details>
      )}
    </div>
  );
}

/* actLog() — ir-merged.js:9160. D59 g3: a seat that only sees itself gets no Person column —
   every row would read its own name. */
function ActLog({
  state, solo, rows, kinds, total, limit, onMore,
}: { state: ReturnType<typeof useConsole>["state"]; solo: boolean; rows: readonly ActRow[]; kinds: Readonly<Record<string, string>>;
  total: number; limit: number; onMore: () => void }) {
  const goLead = useGoLead("activity");
  const book = openable(state);
  const shown = rows.slice(0, limit);
  return (
    <>
      <div className="tw">
        <table className="rd-activity-log">
          <colgroup>
            <col className="rd-log-when" />
            <col className="rd-log-action" />
            {!solo && <col className="rd-log-person" />}
            <col className="rd-log-investor" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              {!solo && <th scope="col">Person</th>}
              <th scope="col">Investor</th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? shown.map((e, i) => {
              const l = book.find((x) => x.id === e.recordId);
              const note = e.detail || "";
              const day = e.day.slice(8), mon = MON[Number(e.day.slice(5, 7)) - 1] || e.day, tm = e.at.slice(11, 16);
              return (
                <tr key={e.at + i}>
                  <td className="sm nw">
                    <time className="rd-log-stamp" dateTime={`${e.day}T${tm}`} title={`${e.day} ${tm}`}>
                      {day} {mon} <span>· {tm}</span>
                    </time>
                  </td>
                  <td>
                    <b className="rd-log-description"><Ag k={e.kind as ActKind} t={e.what} /> <span>{e.what}</span></b>
                    {note ? <div className="sm rd-log-note">{note}</div> : null}
                  </td>
                  {!solo && <td>{P(state.PEOPLE, e.byId as PersonKey).n}</td>}
                  <td>
                    {e.recordId ? (
                      <button type="button" className="chip" onClick={() => goLead(e.recordId!)}>{l ? l.n : e.recordId}</button>
                    ) : "—"}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={solo ? 3 : 4} className="empty">
                  No activity matches these filters.<br />
                  <span className="sm">Choose another month or clear the day, person and action.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {shown.length < rows.length && (
        <div className="ux-activity-page">
          <span className="sm">Showing {shown.length} of {total} actions</span>
          <button type="button" className="chip" onClick={onMore}>Show {Math.min(40, rows.length - shown.length)} more</button>
        </div>
      )}
    </>
  );
}

/* actTally() — 03-app.js(redesigned):11424. By person or by day, whichever the toolbar picked. */
function ActTally({
  state, rows, kinds: kindNames, view,
}: { state: ReturnType<typeof useConsole>["state"]; rows: readonly ActRow[]; kinds: Readonly<Record<string, string>>; view: "person" | "day" }) {
  const kinds = Object.keys(kindNames).filter((k) => rows.some((e) => e.kind === k));
  const groups = actSummary(state, rows, view);
  return (
    <div className="tw">
      <table className="ux-activity-summary">
        <thead>
          <tr>
            <th>{view === "person" ? "Person" : "Day"}</th>
            {kinds.map((k) => <th className="n" key={k}>{kindNames[k]}</th>)}
            <th className="n">Total</th>
          </tr>
        </thead>
        <tbody>
          {groups.length ? groups.map((g) => (
            <tr key={g.key}>
              <th scope="row">{view === "person" ? P(state.PEOPLE, g.key as PersonKey).n : g.key}</th>
              {kinds.map((k) => <td className="n" key={k}>{g.kinds[k] || "—"}</td>)}
              <td className="n"><b>{g.total}</b></td>
            </tr>
          )) : (
            <tr>
              <td colSpan={kinds.length + 2} className="empty">
                No activity matches these filters.<br />
                <span className="sm">Choose another month or clear the day, person and action.</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* actTouch() — 03-app.js(redesigned):11460 */
function ActTouch({ rows }: { rows: readonly ActRow[] }) {
  const touch = rows.filter((e) => e.human);
  return (
    <div className="tw">
      <table>
        <thead><tr><th>Contact in the week</th><th className="n">Actions</th></tr></thead>
        <tbody>
          {[1, 2, 3, 4].map((t) => (
            <tr key={t}>
              <td>{t < 4 ? ["First", "Second", "Third"][t - 1] : "Fourth or later"}</td>
              <td className="n">{touch.filter((e) => (t < 4 ? e.touch === t : (e.touch ?? 0) >= 4)).length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
