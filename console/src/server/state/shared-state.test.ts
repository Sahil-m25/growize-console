/* SharedState contract (docs/architecture/shared-state.md): the same suite against the memory adapter and the catalyst
 * adapter over an in-memory fake of the Catalyst NoSQL REST semantics (both readings of conditional insert), the
 * simulated race for claim(), the catalyst adapter's failure handling, STATE_STORE selection (fail closed) and the
 * wiring of the rate limiter, step-up and webhooks onto sharedState(). */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRateLimiter, createRequestGate } from "../http/request-gate";
import { createCatalystState, catalystConfigFromEnv } from "./catalyst";
import { createFakeCatalyst, FAKE_CONFIG } from "./fake-catalyst";
import { createMemoryState } from "./memory";
import { createStateFromEnv, probeState, stateStoreKind } from "./runtime";
import { SharedStateError, type SharedState } from "./shared-state";

type Rig = { state: SharedState; twin: SharedState; now: { t: number } };
const T0 = Date.parse("2026-10-04T04:30:00Z");
const fast = { sleep: async () => undefined };

const ADAPTERS: ReadonlyArray<{ name: string; make: () => Rig }> = [
  { name: "memory", make: () => { const now = { t: T0 }; const state = createMemoryState({ clock: () => now.t }); return { state, twin: state, now }; } },
  ...([[true, "item"], [false, "item"], [true, "http"], [false, "http"]] as const).map(([insertOverwrites, failureStyle]) => ({
    name: `catalyst (fake REST, insert ${insertOverwrites ? "overwrites when the condition holds" : "never overwrites"}, refusal as ${failureStyle === "item" ? "per-item status on HTTP 200" : "HTTP 400"})`,
    make: (): Rig => {
      const now = { t: T0 };
      const fake = createFakeCatalyst({ insertOverwrites, failureStyle });
      const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => now.t, ...fast });
      return { state: mk(), twin: mk(), now };   // two instances, one backend
    },
  })),
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
    expect(bodies[0]!.b).toMatchObject({ keys: [{ k: { S: expect.any(String) } }], consistent_read: true });
    expect(Array.isArray(bodies[1]!.b) && bodies[1]!.b[0].item.k.S).toBeTruthy();
    expect(Array.isArray(bodies[3]!.b)).toBe(true);
    expect(Array.isArray(bodies[3]!.b[0].keys)).toBe(false);
    expect(bodies[3]!.b[0].keys.k.S).toBeTruthy();
    expect(bodies[3]!.b[0].condition).toMatchObject({ attribute: ["ver"], operator: "equals" });
    expect(bodies[3]!.b[0].update_attributes[0]).toMatchObject({ operation_type: "PUT", attribute_path: [expect.any(String)] });
    expect(Array.isArray(bodies[4]!.b) && bodies[4]!.b[0].keys.k.S).toBeTruthy();
  });

  it("the partition-key attribute name is configurable (CATALYST_STATE_PK)", async () => {
    const fake = createFakeCatalyst({ pk: "K" });
    const wrong = createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, ...fast });
    await expect(wrong.claim("a", 60)).rejects.toMatchObject({ code: "bad-response" });   // INVALID_KEY, as the owner's first spike saw
    const right = createCatalystState({ ...FAKE_CONFIG, pkName: "K" }, { fetch: fake.fetch, ...fast });
    expect(await right.claim("a", 60)).toBe(true);
    expect(await right.claim("a", 60)).toBe(false);
    await right.set("b", "1");
    expect(await right.get("b")).toBe("1");
    expect(catalystConfigFromEnv({ ...FULL_ENV, CATALYST_STATE_PK: "K" }).pkName).toBe("K");
    expect(catalystConfigFromEnv(FULL_ENV).pkName).toBe("k");
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
