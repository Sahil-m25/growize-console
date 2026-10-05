/**
 * D121 A — WHERE A KAM SHARE STANDS, AND THE QUEUE THAT FINISHES IT (SharedState; ids and codes only, rule 7).
 *
 *   kamshare|<contactId>   { state, toKam, fromKam, queuedAt, lastTriedAt, attempts, reason }   (TTL 30 days)
 *   log|kam-share|…        the Contact ids queued (server/state/shared-log), read by the job's drain
 *   kamshare|cursor        the last log slot the drain has read
 *
 * `run(task)` marks the Contact pending, tries the share on the "kam-share" service credential inside the caller's
 * budget (`shouldStop`: the request deadline's stop margin), and saves shared / pending (cut short) / failed. The HTTP
 * request that changed the KAM therefore never waits on Zoho past its deadline; what is left is finished by the
 * kam-share-reconcile job's drain, or by Retry. A result is saved only while the stored task is still this one
 * (a newer KAM change owns the key). Each run files one Plane B event line: job, status code with a count, record ids.
 */

import type { OpsLog } from "../../lib/zoho/log";
import type { ServiceCredential } from "../../lib/zoho/client";
import type { SharedState } from "../state/shared-state";
import { createSharedLog } from "../state/shared-log";
import { applyKamShare, type KamShareClient, type KamShareTask } from "./kam-share";

export type KamShareState = "shared" | "pending" | "failed" | "none";
export interface KamShareStatus {
  readonly state: KamShareState;
  /** Epoch ms of the last attempt, or null when never tried. */
  readonly lastTriedAt: number | null;
}
interface Stored {
  readonly state: Exclude<KamShareState, "none">;
  readonly toKam: string | null;
  readonly fromKam: string | null;
  readonly queuedAt: number;
  readonly lastTriedAt: number | null;
  readonly attempts: number;
  readonly reason: string | null;
}

export const KAM_SHARE_TTL_S = 30 * 86_400;
export const KAM_SHARE_MAX_ATTEMPTS = 5;
const RECORD_ID = /^\d{15,22}$/;
const LOG_NS = "kam-share";
const keyOf = (contactId: string) => `kamshare|${contactId}`;
const CURSOR = "kamshare|cursor";
const ACTOR = Object.freeze({ kind: "service" as const, job: "kam-share" });

function parse(raw: string | null): Stored | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Partial<Stored>;
    if (x.state !== "shared" && x.state !== "pending" && x.state !== "failed") return null;
    const id = (v: unknown) => (typeof v === "string" && RECORD_ID.test(v) ? v : null);
    return {
      state: x.state, toKam: id(x.toKam), fromKam: id(x.fromKam), queuedAt: typeof x.queuedAt === "number" ? x.queuedAt : 0,
      lastTriedAt: typeof x.lastTriedAt === "number" ? x.lastTriedAt : null, attempts: typeof x.attempts === "number" ? x.attempts : 0,
      reason: typeof x.reason === "string" ? x.reason.slice(0, 40) : null,
    };
  } catch { return null; }
}

export interface KamShareQueueDeps {
  readonly state: SharedState;
  readonly client: KamShareClient;
  /** The "kam-share" service credential, or null when the share service is not configured on this host. */
  readonly credential: (signal?: AbortSignal) => Promise<ServiceCredential | null>;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

export interface DrainSummary {
  readonly tried: number; readonly shared: readonly string[]; readonly pending: readonly string[]; readonly failed: readonly string[];
  /** The share service has no credential on this host: nothing was tried and the cursor did not move. */
  readonly notConfigured?: true;
}

export function createKamShareQueue(d: KamShareQueueDeps) {
  const clock = d.clock ?? Date.now;
  const index = createSharedLog(d.state, LOG_NS, { ttlSeconds: KAM_SHARE_TTL_S });
  const event = (reason: string, ids: readonly string[]) => {
    try { d.log.event?.({ at: clock(), actor: ACTOR, action: "kam-share", reason, recordIds: ids.slice(0, 200) }); } catch { /* a sink never takes the job down */ }
  };
  const read = async (contactId: string): Promise<Stored | null> => parse(await d.state.get(keyOf(contactId)));
  const save = (contactId: string, s: Stored) => d.state.set(keyOf(contactId), JSON.stringify(s), KAM_SHARE_TTL_S);

  /** Queue a task: pending, listed for the drain. Returns the stored task. */
  async function enqueue(contactId: string, t: Omit<KamShareTask, "contactId">): Promise<Stored> {
    const s: Stored = { state: "pending", toKam: t.toKam, fromKam: t.fromKam, queuedAt: clock(), lastTriedAt: null, attempts: 0, reason: null };
    await save(contactId, s);
    await index.append(contactId).catch(() => 0);
    return s;
  }

  /** One attempt of a stored task; saves the outcome only while that task is still the stored one. */
  async function attempt(contactId: string, s: Stored, o: { shouldStop?: () => boolean; signal?: AbortSignal }): Promise<KamShareState> {
    const now = clock();
    const tried: Stored = { ...s, lastTriedAt: now, attempts: s.attempts + 1 };
    let next: Stored;
    const cred = await d.credential(o.signal).catch(() => null);
    if (!cred) {
      next = { ...tried, state: "pending", attempts: s.attempts, reason: "not-configured" };
    } else {
      const r = await applyKamShare(d.client, cred, { contactId, toKam: s.toKam, fromKam: s.fromKam }, o).catch(() => ({ ok: false as const, reason: "read-failed" as const }));
      if (!r.ok) {
        next = { ...tried, state: "failed", reason: r.reason };
        event(r.reason, [contactId]);
      } else {
        const failed = r.outcomes.filter((x) => x.status === "failed").map((x) => x.id);
        const changed = r.outcomes.filter((x) => x.status !== "unchanged" && x.status !== "failed").map((x) => x.id);
        next = failed.length ? { ...tried, state: "failed", reason: "record-failed" } : r.complete ? { ...tried, state: "shared", reason: null } : { ...tried, state: "pending", reason: "cut-short" };
        event(`${next.state}.count-${r.outcomes.length}`, [contactId, ...changed, ...failed]);
      }
    }
    const still = await read(contactId).catch(() => null);
    if (still && still.queuedAt !== s.queuedAt) return still.state;   // a newer KAM change owns the key
    await save(contactId, next).catch(() => undefined);
    // listed again for the next drain (not when the service is unconfigured: the drain does not move past it then)
    if (cred && next.state !== "shared" && next.attempts < KAM_SHARE_MAX_ATTEMPTS) await index.append(contactId).catch(() => 0);
    return next.state;
  }

  return Object.freeze({
    /** Queue the task and try it now inside the caller's budget. Never throws; answers the state reached. */
    async run(t: KamShareTask, o: { shouldStop?: () => boolean; signal?: AbortSignal } = {}): Promise<KamShareState> {
      if (!RECORD_ID.test(t.contactId)) return "none";
      let s: Stored;
      try { s = await enqueue(t.contactId, t); } catch { return "none"; }
      if (o.shouldStop?.()) return "pending";
      try { return await attempt(t.contactId, s, o); } catch { return "pending"; }
    },

    /** Queue without trying (a seat change's pool return, when its request time is spent). */
    async enqueue(t: KamShareTask): Promise<boolean> {
      if (!RECORD_ID.test(t.contactId)) return false;
      try { await enqueue(t.contactId, t); return true; } catch { return false; }
    },

    /** What the investor drawer shows. */
    async status(contactId: string): Promise<KamShareStatus> {
      const s = RECORD_ID.test(contactId) ? await read(contactId) : null;
      return s ? { state: s.state, lastTriedAt: s.lastTriedAt } : { state: "none", lastTriedAt: null };
    },

    /** The stored task (for Retry), or null. */
    async task(contactId: string): Promise<{ readonly toKam: string | null; readonly fromKam: string | null } | null> {
      const s = RECORD_ID.test(contactId) ? await read(contactId) : null;
      return s ? { toKam: s.toKam, fromKam: s.fromKam } : null;
    },

    /** The job's drain: every Contact queued since the last drain whose share is still pending or failed (attempts left). */
    async drain(o: { shouldStop?: () => boolean; signal?: AbortSignal } = {}): Promise<DrainSummary> {
      const shared: string[] = [], pending: string[] = [], failed: string[] = [];
      let tried = 0;
      if (!(await d.credential(o.signal).catch(() => null))) return Object.freeze({ tried, shared, pending, failed, notConfigured: true });
      const head = await index.head();
      const from = Number(await d.state.get(CURSOR)) || 0;
      const seen = new Set<string>();
      let n = from + 1;
      for (; n <= head; n++) {
        if (o.shouldStop?.()) break;
        const id = await index.at(n).catch(() => null);
        if (!id || !RECORD_ID.test(id) || seen.has(id)) continue;
        seen.add(id);
        const s = await read(id).catch(() => null);
        if (!s || s.state === "shared" || s.attempts >= KAM_SHARE_MAX_ATTEMPTS) continue;
        tried++;
        const st = await attempt(id, s, o);
        (st === "shared" ? shared : st === "failed" ? failed : pending).push(id);
      }
      await d.state.set(CURSOR, String(n - 1)).catch(() => undefined);
      return Object.freeze({ tried, shared: Object.freeze(shared), pending: Object.freeze(pending), failed: Object.freeze(failed) });
    },
  });
}
export type KamShareQueue = ReturnType<typeof createKamShareQueue>;
