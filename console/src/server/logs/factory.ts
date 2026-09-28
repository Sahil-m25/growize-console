/**
 * M01-S04-T01 — ONE FACTORY FOR THE LOG SINKS EVERY RUNTIME USES (Plane B calls and refusals, Plane B
 * error lines, Plane C identity and authority events).
 *
 *   LOG_STORE   "memory" (default) | "jsonl"
 *   LOG_DIR     absolute directory for the daily files; required when LOG_STORE=jsonl
 *
 * Fixture mode always gets memory, so tests and the demo never write a file. In jsonl mode each
 * sink is a tee: the in-memory ring the System and Activity checks already read, plus the
 * append-only daily file (`jsonl.ts`). Every record passes `guardRecord` first, whichever producer
 * wrote it. A misconfigured store throws at start-up rather than silently logging nowhere. The file
 * write happens after the ring write, and a failure there is thrown to the log writer, which reports
 * it through its own onSinkError and never fails the request (lib/zoho/log.ts, plane-c.ts).
 */

import { fixtureModeOn } from "../../lib/fixture-mode";
import { createMemorySink, type MemorySink, type OpsRecord } from "../../lib/zoho/log";
import { createMemoryErrorSink, type ErrorRecord, type MemoryErrorSink } from "../http/error-log";
import { createPlaneCMemorySink, type PlaneCEvent, type PlaneCMemorySink } from "../identity/plane-c";
import { guardRecord } from "./guard";
import { createJsonlStore, type AppendOnlyStore } from "./jsonl";

export type LogStoreKind = "memory" | "jsonl";

export function logStoreKind(env: NodeJS.ProcessEnv = process.env): LogStoreKind {
  if (fixtureModeOn(env)) return "memory";
  const v = (env.LOG_STORE ?? "").trim();
  if (v === "" || v === "memory") return "memory";
  if (v === "jsonl") return "jsonl";
  throw new Error(`LOG_STORE must be "memory" or "jsonl".`);
}

export interface LogSinks {
  readonly kind: LogStoreKind;
  readonly dir: string | null;
  readonly ops: MemorySink;
  readonly identity: PlaneCMemorySink;
  readonly errors: MemoryErrorSink;
  /** Read-only access to the day files (jsonl only), for the System and Activity checks. */
  readonly stores: Readonly<{ ops: AppendOnlyStore; identity: AppendOnlyStore; errors: AppendOnlyStore }> | null;
}

export interface LogSinkOptions {
  readonly clock?: () => number;
  readonly capacity?: number;
}

export function createLogSinks(env: NodeJS.ProcessEnv = process.env, o: LogSinkOptions = {}): LogSinks {
  const kind = logStoreKind(env);
  let dir: string | null = null;
  let stores: LogSinks["stores"] = null;
  if (kind === "jsonl") {
    dir = (env.LOG_DIR ?? "").trim();
    if (!dir) throw new Error("LOG_DIR is required when LOG_STORE=jsonl.");
    stores = Object.freeze({
      ops: createJsonlStore({ dir, plane: "ops", clock: o.clock }),
      identity: createJsonlStore({ dir, plane: "identity", clock: o.clock }),
      errors: createJsonlStore({ dir, plane: "errors", clock: o.clock }),
    });
  }
  const ring = createMemorySink({ capacity: o.capacity ?? 5_000 });
  const cRing = createPlaneCMemorySink(o.capacity ?? 5_000);
  const eRing = createMemoryErrorSink({ capacity: Math.min(o.capacity ?? 2_000, 2_000) });

  const ops: MemorySink = Object.freeze({
    write(record: OpsRecord) {
      const g = guardRecord(record).record;
      ring.write(g);
      stores?.ops.append(g);
    },
    records: () => ring.records(),
    headroom: () => ring.headroom(),
    /** Clears the in-memory view only; the day files are never touched. */
    clear: () => ring.clear(),
  });
  const identity: PlaneCMemorySink = Object.freeze({
    write(event: PlaneCEvent) {
      const g = guardRecord(event).record;
      cRing.write(g);
      stores?.identity.append(g);
    },
    events: () => cRing.events(),
  });
  const errors: MemoryErrorSink = Object.freeze({
    write(record: ErrorRecord) {
      const g = guardRecord(record).record;
      eRing.write(g);
      stores?.errors.append(g);
    },
    records: () => eRing.records(),
    clear: () => eRing.clear(),
  });
  return Object.freeze({ kind, dir, ops, identity, errors, stores });
}

const G = globalThis as typeof globalThis & { __gzLogSinks?: LogSinks };

/** The one set of log sinks of this process (kept across dev reloads). */
export function logSinks(env: NodeJS.ProcessEnv = process.env): LogSinks {
  G.__gzLogSinks ??= createLogSinks(env);
  return G.__gzLogSinks;
}

export const sharedOpsSink = (): MemorySink => logSinks().ops;
export const sharedPlaneCSink = (): PlaneCMemorySink => logSinks().identity;
export const sharedErrorSink = (): MemoryErrorSink => logSinks().errors;
