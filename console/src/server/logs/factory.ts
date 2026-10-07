/**
 * M01-S04-T01 — ONE FACTORY FOR THE LOG SINKS EVERY RUNTIME USES (Plane B calls and refusals, Plane B
 * error lines, Plane C identity and authority events).
 *
 *   LOG_SINK    unset or "file" (default): the behaviour below, chosen by LOG_STORE
 *               "stratus": batched segment objects in a Catalyst Stratus bucket (./stratus.ts, docs/architecture/log-sink.md);
 *               needs STRATUS_* / GZ_STATE_PROJECT_ID / GZ_STRATUS_API_DOMAIN settings and fails closed at start-up if any is missing
 *   LOG_STORE   "memory" (default) | "jsonl" — with LOG_SINK unset or "file"
 *   LOG_DIR     absolute directory for the daily files; required when LOG_STORE=jsonl
 *
 * Plane C is hash-chained in every durable store (./chain.ts): each line carries ch, n, prev and h, added after
 * the identity guard. The in-memory ring keeps the guarded record without them.
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
import { randomBytes } from "node:crypto";
import { createChainLinker } from "./chain";
import { guardRecord } from "./guard";
import { createJsonlStore } from "./jsonl";
import { fileStore, withChain, type PlaneStore } from "./sink";
import { createStratusClient, createStratusPlaneStore, stratusConfig, stratusTokenSource, type StratusClient, type StratusFetch, type StratusPlaneStore } from "./stratus";

export type LogStoreKind = "memory" | "jsonl" | "stratus";

export function logStoreKind(env: NodeJS.ProcessEnv = process.env): LogStoreKind {
  if (fixtureModeOn(env)) return "memory";
  const sink = (env.LOG_SINK ?? "").trim();
  const v = (env.LOG_STORE ?? "").trim();
  if (sink === "stratus") {
    if (v !== "") throw new Error("LOG_SINK=stratus and LOG_STORE are both set; unset LOG_STORE (Stratus replaces the day files).");
    return "stratus";
  }
  if (sink !== "" && sink !== "file") throw new Error(`LOG_SINK must be "file" or "stratus".`);
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
  /** The durable stores (file or Stratus; null in memory mode), for the Logs, System and Activity reads. */
  readonly stores: Readonly<{ ops: PlaneStore; identity: PlaneStore; errors: PlaneStore }> | null;
  /** The Stratus bucket (stratus only), shared with the audit archive. */
  readonly objects: StratusClient | null;
  /**
   * A further durable plane for append-only records other than Planes B/C — the Zoho Sign dead-letters
   * ("sign-dead") and the investor-app push ledger ("push"): a day file under LOG_DIR (jsonl) or Stratus segments
   * (stratus), so they survive a recycle and every instance reads every instance's lines. Null in memory mode.
   * Each record passes the identity guard first. One store per plane per process.
   */
  planeStore(plane: string): PlaneStore | null;
  /** Upload whatever the durable stores still buffer (a no-op for files). */
  flush(): Promise<void>;
}

export interface LogSinkOptions {
  readonly clock?: () => number;
  readonly capacity?: number;
  /** stratus: the HTTP client (tests inject one; default global fetch). */
  readonly fetch?: StratusFetch;
  /** stratus: drive flush() yourself instead of the timer (tests). */
  readonly timer?: boolean;
  /** stratus: a failed upload; default raises the backup-failed alert (server/ops). */
  readonly onFlushError?: (code: string) => void;
}

const netFetch: StratusFetch = async (url, init) => {
  const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: "error", signal: AbortSignal.timeout(30_000) });
  return { status: r.status, text: () => r.text() };
};

const alertFlush = (code: string): void => {
  void import("../ops/runtime").then((m) => m.reportOpsFailure("backup-failed", code)).catch(() => { /* never throws */ });
};

export function createLogSinks(env: NodeJS.ProcessEnv = process.env, o: LogSinkOptions = {}): LogSinks {
  const kind = logStoreKind(env);
  const clock = o.clock ?? Date.now;
  let dir: string | null = null;
  let stores: LogSinks["stores"] = null;
  let objects: StratusClient | null = null;
  let instance = `p-${randomBytes(6).toString("hex")}`;
  let makeExtra: ((plane: string) => PlaneStore) | null = null;
  if (kind === "jsonl") {
    dir = (env.LOG_DIR ?? "").trim();
    if (!dir) throw new Error("LOG_DIR is required when LOG_STORE=jsonl.");
    const d = dir;
    const file = (plane: string) => fileStore(createJsonlStore({ dir: d, plane, clock }));
    stores = Object.freeze({ ops: file("ops"), identity: withChain(file("identity"), createChainLinker(instance), clock), errors: file("errors") });
    makeExtra = file;
  } else if (kind === "stratus") {
    const c = stratusConfig(env);
    instance = c.instance;
    const f = o.fetch ?? netFetch;
    const client = createStratusClient(c, stratusTokenSource(c, f, clock), f);
    objects = client;
    const remote = (plane: string): StratusPlaneStore => createStratusPlaneStore({ client, plane, instance, clock, flushLines: c.flushLines, flushMs: c.flushMs,
      timer: o.timer, onError: o.onFlushError ?? alertFlush });
    stores = Object.freeze({ ops: remote("ops"), identity: withChain(remote("identity"), createChainLinker(instance), clock), errors: remote("errors") });
    makeExtra = remote;
    if (o.timer !== false) {
      process.once("beforeExit", () => { void flush(); });
    }
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
  const extras = new Map<string, PlaneStore>();
  const planeStore = (plane: string): PlaneStore | null => {
    if (!makeExtra) return null;
    if (plane === "ops" || plane === "identity" || plane === "errors") throw new Error("Planes B and C are written through their own sinks.");
    let st = extras.get(plane);
    if (!st) {
      const inner = makeExtra(plane);
      st = Object.freeze({ ...inner, append: (record: object) => inner.append(guardRecord(record).record) });
      extras.set(plane, st);
    }
    return st;
  };
  const all = stores;
  const flush = async (): Promise<void> => {
    if (all) await Promise.all([all.ops.flush(), all.identity.flush(), all.errors.flush(), ...[...extras.values()].map((x) => x.flush())]);
  };
  return Object.freeze({ kind, dir, ops, identity, errors, stores, objects, planeStore, flush });
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
