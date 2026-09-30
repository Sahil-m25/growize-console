/* M18-S15-H1 — every page and API response carries the security headers; the CSP has no 'unsafe-inline' script.
 * Reads the real next.config.mjs headers() and the real middleware for "/" and one API route (/api/data).
 * Fails if any required header goes missing from either. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { CSP_ALLOW, REQUIRED_SECURITY_HEADERS, pageCsp } from "../../../security-headers.mjs";
import { config as mwConfig, middleware } from "../../middleware";

/* The six the acceptance names — spelled out here, so dropping one from security-headers.mjs fails this test. */
const REQUIRED = ["Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"];

type Rule = { source: string; headers: Array<{ key: string; value: string }> };
let rules: Rule[] = [];
const env = process.env as Record<string, string | undefined>;
const savedEnv = env.NODE_ENV;

beforeAll(async () => {
  env.NODE_ENV = "production";   // withReticle returns the config untouched (and mints no dev token)
  const file = "../../../next.config.mjs";   // a variable specifier: next.config.mjs has no .d.ts, and needs none
  const mod = (await import(/* @vite-ignore */ file)) as { default: unknown };
  rules = await (mod.default as { headers: () => Promise<Rule[]> }).headers();
});
afterAll(() => { env.NODE_ENV = savedEnv; });

/* Next's path matching, for the two sources used: "/:path*" matches every path, "/api/:path*" /api and below. */
const matches = (source: string, p: string) =>
  source === "/:path*" ? true : source === "/api/:path*" ? p === "/api" || p.startsWith("/api/") : source === p;

function configHeaders(p: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rules) if (matches(r.source, p)) for (const h of r.headers) out.set(h.key.toLowerCase(), [...(out.get(h.key.toLowerCase()) ?? []), h.value]);
  return out;
}
const mwMatches = (p: string) => mwConfig.matcher.some((m: string) => new RegExp(`^${m}$`).test(p));
const scriptSrc = (csp: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";

describe("M18-S15-H1 security headers", () => {
  it("the required list names all six headers", () => {
    expect([...REQUIRED_SECURITY_HEADERS].sort()).toEqual([...REQUIRED].sort());
  });

  it("a page (/) carries every required header — CSP from the middleware, the rest from next.config", async () => {
    expect(mwMatches("/")).toBe(true);
    const res = middleware(new NextRequest("http://localhost:3001/"));
    const got = configHeaders("/");
    for (const [k, v] of res.headers) if (k === "content-security-policy") got.set(k, [...(got.get(k) ?? []), v]);
    for (const h of REQUIRED) expect(got.get(h.toLowerCase()), h).toHaveLength(1);   // present, and exactly once
    expect(got.get("x-frame-options")).toEqual(["DENY"]);
    expect(got.get("x-content-type-options")).toEqual(["nosniff"]);
    expect(got.get("referrer-policy")).toEqual(["strict-origin-when-cross-origin"]);
    expect(got.get("strict-transport-security")![0]).toMatch(/^max-age=\d{7,}/);
    const csp = got.get("content-security-policy")![0]!;
    expect(scriptSrc(csp)).not.toContain("'unsafe-inline'");
    expect(scriptSrc(csp)).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("an API response (/api/data) carries every required header, with a no-load CSP", () => {
    expect(mwMatches("/api/data")).toBe(false);   // the middleware leaves /api alone; next.config covers it
    const got = configHeaders("/api/data");
    for (const h of REQUIRED) expect(got.get(h.toLowerCase()), h).toHaveLength(1);
    const csp = got.get("content-security-policy")![0]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe");
  });

  it("the page nonce is fresh per request and handed to Next on the request (so its inline scripts carry it)", () => {
    const a = middleware(new NextRequest("http://localhost:3001/leads"));
    const b = middleware(new NextRequest("http://localhost:3001/leads"));
    const nonce = (csp: string) => /'nonce-([^']+)'/.exec(csp)![1];
    const ca = a.headers.get("content-security-policy")!, cb = b.headers.get("content-security-policy")!;
    expect(nonce(ca)).not.toEqual(nonce(cb));
    expect(a.headers.get("x-middleware-request-content-security-policy")).toEqual(ca);
    expect(a.headers.get("x-middleware-request-x-gz-path")).toEqual("/leads");   // the existing job is untouched
  });

  it("every CSP source comes from the one allow-list (CSP_ALLOW) — only the nonce and 'strict-dynamic' are added", () => {
    const csp = pageCsp("AAAAAAAAAAAAAAAAAAAAAAAA");
    for (const d of csp.split(";").map((s) => s.trim())) {
      const [name, ...sources] = d.split(/\s+/);
      expect(Object.hasOwn(CSP_ALLOW, name!), name).toBe(true);
      for (const s of sources) if (!/^'nonce-/.test(s) && s !== "'strict-dynamic'") expect(CSP_ALLOW[name!], `${name} ${s}`).toContain(s);
    }
    expect(() => pageCsp("")).toThrow();
  });

  it("the production page CSP carries no 'unsafe-eval' (that is added only under next dev)", () => {
    expect(scriptSrc(pageCsp("AAAAAAAAAAAAAAAAAAAAAAAA"))).not.toContain("unsafe-eval");
    expect(scriptSrc(pageCsp("AAAAAAAAAAAAAAAAAAAAAAAA", { dev: true }))).toContain("'unsafe-eval'");
  });
});
