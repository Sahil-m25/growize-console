/* M15-S05-NOTE-10 — the read-only expiry accessor on the service-token provider: the time only, never the token.
   Replays the recorded token response (lib/zoho/__fixtures__/oauth); no request reaches Zoho. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { gatherFacts } from "../system/facts";
import { systemChecks } from "../system/checks";
import { createServiceTokenProvider, serviceTokenProviders } from "./service-token";

const rec = (n: string) => JSON.parse(readFileSync(join(__dirname, "..", "..", "lib", "zoho", "__fixtures__", "oauth", `${n}.response.json`), "utf8")) as { status: number; body: unknown };
const reply = (r: { status: number; body: unknown }) => ({ status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body) });
const T0 = 1_000_000;

function provider(job: "provider-callback" | "kam-pool-return", fetch: (u: string, i: unknown) => Promise<ReturnType<typeof reply>>, clock: () => number) {
  return createServiceTokenProvider({
    job, accountsOrigin: "https://accounts.zoho.in", clientId: "synthetic-client-id", clientSecret: "synthetic-client-secret",
    refreshToken: "synthetic-refresh-token", fetch: fetch as never, clock, log: createOpsLog(createMemorySink()),
  });
}

describe("service token expiry accessor", () => {
  it("is null before a token is minted, the expiry time after, null again once it has lapsed", async () => {
    let now = T0;
    const p = provider("provider-callback", async () => reply(rec("service-token.success")), () => now);
    expect(p.job).toBe("provider-callback");
    expect(p.expiresAt()).toBeNull();
    expect(p.refreshFailed()).toBe(false);
    await p.credential();
    expect(p.expiresAt()).toBe(T0 + 3_600_000);
    now = T0 + 3_600_000;
    expect(p.expiresAt()).toBeNull();
  });

  it("exposes only the time: nothing on the provider or its answers carries the token or a secret", async () => {
    const p = provider("provider-callback", async () => reply(rec("service-token.success")), () => T0);
    await p.credential();
    const shown = JSON.stringify([p.expiresAt(), p.refreshFailed(), p.job, Object.keys(p)]);
    expect(shown).not.toMatch(/synthetic|access_token|owner_email/);
  });

  it("a failed refresh is reported until the next success", async () => {
    let ok = false;
    const p = provider("kam-pool-return", async () => reply(ok ? rec("service-token.success") : rec("service-token.denied")), () => T0);
    await expect(p.credential()).rejects.toThrow();
    expect(p.refreshFailed()).toBe(true);
    expect(p.expiresAt()).toBeNull();
    ok = true;
    await p.credential();
    expect(p.refreshFailed()).toBe(false);
  });

  it("is registered process-wide, so the System route can read it from any bundle", async () => {
    const p = provider("provider-callback", async () => reply(rec("service-token.success")), () => T0);
    expect(serviceTokenProviders()).toContain(p);
  });
});

describe("serviceTokenExpiry on the System card", () => {
  const base = { ops: [], archiveLastRun: async () => null, outbox: { stats: () => ({ lastDeliveredAt: null, failures24h: 0 }) }, env: {} };
  const NOW = 5_000_000;
  const tok = (job: string, at: number | null, failed = false) => ({ job, expiresAt: () => at, refreshFailed: () => failed });

  it("a live token reads hours left and working; an idle job (no token, nothing failed) is not a fault and is not listed", async () => {
    const f = await gatherFacts({ ...base, serviceTokens: [tok("provider-callback", NOW + 2 * 3_600_000), tok("kam-pool-return", null)] }, NOW);
    expect(f.serviceTokenExpiry).toEqual({ "provider-callback": NOW + 2 * 3_600_000 });
    const c = systemChecks(f, NOW).find((x) => x.key === "token:provider-callback")!;
    expect(c.figure).toBe("2 h left");
    expect(c.state).toBe("working");
    expect(systemChecks(f, NOW).some((x) => x.key === "token:kam-pool-return")).toBe(false);
  });

  it("a job whose refresh failed reads missing and down; two providers on one job take the later expiry, and a live one hides a failed sibling", async () => {
    const f = await gatherFacts({ ...base, serviceTokens: [tok("cover-window-share", null, true), tok("provider-callback", NOW + 100), tok("provider-callback", NOW + 9_000_000, false), tok("provider-callback", null, true)] }, NOW);
    expect(f.serviceTokenExpiry["cover-window-share"]).toBeNull();
    expect(f.serviceTokenExpiry["provider-callback"]).toBe(NOW + 9_000_000);
    const c = systemChecks(f, NOW).find((x) => x.key === "token:cover-window-share")!;
    expect(c.figure).toBe("missing");
    expect(c.state).toBe("down");
  });

  it("omitted → no token cards, as before", async () => {
    const f = await gatherFacts(base, NOW);
    expect(f.serviceTokenExpiry).toEqual({});
  });
});

describe("cache on the System card", () => {
  const base = { ops: [], archiveLastRun: async () => null, outbox: { stats: () => ({ lastDeliveredAt: null, failures24h: 0 }) }, env: {} };
  it("the window's totals become the cache check", async () => {
    const f = await gatherFacts({ ...base, cacheLoads: () => ({ reads: 200, errors: 6 }) }, 0);
    expect(f.cache).toEqual({ reads: 200, errors: 6 });
    const c = systemChecks(f, 0).find((x) => x.key === "cache")!;
    expect(c.figure).toBe("3%");
    expect(c.state).toBe("attention");
  });
});
