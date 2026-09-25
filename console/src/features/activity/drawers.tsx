"use client";

/* ── the "All history…" drawer — `panel("activity.allhistory", …)`, redesigned
   `ir-console-redesigned.html` 12908–12914, body from `actHistory()` (12882–12894).

   The one non-lead drawer this feature owns. Registered from here, the documented pattern for a
   page-owned "p:<key>" panel (`components/shell/drawers/registry.ts`'s note on `DrawerKind`'s
   `p:${string}`) — no shell change needed. It reads the very same `activityFilters()` the page
   does, without the day/month narrowing, so "All history" can never disagree with what the page
   was just showing. ────────────────────────────────────────────────────────────────────────── */

import { KINDS } from "@/domain";
import type { PersonKey } from "@/domain";
import { P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { downloadActivityCSV } from "./csv";
import { activityFilters } from "./logic";

function Body(_props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const f = activityFilters(state);
  const { solo, actors, ACTKIND, ACTVIEW, allTime } = f;
  const dates = allTime.map((e) => e.d).sort();
  const bodyRows = ACTVIEW === "person" || ACTVIEW === "day"
    ? new Set(allTime.map((e) => (ACTVIEW === "person" ? e.who : e.d))).size
    : allTime.length;

  return (
    <section className="ux-activity-refined ux-section">
      <p className="sm">
        Exports all dates for {solo ? "your activity" : "your team’s activity"} on relationships you can open.
        Person, action and view stay the same as Activity.
      </p>
      <div className="ux-activity-filter-grid ux-activity-history-filters">
        {!solo && (
          <label className="fi">
            <span>Person</span>
            <select className="selw" value={f.who ?? ""}
              onChange={(e) => dispatch({ type: "setUi", patch: {
                ACTWHO: (e.target.value || null) as PersonKey | null, ACTLIMIT: 40,
              } })}>
              <option value="">All people</option>
              {actors.map((k) => <option key={k} value={k}>{P(state.PEOPLE, k).n}</option>)}
            </select>
          </label>
        )}
        <label className="fi">
          <span>Action</span>
          <select className="selw" value={ACTKIND ?? ""}
            onChange={(e) => dispatch({ type: "setUi", patch: { ACTKIND: e.target.value || null, ACTLIMIT: 40 } })}>
            <option value="">All actions</option>
            {Object.keys(KINDS).map((k) => <option key={k} value={k}>{KINDS[k as keyof typeof KINDS]}</option>)}
          </select>
        </label>
      </div>
      <dl className="kv">
        <dt>Date range</dt>
        <dd>{dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "No matching history"}</dd>
        <dt>Matching activity</dt>
        <dd>{allTime.length} actions</dd>
        <dt>CSV view</dt>
        <dd>{ACTVIEW === "log" ? "Log" : ACTVIEW === "person" ? "By person" : "By day"} · {bodyRows} rows</dd>
      </dl>
      <p className="sm">The export is recorded in the activity log.</p>
    </section>
  );
}

function Foot(_props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const f = activityFilters(state);
  return (
    <button type="button" className="act" disabled={!f.allTime.length}
      onClick={() => downloadActivityCSV(state, f.allTime, f.ACTVIEW, f.exportName(true, f.ACTVIEW), dispatch)}>
      Export all history
    </button>
  );
}

registerDrawer("p:activity.allhistory", {
  w: 560,
  title: () => "Export all history",
  sub: (state) => activityFilters(state).scopeLabel(true),
  Body,
  Foot,
});
