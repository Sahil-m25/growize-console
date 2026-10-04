/**
 * THE INVESTOR-APP PUSH QUEUE IN SharedState (docs/architecture/shared-state.md inventory 10).
 *
 * The outbox (./outbox.ts) keeps its in-process view; with this queue behind it (STATE_STORE=catalyst) every
 * queued event is also written here, so a recycled instance loses nothing and any instance can drain it:
 *
 *   ob|ev|<id>|<i>   the event, in chunks of 3,500 characters, while it is not delivered (TTL 14 days)
 *   ob|item|<id>     its delivery state: type, record ids, status, attempts, reason, next attempt (TTL 14 days)
 *   ob|done|<id>     set once by whoever learns it was delivered — a push.delivered on any instance; it beats a
 *                    stale "retrying" written by a slower attempt
 *   ob|listed|<id>   the id is in the index (so a re-save after a failed write does not list it twice)
 *   ob|send|<id>     the claim one instance holds while it makes ONE delivery attempt (TTL 120 s): two instances
 *                    never send the same event at once. The holder re-reads the state after claiming, so an
 *                    attempt another instance already made is seen and not repeated.
 *   log|outbox|…     the index of event ids (./../state/shared-log), read by every instance's drain
 *   ob|low           the lowest index slot that may still be open, so a fresh instance does not re-read history
 *
 * Rule 7. The event is the one SharedState value that carries text (a reply, an update body) and not only ids:
 * it passed the outbox's identity guard (identityPaths: no PAN, Aadhaar, account number, IFSC or UTR shape) and
 * the schema check before it is queued, and it is deleted on delivery. The item and the index carry ids and codes.
 *
 * A crash between "sent" and "state saved" means the next attempt may resend after the claim expires; the
 * receiver dedupes on event_id, the push's idempotency key (contracts/_envelope.json), so it is applied once.
 */

import { createSharedLog, type SharedLogReader } from "../state/shared-log";
import type { SharedState } from "../state/shared-state";
import type { DeliveryStatus } from "./outbox";

export interface StoredDelivery {
  readonly eventId: string;
  readonly type: string;
  readonly recordIds: readonly string[];
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly lastReason: string | null;
  readonly nextAt: number | null;
  readonly deliveredAt: number | null;
}

export interface OutboxQueue {
  readonly kind: "shared";
  /** Store the event and its state and list it (idempotent; safe to call again after a failure). Returns the index slot. */
  add(d: StoredDelivery, event: Record<string, unknown>): Promise<number | null>;
  /** Store a new delivery state (a delivered state also drops the event and sets the done mark). */
  save(d: StoredDelivery): Promise<void>;
  /** A push.delivered for an event this instance may never have seen. */
  markDelivered(eventId: string, at: number): Promise<void>;
  /** The state (done mark applied) and, while not delivered, the event. Null when unknown or expired. */
  read(eventId: string): Promise<{ readonly delivery: StoredDelivery; readonly event: Record<string, unknown> | null } | null>;
  /** Claim one delivery attempt of this event (false: another instance is attempting it now). */
  lock(eventId: string): Promise<boolean>;
  unlock(eventId: string): Promise<void>;
  /** Event ids listed since the last call (first call: from the low-water slot). */
  listed(): Promise<ReadonlyArray<{ readonly slot: number; readonly eventId: string }>>;
  /** Tell the queue the lowest slot this instance still holds open (null: none), to move the low-water mark. */
  lowWater(lowestOpenSlot: number | null): Promise<void>;
}

export const OUTBOX_TTL_S = 14 * 86_400;
export const OUTBOX_LOCK_S = 120;
export const CHUNK = 3_500;
export const MAX_CHUNKS = 16;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: readonly DeliveryStatus[] = ["queued", "retrying", "delivered", "dead"];

function parseDelivery(eventId: string, raw: string | null): (StoredDelivery & { parts: number }) | null {
  if (raw === null) return null;
  try {
    const x = JSON.parse(raw) as Partial<StoredDelivery & { parts: number }>;
    if (typeof x.type !== "string" || !STATUSES.includes(x.status as DeliveryStatus) || typeof x.attempts !== "number" || !Array.isArray(x.recordIds)) return null;
    return {
      eventId, type: x.type, recordIds: x.recordIds.filter((r): r is string => typeof r === "string"), status: x.status as DeliveryStatus, attempts: x.attempts,
      lastReason: typeof x.lastReason === "string" ? x.lastReason : null, nextAt: typeof x.nextAt === "number" ? x.nextAt : null,
      deliveredAt: typeof x.deliveredAt === "number" ? x.deliveredAt : null, parts: typeof x.parts === "number" ? x.parts : 0,
    };
  } catch { return null; }
}

export function createSharedOutboxQueue(state: SharedState, o: { readonly clock?: () => number; readonly holeMs?: number } = {}): OutboxQueue {
  const log = createSharedLog(state, "outbox", { ttlSeconds: OUTBOX_TTL_S, clock: o.clock, holeMs: o.holeMs });
  let reader: SharedLogReader | null = null;
  let storedLow = 0;
  const k = {
    ev: (id: string, i: number) => `ob|ev|${id}|${i}`, item: (id: string) => `ob|item|${id}`, done: (id: string) => `ob|done|${id}`,
    listed: (id: string) => `ob|listed|${id}`, send: (id: string) => `ob|send|${id}`, low: "ob|low",
  };
  const check = (id: string) => { if (!ID.test(id)) throw new TypeError("An outbox event id is a uuid."); return id; };
  const itemValue = (d: StoredDelivery, parts: number) => JSON.stringify({
    type: d.type, recordIds: d.recordIds, status: d.status, attempts: d.attempts, lastReason: d.lastReason, nextAt: d.nextAt, deliveredAt: d.deliveredAt, parts,
  });
  const dropEvent = async (id: string, parts: number) => { for (let i = 0; i < parts; i++) await state.release(k.ev(id, i)); };

  const q: OutboxQueue = {
    kind: "shared",
    async add(d, event) {
      const id = check(d.eventId);
      const body = JSON.stringify(event);
      const parts = Math.ceil(body.length / CHUNK);
      if (parts > MAX_CHUNKS) throw new RangeError("An investor-app event is too large for the shared queue.");
      for (let i = 0; i < parts; i++) await state.set(k.ev(id, i), body.slice(i * CHUNK, (i + 1) * CHUNK), OUTBOX_TTL_S);
      await state.set(k.item(id), itemValue(d, parts), OUTBOX_TTL_S);
      const listed = await state.get(k.listed(id));
      if (listed !== null) return Number(listed) || null;
      const slot = await log.append(id);
      await state.set(k.listed(id), String(slot), OUTBOX_TTL_S);
      return slot;
    },
    async save(d) {
      const id = check(d.eventId);
      const prev = parseDelivery(id, await state.get(k.item(id)));
      const parts = prev?.parts ?? 0;
      if (d.status === "delivered") {
        await state.set(k.done(id), String(d.deliveredAt ?? 0), OUTBOX_TTL_S);
        await state.set(k.item(id), itemValue(d, 0), OUTBOX_TTL_S);
        await dropEvent(id, parts);
        return;
      }
      await state.set(k.item(id), itemValue(d, parts), OUTBOX_TTL_S);
    },
    async markDelivered(eventId, at) {
      const id = check(eventId);
      await state.set(k.done(id), String(at), OUTBOX_TTL_S);
      const prev = parseDelivery(id, await state.get(k.item(id)));
      if (prev && prev.status !== "delivered") await q.save({ ...prev, status: "delivered", deliveredAt: at, nextAt: null, lastReason: null });
    },
    async read(eventId) {
      const id = check(eventId);
      const [raw, done] = await Promise.all([state.get(k.item(id)), state.get(k.done(id))]);
      const d = parseDelivery(id, raw);
      if (!d) return null;
      const { parts, ...delivery } = d;
      if (done !== null) return { delivery: { ...delivery, status: "delivered", deliveredAt: d.deliveredAt ?? (Number(done) || null), nextAt: null, lastReason: null }, event: null };
      if (d.status === "delivered" || parts === 0) return { delivery, event: null };
      const chunks = await Promise.all(Array.from({ length: parts }, (_, i) => state.get(k.ev(id, i))));
      if (chunks.some((c) => c === null)) return { delivery, event: null };
      try { return { delivery, event: JSON.parse(chunks.join("")) as Record<string, unknown> }; } catch { return { delivery, event: null }; }
    },
    lock: (eventId) => state.claim(k.send(check(eventId)), OUTBOX_LOCK_S),
    unlock: (eventId) => state.release(k.send(check(eventId))),
    async listed() {
      if (!reader) {
        const low = Number(await state.get(k.low)) || 0;
        storedLow = low;
        reader = log.reader({ from: Math.max(0, low - 1) });
      }
      const got = await reader.poll();
      return got.filter((x) => ID.test(x.line)).map((x) => ({ slot: x.n, eventId: x.line }));
    },
    async lowWater(lowestOpenSlot) {
      if (!reader) return;
      const holes = reader.holes();
      const candidates = [lowestOpenSlot ?? reader.cursor() + 1, ...(holes.length ? [holes[0]!] : [])];
      const low = Math.min(...candidates);
      if (low > storedLow) { await state.set(k.low, String(low)); storedLow = low; }
    },
  };
  return Object.freeze(q);
}
