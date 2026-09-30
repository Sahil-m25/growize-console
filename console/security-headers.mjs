/* M18-S15-H1 — THE ONE ALLOW-LIST every Content-Security-Policy is built from, and the fixed security headers.
 *
 * Read by next.config.mjs (headers on every response; the API's CSP) and src/middleware.ts (each page's CSP,
 * with a fresh per-request nonce). Plain .mjs so next.config.mjs can import it without a TypeScript step;
 * its types are in security-headers.d.mts.
 *
 * Scripts: no 'unsafe-inline'. Next's App Router writes inline <script> tags (the RSC payload and bootstrap),
 * so a page's script-src is `'nonce-…' 'strict-dynamic'`: the middleware mints the nonce and puts the policy on
 * the request, Next stamps the same nonce on its own scripts, and anything those scripts load is trusted through
 * 'strict-dynamic'. That needs every page rendered per request, which the root layout already is (force-dynamic).
 * Styles keep 'unsafe-inline': React renders style="…" attributes and the shell's popup copies a <style> element;
 * the acceptance line asks only that scripts carry no 'unsafe-inline'.
 *
 * Zoho origins: none are needed in the browser today. Sign-in is a top-level navigation to /api/auth/zoho,
 * which answers 302 to accounts.zoho.in (a navigation, not a form post, so form-action does not govern it);
 * every Zoho API call is server-side; Zoho Sign is reached by mail, not an embedded frame. Add one to the list
 * below, with the reason, the day a page needs it — never a wildcard.
 */

/** Directive → sources. The only place a source is allowed. */
export const CSP_ALLOW = Object.freeze({
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:"],
  "connect-src": ["'self'"],
  "frame-src": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
});

/** Development only (next dev): React Refresh evaluates code and the HMR / Reticle sockets are ws://. */
const DEV_EXTRA = Object.freeze({
  "script-src": ["'unsafe-eval'"],
  "connect-src": ["ws:", "http://localhost:*", "http://127.0.0.1:*"],
});

/**
 * A page's policy. `nonce` (base64) is required in production: without one the page's inline bootstrap
 * would be refused, so a missing nonce is a programming error, not a reason to fall back to 'unsafe-inline'.
 */
export function pageCsp(nonce, { dev = false } = {}) {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce)) throw new TypeError("pageCsp needs a base64 nonce");
  const d = Object.fromEntries(Object.entries(CSP_ALLOW).map(([k, v]) => [k, [...v]]));
  d["script-src"].push(`'nonce-${nonce}'`, "'strict-dynamic'");
  if (dev) for (const [k, v] of Object.entries(DEV_EXTRA)) d[k].push(...v);
  return serialise(d);
}

/** An API response's policy: it is JSON, never a document — nothing may load, nothing may frame it. */
export function apiCsp() {
  return serialise({ "default-src": ["'none'"], "frame-ancestors": CSP_ALLOW["frame-ancestors"], "base-uri": ["'none'"], "form-action": ["'none'"] });
}

/* No upgrade-insecure-requests: the local test build is served over http://localhost and would lose its own files. */
function serialise(d) {
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/**
 * The fixed headers, on every response (pages, API, static files).
 * Strict-Transport-Security is sent on every response: a browser ignores it over plain http (RFC 6797 §8.1),
 * so it takes effect exactly when the console is served over https, which is what the acceptance asks.
 * No `preload`: that is a one-way registration for the owner to choose once the host (AP4) is fixed.
 */
export const SECURITY_HEADERS = Object.freeze([
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()" },
]);

/** The header names a response must carry (the test fails if one goes missing). */
export const REQUIRED_SECURITY_HEADERS = Object.freeze([
  "Content-Security-Policy", ...SECURITY_HEADERS.map((h) => h.key),
]);

/** next.config.mjs `headers()`: the fixed headers everywhere; the API's CSP on /api (pages get theirs from the middleware). */
export function nextHeaderRules() {
  return [
    { source: "/:path*", headers: [...SECURITY_HEADERS] },
    { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: apiCsp() }] },
  ];
}
