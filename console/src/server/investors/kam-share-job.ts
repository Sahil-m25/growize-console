/**
 * D121 A / ACCESS-PLAN §7 R3 — THE KAM SHARE RECONCILE JOB (POST /api/jobs/kam-share-reconcile, JOB_SECRET).
 *
 * One run: (1) the queue's drain — every KAM share still pending or failed is tried again; (2) the reconcile — for each
 * Contact with KAM set, its records' actual shares are compared with the expected ones (KAM read_write; Originating_IR
 * read on the Contact and its allotments), missing shares are added and other KAMs' shares revoked (kam-share.ts).
 * Both stop at the request deadline's stop margin; the reconcile's resume point is kept in SharedState
 * (kamshare|reconcile-from, 2 days) and the next call goes on from it, so a scheduler calling every few minutes through
 * the night covers the whole book. Output: counts and record ids only; one Plane B event line per run (ids only).
 */

import type { OpsLog } from "../../lib/zoho/log";
import type { ServiceCredential } from "../../lib/zoho/client";
import type { SharedState } from "../state/shared-state";
import type { JobSummary } from "../jobs/claim";
import { reconcileKamShares, type KamShareClient } from "./kam-share";
import type { KamShareQueue } from "./kam-share-queue";

export const RECONCILE_FROM = "kamshare|reconcile-from";
const RESUME_TTL_S = 2 * 86_400;

export interface KamShareJobDeps {
  readonly queue: Pick<KamShareQueue, "drain">;
  readonly client: KamShareClient;
  readonly credential: (signal?: AbortSignal) => Promise<ServiceCredential | null>;
  readonly state: SharedState;
  readonly log: OpsLog;
  readonly serviceUserId: string | null;
  readonly shouldStop?: () => boolean;
  readonly clock?: () => number;
}

export async function runKamShareReconcile(d: KamShareJobDeps): Promise<JobSummary> {
  const clock = d.clock ?? Date.now;
  const cred = await d.credential().catch(() => null);
  if (!cred) return { notConfigured: true };
  const drain = await d.queue.drain({ shouldStop: d.shouldStop });
  const from = await d.state.get(RECONCILE_FROM).catch(() => null);
  const r = await reconcileKamShares(d.client, cred, { from, shouldStop: d.shouldStop, serviceUserId: d.serviceUserId }).catch(() => null);
  const event = (reason: string, ids: readonly string[]) => {
    try { d.log.event?.({ at: clock(), actor: { kind: "service", job: "kam-share" }, action: "kam-share-reconcile", reason, recordIds: ids.slice(0, 200) }); } catch { /* never takes the job down */ }
  };
  const base = { drained: drain.tried, drainShared: drain.shared, drainPending: drain.pending, drainFailed: drain.failed };
  if (!r) {
    event("read-failed", []);
    return { ...base, readFailed: true };
  }
  if (r.continueFrom) await d.state.set(RECONCILE_FROM, r.continueFrom, RESUME_TTL_S).catch(() => undefined);
  else if (from) await d.state.set(RECONCILE_FROM, "", 1).catch(() => undefined);
  event(`added-${r.added.length}.revoked-${r.revoked.length}.failed-${r.failed.length}`, [...r.added, ...r.revoked, ...r.failed, ...r.unreadable]);
  return {
    ...base,
    contactsChecked: r.contactsChecked, recordsChecked: r.recordsChecked,
    added: r.added.length, revoked: r.revoked.length, failed: r.failed.length, unreadable: r.unreadable.length,
    addedIds: r.added, revokedIds: r.revoked, failedIds: r.failed, unreadableIds: r.unreadable,
    continueFrom: r.continueFrom,
  };
}
