import { describe, expect, it } from "vitest";
import { createSaveQueue, SAVE_WAIT_MS } from "./save-queue";
import { NOT_SAVED_NO_CONTEXT, NOT_SAVED_STALE, offlineGate, PREPARE_MAX_OFFLINE_MS, PREPARE_RENEW_MS, queuedAtOf, receiptQueueKey, receiptSave } from "./receipt-queue";

/* M01-S08 / D41 / NOTE-8: the receipt press on the one save queue, with a fake wall clock, a separate monotonic clock and a switchable network. */
type P = { preparedAt: number };
function rig() {
  const w = { now: 1_000_000, mono: 0, online: false, timers: [] as { at: number; f: () => void; h: number }[], n: 0 };
  const queue = createSaveQueue({
    clock: () => w.now, isOnline: () => w.online, currentSession: () => ({ actor: "meena", session: 1 }),
    setTimer: (f, d) => { const h = ++w.n; w.timers.push({ at: w.now + d, f, h }); return h; },
    clearTimer: h => { w.timers = w.timers.filter(t => t.h !== h); },
  });
  const advance = (ms: number) => { w.now += ms; w.mono += ms; for (const t of w.timers.filter(x => x.at <= w.now)) { w.timers = w.timers.filter(x => x !== t); t.f(); } };
  const calls = { prepare: 0, record: [] as { idempotencyKey: string; queuedAt: number | null; preparedAt: number }[] };
  let keys = 0;
  const held = { p: { preparedAt: 5_000_000 } as P, preparedAt: 5_000_000, mono: 0 };
  const spec = (o: { offline: boolean; held?: typeof held | null }) => receiptSave<P, { receiptId: string }, unknown>({
    key: receiptQueueKey({ actor: "meena", session: 1 }, { inv: "I1", ref: "HDFC2609001" }), inv: "I1", offline: o.offline, held: o.held === undefined ? held : o.held,
    mono: () => w.mono, newKey: () => "K" + ++keys,
    prepare: async () => { calls.prepare++; return { ok: true, data: { preparedAt: 9_000_000 + w.mono } }; },
    record: async (p, x) => { calls.record.push({ ...x, preparedAt: p.preparedAt }); return { ok: true, data: { receiptId: "T-1" } }; },
    validate: () => true,
  });
  const enqueue = (sp: ReturnType<typeof spec>) => queue.enqueue({ actor: "meena", session: 1, key: sp.key, id: sp.id, label: sp.label, validate: () => sp.validate(null), execute: () => sp.execute(() => null) });
  return { w, queue, advance, calls, spec, enqueue, held, hooks: (sp: ReturnType<typeof spec>) => sp.onRetry!() };
}
const settle = () => new Promise(r => setTimeout(r, 0));

describe("receipt queue — the offline press", () => {
  it("queues one change offline, runs nothing, and a second press of the same form adds nothing", async () => {
    const r = rig();
    const a = r.enqueue(r.spec({ offline: true }));
    expect(a.status).toBe("pending");
    const b = r.enqueue(r.spec({ offline: true }));
    expect(b.accepted).toBe(false);
    expect(r.queue.snapshot()).toHaveLength(1);
    expect(r.calls.record).toHaveLength(0);
    expect(r.calls.prepare).toBe(0);
  });

  it("replays on reconnect with the HELD context, queuedAt = preparedAt + monotonic elapsed, and one idempotency key", async () => {
    const r = rig();
    r.advance(30_000);                                // held prepared 30 s ago (monotonic)
    r.enqueue(r.spec({ offline: true }));
    r.advance(60_000);                                // 60 s offline; queuedAt comes from the monotonic reading, not Date.now()
    r.w.now += 20_000;                                // a wall-clock skew inside the window must not move queuedAt
    r.w.online = true; r.queue.reconnect(); await settle();
    expect(r.calls.prepare).toBe(0);
    expect(r.calls.record).toEqual([{ idempotencyKey: "K1", queuedAt: 5_000_000 + 30_000, preparedAt: 5_000_000 }]);
    expect(r.queue.snapshot()).toHaveLength(0);
  });

  it("an online press prepares fresh and sends no queuedAt", async () => {
    const r = rig(); r.w.online = true;
    r.enqueue(r.spec({ offline: false, held: null })); await settle();
    expect(r.calls.prepare).toBe(1);
    expect(r.calls.record).toEqual([{ idempotencyKey: "K1", queuedAt: null, preparedAt: 9_000_000 }]);
  });

  it("past five minutes the queued press fails and reconnecting never revives it", async () => {
    const r = rig();
    r.enqueue(r.spec({ offline: true }));
    r.advance(SAVE_WAIT_MS + 1);
    expect(r.queue.snapshot()[0]!.status).toBe("failed");
    r.w.online = true; r.queue.reconnect(); await settle();
    expect(r.calls.record).toHaveLength(0);
    expect(r.queue.snapshot()[0]!.status).toBe("failed");
  });

  it("an explicit retry is a new press: new idempotency key, fresh preparation, no queuedAt", async () => {
    const r = rig();
    const sp = r.spec({ offline: true });
    r.enqueue(sp);
    r.advance(SAVE_WAIT_MS + 1);
    r.w.online = true;
    r.hooks(sp);                                      // what ConsoleCtx.retrySave does first
    r.queue.retry(sp.key); await settle();
    expect(r.calls.prepare).toBe(1);
    expect(r.calls.record).toEqual([{ idempotencyKey: "K2", queuedAt: null, preparedAt: 9_000_000 + SAVE_WAIT_MS + 1 }]);
  });

  it("a failed record is reported as failed with the route's words", async () => {
    const r = rig(); r.w.online = true;
    const sp = receiptSave<P, unknown, unknown>({ key: "k", inv: "I1", offline: false, held: null, mono: () => 0, newKey: () => "K",
      prepare: async () => ({ ok: true, data: { preparedAt: 1 } }), record: async () => ({ ok: false, error: "Not saved yet — Zoho refused it." }), validate: () => true });
    r.queue.enqueue({ actor: "meena", session: 1, key: sp.key, validate: () => true, execute: () => sp.execute(() => null) }); await settle();
    expect(r.queue.snapshot()[0]).toMatchObject({ status: "failed", error: "Not saved yet — Zoho refused it." });
  });
});

describe("receipt queue — the preparation clock", () => {
  it("renews at least every 4 minutes and refuses an offline press once it is 5 minutes old", () => {
    expect(PREPARE_RENEW_MS).toBeLessThan(PREPARE_MAX_OFFLINE_MS);
    const h = { p: {}, preparedAt: 1, mono: 100 };
    expect(offlineGate(h, 100 + PREPARE_MAX_OFFLINE_MS - 1)).toBeNull();
    expect(offlineGate(h, 100 + PREPARE_MAX_OFFLINE_MS)).toBe(NOT_SAVED_STALE);
    expect(offlineGate(null, 0)).toBe(NOT_SAVED_NO_CONTEXT);
    expect(NOT_SAVED_STALE).toMatch(/^Not saved yet/);
  });
  it("derives queuedAt from the server's preparedAt plus monotonic time, never below it", () => {
    expect(queuedAtOf({ preparedAt: 1_000, mono: 50 }, 50_500.7)).toBe(1_000 + 50_450);
    expect(queuedAtOf({ preparedAt: 1_000, mono: 50 }, 10)).toBe(1_000);
  });
  it("the queue key carries no typed text", () => {
    expect(receiptQueueKey({ actor: "meena", session: 1 }, { ref: "HDFC2609001" })).toMatch(/^receipt-[0-9a-f]+$/);
  });
});
