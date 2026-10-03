/* M01-S08 — the Investors side's "Record it" through the one save queue (D41, BLOCKED M01-S08-NOTE-8).
   Pure and injectable so the same code runs in fixture and live mode and a unit test can drive it with a fake clock.

   - A receipt preparation (POST /api/receipts/prepare) is renewed online at least every four minutes.
   - Once it is five minutes old an OFFLINE press is refused ("Not saved yet"); it is never queued on a stale context.
   - queuedAt = the server's preparedAt + the browser's MONOTONIC elapsed time since it arrived. The device wall clock is never read.
   - A queued press waits at most five minutes (save-queue.ts); past that it fails and nothing revives it.
   - An explicit retry is a new press: a NEW idempotency key and a FRESH preparation (the held one is gone). */

import type { SaveSession } from "./save-queue";

export const PREPARE_RENEW_MS = 4 * 60_000;
export const PREPARE_MAX_OFFLINE_MS = 5 * 60_000;

export const NOT_SAVED_WAITING = "Not saved yet — waiting for a connection. Nothing on the record changed. It will fail after five minutes if it cannot save.";
export const NOT_SAVED_STALE = "Not saved yet — this form was last checked with the server more than five minutes ago, so it cannot be saved offline. Reconnect and press Record it again.";
export const NOT_SAVED_NO_CONTEXT = "Not saved yet — there is no connection and the form has not been checked with the server. Reconnect and press Record it again.";

/** What one successful prepare gave the page: the server's context and the monotonic reading when it arrived. */
export type HeldPrepare<P> = { readonly p: P; readonly preparedAt: number; readonly mono: number };

/** null → an offline press may be queued on this preparation; otherwise the words that refuse it. */
export function offlineGate<P>(held: HeldPrepare<P> | null, mono: number): string | null {
  if (!held) return NOT_SAVED_NO_CONTEXT;
  return mono - held.mono >= PREPARE_MAX_OFFLINE_MS ? NOT_SAVED_STALE : null;
}

/** The press time, derived from the server's clock plus monotonic browser time — never the device wall clock. */
export const queuedAtOf = (held: { preparedAt: number; mono: number }, mono: number): number =>
  held.preparedAt + Math.max(0, Math.floor(mono - held.mono));

/** A queue key that carries no typed text: a hash of who, which session and what was pressed. The same press twice is one key. */
export function receiptQueueKey(session: SaveSession, press: unknown): string {
  const value = JSON.stringify([session.actor, session.session, press]);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(i))) * 0x100000001b3n);
  return "receipt-" + hash.toString(16);
}

/** What the store needs to queue one save (see ConsoleCtx.enqueueSave). */
export type SaveSpec<S> = {
  key: string;
  id?: string;
  label: string;
  /** D41: re-checked at every replay against the CURRENT state (same person, still allowed, still visible). */
  validate: (state: S) => boolean;
  execute: (read: () => S) => Promise<boolean>;
  /** run before an explicit retry starts a new waiting window */
  onRetry?: () => void;
};

type Answer = { ok: true } | { ok: false; error: string };

export type ReceiptPressDeps<P extends { preparedAt: number }, R, S> = {
  key: string;
  inv: string;
  /** true when the browser was offline at the press; the press then rides on `held` */
  offline: boolean;
  held: HeldPrepare<P> | null;
  mono: () => number;
  newKey: () => string;
  prepare: () => Promise<{ ok: true; data: P } | { ok: false; error: string }>;
  record: (p: P, extra: { idempotencyKey: string; queuedAt: number | null }) => Promise<{ ok: true; data: R } | { ok: false; error: string }>;
  validate: (state: S) => boolean;
  /** after a confirmed save (live: close the drawer, clear the draft, re-read) */
  saved?: (data: R, read: () => S) => void;
};

/** Builds the queued task for one press. Throws only the words a refused/failed save says; the queue turns that into "failed". */
export function receiptSave<P extends { preparedAt: number }, R, S>(d: ReceiptPressDeps<P, R, S>): SaveSpec<S> {
  const state = { offline: d.offline, held: d.held, idem: d.newKey() };
  /* the press time is fixed at the press, not at the replay */
  const queuedAt = d.offline && d.held ? queuedAtOf(d.held, d.mono()) : null;
  return {
    key: d.key, id: d.inv, label: "Receipt",
    validate: d.validate,
    onRetry: () => { state.idem = d.newKey(); state.offline = false; state.held = null; },
    async execute(read) {
      let p: P;
      let at: number | null = null;
      if (state.offline && state.held) { p = state.held.p; at = queuedAt; }
      else {
        const r: Answer & { data?: P } = await d.prepare();
        if (!r.ok) throw new Error(r.error);
        p = r.data as P;
      }
      const r = await d.record(p, { idempotencyKey: state.idem, queuedAt: at });
      if (!r.ok) throw new Error(r.error);
      d.saved?.(r.data, read);
      return true;
    },
  };
}
