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
 * Retry-After (whole seconds). IN-PROCESS ONLY: a host running more than one instance needs a shared store
 * (ops/env/README.md). Off under NODE_ENV=test unless GZ_RATE_LIMITS=on, so route tests that call one endpoint
 * many times keep passing; every other mode (dev, fixture mode, production) enforces it.
 */

import { createHash } from "node:crypto";

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

/** The hosts this request may call its own: the Host header, the proxy's X-Forwarded-Host, and the URL's own. */
function ownHosts(request: Request): Set<string> {
  const out = new Set<string>();
  const add = (h: string | null | undefined) => { const v = h?.split(",")[0]?.trim().toLowerCase(); if (v) out.add(v); };
  add(request.headers.get("host"));
  add(request.headers.get("x-forwarded-host"));
  add(hostOf(request.url));
  return out;
}

export type OriginVerdict = { readonly ok: true } | { readonly ok: false; readonly why: "cross-site" | "same-site" | "foreign-origin" };

/** Decide one request. Pure: reads only the method, Sec-Fetch-Site, Origin and the host headers. */
export function originVerdict(request: Request, route: string): OriginVerdict {
  if (!MUTATING.has(request.method.toUpperCase())) return { ok: true };
  if (ORIGIN_EXEMPT.some((e) => route.startsWith(e.prefix))) return { ok: true };
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

type Bucket = { tokens: number; at: number };
export type RateVerdict = { readonly ok: true } | { readonly ok: false; readonly rule: string; readonly retryAfterS: number };

export interface RateLimiter {
  check(route: string, request: Request): RateVerdict;
  reset(): void;
}

const MAX_BUCKETS = 50_000;

export function createRateLimiter(options: { rules?: ReadonlyArray<RateRule>; clock?: () => number; ipShare?: number } = {}): RateLimiter {
  const rules = options.rules ?? RATE_LIMITS;
  const clock = options.clock ?? Date.now;
  const ipShare = options.ipShare ?? IP_SHARE;
  const buckets = new Map<string, Bucket>();

  /** Refill, then take one token. Returns 0 when taken, else the ms until one is available. */
  const take = (key: string, capacity: number, now: number): number => {
    const perMs = capacity / 60_000;
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + Math.max(0, now - b.at) * perMs);
    b.at = now;
    buckets.set(key, b);
    if (b.tokens >= 1) { b.tokens -= 1; return 0; }
    return Math.ceil((1 - b.tokens) / perMs);
  };

  const sweep = (now: number) => {
    if (buckets.size < MAX_BUCKETS) return;
    for (const [k, b] of buckets) if (now - b.at > 60_000) buckets.delete(k);   // full again by now: forgetting it changes nothing
    if (buckets.size >= MAX_BUCKETS) buckets.clear();
  };

  return {
    check(route, request) {
      const rule = rules.find((r) => r.matches(route));
      if (!rule) return { ok: true };
      const now = clock();
      sweep(now);
      const ip = clientIp(request);
      const waitPair = take(`${rule.name}|${ip}|${sessionKey(request)}`, rule.perMinute, now);
      if (waitPair > 0) return { ok: false, rule: rule.name, retryAfterS: Math.max(1, Math.ceil(waitPair / 1000)) };
      const waitIp = take(`${rule.name}|${ip}`, rule.perMinute * ipShare, now);
      if (waitIp > 0) return { ok: false, rule: rule.name, retryAfterS: Math.max(1, Math.ceil(waitIp / 1000)) };
      return { ok: true };
    },
    reset() { buckets.clear(); },
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
    return (request, context) => {
      const limiter = options.limiter();
      if (limiter) {
        const r = limiter.check(route, request);
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
  return (G.__gzRateLimiter ??= createRateLimiter());
}

/** The gate withErrorCapture applies to every route. */
export const requestGate = createRequestGate({ limiter: () => (rateLimitsOn() ? sharedRateLimiter() : null) });
