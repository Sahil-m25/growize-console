/* M18-S09-NOTE-2 — the per-instance state moved onto SharedState / the log sink (docs/architecture/shared-state.md):
 * the shared list, the idempotency guard, webhook seen-ids, the request index, the grant store, the push outbox
 * queue, the job claim and door, and the env switches. Each multi-instance case runs on the memory adapter (one Map
 * two "instances" share) and on two catalyst adapters over one fake Catalyst backend (the simulated race). */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSharedLog } from "./shared-log";
import { createIdempotency } from "./idempotent";
import { createMemoryState } from "./memory";
import { createCatalystState } from "./catalyst";
import { createFakeCatalyst, FAKE_CONFIG } from "./fake-catalyst";
import { instanceStateShared } from "./runtime";
import type { SharedState } from "./shared-state";
import { createSeenEvents, createSharedSeenEvents } from "../contracts/inbound";
import { createRequestIndex, createSharedRequestIndex } from "../contracts/requests";
import { createGrantStore, createSharedGrantStore, grantStoreKind } from "../access/grants";
import { caseReplied, createOutbox, type PushFetch } from "../contracts/outbox";
import { createSharedOutboxQueue } from "../contracts/outbox-queue";
import { createInProcessStub, loadSchemas } from "../contracts/stub";
import { claimJob, jobResponse, jobSecretOk } from "../jobs/claim";

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const T0 = Date.parse("2026-10-04T04:30:00Z");
type Two = { a: SharedState; b: SharedState; now: { t: number }; fake: ReturnType<typeof createFakeCatalyst> | null };
const BACKENDS: ReadonlyArray<{ name: string; make: () => Two }> = [
  { name: "memory", make: () => { const now = { t: T0 }; const s = createMemoryState({ clock: () => now.t }); return { a: s, b: s, now, fake: null }; } },
  { name: "fake catalyst", make: () => {
    const now = { t: T0 };
    const fake = createFakeCatalyst({ seed: 21 });
    const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => now.t, sleep: async () => undefined });
    return { a: mk(), b: mk(), now, fake };
  } },
];

describe.each(BACKENDS)("instance state — $name", ({ make }) => {
  it("shared log: appends from two instances are all read by each reader, once each", async () => {
    const { a, b } = make();
    const la = createSharedLog(a, "t"), lb = createSharedLog(b, "t");
    const ra = la.reader(), rb = lb.reader();
    const ns = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? la : lb).append(`line-${i}`)));
    expect(new Set(ns).size).toBe(12);
    const got = (await ra.poll()).map((x) => x.line).sort();
    expect(got).toEqual(Array.from({ length: 12 }, (_, i) => `line-${i}`).sort());
    expect(await ra.poll()).toEqual([]);
    expect((await rb.poll()).length).toBe(12);
  });

  it("shared log: a slot handed out but not written is a hole — read when it lands, given up after holeMs", async () => {
    const { a, now } = make();
    const log = createSharedLog(a, "h", { holeMs: 60_000, clock: () => now.t });
    const r = log.reader();
    await a.incr("log|h|seq");             // a writer that took slot 1 and has not written it yet
    await log.append("two");
    expect((await r.poll()).map((x) => x.line)).toEqual(["two"]);
    expect(r.holes()).toEqual([1]);
    await a.set("log|h|1", "one");
    expect((await r.poll()).map((x) => x.line)).toEqual(["one"]);
    await a.incr("log|h|seq");             // slot 3, never written
    await r.poll();
    now.t += 60_000;
    await r.poll();
    expect(r.holes()).toEqual([]);
  });

  it("idempotency: one key pressed on two instances at once runs once; the other replays the stored answer", async () => {
    const { a, b } = make();
    let runs = 0;
    const mk = (state: SharedState) => createIdempotency<{ ok: boolean; id: string }>({ state, ns: "t", ttlSeconds: 600, keep: (r) => r.ok,
      save: (r) => JSON.stringify(r), load: (s) => JSON.parse(s) });
    const work = async () => { runs++; await new Promise((ok) => setTimeout(ok, 5)); return { ok: true, id: "r1" }; };
    const [x, y] = await Promise.all([mk(a).once("me|k1", "fp", work), mk(b).once("me|k1", "fp", work)]);
    expect(runs).toBe(1);
    expect([x.kind, y.kind].sort()).toEqual(["ran", "replay"]);
    const z = await mk(b).once("me|k1", "fp", work);
    expect(z).toEqual({ kind: "replay", result: { ok: true, id: "r1" } });
    expect((await mk(a).once("me|k1", "other", work)).kind).toBe("reused");
    expect(runs).toBe(1);
  });

  it("idempotency: an answer not kept frees the key; a press still running elsewhere makes a late one wait, then busy", async () => {
    const { a, b } = make();
    const mk = (state: SharedState, waitMs = 20_000) => createIdempotency<{ ok: boolean }>({ state, ns: "u", ttlSeconds: 600, keep: (r) => r.ok,
      save: (r) => JSON.stringify(r), load: (s) => JSON.parse(s), waitMs, sleep: async () => undefined });
    expect((await mk(a).once("k", "fp", async () => ({ ok: false }))).kind).toBe("ran");
    expect(await mk(b).once("k", "fp", async () => ({ ok: true }))).toEqual({ kind: "ran", result: { ok: true } });
    let release!: () => void;
    const slow = mk(a).once("k2", "fp", () => new Promise((ok) => { release = () => ok({ ok: true }); }));
    await new Promise((ok) => setTimeout(ok, 10));
    expect((await mk(b, 100).once("k2", "fp", async () => ({ ok: true }))).kind).toBe("busy");
    release();
    expect((await slow).kind).toBe("ran");
  });

  it("webhook seen-ids: an event applied on one instance is seen on the other", async () => {
    const { a, b } = make();
    const sa = createSharedSeenEvents(a, "inbound"), sb = createSharedSeenEvents(b, "inbound");
    expect(await sb.has("e-1")).toBe(false);
    await sa.add("e-1");
    expect(await sb.has("e-1")).toBe(true);
    expect(await createSharedSeenEvents(b, "sign-webhook").has("e-1")).toBe(false);   // one namespace per receiver
  });

  it("request index: a request filed on one instance maps to the same Case on the other (ids only)", async () => {
    const { a, b, fake } = make();
    await createSharedRequestIndex(a).put("app-req.1", "9007199254740999001", "9007199254740994101");
    expect(await createSharedRequestIndex(b).get("app-req.1")).toEqual({ caseId: "9007199254740999001", contactId: "9007199254740994101" });
    expect(await createSharedRequestIndex(b).get("app-req.2")).toBeNull();
    if (fake) expect(JSON.stringify([...fake.items.values()])).not.toContain("app-req.1");   // keys are hashed
  });

  it("grant store: a grant given on one instance holds on the other; the later change wins whatever order the lines are read in", async () => {
    const { a, b, now } = make();
    const ga = createSharedGrantStore(a, { clock: () => now.t }), gb = createSharedGrantStore(b, { clock: () => now.t });
    const BY = "9007199254740990001", WHOM = "9007199254740990002";
    expect(await gb.grantsOf(WHOM)).toEqual({});
    await ga.set({ at: now.t, by: BY, whom: WHOM, page: "leads", caps: ["view", "edit"] });
    now.t += 2_000;
    expect(await gb.grantsOf(WHOM)).toEqual({ leads: ["view", "edit"] });
    await gb.set({ at: now.t, by: BY, whom: WHOM, page: "leads", caps: null });
    now.t += 2_000;
    expect(await ga.grantsOf(WHOM)).toEqual({});
    expect(await ga.holders()).toEqual([]);
    // a fresh instance replays every line and lands on the same answer
    const gc = createSharedGrantStore(b, { clock: () => now.t });
    await gc.set({ at: now.t, by: BY, whom: WHOM, page: "farms", caps: ["view"] });
    expect(await gc.grantsOf(WHOM)).toEqual({ farms: ["view"] });
    await expect(ga.set({ at: now.t, by: BY, whom: "not-an-id", page: "leads", caps: null } as never)).rejects.toThrow(TypeError);
  });

  it("push outbox: an event queued on an instance that is then recycled is delivered by another, once", async () => {
    const { a, b, now } = make();
    const schemas = loadSchemas(path.resolve(__dirname, "../../../../contracts"));
    const KEY = "synthetic-contract-key-never-live-000000000001";
    const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => now.t });
    let sends = 0, down = true;
    const fetch: PushFetch = async (url, init) => { sends++; if (down) throw new TypeError("fetch failed"); return stub.fetch(url, init); };
    const mk = (state: SharedState) => createOutbox({ schemas, target: () => ({ url: "stub://investor-app/events", key: KEY }), fetch, clock: () => now.t,
      baseDelayMs: 1_000, queue: createSharedOutboxQueue(state, { clock: () => now.t }) });
    const first = mk(a);
    const e = caseReplied({ caseId: "9007199254740999001", contactId: "9007199254740994101", message: "Your statement is in the app.", byUserId: "9007199254740995020", at: now.t }, () => now.t);
    expect(first.enqueue(e).ok).toBe(true);
    expect(await first.drain()).toBe(1);   // the app is down: retrying
    expect(first.state(e.event_id as string)?.status).toBe("retrying");
    // the instance is recycled; two fresh ones drain at once when the app is back
    down = false;
    now.t += 5_000;
    const [x, y] = [mk(b), mk(a)];
    const tried = await Promise.all([x.drain(), y.drain()]);
    expect(tried.reduce((s, n) => s + n, 0)).toBe(1);
    expect(sends).toBe(2);   // one failed attempt, one delivery — never two at once
    expect(stub.recorded().length).toBe(1);
    await x.sync(); await y.sync();
    expect([x.state(e.event_id as string)?.status, y.state(e.event_id as string)?.status].filter(Boolean)).toContain("delivered");
    expect(await mk(b).drain()).toBe(0);   // nothing left for anyone
  });

  it("push outbox: a push.delivered landing on an instance that never saw the event marks it delivered for all", async () => {
    const { a, b, now } = make();
    const schemas = loadSchemas(path.resolve(__dirname, "../../../../contracts"));
    const fetch: PushFetch = async () => { throw new TypeError("fetch failed"); };
    const mk = (state: SharedState) => createOutbox({ schemas, target: () => ({ url: "stub://investor-app/events", key: "k".repeat(40) }), fetch, clock: () => now.t,
      baseDelayMs: 1_000, queue: createSharedOutboxQueue(state, { clock: () => now.t }) });
    const one = mk(a), two = mk(b);
    const e = caseReplied({ caseId: "9007199254740999001", contactId: "9007199254740994101", message: "Hello.", byUserId: "9007199254740995020", at: now.t }, () => now.t);
    one.enqueue(e);
    await one.drain();
    expect(two.acknowledge(e.event_id as string)).toBe(false);   // unknown here…
    await two.settle();
    now.t += 60_000;
    expect(await one.drain()).toBe(0);                          // …but the done mark stops the retry
    expect(one.state(e.event_id as string)?.status).toBe("delivered");
  });

  it("job claim: overlapping runs of one job do nothing; the claim frees when the run ends", async () => {
    const { a, b } = make();
    let runs = 0;
    let release!: () => void;
    const long = claimJob(a, "sign-recheck", () => new Promise<void>((ok) => { runs++; release = ok; }));
    await new Promise((ok) => setTimeout(ok, 10));
    expect(await claimJob(b, "sign-recheck", async () => { runs++; })).toEqual({ ran: false, reason: "already-running" });
    release();
    expect(await long).toEqual({ ran: true });
    expect(await claimJob(b, "sign-recheck", async () => { runs++; })).toEqual({ ran: true });
    expect(runs).toBe(2);
  });
});

describe("file / memory defaults keep their behaviour", () => {
  it("seen-ids and request index without a store are this process's memory", async () => {
    const seen = createSeenEvents(null);
    await seen.add("x");
    expect(await seen.has("x")).toBe(true);
    const idx = createRequestIndex(null);
    await idx.put("r", "9007199254740999001", "9007199254740994101");
    expect(await idx.get("r")).toEqual({ caseId: "9007199254740999001", contactId: "9007199254740994101" });
    const g = createGrantStore();
    g.set({ at: 1, by: "9007199254740990001", whom: "9007199254740990002", page: "leads", caps: ["view"] });
    expect(g.grantsOf("9007199254740990002")).toEqual({ leads: ["view"] });
  });

  it("the switches: STATE_STORE=catalyst makes the items shared; GRANT_STORE=shared needs it", () => {
    expect(instanceStateShared(env({}))).toBe(false);
    expect(instanceStateShared(env({ STATE_STORE: "catalyst" }))).toBe(true);
    expect(grantStoreKind(env({}))).toBe("memory");
    expect(grantStoreKind(env({ STATE_STORE: "catalyst" }))).toBe("shared");
    expect(grantStoreKind(env({ STATE_STORE: "catalyst", GRANT_STORE: "jsonl" }))).toBe("jsonl");
    expect(() => grantStoreKind(env({ GRANT_STORE: "shared" }))).toThrow(/STATE_STORE=catalyst/);
    expect(() => grantStoreKind(env({ GRANT_STORE: "nope" }))).toThrow();
  });
});

describe("the job door (POST /api/jobs/*)", () => {
  const SECRET = "synthetic-job-secret-never-live-0123456789";
  const jobEnv = env({ JOB_SECRET: SECRET });
  const req = (h?: string) => new Request("http://localhost/api/jobs/sign-recheck", { method: "POST", headers: h === undefined ? {} : { "X-Job-Secret": h } });

  it("JOB_SECRET is compared in constant time; unset or short is not-configured", () => {
    expect(jobSecretOk(SECRET, jobEnv)).toBe(true);
    expect(jobSecretOk(SECRET.slice(0, -1), jobEnv)).toBe(false);
    expect(jobSecretOk(null, jobEnv)).toBe(false);
    expect(jobSecretOk(SECRET, env({}))).toBe("not-configured");
    expect(jobSecretOk("short", env({ JOB_SECRET: "short" }))).toBe("not-configured");
  });

  it("answers 503 / 401 / 200 ran / 200 already-running / 503 state-unavailable, and never runs without the secret", async () => {
    let runs = 0;
    const run = async () => { runs++; return { ran: true } as const; };
    expect((await jobResponse(req(SECRET), "sign-recheck", run, env({}))).status).toBe(503);
    expect((await jobResponse(req("wrong"), "sign-recheck", run, jobEnv)).status).toBe(401);
    expect((await jobResponse(req(), "sign-recheck", run, jobEnv)).status).toBe(401);
    expect(runs).toBe(0);
    const ok = await jobResponse(req(SECRET), "sign-recheck", run, jobEnv);
    expect([ok.status, await ok.json()]).toEqual([200, { job: "sign-recheck", ran: true }]);
    const busy = await jobResponse(req(SECRET), "sign-recheck", async () => ({ ran: false, reason: "already-running" }), jobEnv);
    expect([busy.status, (await busy.json()).code]).toEqual([200, "already-running"]);
    expect((await jobResponse(req(SECRET), "sign-recheck", async () => ({ ran: false, reason: "state-unavailable" }), jobEnv)).status).toBe(503);
    // D121: a run may report counts and record ids; claimJob passes them through and the answer carries them
    const summary = { added: 1, addedIds: ["554023000000600002"] };
    const withSummary = await jobResponse(req(SECRET), "kam-share-reconcile", () => claimJob(createMemoryState(), "kam-share-reconcile", async () => summary), jobEnv);
    expect(await withSummary.json()).toEqual({ job: "kam-share-reconcile", ran: true, summary });
  });

  it("the Sign re-check timer is kept only on a single long-lived process (SIGN_CHECK_TIMER)", async () => {
    const { signCheckTimerOn } = await import("../zoho-sign/runtime");
    expect(signCheckTimerOn(env({}))).toBe(true);
    expect(signCheckTimerOn(env({ STATE_STORE: "catalyst" }))).toBe(false);
    expect(signCheckTimerOn(env({ STATE_STORE: "catalyst", SIGN_CHECK_TIMER: "on" }))).toBe(true);
    expect(signCheckTimerOn(env({ SIGN_CHECK_TIMER: "off" }))).toBe(false);
    expect(() => signCheckTimerOn(env({ SIGN_CHECK_TIMER: "sometimes" }))).toThrow();
  });
});

describe("append-only records go to the log sink (Sign dead-letters, push ledger)", () => {
  it("planeStore: a durable extra plane in jsonl mode, guarded, read back by day; none in memory mode; Planes B/C refused", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { createLogSinks } = await import("../logs/factory");
    const dir = mkdtempSync(path.join(tmpdir(), "gz-extra-"));
    try {
      const sinks = createLogSinks(env({ LOG_STORE: "jsonl", LOG_DIR: dir }), { clock: () => T0 });
      const dead = sinks.planeStore("sign-dead")!;
      expect(sinks.planeStore("sign-dead")).toBe(dead);
      dead.append({ at: T0, reason: "unlinked", requestId: "9007199254740999001", retryable: false, note: "PAN ABCPE1234F" });
      // another process (a restarted instance) reads the same day file
      const again = createLogSinks(env({ LOG_STORE: "jsonl", LOG_DIR: dir }), { clock: () => T0 }).planeStore("sign-dead")!;
      const lines = await again.read((await again.days())[0]!);
      expect(lines).toHaveLength(1);
      expect(JSON.stringify(lines)).not.toContain("ABCPE1234F");
      expect(() => sinks.planeStore("identity")).toThrow();
      expect(createLogSinks(env({})).planeStore("push")).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
