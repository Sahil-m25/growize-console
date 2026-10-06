/* D124 staging test sign-in — the gate, the secret, the two handlers and the enrolment store.
   Run from console/: npx vitest run src/server/oauth/test-signin.test.ts */
import { describe, expect, it } from "vitest";
import { createSealer } from "./crypto";
import { createMemoryState } from "../state/memory";
import { originVerdict, RATE_LIMITS } from "../http/request-gate";
import { API_ROUTES, apiRuleOf } from "../access/guard-core";
import {
  createTestEnrolment, MINTS_PER_10_MIN, seatNameOf, TEST_SESSION_ROUTE, testSecretMatches, testSessionMint, testSessionStatus,
  testSigninEnabled, testSigninUsers, type TestEnrolment, type TestSigninDeps,
} from "./test-signin";
import type { CallbackResult, UserSessions } from "./user-session";

const SECRET = "s".repeat(24) + "0123456789abcdefghijklmnop";   // 50 chars, synthetic
const U1 = "554023000000300004", U2 = "554023000000300005", STRANGER = "554023000000399999";
const TOKEN = "1000.synthetic-refresh-token-never-real.abcdef";
const SID = "A".repeat(43);
const ON: NodeJS.ProcessEnv = {
  ZOHO_CRM_ENVIRONMENT: "sandbox", ZOHO_EXPECTED_ORG_ID: "60090668120", GZ_TEST_SIGNIN_SECRET: SECRET, GZ_TEST_SIGNIN_USERS: `${U1}, ${U2}`,
} as unknown as NodeJS.ProcessEnv;
const KEY = Buffer.alloc(32, 7).toString("base64");

describe("the gate", () => {
  it("is on only with sandbox + expected org + a 32+ char secret + a non-empty allowlist", () => {
    expect(testSigninEnabled(ON)).toBe(true);
    const off = (over: Record<string, string | undefined>) => testSigninEnabled({ ...ON, ...over } as unknown as NodeJS.ProcessEnv);
    expect(off({ ZOHO_CRM_ENVIRONMENT: undefined })).toBe(false);
    expect(off({ ZOHO_CRM_ENVIRONMENT: "Sandbox" })).toBe(false);
    expect(off({ ZOHO_EXPECTED_ORG_ID: undefined })).toBe(false);
    expect(off({ ZOHO_EXPECTED_ORG_ID: "  " })).toBe(false);
    expect(off({ GZ_TEST_SIGNIN_SECRET: undefined })).toBe(false);
    expect(off({ GZ_TEST_SIGNIN_SECRET: "x".repeat(31) })).toBe(false);
    expect(off({ GZ_TEST_SIGNIN_SECRET: "x".repeat(32) })).toBe(true);
    expect(off({ GZ_TEST_SIGNIN_USERS: "" })).toBe(false);
    expect(off({ GZ_TEST_SIGNIN_USERS: "alice@example.invalid, 12" })).toBe(false);
  });

  it("can never be on in production, with every other variable set", () => {
    for (const envName of ["production", undefined, "", "live", "sandbox "]) {
      expect(testSigninEnabled({ ...ON, ZOHO_CRM_ENVIRONMENT: envName, NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it("every 2^4 combination: on exactly when all four hold", () => {
    for (let m = 0; m < 16; m++) {
      const env = {
        ZOHO_CRM_ENVIRONMENT: m & 1 ? "sandbox" : "production", ZOHO_EXPECTED_ORG_ID: m & 2 ? "60090668120" : "",
        GZ_TEST_SIGNIN_SECRET: m & 4 ? SECRET : "short", GZ_TEST_SIGNIN_USERS: m & 8 ? U1 : "",
      } as unknown as NodeJS.ProcessEnv;
      expect(testSigninEnabled(env), String(m)).toBe(m === 15);
    }
  });

  it("the allowlist keeps only Zoho-id-shaped entries, once each", () => {
    expect(testSigninUsers({ GZ_TEST_SIGNIN_USERS: ` ${U1},${U1},bad,,${U2} ` } as unknown as NodeJS.ProcessEnv)).toEqual([U1, U2]);
  });
});

describe("the secret", () => {
  it("matches only the exact value (timingSafeEqual over sha256 digests, so equal-length buffers whatever is sent)", () => {
    expect(testSecretMatches(SECRET, ON)).toBe(true);
    expect(testSecretMatches(SECRET + "x", ON)).toBe(false);
    expect(testSecretMatches(SECRET.slice(0, -1), ON)).toBe(false);
    expect(testSecretMatches("", ON)).toBe(false);
    expect(testSecretMatches(null, ON)).toBe(false);
    expect(testSecretMatches(SECRET, { ...ON, GZ_TEST_SIGNIN_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(testSecretMatches("x".repeat(5000), ON)).toBe(false);
  });
});

/* ------------------------------------------------ handlers ------------------------------------------------ */

function rig(o: { env?: NodeJS.ProcessEnv; configured?: boolean; enrolled?: Record<string, string>; result?: (t: string) => CallbackResult } = {}) {
  const calls = { mint: [] as string[], signOut: [] as string[] };
  const enrolled = o.enrolled ?? { [U1]: TOKEN };
  const enrolment: TestEnrolment = {
    wants: () => true, save: async () => {},
    load: async (who) => (enrolled[who] ? { token: enrolled[who]!, seat: "conv", source: "store" } : { token: null, seat: null, source: null }),
  };
  const sessions = {
    signInWithRefreshToken: async (t: string) => { calls.mint.push(t); return o.result ? o.result(t) : { ok: true, sid: SID, session: { who: U1, seat: "conv" } }; },
    signOut: async (sid: string) => { calls.signOut.push(sid); },
  } as unknown as UserSessions;
  const state = createMemoryState();
  const deps: TestSigninDeps = {
    env: o.env ?? ON, configured: o.configured ?? true, sessions: () => sessions, enrolment: () => enrolment, state: () => state, cookie: { secure: true },
  };
  return { deps, calls };
}
const post = (body: unknown, secret: string | null = SECRET) => new Request("https://console.example.invalid/api/test/session", {
  method: "POST", headers: { "content-type": "application/json", ...(secret !== null ? { "x-test-signin-secret": secret } : {}) }, body: JSON.stringify(body),
});
const getStatus = (secret: string | null = SECRET) => new Request("https://console.example.invalid/api/test/session/status", {
  headers: secret !== null ? { "x-test-signin-secret": secret } : {},
});

describe("POST /api/test/session", () => {
  it("404 — indistinguishable from no route — when the gate is off, the OAuth door is not wired, or the secret is wrong/missing", async () => {
    const cases: [ReturnType<typeof rig>, Request][] = [
      [rig({ env: { ...ON, ZOHO_CRM_ENVIRONMENT: "production" } as NodeJS.ProcessEnv }), post({ zohoUserId: U1 })],
      [rig({ env: { ...ON, GZ_TEST_SIGNIN_SECRET: undefined } as NodeJS.ProcessEnv }), post({ zohoUserId: U1 })],
      [rig({ configured: false }), post({ zohoUserId: U1 })],
      [rig(), post({ zohoUserId: U1 }, "wrong-secret-wrong-secret-wrong-secret")],
      [rig(), post({ zohoUserId: U1 }, null)],
    ];
    for (const [r, req] of cases) {
      const res = await testSessionMint(req, r.deps);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
      expect(r.calls.mint).toEqual([]);
    }
  });

  it("a bad body is 400; a user not on the allowlist is 403; an allowlisted but unenrolled user is a clear 409", async () => {
    const r = rig();
    expect((await testSessionMint(post({}), r.deps)).status).toBe(400);
    const s = await testSessionMint(post({ zohoUserId: STRANGER }), r.deps);
    expect(s.status).toBe(403); expect((await s.json()).why).toBe("not-allowlisted");
    const u = await testSessionMint(post({ zohoUserId: U2 }), r.deps);
    expect(u.status).toBe(409);
    const b = await u.json();
    expect(b.ok).toBe(false); expect(b.why).toBe("not-enrolled"); expect(b.message).toMatch(/sign in to the console once/);
    expect(r.calls.mint).toEqual([]);
  });

  it("an enrolled user gets the normal session cookie through signInWithRefreshToken, and no token in the body", async () => {
    const r = rig();
    const res = await testSessionMint(post({ zohoUserId: U1 }), r.deps);
    expect(res.status).toBe(200);
    expect(r.calls.mint).toEqual([TOKEN]);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, who: U1, seat: "conv", seatName: "ir-manager" });
    expect(text).not.toContain(TOKEN); expect(text).not.toContain(SID);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^gz_zsid=${SID}; Path=/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure$`));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a refusal from the shared pipeline surfaces as {ok:false, why} with no cookie", async () => {
    const r = rig({ result: () => ({ ok: false, code: "no-grant", message: "No console access: …" }) });
    const res = await testSessionMint(post({ zohoUserId: U1 }), r.deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, why: "no-grant", message: "No console access: …" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a token that resolves to another person ends that session and refuses", async () => {
    const r = rig({ result: () => ({ ok: true, sid: SID, session: { who: STRANGER, seat: "ir" } }) });
    const res = await testSessionMint(post({ zohoUserId: U1 }), r.deps);
    expect(res.status).toBe(409); expect((await res.json()).why).toBe("token-user-mismatch");
    expect(r.calls.signOut).toEqual([SID]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it(`stays under Zoho's access-token budget: at most ${MINTS_PER_10_MIN} per user per 10 minutes`, async () => {
    const r = rig();
    for (let i = 0; i < MINTS_PER_10_MIN; i++) expect((await testSessionMint(post({ zohoUserId: U1 }), r.deps)).status).toBe(200);
    const res = await testSessionMint(post({ zohoUserId: U1 }), r.deps);
    expect(res.status).toBe(429); expect((await res.json()).why).toBe("zoho-token-budget");
  });
});

describe("GET /api/test/session/status", () => {
  it("lists the allowlist with enrolled true/false and the seat — never a token; 404 without the secret", async () => {
    const r = rig();
    expect((await testSessionStatus(getStatus(null), r.deps)).status).toBe(404);
    expect((await testSessionStatus(getStatus(), { ...r.deps, env: { ...ON, ZOHO_CRM_ENVIRONMENT: "production" } as NodeJS.ProcessEnv })).status).toBe(404);
    const res = await testSessionStatus(getStatus(), r.deps);
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({ ok: true, users: [
      { zohoUserId: U1, enrolled: true, source: "store", seat: "conv", seatName: "ir-manager" },
      { zohoUserId: U2, enrolled: false, source: null, seat: null, seatName: null },
    ] });
  });
});

describe("the enrolment store", () => {
  it("keeps the token sealed in SharedState (never plain), reads it back, and falls back to GZ_TEST_REFRESH_<id>", async () => {
    const state = createMemoryState();
    const seen: string[] = [];
    const spyState = { ...state, kind: state.kind, set: async (k: string, v: string, t?: number) => { seen.push(v); return state.set(k, v, t); } };
    const env = { ...ON, [`GZ_TEST_REFRESH_${U2}`]: "1000.env-supplied-synthetic" } as unknown as NodeJS.ProcessEnv;
    const e = createTestEnrolment({ state: spyState, sealer: createSealer(KEY), env });
    expect(e.wants(U1)).toBe(true); expect(e.wants(STRANGER)).toBe(false);
    await e.save(U1, "conv", TOKEN);
    await e.save(STRANGER, "ir", TOKEN);   // not allowlisted: nothing kept
    expect(seen.length).toBe(1);
    expect(seen[0]).not.toContain(TOKEN);
    expect(await e.load(U1)).toEqual({ token: TOKEN, seat: "conv", source: "store" });
    expect(await e.load(U2)).toEqual({ token: "1000.env-supplied-synthetic", seat: null, source: "env" });
    expect(await e.load(STRANGER)).toEqual({ token: null, seat: null, source: null });
    /* another key cannot open it */
    const other = createTestEnrolment({ state, sealer: createSealer(Buffer.alloc(32, 9).toString("base64")), env: ON });
    expect((await other.load(U1)).token).toBeNull();
    /* the gate off: wants() is false whatever the allowlist says */
    expect(createTestEnrolment({ state, sealer: createSealer(KEY), env: { ...ON, ZOHO_CRM_ENVIRONMENT: "production" } as NodeJS.ProcessEnv }).wants(U1)).toBe(false);
  });
});

describe("registration", () => {
  it("both routes are named in API_ROUTES (open, said why), rate-limited, and only the mint is Origin-exempt — only while the gate is on", () => {
    expect(API_ROUTES[TEST_SESSION_ROUTE]?.kind).toBe("open");
    expect(apiRuleOf("/api/test/session/status")?.rule.kind).toBe("open");
    expect(RATE_LIMITS.find((r) => r.matches("/api/test/session"))?.name).toBe("test-signin");
    expect(RATE_LIMITS.find((r) => r.matches("/api/test/session/status"))?.name).toBe("test-signin");
    const cross = new Request("https://console.example.invalid/api/test/session", { method: "POST", headers: { "sec-fetch-site": "cross-site" } });
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(ON)) delete process.env[k];
      expect(originVerdict(cross, TEST_SESSION_ROUTE).ok).toBe(false);
      Object.assign(process.env, ON);
      expect(originVerdict(cross, TEST_SESSION_ROUTE).ok).toBe(true);
      expect(originVerdict(cross, "/api/test/reset").ok).toBe(false);
      expect(originVerdict(cross, "/api/session").ok).toBe(false);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it("seat names come from CONSOLE_SEAT", () => {
    expect(seatNameOf("kam")).toBe("key-account-manager");
    expect(seatNameOf("nope")).toBeNull();
  });
});
