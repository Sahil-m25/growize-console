/* ── features/activity/csv.ts — the same filtered records, exported ──────────────────────────
   Ports `ref/03-app.js` (redesigned) `actSummary`, `actExportData` and `actCSV`, 11376–11431.

   Log, By person and By day all read one filtered row set; the export reads the very same set
   and the very same grouping, so the file on disk can never disagree with what the screen showed
   when it was pressed.

   `actCSV` (11618) also appends a LOG line — "Exported the activity log", null lead, `rows.length
   activity rows · body.length exported <view> rows · <filename>`, kind "admin" — so the export
   itself is audited. Now that the store carries the generic `log(what,lead,note,kind)` action, the
   caller passes its `dispatch` in and this writes that same line. */

import { KINDS } from "@/domain";
import type { LogEntry, PersonKey } from "@/domain";
import type { Ctx } from "@/lib/selectors";
import { P, logNote } from "@/lib/selectors";
import type { Action } from "@/lib/store";

export type ActView = "log" | "person" | "day";

export type ActGroup = { key: string; total: number; kinds: Record<string, number> };

export function actSummary(ctx: Ctx, rows: LogEntry[], view: "person" | "day"): ActGroup[] {
  const groups: Record<string, ActGroup> = {};
  rows.forEach((e) => {
    const key = view === "person" ? e.who : e.d;
    const item = groups[key] || (groups[key] = { key, total: 0, kinds: {} });
    item.total++;
    item.kinds[e.kind] = (item.kinds[e.kind] || 0) + 1;
  });
  return Object.values(groups).sort((a, b) => (view === "person"
    ? b.total - a.total || P(ctx.PEOPLE, a.key as PersonKey).n.localeCompare(P(ctx.PEOPLE, b.key as PersonKey).n)
    : b.key.localeCompare(a.key)));
}

export type ActExport = { head: (string | number)[]; body: (string | number)[][] };

export function actExportData(ctx: Ctx, rows: LogEntry[], view: ActView): ActExport {
  if (view === "person" || view === "day") {
    const kinds = Object.keys(KINDS).filter((k) => rows.some((e) => e.kind === k));
    const groups = actSummary(ctx, rows, view);
    return {
      head: [view === "person" ? "Person" : "Date", ...kinds.map((k) => KINDS[k as keyof typeof KINDS]), "Total"],
      body: groups.map((g) => [
        view === "person" ? P(ctx.PEOPLE, g.key as PersonKey).n : g.key,
        ...kinds.map((k) => g.kinds[k] || 0),
        g.total,
      ]),
    };
  }
  return {
    head: ["Date", "Time", "Person", "Kind", "What", "Note", "Lead", "Investor", "Touch"],
    body: rows.map((e) => {
      const l = ctx.LEADS.find((x) => x.id === e.lead);
      return [
        e.d, e.at, P(ctx.PEOPLE, e.who).n, KINDS[e.kind] || e.kind || "", e.what, logNote(ctx, e),
        e.lead || "", l ? l.n : "", e.touch || "",
      ];
    }),
  };
}

const q = (v: unknown): string => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** Builds the CSV and hands it to the browser as a download. Returns false (and does nothing)
 *  when there is nothing to export, exactly as the prototype's `actCSV` does. `dispatch`, when
 *  given, logs the export itself the way `actCSV` (11618) does. */
export function downloadActivityCSV(
  ctx: Ctx, rows: LogEntry[], view: ActView, filename: string,
  dispatch?: (action: Action) => unknown,
): boolean {
  if (!rows.length) return false;
  const data = actExportData(ctx, rows, view);
  const CRLF = "\r\n", BOM = "﻿";
  const csv = BOM + [data.head, ...data.body].map((r) => r.map(q).join(",")).join(CRLF) + CRLF;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  dispatch?.({
    type: "log", what: "Exported the activity log", lead: null,
    note: `${rows.length} activity rows · ${data.body.length} exported ${view} rows · ${filename}`,
    kind: "admin",
  });
  return true;
}
