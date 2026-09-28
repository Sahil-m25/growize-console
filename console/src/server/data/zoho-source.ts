/**
 * M01-S03-T01 — THE LIVE SOURCE behind `zohoSource` (src/lib/data/source.ts): server-only.
 *
 * Process-wide, once: the gate (≤12 in flight, ≤8 complex — lib/zoho/gate defaults), the scoped
 * aggregate cache, Plane B (ops log, alerting sink) and Plane C. Per request: one Zoho client on that
 * gate, the signed-in person's own credential from their session (D53), and the live data layer.
 *
 * `loadLiveDataset()` answers null — and the caller serves the empty book — when Zoho sign-in is not
 * configured (fixture/dev builds, tests) or nobody is signed in. When the person's primary book cannot
 * be read it throws `LiveReadError`, so /api/data answers an error the page shows, never an empty or
 * older book passed off as current (D45).
 */

import type { Dataset } from "../../lib/data/types";
import { createScopedCache, type ScopedCache } from "../../lib/zoho/cache";
import { createZohoClient } from "../../lib/zoho/client";
import { createGate, type Gate } from "../../lib/zoho/gate";
import { createMemorySink, createOpsLog, type OpsLog } from "../../lib/zoho/log";
import { createPlaneCLog, createPlaneCMemorySink, type PlaneCLog } from "../identity/plane-c";
import { alertingOpsSink } from "../ops/runtime";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { SID_COOKIE } from "../oauth/user-session";
import { createInvestorEvents, type InvestorEvents } from "./events";
import { createLiveDataLayer, type LiveLoad, type SeatIds } from "./live";

export interface DataRuntime {
  readonly gate: Gate;
  readonly cache: ScopedCache;
  readonly log: OpsLog;
  readonly planeC: PlaneCLog;
  readonly events: InvestorEvents;
}

const G = globalThis as typeof globalThis & { __gzDataRuntime?: DataRuntime };

/** The one gate, cache and log pair of this process (kept across dev reloads). */
export function dataRuntime(): DataRuntime {
  if (G.__gzDataRuntime) return G.__gzDataRuntime;
  const log = createOpsLog(alertingOpsSink(createMemorySink()));
  const planeC = createPlaneCLog(createPlaneCMemorySink());
  const rt: DataRuntime = Object.freeze({ gate: createGate(), cache: createScopedCache(), log, planeC, events: createInvestorEvents({ log, planeC }) });
  G.__gzDataRuntime = rt;
  return rt;
}

export class LiveReadError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Zoho did not answer the signed-in person's book (${problems.join(", ")}).`);
    this.name = "LiveReadError";
  }
}

/** A primary book (leads, investors) that failed at the source — not a refusal, not a truncation. */
const PRIMARY = /^(leads|investors):(?!truncated|scope-drift|source-invalid|session-changed|capability-missing|no-team-scope|seat-denied|invalid-request|book-too-large)/;

export function mustFail(load: LiveLoad): boolean {
  return load.problems.some((p) => PRIMARY.test(p));
}

/** The signed-in person's live Dataset, or null when there is no Zoho sign-in or no session. */
export async function loadLiveDataset(env: NodeJS.ProcessEnv = process.env): Promise<Dataset | null> {
  if (!zohoSignInConfigured(env)) return null;
  const { cookies } = await import("next/headers");
  const sid = (await cookies()).get(SID_COOKIE)?.value;
  if (!sid) return null;
  const sessions = userSessions(env);
  const first = await sessions.credential(sid);
  if (!first.ok) return null;

  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  let seatIds: SeatIds | undefined;
  try { seatIds = JSON.parse(env.ZOHO_SEAT_IDS!) as SeatIds; } catch { seatIds = undefined; }
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const layer = createLiveDataLayer({
    crm, cache: rt.cache, log: rt.log, events: rt.events, recordIdPrefix, seatIds,
    unassignedQueueUserId: env.ZOHO_UNASSIGNED_QUEUE_USER_ID || null,
    recheck: async (s) => {
      const r = await sessions.credential(s);
      return r.ok ? { credential: r.credential, session: r.session } : null;
    },
  });
  const load = await layer.load({ credential: first.credential, session: first.session, sessionId: sid });
  if (mustFail(load)) throw new LiveReadError(load.problems);
  return load.ds;
}
