/**
 * M18-S15-H2/H3 — THE DOOR EVERY WRAPPED ROUTE PASSES BEFORE ITS HANDLER: rate limits, then the Origin check.
 *
 * Applied once, inside `withErrorCapture` (server/ops/runtime.ts), so no route file changes and a refusal still
 * carries its x-request-id. Nothing here reads a body, logs a header value or keeps a cookie value (only a hash).
 *
 * ORIGIN (H2). On POST/PUT/PATCH/DELETE a browser's own word decides: `Sec-Fetch-Site` when sent (same-origin
 * and none pass; same-site and cross-site are refused — a sibling subdomain is not this console), otherwise
 * `Origin`, which must name this host. A request with neither is not from a browser page (a server, curl, the
 * Jev seeder) and passes: CSRF needs a victim's browser, and every current browser sends one of the two on a
 * cross-origin write. GET/HEAD/OPTIONS are never checked, so a top-level navigation (the Zoho OAuth and step-up
 * callbacks are GETs arriving cross-site from zoho.in) always passes — they need no exemption.
 * Exempt: /api/webhooks/* only. Their callers are Zoho Sign's and the investor app's servers, which carry no
 * session cookie; each is authenticated by an HMAC over the exact body (server/zoho-sign/webhook,
 * server/contracts/inbound), so a forged cross-site post has nothing to ride on, and a provider whose delivery
 * infrastructure happens to send an Origin must not be refused for it.
 *
 * RATE LIMITS (H3). One table, RATE_LIMITS. An in-process token bucket per (client IP + session) — refill
 * `perMinute` per minute, burst `perMinute` — and a coarser one per client IP alone at IP_SHARE × perMinute,
 * so a caller inventing a fresh cookie per request still meets a ceiling. Crossing either answers 429 with
 * Retry-After (whole seconds). The buckets live in the process's SharedState (server/state, STATE_STORE): memory
 * by default (one instance only), Catalyst NoSQL for a multi-instance host (docs/architecture/shared-state.md). Off under NODE_ENV=test unless GZ_RATE_LIMITS=on, so route tests that call one endpoint
 * many times keep passing; every other mode (dev, fixture mode, production) enforces it.
 */

import { createHash } from "node:crypto";
import { createMemoryState } from "../state/memory";
import { sharedState } from "../state/runtime";
import type { SharedState } from "../state/shared-state";
import { TEST_SESSION_ROUTE, testSigninEnabled } from "../oauth/test-signin-gate";

export type RouteHandler<C> = (request: Request, context: C) => Response | Promise<Response>;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ------------------------------------------------ H2: Origin ------------------------------------------------ */

/** Routes whose writes are not checked, and why (see the header). Prefix match on the route template. */
export const ORIGIN_EXEMPT: ReadonlyArray<{ readonly prefix: string; readonly why: string }> = Object.freeze([
  { prefix: "/api/webhooks/", why: "server-to-server, no session cookie, authenticated by an HMAC over the exact body" },
]);

const hostOf = (value: string | null): string | null => {
  if (!value) return null;
  try { return new URL(value).host.toLowerCase(); } catch { return null; }
};

/** The hosts this request may call its own: the Host header, the proxy's X-Forwarded-Host, the URL's own, and CONSOLE_PUBLIC_ORIGIN when set. */
function ownHosts(request: Request): Set<string> {
  const out = new Set<string>();
  const add = (h: string | null | undefined) => { const v = h?.split(",")[0]?.trim().toLowerCase(); if (v) out.add(v); };
  add(request.headers.get("host"));
  add(request.headers.get("x-forwarded-host"));
  add(hostOf(request.url));
  // Behind a proxy (Catalyst AppSail) the Host the app sees is internal: the deployment names its public origin.
  add(hostOf(process.env.CONSOLE_PUBLIC_ORIGIN ?? null));
  return out;
}

export type OriginVerdict = { readonly ok: true } | { readonly ok: false; readonly why: "cross-site" | "same-site" | "foreign-origin" };

/** Decide one request. Pure: reads only the method, Sec-Fetch-Site, Origin and the host headers. */
export function originVerdict(request: Request, route: string): OriginVerdict {
  if (!MUTATING.has(request.method.toUpperCase())) return { ok: true };
  if (ORIGIN_EXEMPT.some((e) => route.startsWith(e.prefix))) return { ok: true };
  /* D124: the staging test sign-in is called by the test runner's server-side request context and authenticated by
     X-Test-Signin-Secret (a header no cross-site page can set without a CORS preflight this app never grants). Exactly
     this route, and only while its gate is on; off, the route itself answers 404. */
  if (route === TEST_SESSION_ROUTE && testSigninEnabled()) return { ok: true };
  const site = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site === "cross-site") return { ok: false, why: "cross-site" };
  if (site === "same-site") return { ok: false, why: "same-site" };
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const host = hostOf(origin);   // "null" (sandboxed frame, privacy redirect) parses to null → refused
    if (host === null || !ownHosts(request).has(host)) return { ok: false, why: "foreign-origin" };
    return { ok: true };
  }
  return { ok: true };
}

export const ORIGIN_REFUSAL_MESSAGE = "Refused: this change did not come from the console's own page.";

function originRefusal(why: string): Response {
  return Response.json({ error: ORIGIN_REFUSAL_MESSAGE, code: why }, { status: 403, headers: NO_STORE });
}

/* --------------------------------------------- H3: rate limits --------------------------------------------- */

export interface RateRule {
  readonly name: string;
  /** Route templates as passed to withErrorCapture. */
  readonly matches: (route: string) => boolean;
  readonly perMinute: number;
}

/** THE ONE CONFIG. N per minute per (IP + session); per IP alone, IP_SHARE × N. */
export const RATE_LIMITS: ReadonlyArray<RateRule> = Object.freeze([
  { name: "test-signin", matches: (r: string) => r === "/api/test/session" || r.startsWith("/api/test/session/") || r === "/api/test/state-health" || r === "/api/test/sign/complete", perMinute: 10 },
  { name: "auth", matches: (r: string) => r === "/api/auth" || r.startsWith("/api/auth/"), perMinute: 20 },
  { name: "search", matches: (r: string) => /^\/api\/[^/]+\/search$/.test(r), perMinute: 60 },
  { name: "upload", matches: (r: string) => r === "/api/documents/upload", perMinute: 20 },
  { name: "webhooks", matches: (r: string) => r.startsWith("/api/webhooks/"), perMinute: 120 },
]);
export const IP_SHARE = 5;

/** Session cookies that name a caller (Zoho session id; the phase-1 / fixture session). */
const SESSION_COOKIES = ["gz_zsid", "gz_session"];

/** The client's address as the nearest proxy saw it: the right-most X-Forwarded-For hop, else X-Real-IP. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return (last || request.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

/** A short hash of the caller's session cookie (never the value itself); "-" when there is none. */
export function sessionKey(request: Request): string {
  const cookie = request.headers.get("cookie");
  if (!cookie) return "-";
  for (const name of SESSION_COOKIES) {
    for (const part of cookie.split(";")) {
      const at = part.indexOf("=");
      if (at > 0 && part.slice(0, at).trim() === name) {
        const v = part.slice(at + 1).trim();
        if (v) return createHash("sha256").update(v).digest("base64url").slice(0, 16);
      }
    }
  }
  return "-";
}

export type RateVerdict = { readonly ok: true } | { readonly ok: false; readonly rule: string; readonly retryAfterS: number };

export interface RateLimiter {
  check(route: string, request: Request): Promise<RateVerdict>;
  /** Start every bucket afresh (tests). Bumps this limiter's key generation; the store forgets the old keys by TTL. */
  reset(): void;
}

/** The buckets live in a SharedState (server/state): memory by default, one per limiter, as before. */
export function createRateLimiter(options: { rules?: ReadonlyArray<RateRule>; clock?: () => number; ipShare?: number; state?: SharedState } = {}): RateLimiter {
  const rules = options.rules ?? RATE_LIMITS;
  const ipShare = options.ipShare ?? IP_SHARE;
  const state = options.state ?? createMemoryState({ clock: options.clock });
  let generation = 0;

  return {
    async check(route, request) {
      const rule = rules.find((r) => r.matches(route));
      if (!rule) return { ok: true };
      const ip = clientIp(request);
      const g = `rate|${generation}|${rule.name}|${ip}`;
      const waitPair = await state.take(`${g}|${sessionKey(request)}`, rule.perMinute, rule.perMinute);
      if (waitPair > 0) return { ok: false, rule: rule.name, retryAfterS: Math.max(1, Math.ceil(waitPair / 1000)) };
      const waitIp = await state.take(g, rule.perMinute * ipShare, rule.perMinute * ipShare);
      if (waitIp > 0) return { ok: false, rule: rule.name, retryAfterS: Math.max(1, Math.ceil(waitIp / 1000)) };
      return { ok: true };
    },
    reset() { generation++; },
  };
}

export const RATE_LIMIT_MESSAGE = "Too many requests — wait a moment and try again.";

function rateRefusal(v: Extract<RateVerdict, { ok: false }>): Response {
  return Response.json({ error: RATE_LIMIT_MESSAGE, code: "rate-limited" },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(v.retryAfterS) } });
}

export const rateLimitsOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.GZ_RATE_LIMITS === "on" || env.NODE_ENV !== "test";

/* ------------------------------------------------- the gate ------------------------------------------------- */

export interface RequestGateOptions {
  /** The limiter to use, or null for none. Read per request, so tests can switch it. */
  readonly limiter: () => RateLimiter | null;
}

/** Wrap one handler: 429 when throttled, 403 when a write comes from another site; else the handler. */
export function createRequestGate(options: RequestGateOptions) {
  return function gate<C>(handler: RouteHandler<C>, route: string): RouteHandler<C> {
    return async (request, context) => {
      const limiter = options.limiter();
      if (limiter) {
        let r: RateVerdict;
        /* A shared store that cannot answer lets the request through (PROVISIONAL, docs/architecture/shared-state.md):
           the limit is a guard in front of Zoho's own, and refusing every sign-in while the store is down is worse. */
        try { r = await limiter.check(route, request); } catch { r = { ok: true }; }
        if (!r.ok) return rateRefusal(r);
      }
      const o = originVerdict(request, route);
      if (!o.ok) return originRefusal(o.why);
      return handler(request, context);
    };
  };
}

/* The process's one limiter (globalThis, so a dev-server module reload keeps the counts). */
const G = globalThis as typeof globalThis & { __gzRateLimiter?: RateLimiter };
export function sharedRateLimiter(): RateLimiter {
  return (G.__gzRateLimiter ??= createRateLimiter({ state: sharedState() }));
}

/** The gate withErrorCapture applies to every route. */
export const requestGate = createRequestGate({ limiter: () => (rateLimitsOn() ? sharedRateLimiter() : null) });
