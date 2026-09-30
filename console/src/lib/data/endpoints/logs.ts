/* M15-S05-W1 — the Logs view: GET /api/logs[?actor=<id>] (server/logs/reader — Planes B and C, filtered, with the
   identity-reveal count, the API headroom and where sign-in history lives).
   Live: the route (Digital Infrastructure / Administrator / Auditor only — 403 otherwise, logged as a refusal).
   Fixture: the same LogResult fields projected from the demo book's audit trail (systemRows). The demo trail has
   a note per line that Planes B and C do not carry; the view type adds an optional `note` the fixture fills. */

import type { LogResult, LogRow } from "@/server/logs/reader";
import { logNote, may, systemRows } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import { fail, ok, type ReadEndpoint } from "../api";

type Ok = Extract<LogResult, { ok: true }>;
export type LogRowView = LogRow & { readonly note?: string | null };
export type LogsView = Pick<Ok, "byActor" | "identityReveals" | "identity" | "total" | "headroom" | "signInHistory"> & { readonly rows: readonly LogRowView[] };
export type LogsArgs = { actor: string | null };

export const logsRead: ReadEndpoint<ConsoleState, LogsArgs, LogsView> = {
  path: a => (a.actor ? `/api/logs?actor=${encodeURIComponent(a.actor)}` : "/api/logs"),
  pick: j => j as LogsView,
  fixture(state, a) {
    if (!may(state, "system", "view")) return fail(403, "not-a-log-reader", "The console logs are Digital Infrastructure's and the Auditor's.");
    const all = systemRows(state);
    const byActor: Record<string, number> = {};
    for (const e of all) byActor[e.who] = (byActor[e.who] ?? 0) + 1;
    const rows: LogRowView[] = all.filter(e => !a.actor || e.who === a.actor).map((e): LogRowView => {
      const reveal = /reveal/i.test(e.what);
      return { at: 0, when: e.at, plane: reveal || e.kind === "admin" ? "c" : "b", kind: e.kind, group: reveal ? "identity" : "event", actorId: e.who, action: e.what,
        outcome: "ok", reason: null, endpoint: null, status: null, durationMs: null, creditsRemaining: null, whom: null, seat: null,
        recordIds: e.lead ? [e.lead] : [], label: e.what, withheld: false, note: logNote(state, e) };
    });
    return ok({
      byActor, identityReveals: all.filter(e => /reveal/i.test(e.what)).length, identity: true, total: rows.length, rows,
      headroom: { calls: 0, r429: 0, failed: 0, lastCreditsRemaining: null, lowestCreditsRemaining: null, creditsWarning: false },
      signInHistory: { where: "Zoho Directory → Security Control → Login History", who: "Digital Infrastructure", runbook: "ops/runbooks/sign-in-history.md" },
    });
  },
};
