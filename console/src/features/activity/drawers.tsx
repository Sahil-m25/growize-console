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
import { activityFilters } from "./logic";

function Body(_props: DrawerProps) {
  const { state } = useConsole();
  const f = activityFilters(state);
  const view = actExportData(state, f.rows, f.ACTVIEW), all = f.allTime;
  const dates = all.map((e) => e.d).sort();
  const vname = f.ACTVIEW === "log" ? "Log" : f.ACTVIEW === "person" ? "By person" : "By day";
  return (
    <section className="ux-activity-refined ux-section">
      <dl className="kv">
        <dt>This view</dt>
        <dd>{f.scopeLabel()} · {vname} · {view.body.length} rows</dd>
        <dt>All history</dt>
        <dd>{dates.length ? `${dates[0]} to ${dates[dates.length - 1]} · ${all.length} actions` : "No matching history"}</dd>
      </dl>
      <p className="sm">Both use the page&apos;s person, action and view. The export is recorded in the activity log.</p>
    </section>
  );
}

function Foot(_props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const f = activityFilters(state);
  return (
    <>
      <button type="button" className="act ghost" disabled={!f.rows.length}
        onClick={() => downloadActivityCSV(state, f.rows, f.ACTVIEW, f.exportName(false, f.ACTVIEW), dispatch)}>
        Export this view
      </button>
      <button type="button" className="act" disabled={!f.allTime.length}
        onClick={() => downloadActivityCSV(state, f.allTime, f.ACTVIEW, f.exportName(true, f.ACTVIEW), dispatch)}>
        Export all history
      </button>
    </>
  );
}

registerDrawer("p:activity.allhistory", {
  w: 560,
  title: () => "Export",
  sub: (state) => activityFilters(state).scopeLabel(),
  Body,
  Foot,
});
