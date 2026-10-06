"use client";

/* ── Activity's one drawer: Export — `panel("activity.allhistory", …)`, ir-merged.js:10433, body
   from `actHistory()` (ir-merged.js:9186). D59 g3: the one export place — Person and Action are
   asked once, in the page's Filters fold; this drawer says what each export contains and offers both.

   The one non-lead drawer this feature owns. Registered from here, the documented pattern for a
   page-owned "p:<key>" panel (`components/shell/drawers/registry.ts`'s note on `DrawerKind`'s
   `p:${string}`) — no shell change needed. It reads the very same `activityFilters()` the page
   does, without the day/month narrowing, so "All history" can never disagree with what the page
   was just showing. ────────────────────────────────────────────────────────────────────────── */

import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { actExportData, downloadActivityCSV } from "./csv";
import { useActivityExportLog } from "@/lib/data/endpoints/me";
import { activityUi, exportName, scopeLabel, useLeadActivity } from "./logic";

const NONE = { rows: [], kinds: {}, solo: true, person: null, total: 0 } as const;
function useRead() {
  const { state, dispatch } = useConsole();
  const f = activityUi(state), r = useLeadActivity(state, f);
  return { state, dispatch, f, v: r.view.state === "ok" ? r.view.data : NONE, a: r.all.state === "ok" ? r.all.data : NONE };
}

function Body(_props: DrawerProps) {
  const { state, f, v, a } = useRead();
  const view = actExportData(state, v.rows, f.ACTVIEW, v.kinds), all = a.rows;
  const dates = all.map((e) => e.day).sort();
  const vname = f.ACTVIEW === "log" ? "Log" : f.ACTVIEW === "person" ? "By person" : "By day";
  return (
    <section className="ux-activity-refined ux-section">
      <dl className="kv">
        <dt>This view</dt>
        <dd>{scopeLabel(state, f, v)} · {vname} · {view.body.length} rows</dd>
        <dt>Whole month</dt>
        <dd>{dates.length ? `${dates[0]} to ${dates[dates.length - 1]} · ${a.total} actions` : "No matching history"}</dd>
      </dl>
      <p className="sm">Both use the page&apos;s person, action and view. The export is recorded in the activity log.</p>
    </section>
  );
}

function Foot(_props: DrawerProps) {
  const { state, f, v, a } = useRead();
  /* C4 (J14): the export's log line — fixture the reducer's "log", live POST /api/activity/export (counts only) */
  const logExport = useActivityExportLog();
  return (
    <>
      <button type="button" className="act ghost" disabled={!v.rows.length}
        onClick={() => downloadActivityCSV(state, v.rows, f.ACTVIEW, exportName(f, v, false, f.ACTVIEW), v.kinds, undefined, logExport)}>
        Export this view
      </button>
      <button type="button" className="act" disabled={!a.rows.length}
        onClick={() => downloadActivityCSV(state, a.rows, f.ACTVIEW, exportName(f, a, true, f.ACTVIEW), a.kinds, undefined, logExport)}>
        Export whole month
      </button>
    </>
  );
}

registerDrawer("p:activity.allhistory", {
  w: 560,
  title: () => "Export",
  sub: (state) => scopeLabel(state, activityUi(state), null),
  Body,
  Foot,
});
