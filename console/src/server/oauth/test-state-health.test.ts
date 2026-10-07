/* D125 GET /api/test/state-health + the enrolment-failure ring + status loadError.
   Run from console/: npx vitest run src/server/oauth/test-state-health.test.ts */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSealer } from "./crypto";
import { createMemoryState } from "../state/memory";
import { createCatalystState } from "../state/catalyst";
import { createFakeCatalyst, FAKE_CONFIG } from "../state/fake-catalyst";
import { SharedStateError, type SharedState } from "../state/shared-state";
import { clearEnrolFailures, ENROL_FAILURE_RING, recentEnrolFailures, recordEnrolFailure } from "./enrol-failures";
import { createTestEnrolment, testSessionStatus, type TestSigninDeps } from "./test-signin";
import { testStateHealth, type StateHealthDeps } from "./test-state-health";
import { API_ROUTES, apiRuleOf } from "../access/guard-core";

const SECRET = "h".repeat(24) + "0123456789abcdefghijklmnop";
const U1 = "554023000000300004";
const REFRESH = "1000.fake.refresh";
const CLIENT_SECRET = "fake-secret-xx";
const ENV = {
  ZOHO_CRM_ENVIRONMENT: "sandbox", ZOHO_EXPECTED_ORG_ID: "60090668120", GZ_TEST_SIGNIN_SECRET: SECRET, GZ_TEST_SIGNIN_USERS: U1,
  STATE_STORE: "catalyst",
  GZ_STATE_API_ORIGIN: FAKE_CONFIG.apiOrigin, GZ_STATE_PROJECT_ID: FAKE_CONFIG.projectId, GZ_STATE_TABLE: FAKE_CONFIG.table, GZ_STATE_PK: "K",
  GZ_STATE_REFRESH_TOKEN: REFRESH, ZOHO_OAUTH_CLIENT_ID: FAKE_CONFIG.clientId, ZOHO_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
  ZOHO_ACCOUNTS_ORIGIN: FAKE_CONFIG.accountsOrigin, CATALYST_ORG_ID: "",
} as unknown as NodeJS.ProcessEnv;

const req = (secret: string | null = SECRET) => new Request("https://x.invalid/api/test/state-health", { headers: secret === null ? {} : { "x-test-signin-secret": secret } });
function rig(over: Partial<StateHealthDeps> = {}) {
  const fake = createFakeCatalyst({ maxHops: 0 });
  const state = createCatalystState(FAKE_CONFIG, { fetch: fake.fetch });
  const deps: StateHealthDeps = { env: ENV, configured: true, state: () => state, fetch: fake.fetch, ...over };
  return { fake, state, deps };
}

beforeEach(() => clearEnrolFailures());

describe("GET /api/test/state-health gate", () => {
  it("404 with the gate off, unwired, no secret, or a wrong secret", async () => {
    const r = rig();
    const cases: Array<[StateHealthDeps, Request]> = [
      [{ ...r.deps, env: { ...ENV, ZOHO_CRM_ENVIRONMENT: "production" } as NodeJS.ProcessEnv }, req()],
      [{ ...r.deps, env: { ...ENV, GZ_TEST_SIGNIN_SECRET: undefined } as unknown as NodeJS.ProcessEnv }, req()],
      [{ ...r.deps, configured: false }, req()],
      [r.deps, req(null)],
      [r.deps, req("wrong-secret-wrong-secret-wrong-secret")],
    ];
    for (const [deps, rq] of cases) {
      const res = await testStateHealth(rq, deps);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
    expect(r.fake.seen).toEqual([]);   // nothing was probed
  });

  it("is registered like the other test routes (open in API_ROUTES; no session needed)", () => {
    expect(apiRuleOf("/api/test/state-health")?.rule.kind).toBe("open");
    expect(Object.keys(API_ROUTES)).toContain("/api/test/state-health");
  });
});

describe("the probe", () => {
  it("succeeds against the fake Catalyst: every step ok, token mint ok, env names (no values), host/project/table", async () => {
    const r = rig();
    const res = await testStateHealth(req(), r.deps);
    expect(res.status).toBe(200);
    const text = await res.text();
    const j = JSON.parse(text);
    expect(j.ok).toBe(true);
    expect(j.storeKind).toBe("catalyst");
    expect(j.tokenMint).toMatchObject({ ok: true });
    expect(j.probe.ok).toBe(true);
    expect(j.probe.steps.map((s: { step: string }) => s.step)).toEqual(["claim", "claimAgain", "get", "set", "getAfterSet", "release"]);
    for (const s of j.probe.steps) { expect(s.ok).toBe(true); expect(typeof s.latencyMs).toBe("number"); }
    expect(j.envSeen).toMatchObject({ pkName: "K", apiOrigin: "api.catalyst.zoho.in", projectId: FAKE_CONFIG.projectId, table: "gz_state" });
    expect(j.envSeen.names).toEqual(expect.arrayContaining(["GZ_STATE_API_ORIGIN", "GZ_STATE_PROJECT_ID", "GZ_STATE_REFRESH_TOKEN", "GZ_STATE_TABLE", "GZ_STATE_PK"]));
    expect(j.envSeen.names).not.toContain("CATALYST_ORG_ID");   // empty = not set
    expect(typeof j.instance.startedAt).toBe("string"); expect(j.instance.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(j.recentEnrolFailures).toEqual([]);
    expect(r.fake.items.size).toBe(0);   // the probe key was released
    for (const secret of [SECRET, REFRESH, CLIENT_SECRET]) expect(text).not.toContain(secret);
  });

  it("surfaces the failure: SharedStateError code + HTTP status + Catalyst error_code, and still releases", async () => {
    const r = rig();
    r.fake.failNext(500);
    const j = await (await testStateHealth(req(), r.deps)).json();
    expect(j.probe.ok).toBe(false);
    const claim = j.probe.steps[0];
    expect(claim).toMatchObject({ step: "claim", ok: false, error: { code: "unavailable", httpStatus: 500 } });
    expect(j.probe.steps[1].error.code).toBe("skipped");
    expect(j.probe.steps.at(-1).step).toBe("release");
  });

  it("a Catalyst error_code on a 4xx is reported (INVALID_KEY from a wrong partition-key name)", async () => {
    const fake = createFakeCatalyst({ maxHops: 0 });
    const state = createCatalystState({ ...FAKE_CONFIG, pkName: "k" }, { fetch: fake.fetch });
    const j = await (await testStateHealth(req(), { env: { ...ENV, GZ_STATE_PK: "k" } as NodeJS.ProcessEnv, configured: true, state: () => state, fetch: fake.fetch })).json();
    expect(j.envSeen.pkName).toBe("k");
    expect(j.probe.steps[0].error).toMatchObject({ code: "bad-response", httpStatus: 400, catalystCode: "INVALID_KEY" });
  });

  it("token mint failure is reported with the HTTP status and Zoho's error word, and a refused token fails the probe", async () => {
    const fake = createFakeCatalyst({ maxHops: 0 });
    const bad = async () => ({ status: 400, json: async () => ({ error: "invalid_client" }) });
    const state = createCatalystState(FAKE_CONFIG, { fetch: bad });
    const j = await (await testStateHealth(req(), { env: ENV, configured: true, state: () => state, fetch: bad })).json();
    expect(j.tokenMint).toMatchObject({ ok: false, error: "http", httpStatus: 400, zohoError: "invalid_client" });
    expect(j.probe.steps[0].error).toMatchObject({ code: "unavailable", stage: "token", httpStatus: 400, catalystCode: "invalid_client" });
    void fake;
  });

  it("memory store: probe runs, token mint skipped", async () => {
    const state = createMemoryState();
    const j = await (await testStateHealth(req(), { env: { ...ENV, STATE_STORE: "memory" } as NodeJS.ProcessEnv, configured: true, state: () => state })).json();
    expect(j.storeKind).toBe("memory");
    expect(j.tokenMint.ok).toBe("skipped");
    expect(j.probe.ok).toBe(true);
  });

  it("a misconfigured store (state() throws) is reported, not a 500", async () => {
    const j = await (await testStateHealth(req(), { env: ENV, configured: true, state: () => { throw new Error("STATE_STORE=catalyst is misconfigured: GZ_STATE_TABLE is not set."); } })).json();
    expect(j.storeKind).toBeNull();
    expect(j.stateError.code).toBe("Error");
    expect(j.probe).toEqual({ ok: false, steps: [] });
  });

  it("redacts a configured secret even if one slipped into an error", async () => {
    const leaky: SharedState = { ...createMemoryState(), kind: "memory", claim: async () => { throw new SharedStateError("unavailable", `boom ${SECRET}`); } };
    const text = await (await testStateHealth(req(), { env: ENV, configured: true, state: () => leaky })).text();
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[redacted]");
  });
});

describe("enrolment failures", () => {
  it("keeps the last 20 with timestamp, who and a secret-free code; logs with console.error; shows in state-health", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < ENROL_FAILURE_RING + 5; i++) {
      recordEnrolFailure(i === ENROL_FAILURE_RING + 4 ? U1 : "554023000000300099", new SharedStateError("unavailable", "shared state: Catalyst answered 500", { stage: "http", httpStatus: 500 }), () => Date.UTC(2026, 9, 7));
    }
    recordEnrolFailure(U1, new Error(`leaky ${REFRESH}`));
    expect(recentEnrolFailures().length).toBe(ENROL_FAILURE_RING);
    expect(err).toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    expect(err.mock.calls.at(-1)![0]).not.toContain(REFRESH);
    const r = rig();
    const text = await (await testStateHealth(req(), r.deps)).text();
    const j = JSON.parse(text);
    expect(j.recentEnrolFailures.length).toBe(ENROL_FAILURE_RING);
    expect(j.recentEnrolFailures.at(-1)).toMatchObject({ who: U1, code: "Error" });
    expect(j.recentEnrolFailures[0]).toMatchObject({ at: "2026-10-07T00:00:00.000Z", code: "unavailable", httpStatus: 500, stage: "http" });
    expect(text).not.toContain(REFRESH);
    err.mockRestore(); warn.mockRestore();
  });
});

describe("status loadError", () => {
  it("reports why a state.get threw instead of a silent enrolled:false", async () => {
    const sealer = createSealer(Buffer.alloc(32, 7).toString("base64"));
    const broken: SharedState = { ...createMemoryState(), kind: "catalyst", get: async () => { throw new SharedStateError("unavailable", "shared state: Catalyst answered 500", { stage: "http", httpStatus: 500 }); } };
    const enrolment = createTestEnrolment({ state: broken, sealer, env: ENV });
    const d = { env: ENV, configured: true, sessions: () => { throw new Error("unused"); }, enrolment: () => enrolment, state: () => broken, cookie: { secure: true } } as unknown as TestSigninDeps;
    const j = await (await testSessionStatus(req(), d)).json();
    expect(j.users).toEqual([{ zohoUserId: U1, enrolled: false, source: null, seat: null, seatName: null, loadError: "unavailable (http, http 500)" }]);
  });

  it("an unopenable stored record is a loadError too (e.g. the session key changed)", async () => {
    const state = createMemoryState();
    const a = createTestEnrolment({ state, sealer: createSealer(Buffer.alloc(32, 7).toString("base64")), env: ENV });
    await a.save(U1, "conv", "1000.token-synthetic");
    const b = createTestEnrolment({ state, sealer: createSealer(Buffer.alloc(32, 9).toString("base64")), env: ENV });
    const e = await b.load(U1);
    expect(e.token).toBeNull(); expect(e.loadError).toMatch(/stored-record/);
  });
});
