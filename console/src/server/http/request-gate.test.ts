/* M18-S15-H2/H3 — the request gate inside withErrorCapture: Origin / Sec-Fetch-Site on writes, and rate limits.
 * Through the real wrapper (server/ops/runtime withErrorCapture) with a spy handler, so "refused before the
 * handler runs" is observed, not assumed; plus a scan proving every mutating route is behind that wrapper and
 * every rate-limited route template is the one its route file passes. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withErrorCapture } from "../ops/runtime";
import { createRateLimiter, IP_SHARE, ORIGIN_EXEMPT, RATE_LIMITS, rateLimitsOn, sharedRateLimiter } from "./request-gate";

const env = process.env as Record<string, string | undefined>;
const HOST = "console.example.in";
const url = (route: string) => `https://${HOST}${route}`;

function spy() {
  const calls: Request[] = [];
  const handler = (req: Request) => { calls.push(req); return Response.json({ ran: true }); };
  return { calls, handler };
}
const req = (route: string, method: string, headers: Record<string, string> = {}) =>
  new Request(url(route), { method, headers: { host: HOST, ...headers } });

const apiDir = path.resolve(__dirname, "..", "..", "app", "api");
function routeFiles(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  (function walk(d: string) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p); else if (f.name === "route.ts") out.push({ file: path.relative(apiDir, p), src: fs.readFileSync(p, "utf8") });
    }
  })(apiDir);
  return out;
}

describe("M18-S15-H2 Origin / Sec-Fetch-Site guard on writes", () => {
  const route = "/api/leads/[id]/stage";

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s marked cross-site is refused 403 before the handler runs", async (method) => {
    const s = spy();
    const res = await withErrorCapture(s.handler, route)(req(route, method, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }), {});
    expect(res.status).toBe(403);
    expect(s.calls).toHaveLength(0);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.json()).toMatchObject({ code: "cross-site" });
  });

  it("a same-origin write passes (Sec-Fetch-Site: same-origin, own Origin)", async () => {
    const s = spy();
    const res = await withErrorCapture(s.handler, route)(req(route, "POST", { "sec-fetch-site": "same-origin", origin: `https://${HOST}` }), {});
    expect(res.status).toBe(200);
    expect(s.calls).toHaveLength(1);
  });

  it("same-site (a sibling subdomain) is refused", async () => {
    const s = spy();
    const res = await withErrorCapture(s.handler, route)(req(route, "PATCH", { "sec-fetch-site": "same-site", origin: `https://other.example.in` }), {});
    expect(res.status).toBe(403);
    expect(s.calls).toHaveLength(0);
  });

  it("with no Sec-Fetch-Site, Origin decides: own host passes (also behind a proxy's X-Forwarded-Host), a foreign or null Origin is refused", async () => {
    const s = spy();
    const w = withErrorCapture(s.handler, route);
    expect((await w(req(route, "POST", { origin: `https://${HOST}` }), {})).status).toBe(200);
    expect((await w(new Request("http://10.0.0.5:3001" + route, { method: "POST", headers: { host: "10.0.0.5:3001", "x-forwarded-host": HOST, origin: `https://${HOST}` } }), {})).status).toBe(200);
    expect((await w(req(route, "POST", { origin: "https://evil.example" }), {})).status).toBe(403);
    expect((await w(req(route, "POST", { origin: "null" }), {})).status).toBe(403);
    expect(s.calls).toHaveLength(2);
  });

  it("a write with neither header (a server, curl, the Jev seeder) passes — no browser, no ambient cookie to ride", async () => {
    const s = spy();
    expect((await withErrorCapture(s.handler, route)(req(route, "POST"), {})).status).toBe(200);
    expect(s.calls).toHaveLength(1);
  });

  it("GET is never checked: a top-level cross-site navigation (the Zoho OAuth / step-up callbacks) still passes", async () => {
    for (const r of ["/api/auth/zoho/callback", "/api/auth/step-up/callback", "/api/data"]) {
      const s = spy();
      const res = await withErrorCapture(s.handler, r)(req(r, "GET", { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), {});
      expect(res.status, r).toBe(200);
      expect(s.calls, r).toHaveLength(1);
    }
    const s = spy();
    expect((await withErrorCapture(s.handler, route)(req(route, "GET"), {})).status).toBe(200);   // missing headers on a GET
  });

  it("webhooks are the only exemption: a provider's cross-site POST reaches the handler (its HMAC decides)", async () => {
    expect(ORIGIN_EXEMPT.map((e) => e.prefix)).toEqual(["/api/webhooks/"]);
    for (const r of ["/api/webhooks/zoho-sign", "/api/webhooks/investor-app"]) {
      const s = spy();
      const res = await withErrorCapture(s.handler, r)(req(r, "POST", { "sec-fetch-site": "cross-site", origin: "https://sign.zoho.in" }), {});
      expect(res.status, r).toBe(200);
      expect(s.calls).toHaveLength(1);
    }
  });

  it("every mutating API route is behind withErrorCapture (so the guard runs), except the fixture-only test/** routes", () => {
    const unwrapped: string[] = [];
    let seen = 0;
    for (const { file, src } of routeFiles()) {
      for (const m of src.matchAll(/export\s+(?:const|async function)\s+(POST|PUT|PATCH|DELETE)\b([^\n]*)/g)) {
        seen++;
        if (!/=\s*withErrorCapture\(/.test(m[2]!)) unwrapped.push(`${file} ${m[1]}`);
      }
    }
    /* test/** answer 404 unless FIXTURE_MODE=local, which never runs in production (lib/fixture-mode) */
    expect(seen).toBeGreaterThan(20);
    expect(unwrapped.filter((u) => !u.startsWith(`test${path.sep}`))).toEqual([]);
  });
});

describe("M18-S15-H3 rate limits", () => {
  beforeEach(() => { env.GZ_RATE_LIMITS = "on"; sharedRateLimiter().reset(); });
  afterEach(() => { delete env.GZ_RATE_LIMITS; sharedRateLimiter().reset(); });

  /* One real route template per rule; the test below proves each is the one its route file passes. */
  const ENDPOINTS: Array<{ route: string; method: string; rule: string }> = [
    { route: "/api/auth/zoho", method: "POST", rule: "auth" },
    { route: "/api/auth/zoho/callback", method: "GET", rule: "auth" },
    { route: "/api/auth/step-up", method: "GET", rule: "auth" },
    { route: "/api/leads/search", method: "GET", rule: "search" },
    { route: "/api/investors/search", method: "GET", rule: "search" },
    { route: "/api/documents/upload", method: "POST", rule: "upload" },
    { route: "/api/webhooks/zoho-sign", method: "POST", rule: "webhooks" },
    { route: "/api/webhooks/investor-app", method: "POST", rule: "webhooks" },
  ];
  const limitOf = (rule: string) => RATE_LIMITS.find((r) => r.name === rule)!.perMinute;

  it.each(ENDPOINTS)("$route: N=$rule limit per minute per IP+session, then 429 with Retry-After", async ({ route, method, rule }) => {
    const n = limitOf(rule);
    const s = spy();
    const w = withErrorCapture(s.handler, route);
    const h = { "x-forwarded-for": "203.0.113.7", cookie: "gz_zsid=abc" };
    for (let i = 0; i < n; i++) expect((await w(req(route, method, h), {})).status).toBe(200);
    const res = await w(req(route, method, h), {});
    expect(res.status).toBe(429);
    const after = Number(res.headers.get("retry-after"));
    expect(Number.isInteger(after) && after >= 1 && after <= 60).toBe(true);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(s.calls).toHaveLength(n);                                   // the throttled one never reached the handler
    expect((await w(req(route, method, { ...h, "x-forwarded-for": "198.51.100.9" }), {})).status).toBe(200);   // another caller is untouched
  });

  it("each rate-limited template is exactly what its route file passes to withErrorCapture", () => {
    const templates = new Set(routeFiles().flatMap(({ src }) => [...src.matchAll(/withErrorCapture\([\s\S]*?,\s*"([^"]+)"\)/g)].map((m) => m[1]!)));
    for (const e of ENDPOINTS) expect(templates.has(e.route), e.route).toBe(true);
    /* and every search / auth / webhook / upload template in the app is covered by a rule */
    for (const t of templates) if (/\/search$|^\/api\/auth\/|^\/api\/webhooks\/|^\/api\/documents\/upload$/.test(t)) expect(RATE_LIMITS.some((r) => r.matches(t)), t).toBe(true);
  });

  it("routes outside the four groups are never throttled", async () => {
    const s = spy();
    const w = withErrorCapture(s.handler, "/api/data");
    for (let i = 0; i < 300; i++) expect((await w(req("/api/data", "GET"), {})).status).toBe(200);
  });

  it("a caller inventing a fresh session per request still meets the per-IP ceiling (IP_SHARE × N)", async () => {
    const lim = createRateLimiter({ clock: () => 0 });
    const n = limitOf("auth");
    let ok = 0;
    for (let i = 0; i < n * IP_SHARE + 5; i++) if ((await lim.check("/api/auth/zoho", req("/api/auth/zoho", "GET", { "x-forwarded-for": "203.0.113.7", cookie: `gz_zsid=s${i}` }))).ok) ok++;
    expect(ok).toBe(n * IP_SHARE);
  });

  it("the bucket refills with time, and Retry-After is when the next token lands", async () => {
    let now = 0;
    const lim = createRateLimiter({ clock: () => now, rules: [{ name: "t", matches: () => true, perMinute: 6 }] });
    const r = () => lim.check("/x", req("/x", "GET"));
    for (let i = 0; i < 6; i++) expect((await r()).ok).toBe(true);
    const v = await r();
    expect(v).toEqual({ ok: false, rule: "t", retryAfterS: 10 });
    now += 10_000;
    expect((await r()).ok).toBe(true);
    expect((await r()).ok).toBe(false);
  });

  it("the client IP is the proxy's right-most X-Forwarded-For hop (a spoofed left-most entry does not buy a new bucket)", async () => {
    const lim = createRateLimiter({ clock: () => 0, rules: [{ name: "t", matches: () => true, perMinute: 1 }] });
    expect((await lim.check("/x", req("/x", "GET", { "x-forwarded-for": "1.1.1.1, 203.0.113.7" }))).ok).toBe(true);
    expect((await lim.check("/x", req("/x", "GET", { "x-forwarded-for": "2.2.2.2, 203.0.113.7" }))).ok).toBe(false);
  });

  it("on in every mode but unit tests (NODE_ENV=test) unless GZ_RATE_LIMITS=on", () => {
    expect(rateLimitsOn({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(rateLimitsOn({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
    expect(rateLimitsOn({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(false);
    expect(rateLimitsOn({ NODE_ENV: "test", GZ_RATE_LIMITS: "on" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
