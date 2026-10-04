/**
 * M01-S08-NOTE-6 — who must hear that a session is ending, before it is destroyed. The receipt-replay service
 * (server/money/receipt-replay.ts, one per process) registers its `discardSession` here when it is composed
 * (app/api/receipts/compose.ts); user-session.ts calls `notifySessionEnd` from sign-out, change of person (the
 * callback signs the prior session out), expiry and revocation — every end where the raw session id is known.
 *
 * Local only: it reaches this instance's queued work. Other instances learn from the shared session store — their
 * replay's session recheck reads the record and finds it gone (M18-S09-NOTE-1). Listeners must not throw; a throw is
 * swallowed so that discarding never blocks the sign-out. Nothing here logs.
 */

export type SessionEndListener = (who: string, sid: string) => void;

const G = globalThis as typeof globalThis & { __gzSessionEnd?: Set<SessionEndListener> };
const listeners = (): Set<SessionEndListener> => (G.__gzSessionEnd ??= new Set());

/** Register a listener (idempotent for the same function). Returns the unregister. */
export function onSessionEnd(fn: SessionEndListener): () => void {
  listeners().add(fn);
  return () => { listeners().delete(fn); };
}

export function notifySessionEnd(who: string, sid: string): void {
  for (const fn of listeners()) {
    try { fn(who, sid); } catch { /* never blocks the sign-out */ }
  }
}
