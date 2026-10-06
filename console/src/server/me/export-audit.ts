/**
 * The activity CSV export's log line (J14): "who exported which view, how many rows, when". A server log line only —
 * no Zoho call and no values (rule 7): the view is one of three codes and the row count a number. The export itself is
 * built in the browser from rows the person already read on their own token; this is the audit that it happened.
 * A repeated press of the same Idempotency-Key writes nothing a second time.
 */

import type { OpsLog } from "../../lib/zoho/log";
import { activitySides } from "../activity/query";
import type { SharedState } from "../state/shared-state";

export const EXPORT_VIEWS = ["log", "person", "day"] as const;
export type ExportView = (typeof EXPORT_VIEWS)[number];
export type ExportResult =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly reasonCode: "invalid-request" | "no-activity" | "unavailable"; readonly reason: string };

const USER_ID = /^\d{15,25}$/;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_ROWS = 999_999;
const REASON = {
  "invalid-request": "the request is invalid",
  "no-activity": "this seat has no Activity page",
  unavailable: "the console could not record the export, try again",
} as const;

export function createExportAudit(deps: { readonly log: OpsLog; readonly state: SharedState; readonly clock?: () => number }) {
  const clock = deps.clock ?? Date.now;
  const refuse = (reasonCode: keyof typeof REASON): ExportResult => ({ ok: false, reasonCode, reason: REASON[reasonCode] });
  return Object.freeze({
    async record(actor: { readonly userId: string; readonly seat: string }, body: { readonly view?: unknown; readonly rows?: unknown }, idempotencyKey?: string | null): Promise<ExportResult> {
      if (!actor || !USER_ID.test(actor.userId) || !body || typeof body !== "object") return refuse("invalid-request");
      const view = EXPORT_VIEWS.find((v) => v === body.view);
      const rows = body.rows;
      if (!view || typeof rows !== "number" || !Number.isSafeInteger(rows) || rows < 0 || rows > MAX_ROWS) return refuse("invalid-request");
      if (idempotencyKey != null && !KEY.test(idempotencyKey)) return refuse("invalid-request");
      if (activitySides(actor.seat).length === 0) return refuse("no-activity");
      if (idempotencyKey) {
        try { if (!(await deps.state.claim(`me-export|${actor.userId}|${idempotencyKey}`, 600))) return { ok: true, replayed: true }; }
        catch { return refuse("unavailable"); }
      }
      deps.log.event?.({ at: clock(), actor: { kind: "user", userId: actor.userId }, action: "activity-export", reason: `${view}.rows-${rows}`, recordIds: [] });
      return { ok: true, replayed: false };
    },
  });
}
