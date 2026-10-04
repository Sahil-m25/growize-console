/**
 * M15-S05-T01 — server-only composition for the Logs API: the process's sinks as a read source, and one
 * Plane B writer (with the `event` kind) for this area's own refusals and events.
 */

import { createOpsLog, type OpsEventLog } from "../../lib/zoho/log";
import { verifyChain, type ChainVerdict } from "./chain";
import { logSinks, type LogSinks } from "./factory";
import { logSourceOf, type LogSource } from "./reader";

const G = globalThis as typeof globalThis & { __gzLogsRuntime?: { source: LogSource; log: OpsEventLog } };

function held() {
  if (!G.__gzLogsRuntime) {
    const sinks = logSinks();
    G.__gzLogsRuntime = { source: logSourceOf(sinks), log: createOpsLog(sinks.ops) };
  }
  return G.__gzLogsRuntime;
}

/** Planes B and C as stored (day files in jsonl mode, the rings otherwise). */
export const logSource = (): LogSource => held().source;
/** Plane B on the shared sink, `event` included. */
export const planeBLog = (): OpsEventLog => held().log;

export type AuditChainCheck = ChainVerdict | { readonly ok: null; readonly day: string; readonly reason: "not-durable" };

/**
 * Plane C's hash chain for one UTC day (./chain.ts): detects an edited, deleted or reordered line, a missing or
 * edited segment and a manifest that does not match; with `anchor` (kept elsewhere for a closed day), a lost tail.
 * In memory mode there is nothing durable to verify, and the answer says so. The System check calls
 * `auditChain().verify(yesterday)`; scripts/verify-audit-chain.mjs runs the same check offline.
 */
export function auditChain(sinks: Pick<LogSinks, "stores"> = logSinks()) {
  return Object.freeze({
    async verify(day: string, anchor?: string | null): Promise<AuditChainCheck> {
      const store = sinks.stores?.identity;
      if (!store) return Object.freeze({ ok: null, day, reason: "not-durable" as const });
      return verifyChain(await store.segments(day), { day, anchor });
    },
  });
}
