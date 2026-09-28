/**
 * M15-S05-T01 — server-only composition for the Logs API: the process's sinks as a read source, and one
 * Plane B writer (with the `event` kind) for this area's own refusals and events.
 */

import { createOpsLog, type OpsEventLog } from "../../lib/zoho/log";
import { logSinks } from "./factory";
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
