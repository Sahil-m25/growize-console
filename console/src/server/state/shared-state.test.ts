/* SharedState contract (docs/architecture/shared-state.md): the same suite against the memory adapter and the catalyst
 * adapter over an in-memory fake that reproduces the LIVE Catalyst NoSQL behaviour (spike run 2, 7 Oct 2026), the
 * simulated race for claim(), the catalyst adapter's failure handling, STATE_STORE selection (fail closed) and the
 * wiring of the rate limiter, step-up and webhooks onto sharedState(). */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRateLimiter, createRequestGate } from "../http/request-gate";
import { CONDITION_FAILED_CODES, createCatalystState, catalystConfigFromEnv } from "./catalyst";
import { createFakeCatalyst, FAKE_CONFIG } from "./fake-catalyst";
import { createMemoryState } from "./memory";
import { createStateFromEnv, probeState, stateStoreKind } from "./runtime";
import { SharedStateError, type SharedState } from "./shared-state";

type Rig = { state: SharedState; twin: SharedState; now: { t: number } };
const T0 = Date.parse("2026-10-04T04:30:00Z");
const fast = { sleep: async () => undefined };

const ADAPTERS: ReadonlyArray<{ name: string; make: () => Rig }> = [
  { name: "memory", make: () => { const now = { t: T0 }; const state = createMemoryState({ clock: () => now.t }); return { state, twin: state, now }; } },
  {
    name: "catalyst (fake reproducing the live spike)",
    make: (): Rig => {
      const now = { t: T0 };
      const fake = createFakeCatalyst();
      const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => now.t, ...fast });
      return { state: mk(), twin: mk(), now };   // two instances, one backend
    },
  },
];

describe.each(ADAPTERS)("SharedState contract — $name", ({ make }) => {
  it("claim is set-if-absent; release frees it", async () => {
    const { state } = make();
    expect(await state.claim("k1", 60)).toBe(true);
    expect(await state.claim("k1", 60)).toBe(false);
    await state.release("k1");
    expect(await state.claim("k1", 60)).toBe(true);
    await state.release("never-held");   // idempotent
  });

  it("a claim with a TTL expires; one without never does", async () => {
    const { state, now } = make();
    expect(await state.claim("short", 2)).toBe(true);
    expect(await state.claim("lock")).toBe(true);
    now.t += 1_999;
    expect(await state.claim("short", 2)).toBe(false);
    now.t += 1;
    expect(await state.claim("short", 2)).toBe(true);
    now.t += 10 * 365 * 86_400_000;
    expect(await state.claim("lock")).toBe(false);
  });

  it("get/set: replace, expire, release", async () => {
    const { state, now } = make();
    expect(await state.get("v")).toBeNull();
    await state.set("v", "one", 5);
    expect(await state.get("v")).toBe("one");
    await state.set("v", "two");
    expect(await state.get("v")).toBe("two");
    now.t += 86_400_000;
    expect(await state.get("v")).toBe("two");
    await state.set("w", "x", 5);
    now.t += 5_000;
    expect(await state.get("w")).toBeNull();
    await state.release("v");
    expect(await state.get("v")).toBeNull();
  });

  it("incr counts in a fixed window", async () => {
    const { state, now } = make();
    expect(await state.incr("c", 60)).toBe(1);
    now.t += 30_000;
    expect(await state.incr("c", 60)).toBe(2);
    now.t += 29_999;
    expect(await state.incr("c", 60)).toBe(3);
    now.t += 1;
    expect(await state.incr("c", 60)).toBe(1);   // the window began at the first incr, not the last
    expect(await state.incr("forever")).toBe(1);
    expect(await state.incr("forever")).toBe(2);
    await state.release("forever");
    expect(await state.incr("forever")).toBe(1);
  });

  it("take is the limiter's token bucket: burst, then Retry-After when the next token lands, refill", async () => {
    const { state, now } = make();
    for (let i = 0; i < 6; i++) expect(await state.take("b", 6, 6)).toBe(0);
    expect(await state.take("b", 6, 6)).toBe(10_000);
    now.t += 10_000;
    expect(await state.take("b", 6, 6)).toBe(0);
    expect(await state.take("b", 6, 6)).toBeGreaterThan(0);
    now.t += 60_000;
    for (let i = 0; i < 6; i++) expect(await state.take("b", 6, 6)).toBe(0);   // full again, never more than capacity
    expect(await state.take("b", 6, 6)).toBeGreaterThan(0);
  });

  it("refuses a bad key with SharedStateError", async () => {
    const { state } = make();
    await expect(state.claim("")).rejects.toBeInstanceOf(SharedStateError);
    await expect(state.get("a\nb")).rejects.toBeInstanceOf(SharedStateError);
    await expect(state.set("k", "x".repeat(5_000))).rejects.toBeInstanceOf(SharedStateError);
    await expect(state.claim("k", 0)).rejects.toBeInstanceOf(SharedStateError);
  });

  it("the race: twenty concurrent claims of one key, from two instances, give exactly one holder", async () => {
    const { state, twin } = make();
    const got = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? twin : state).claim("race", 60)));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("the race: an expired claim taken over concurrently still has exactly one new holder", async () => {
    const { state, twin, now } = make();
    expect(await state.claim("old", 1)).toBe(true);
    now.t += 1_000;
    const got = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? twin : state).claim("old", 60)));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("concurrent incr from two instances loses no count", async () => {
    const { state, twin } = make();
    const got = await Promise.all(Array.from({ length: 5 }, (_, i) => (i % 2 ? twin : state).incr("n", 60)));
    expect([...got].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

const FULL_ENV = {
  STATE_STORE: "catalyst", CATALYST_API_ORIGIN: "https://api.catalyst.zoho.in", CATALYST_PROJECT_ID: "4000000006007",
  CATALYST_STATE_TABLE: "gz_state", CATALYST_REFRESH_TOKEN: "1000.fake.refresh", ZOHO_ACCOUNTS_ORIGIN: "https://accounts.zoho.in",
  ZOHO_OAUTH_CLIENT_ID: "1000.FAKECLIENT", ZOHO_OAUTH_CLIENT_SECRET: "fake-secret-xx",
} as unknown as NodeJS.ProcessEnv;

describe("catalyst adapter — wire behaviour", () => {
  const rig = (o: { maxAttempts?: number } = {}) => {
    const fake = createFakeCatalyst();
    return { fake, state: createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => T0, ...fast, ...o }) };
  };

  it("hashes every key: no IP, user id or event key reaches Catalyst in the clear", async () => {
    const { fake, state } = rig();
    await state.claim("rate|0|auth|203.0.113.7|abc", 60);
    await state.set("stepup-lock|554023000000300007|reveal", "1");
    const wire = JSON.stringify(fake.seen) + JSON.stringify([...fake.items.keys()]);
    expect(wire).not.toMatch(/203\.0\.113\.7|554023000000300007/);
    expect([...fake.items.keys()].every((k) => /^[A-Za-z0-9_-]{43}$/.test(k))).toBe(true);
  });

  it("claim is one HTTP call when free; reads use POST /item/fetch", async () => {
    const { fake, state } = rig();
    await state.claim("one", 60);
    expect(fake.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /item"]);
    await state.get("one");
    expect(fake.seen.at(-1)).toMatchObject({ method: "POST", path: "/item/fetch" });
  });

  it("sends the verified SDK shapes: array write bodies, keys as one object, fetch with keys[] + consistent_read", async () => {
    const { fake, state } = rig();
    await state.set("shape", "x", 60);   // fetch (absent) → insert
    await state.set("shape", "y", 60);   // fetch → conditional update on ver
    await state.release("shape");
    const bodies = fake.seen.map((s) => ({ m: `${s.method} ${s.path}`, b: JSON.parse(s.body) }));
    expect(bodies.map((x) => x.m)).toEqual(["POST /item/fetch", "POST /item", "POST /item/fetch", "PUT /item", "DELETE /item"]);
    expect(bodies[0]!.b).toMatchObject({ keys: [{ K: { S: expect.any(String) } }], consistent_read: true });
    expect(Array.isArray(bodies[1]!.b) && bodies[1]!.b[0].item.K.S).toBeTruthy();
    expect(Array.isArray(bodies[3]!.b)).toBe(true);
    expect(Array.isArray(bodies[3]!.b[0].keys)).toBe(false);
    expect(bodies[3]!.b[0].keys.K.S).toBeTruthy();
    expect(bodies[3]!.b[0].condition).toMatchObject({ attribute: ["ver"], operator: "equals" });
    expect(bodies[3]!.b[0].update_attributes[0]).toMatchObject({ operation_type: "PUT", attribute_path: [expect.any(String)] });
    expect(Array.isArray(bodies[4]!.b) && bodies[4]!.b[0].keys.K.S).toBeTruthy();
  });

  it("the partition-key attribute name is configurable (CATALYST_STATE_PK)", async () => {
    const fake = createFakeCatalyst({ pk: "K" });
    const wrong = createCatalystState({ ...FAKE_CONFIG, pkName: "k" }, { fetch: fake.fetch, ...fast });
    await expect(wrong.claim("a", 60)).rejects.toMatchObject({ code: "bad-response" });   // INVALID_KEY, as the owner's first spike saw
    const right = createCatalystState({ ...FAKE_CONFIG, pkName: "K" }, { fetch: fake.fetch, ...fast });
    expect(await right.claim("a", 60)).toBe(true);
    expect(await right.claim("a", 60)).toBe(false);
    await right.set("b", "1");
    expect(await right.get("b")).toBe("1");
    expect(catalystConfigFromEnv({ ...FULL_ENV, CATALYST_STATE_PK: "K" }).pkName).toBe("K");
    expect(catalystConfigFromEnv(FULL_ENV).pkName).toBe("K");   // live table: capital K
    expect(() => catalystConfigFromEnv({ ...FULL_ENV, CATALYST_STATE_PK: "a-b" })).toThrow(/CATALYST_STATE_PK/);
  });

  it("a 5xx, a timeout-like failure or a 429 rejects with SharedStateError('unavailable'), never 'absent'", async () => {
    const { fake, state } = rig();
    await state.get("warm");   // token issued
    fake.failNext(503);
    await expect(state.get("x")).rejects.toMatchObject({ code: "unavailable" });
    fake.failNext(500);
    await expect(state.claim("x", 60)).rejects.toMatchObject({ code: "unavailable" });
    const broken = createCatalystState(FAKE_CONFIG, { fetch: async () => { throw new Error("socket hang up"); }, ...fast });
    await expect(broken.claim("x", 60)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("a revoked token is refreshed once and the call retried", async () => {
    const { fake, state } = rig();
    expect(await state.claim("a", 60)).toBe(true);
    expect(fake.tokens()).toBe(1);
    fake.revokeTokens();
    expect(await state.claim("b", 60)).toBe(true);
    expect(fake.tokens()).toBe(2);
  });

  it("under contention it gives up with 'contended' rather than lose an update", async () => {
    const { state } = rig({ maxAttempts: 1 });
    const got = await Promise.allSettled(Array.from({ length: 8 }, () => state.incr("hot", 60)));
    const ok = got.filter((g): g is PromiseFulfilledResult<number> => g.status === "fulfilled").map((g) => g.value);
    const failed = got.filter((g) => g.status === "rejected");
    expect(failed.every((f) => (f as PromiseRejectedResult).reason?.code === "contended")).toBe(true);
    expect(new Set(ok).size).toBe(ok.length);                         // no two callers saw the same count
    expect(Number(await state.incr("hot", 60))).toBe(ok.length + 1);   // every success landed
  });
});

describe("STATE_STORE selection — fails closed, never falls back to memory", () => {
  const FULL = {
    STATE_STORE: "catalyst", CATALYST_API_ORIGIN: "https://api.catalyst.zoho.in", CATALYST_PROJECT_ID: "4000000006007",
    CATALYST_STATE_TABLE: "gz_state", CATALYST_REFRESH_TOKEN: "1000.fake.refresh", ZOHO_ACCOUNTS_ORIGIN: "https://accounts.zoho.in",
    ZOHO_OAUTH_CLIENT_ID: "1000.FAKECLIENT", ZOHO_OAUTH_CLIENT_SECRET: "fake-secret-xx",
  } as unknown as NodeJS.ProcessEnv;

  it("unset or memory → memory; catalyst → catalyst; anything else throws", () => {
    expect(stateStoreKind({} as NodeJS.ProcessEnv)).toBe("memory");
    expect(stateStoreKind({ STATE_STORE: "memory" } as unknown as NodeJS.ProcessEnv)).toBe("memory");
    expect(createStateFromEnv({} as NodeJS.ProcessEnv).kind).toBe("memory");
    expect(createStateFromEnv(FULL).kind).toBe("catalyst");
    expect(() => stateStoreKind({ STATE_STORE: "redis" } as unknown as NodeJS.ProcessEnv)).toThrow(/STATE_STORE must be/);
  });

  it("catalyst with anything missing or malformed throws, naming every variable and no value", () => {
    expect(() => createStateFromEnv({ STATE_STORE: "catalyst" } as unknown as NodeJS.ProcessEnv)).toThrow(
      /CATALYST_API_ORIGIN is not set.*CATALYST_PROJECT_ID is not set.*CATALYST_STATE_TABLE is not set.*CATALYST_REFRESH_TOKEN is not set/);
    for (const [k, bad] of [["CATALYST_API_ORIGIN", "http://api.catalyst.zoho.in"], ["CATALYST_API_ORIGIN", "https://evil.example"], ["CATALYST_PROJECT_ID", "abc"],
      ["CATALYST_STATE_TABLE", "a/b"], ["ZOHO_ACCOUNTS_ORIGIN", "https://accounts.evil.example"], ["CATALYST_ORG_ID", "x1"], ["ZOHO_OAUTH_CLIENT_SECRET", "short"]] as const) {
      let msg = "";
      try { createStateFromEnv({ ...FULL, [k]: bad }); } catch (e) { msg = (e as Error).message; }
      expect(msg, k).toContain(k);
      expect(msg, k).not.toContain(bad);
    }
    expect(catalystConfigFromEnv({ ...FULL, CATALYST_ENVIRONMENT: "Development" }).environment).toBe("Development");
  });

  it("the startup probe passes on a working store and refuses a broken or non-atomic one", async () => {
    await probeState(createMemoryState());
    const fake = createFakeCatalyst();
    await probeState(createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, ...fast }));
    const down = createFakeCatalyst();
    down.failNext(500, 500, 500);
    await expect(probeState(createCatalystState(FAKE_CONFIG, { fetch: down.fetch, ...fast }))).rejects.toThrow(/did not answer at startup/);
    const liar: SharedState = { ...createMemoryState(), kind: "liar", claim: async () => true };
    await expect(probeState(liar)).rejects.toThrow(/not set-if-absent/);
  });
});

describe("callers on the interface", () => {
  const req = (h: Record<string, string> = {}) => new Request("https://console.example.in/x", { headers: h });

  it("the rate limiter behaves the same over the catalyst adapter (6/min: burst, Retry-After 10 s, refill)", async () => {
    let now = T0;
    const fake = createFakeCatalyst();
    const lim = createRateLimiter({ rules: [{ name: "t", matches: () => true, perMinute: 6 }], state: createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => now, ...fast }) });
    for (let i = 0; i < 6; i++) expect((await lim.check("/x", req())).ok).toBe(true);
    expect(await lim.check("/x", req())).toEqual({ ok: false, rule: "t", retryAfterS: 10 });
    now += 10_000;
    expect((await lim.check("/x", req())).ok).toBe(true);
  });

  it("two instances share one limit when they share the store", async () => {
    const shared = createMemoryState({ clock: () => T0 });
    const rules = [{ name: "t", matches: () => true, perMinute: 3 }];
    const a = createRateLimiter({ rules, state: shared }), b = createRateLimiter({ rules, state: shared });
    const got = [await a.check("/x", req()), await b.check("/x", req()), await a.check("/x", req()), await b.check("/x", req())];
    expect(got.map((g) => g.ok)).toEqual([true, true, true, false]);
  });

  it("a store that cannot answer lets the request through (PROVISIONAL fail-open) — the handler still runs", async () => {
    const down: SharedState = { ...createMemoryState(), take: async () => { throw new SharedStateError("unavailable"); } };
    const gate = createRequestGate({ limiter: () => createRateLimiter({ state: down, rules: [{ name: "t", matches: () => true, perMinute: 1 }] }) });
    const res = await gate(async () => new Response("ran"), "/x")(req(), {});
    expect(await res.text()).toBe("ran");
  });

  it("every runtime hands the shared store to what it builds (no silent per-instance memory in production)", () => {
    const src = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf8");
    expect(src("http/request-gate.ts")).toMatch(/createRateLimiter\(\{ state: sharedState\(\) \}\)/);
    expect(src("access/runtime.ts")).toMatch(/createStepUp\(\{[\s\S]*?state: sharedState\(\),/);
    expect(src("contracts/runtime.ts")).toMatch(/createInboundEndpoint\(\{[\s\S]*?state: sharedState\(\)/);
    expect(src("zoho-sign/webhook.ts")).toMatch(/deps\.state \?\? sharedState\(\)/);
  });
});

describe("catalyst adapter — LIVE spike facts (7 Oct 2026, India DC)", () => {
  const T = T0;
  const mk = (o: Parameters<typeof createFakeCatalyst>[0] = {}, d: { maxAttempts?: number; rateLimitRetries?: number } = {}) => {
    const fake = createFakeCatalyst(o);
    const now = { t: T };
    return { fake, now, state: createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => now.t, ...fast, ...d }) };
  };
  const call = async (fake: ReturnType<typeof createFakeCatalyst>, method: string, p: string, body: unknown) => {
    const tok = await fake.fetch("https://accounts.zoho.in/oauth/v2/token", { method: "POST", headers: {} });
    const t = ((await tok.json()) as { access_token: string }).access_token;
    const res = await fake.fetch(`https://api.catalyst.zoho.in/baas/v1/project/1/nosqltable/gz_state${p}`, { method, headers: { Authorization: `Zoho-oauthtoken ${t}` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const item = (k: string, exp: number) => ({ K: { S: k }, v: { S: "1" }, exp: { N: String(exp) }, ver: { N: "1" }, ttl: { N: "1" } });
  const lt = { attribute: ["exp"], operator: "less_than", value: { N: String(T + 1) } };

  it("the fake answers exactly the recorded shapes (capital statuses, no echo, size:0, ConditionMismatch)", async () => {
    const { fake } = mk({ maxHops: 0 });
    expect((await call(fake, "POST", "/item", [{ item: item("a", T + 9_999) }])).body).toEqual({ status: "success", data: { size: 62, create: [{ status: "Success" }] } });
    expect((await call(fake, "POST", "/item", [{ item: { ...item("a", T + 9_999), v: { S: "2" } } }])).body.data.create).toEqual([{ status: "Success" }]);   // plain insert overwrites
    expect(fake.items.get("a")!.v).toEqual({ S: "2" });
    const lost = await call(fake, "POST", "/item", [{ item: item("a", T + 1), condition: lt }]);
    expect(lost.status).toBe(200);
    expect(lost.body.data).toEqual({ size: 0, create: [{ status: "CriteriaMismatch" }] });
    const hit = await call(fake, "POST", "/fetch".replace("/fetch", "/item/fetch"), { keys: [{ K: { S: "a" } }], consistent_read: true });
    expect(hit.body.data.get).toEqual([{ item: fake.items.get("a") }]);
    const miss = await call(fake, "POST", "/item/fetch", { keys: [{ K: { S: "nope" } }], consistent_read: true });
    expect(miss.status).toBe(200);
    expect(miss.body.data).toEqual({ size: 0 });
    expect("get" in miss.body.data).toBe(false);
    const stale = { keys: { K: { S: "a" } }, update_attributes: [{ operation_type: "PUT", attribute_path: ["v"], update_value: { S: "z" } }], condition: { attribute: ["ver"], operator: "equals", value: { N: "9" } } };
    expect((await call(fake, "PUT", "/item", [stale])).body.data).toEqual({ size: 0, update: [{ status: "ConditionMismatch" }] });
    const ghost = { ...stale, keys: { K: { S: "ghost" } }, condition: undefined };
    expect((await call(fake, "PUT", "/item", [ghost])).body.data.update).toEqual([{ status: "ConditionMismatch" }]);
    expect(fake.items.has("ghost")).toBe(false);   // update never creates
    expect((await call(fake, "DELETE", "/item", [{ keys: { K: { S: "a" } } }])).body.data.delete).toEqual([{ status: "Success" }]);
    expect((await call(fake, "DELETE", "/item", [{ keys: { K: { S: "a" } } }])).body.data.delete).toEqual([{ status: "ConditionMismatch" }]);
  });

  it("CriteriaMismatch and ConditionMismatch are in CONDITION_FAILED_CODES", () => {
    expect(CONDITION_FAILED_CODES).toEqual(expect.arrayContaining(["CriteriaMismatch", "ConditionMismatch"]));
  });

  it("claim: one conditional insert; a live claim is refused, an EXPIRED one is taken over in that same single call", async () => {
    const { fake, now, state } = mk();
    expect(await state.claim("c", 1)).toBe(true);
    expect(await state.claim("c", 1)).toBe(false);
    expect(fake.seen.map((s) => `${s.method} ${s.path}`)).toEqual(["POST /item", "POST /item"]);
    now.t += 1_000;
    fake.seen.length = 0;
    expect(await state.claim("c", 60)).toBe(true);
    expect(fake.seen).toHaveLength(1);
  });

  it("get of a missing key (no data.get at all) is absent, not an error", async () => {
    const { state } = mk();
    expect(await state.get("never")).toBeNull();
  });

  it("set/incr/take on a MISSING key insert it (update would answer ConditionMismatch and create nothing)", async () => {
    const { fake, state } = mk();
    await state.set("s", "x");
    expect(await state.get("s")).toBe("x");
    expect(await state.incr("i", 60)).toBe(1);
    expect(await state.take("t", 3, 3)).toBe(0);
    expect(fake.items.size).toBe(3);
    expect(fake.seen.filter((s) => s.method === "PUT")).toHaveLength(0);
    expect(await state.incr("i", 60)).toBe(2);
    expect(fake.seen.filter((s) => s.method === "PUT")).toHaveLength(1);
  });

  it("an item deleted between read and update (update → ConditionMismatch) is retried as an insert, not lost", async () => {
    const { fake, state } = mk({ maxHops: 0 });
    await state.set("r", "1");
    const real = fake.fetch;
    let first = true;
    const racing = createCatalystState(FAKE_CONFIG, {
      clock: () => T, ...fast,
      fetch: async (url, init) => {
        const res = await real(url, init);
        if (first && url.endsWith("/item/fetch")) { first = false; fake.items.clear(); }   // vanishes after our read
        return res;
      },
    });
    expect(await racing.incr("r", 60)).toBe(1);   // the retry re-reads (absent now) and inserts: the item is recreated, nothing throws
    expect(fake.items.size).toBe(1);
  });

  it("expiry is enforced on read from our own exp (the TTL scheduler runs only daily)", async () => {
    const { now, state } = mk();
    await state.set("e", "v", 2);
    now.t += 2_000;
    expect(await state.get("e")).toBeNull();
    await state.set("e", "w", 5);   // an expired item is updated in place (ver CAS)
    expect(await state.get("e")).toBe("w");
  });

  it("50 concurrent conditional inserts on one key: exactly one claim wins", async () => {
    const { state } = mk({ seed: 3, maxHops: 4 });
    const got = await Promise.all(Array.from({ length: 50 }, () => state.claim("burst", 60)));
    expect(got.filter(Boolean)).toHaveLength(1);
  });

  it("20 concurrent ver-CAS increments end at exactly 20", async () => {
    const { state } = mk({ seed: 5, maxHops: 4 }, { maxAttempts: 200 });
    await state.incr("cas", 60);
    await Promise.all(Array.from({ length: 19 }, () => state.incr("cas", 60)));
    expect(await state.incr("cas", 60)).toBe(21);
    const m = mk({ seed: 5, maxHops: 4 }, { maxAttempts: 200 });
    const all = await Promise.all(Array.from({ length: 20 }, () => m.state.incr("cas", 60)));
    expect([...all].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await m.state.get("cas")).toBe("20");
  });

  it("429: backed off and retried (data untouched), then SharedStateError('unavailable') when it persists", async () => {
    const { fake, state } = mk();
    await state.get("warm");
    fake.failNext(429, 429);
    expect(await state.claim("l1", 60)).toBe(true);
    expect(fake.seen.filter((s) => s.path === "/item")).toHaveLength(3);   // 2 rejected + 1 applied
    const sleeps: number[] = [];
    const slow = createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => T, sleep: async (ms) => { sleeps.push(ms); }, rateLimitRetries: 3 });
    await slow.get("warm2");
    fake.failNext(429, 429, 429, 429);
    await expect(slow.claim("l2", 60)).rejects.toMatchObject({ code: "unavailable" });
    expect(sleeps).toHaveLength(3);
    expect(sleeps[2]!).toBeGreaterThan(sleeps[0]!);   // exponential
    expect(fake.items.size).toBe(1);                   // l2 was never written
  });

  it("a 500 on a claim is 'unavailable': fail closed, never assume won, never retried blindly", async () => {
    const { fake, state } = mk();
    await state.get("warm");
    const before = fake.seen.length;
    fake.failNext(500);
    await expect(state.claim("c500", 60)).rejects.toMatchObject({ code: "unavailable" });
    expect(fake.seen.length - before).toBe(1);
  });

  it("under a flaky Catalyst (seeded 429s and 500s) no claim is ever won twice", async () => {
    const { state } = mk({ seed: 11, flaky: { p429: 0.12, p500: 0.04 } });
    const got = await Promise.allSettled(Array.from({ length: 50 }, () => state.claim("flaky", 60)));
    expect(got.filter((g) => g.status === "fulfilled" && g.value === true).length).toBeLessThanOrEqual(1);
    for (const g of got) if (g.status === "rejected") expect(g.reason).toMatchObject({ code: "unavailable" });
  });

  it("release of a missing key (ConditionMismatch) is not an error", async () => {
    const { state } = mk();
    await state.release("never-held");
    await state.claim("h", 60);
    await state.release("h");
    await state.release("h");
  });
});
