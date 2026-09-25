/**
 * THE CONCURRENCY GATE — THE CONSOLE'S OWN CEILING, SET BELOW ZOHO'S SO ZOHO NEVER HAS TO SAY NO.
 *
 * Implements D46 (concurrency binds, not credits; the sub-concurrency bucket is where Leads and
 * Numbers live), D52 (one Enterprise org: 20 concurrent, 10 on complex calls) and D53 (a
 * client-side gate of about 12 overall and about 8 complex, until T10's load test says otherwise).
 * D45 is why it exists at all: every screen now waits on a network call.
 *
 * Two pools, one queue. Every call takes an overall slot; a complex call — COQL, Get Records with
 * `sort_by` or `cvid`, a bulk write over ten records, Send Mail, Convert Lead, Composite — also
 * takes a complex slot, because Zoho counts sub-concurrency inside concurrency, not beside it. The
 * defaults are 12 and 8 against Zoho's 20 and 10: the headroom belongs to scheduled jobs, Zoho's own
 * workflows and anything else holding a token into the org. The constructor refuses limits at or
 * above Zoho's, so the headroom cannot be configured away.
 *
 * Order is first come, first served, with one exception that prevents a pile-up: a simple call may
 * pass a complex call that is waiting only for a complex slot, since it does not compete for one.
 * Complex calls keep their order among themselves, and nothing passes a call that is waiting for an
 * overall slot, so neither kind can starve the other.
 *
 * A queued request carries an AbortSignal; aborting removes it from the queue and rejects it with the
 * signal's reason. Once granted, the slot belongs to the caller until `release()` — the signal is the
 * fetch's business from there. The queue is bounded: past `maxQueued` the gate refuses at once rather
 * than hold a request for a screen whose user has given up.
 *
 * The gate is per process. Two server instances each allowing 12 is 24 against Zoho's 20: running
 * more than one instance means dividing these numbers between them (T10 measures it).
 */

/** Enterprise, org-wide (D52, correcting D46's Professional 15). */
export const ZOHO_CONCURRENCY = 20;
/** Complex calls, org-wide, the same on every edition (D46). */
export const ZOHO_SUB_CONCURRENCY = 10;
export const DEFAULT_MAX_IN_FLIGHT = 12;
export const DEFAULT_MAX_COMPLEX = 8;
export const DEFAULT_MAX_QUEUED = 500;
/** A write of more records than this is a bulk write, and complex. */
export const BULK_WRITE_THRESHOLD = 10;

export type CallClass = "simple" | "complex";

/** What a call is, in the terms Zoho's sub-concurrency list uses. */
export type CallShape =
  | { readonly op: "read" }
  | { readonly op: "list"; readonly sortBy?: boolean; readonly cvid?: boolean }
  | { readonly op: "coql" }
  | { readonly op: "write"; readonly records: number }
  | { readonly op: "send-mail" }
  | { readonly op: "convert-lead" }
  | { readonly op: "composite" };

export function classOf(shape: CallShape): CallClass {
  switch (shape.op) {
    case "read":
      return "simple";
    case "list":
      return shape.sortBy || shape.cvid ? "complex" : "simple";
    case "write":
      return shape.records > BULK_WRITE_THRESHOLD ? "complex" : "simple";
    case "coql":
    case "send-mail":
    case "convert-lead":
    case "composite":
      return "complex";
    default:
      throw new TypeError(`Unknown call shape ${JSON.stringify(shape)}.`);
  }
}

export class GateQueueFullError extends Error {
  constructor(queued: number) {
    super(`The Zoho gate already has ${queued} requests waiting; refusing rather than queueing more.`);
    this.name = "GateQueueFullError";
  }
}

export interface GateLease {
  readonly cls: CallClass;
  readonly waitedMs: number;
  /** Idempotent. */
  release(): void;
}

export interface GateSnapshot {
  readonly inFlight: number;
  readonly complexInFlight: number;
  readonly queued: number;
  readonly peakInFlight: number;
  readonly peakComplexInFlight: number;
  readonly maxInFlight: number;
  readonly maxComplex: number;
}

export interface Gate {
  acquire(cls: CallClass, signal?: AbortSignal): Promise<GateLease>;
  run<T>(cls: CallClass, task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
  snapshot(): GateSnapshot;
}

export type GateOptions = {
  readonly maxInFlight?: number;
  readonly maxComplex?: number;
  readonly maxQueued?: number;
  readonly clock?: () => number;
};

type Waiter = {
  readonly cls: CallClass;
  readonly queuedAt: number;
  readonly resolve: (lease: GateLease) => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
};

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The request was aborted before it reached Zoho.", "AbortError");

export function createGate(options: GateOptions = {}): Gate {
  const maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const maxComplex = options.maxComplex ?? DEFAULT_MAX_COMPLEX;
  const maxQueued = options.maxQueued ?? DEFAULT_MAX_QUEUED;
  const clock = options.clock ?? Date.now;
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight >= ZOHO_CONCURRENCY) {
    throw new RangeError(`maxInFlight must be 1–${ZOHO_CONCURRENCY - 1}: Zoho's own limit is ${ZOHO_CONCURRENCY} and the gate keeps headroom.`);
  }
  if (!Number.isInteger(maxComplex) || maxComplex < 1 || maxComplex >= ZOHO_SUB_CONCURRENCY || maxComplex > maxInFlight) {
    throw new RangeError(`maxComplex must be 1–${ZOHO_SUB_CONCURRENCY - 1} and no more than maxInFlight.`);
  }
  if (!Number.isInteger(maxQueued) || maxQueued < 0) throw new RangeError("maxQueued must be a whole number.");

  let inFlight = 0;
  let complexInFlight = 0;
  let peakInFlight = 0;
  let peakComplexInFlight = 0;
  const queue: Waiter[] = [];

  const grant = (w: Waiter) => {
    inFlight++;
    if (w.cls === "complex") complexInFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    peakComplexInFlight = Math.max(peakComplexInFlight, complexInFlight);
    if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
    let released = false;
    w.resolve({
      cls: w.cls,
      waitedMs: Math.max(0, clock() - w.queuedAt),
      release: () => {
        if (released) return;
        released = true;
        inFlight--;
        if (w.cls === "complex") complexInFlight--;
        pump();
      },
    });
  };

  const pump = () => {
    let complexBlocked = false;
    for (let i = 0; i < queue.length; ) {
      if (inFlight >= maxInFlight) return; // everyone needs an overall slot: nobody passes here
      const w = queue[i];
      if (w.cls === "complex" && (complexBlocked || complexInFlight >= maxComplex)) {
        complexBlocked = true; // later complex calls keep their place behind this one
        i++;
        continue;
      }
      queue.splice(i, 1);
      grant(w);
    }
  };

  const acquire = (cls: CallClass, signal?: AbortSignal): Promise<GateLease> => {
    if (cls !== "simple" && cls !== "complex") return Promise.reject(new TypeError(`Unknown call class ${String(cls)}.`));
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    return new Promise<GateLease>((resolve, reject) => {
      const w: Waiter = { cls, queuedAt: clock(), resolve, reject, signal };
      queue.push(w);
      pump();
      const at = queue.indexOf(w);
      if (at < 0) return; // granted at once
      if (queue.length > maxQueued) {
        queue.splice(at, 1);
        reject(new GateQueueFullError(queue.length));
        return;
      }
      if (signal) {
        w.onAbort = () => {
          const i = queue.indexOf(w);
          if (i < 0) return;
          queue.splice(i, 1);
          reject(abortReason(signal));
          pump();
        };
        signal.addEventListener("abort", w.onAbort, { once: true });
      }
    });
  };

  const run = async <T>(cls: CallClass, task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const lease = await acquire(cls, signal);
    try {
      return await task();
    } finally {
      lease.release();
    }
  };

  const snapshot = (): GateSnapshot => ({
    inFlight,
    complexInFlight,
    queued: queue.length,
    peakInFlight,
    peakComplexInFlight,
    maxInFlight,
    maxComplex,
  });

  return { acquire, run, snapshot };
}
