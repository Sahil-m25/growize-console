/**
 * D124 — THE STAGING-ONLY TEST SIGN-IN (Jev + Playwright get a real console session for each sandbox test user).
 *
 * GATE. `testSigninEnabled(env)` is true only when ZOHO_CRM_ENVIRONMENT=sandbox AND ZOHO_EXPECTED_ORG_ID is set AND
 * GZ_TEST_SIGNIN_SECRET has at least 32 characters AND GZ_TEST_SIGNIN_USERS names at least one Zoho user id. Off, both
 * routes answer 404 — the same as a route that does not exist. Production is never sandbox, so it can never be on.
 *
 * ENROLMENT. An allowlisted person completing the NORMAL Zoho sign-in while the gate is on has their refresh token kept
 * (user-session.ts `testEnrol`): sealed with ZOHO_SESSION_KEY bound to their user id, in SharedState under
 * `test-enrol|<id>` (no expiry). With STATE_STORE=memory that dies with the instance, so a token may also be supplied
 * read-only as GZ_TEST_REFRESH_<ZOHO_USER_ID>. Sessions holding an enrolled token carry `keepGrant`, so a sign-out or an
 * expiry never revokes it at Zoho. No token ever reaches an HTTP response or a log line.
 *
 * MINT. POST /api/test/session, header X-Test-Signin-Secret (constant-time compare), body { zohoUserId }: the enrolled
 * token → `UserSessions.signInWithRefreshToken` — the callback's own pipeline (org proof, CurrentUser, seat, admission)
 * — → the normal session cookie. GET /api/test/session/status lists the allowlist with enrolled true/false; no tokens.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { Sealer } from "./crypto";
import type { SharedState } from "../state/shared-state";
import { CONSOLE_SEAT, SESSION_ABSOLUTE_MS, SID_COOKIE, type TestEnrolHook, type UserSessions } from "./user-session";
import { TEST_SECRET_MIN, testSigninEnabled, testSigninUsers } from "./test-signin-gate";

/* the gate lives in ./test-signin-gate.ts (no imports, so the request gate can ask it without loading the sign-in) */
export { TEST_SECRET_MIN, TEST_SESSION_ROUTE, TEST_SESSION_STATUS_ROUTE, testSigninEnabled, testSigninUsers } from "./test-signin-gate";

export const TEST_SECRET_HEADER = "x-test-signin-secret";
/** Zoho allows about ten access tokens per refresh token per ten minutes; stay under it per test user. */
export const MINTS_PER_10_MIN = 8;
const USER_ID = /^\d{15,25}$/;
const ENROL_AAD = "gz-test-enrol|";
const enrolKey = (who: string) => `test-enrol|${who}`;
export const refreshEnvName = (who: string) => `GZ_TEST_REFRESH_${who}`;

/** Constant-time: both sides hashed to 32 bytes first, so neither the content nor the length leaks through timing. */
export function testSecretMatches(given: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const want = (env.GZ_TEST_SIGNIN_SECRET ?? "").trim();
  if (want.length < TEST_SECRET_MIN || typeof given !== "string" || given.length === 0 || given.length > 1_024) return false;
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(h(given.trim()), h(want));
}

export interface EnrolledToken { readonly token: string | null; readonly seat: string | null; readonly source: "store" | "env" | null }
export interface TestEnrolment extends TestEnrolHook { load(who: string): Promise<EnrolledToken> }

export function createTestEnrolment(o: { state: SharedState; sealer: Sealer; env?: NodeJS.ProcessEnv }): TestEnrolment {
  const env = o.env ?? process.env;
  const allow = new Set(testSigninUsers(env));
  return Object.freeze({
    wants: (who: string) => testSigninEnabled(env) && allow.has(who),
    async save(who: string, seat: string, refreshToken: string) {
      if (!allow.has(who) || !refreshToken) return;
      await o.state.set(enrolKey(who), JSON.stringify({ t: o.sealer.seal(refreshToken, ENROL_AAD + who), s: seat }));
    },
    async load(who: string): Promise<EnrolledToken> {
      if (!allow.has(who)) return { token: null, seat: null, source: null };
      let raw: string | null = null;
      try { raw = await o.state.get(enrolKey(who)); } catch { raw = null; }
      if (raw !== null) {
        try {
          const v = JSON.parse(raw) as { t?: unknown; s?: unknown };
          const token = typeof v.t === "string" ? o.sealer.open(v.t, ENROL_AAD + who) : null;
          if (token) return { token, seat: typeof v.s === "string" ? v.s : null, source: "store" };
        } catch { /* unreadable: fall through to the env fallback */ }
      }
      const fromEnv = (env[refreshEnvName(who)] ?? "").trim();
      return fromEnv ? { token: fromEnv, seat: null, source: "env" } : { token: null, seat: null, source: null };
    },
  });
}

/** The Zoho seat name behind a console seat token ("conv" → "ir-manager"). */
export const seatNameOf = (seat: string | null): string | null =>
  seat === null ? null : (Object.entries(CONSOLE_SEAT).find(([, t]) => t === seat)?.[0] ?? null);

/* ---------------------------------------------- the two handlers ---------------------------------------------- */

export interface TestSigninDeps {
  readonly env: NodeJS.ProcessEnv;
  /** zohoSignInConfigured() — the real OAuth door must be wired (never fixture mode). */
  readonly configured: boolean;
  readonly sessions: () => UserSessions;
  readonly enrolment: () => TestEnrolment | null;
  readonly state: () => SharedState;
  /** cookieBase(): httpOnly, lax, secure off localhost, path "/". */
  readonly cookie: { readonly secure: boolean };
}

const NO_STORE = { "Cache-Control": "no-store" } as const;
const notFound = () => new Response("Not found", { status: 404, headers: NO_STORE });
const fail = (status: number, why: string, message: string) => Response.json({ ok: false, why, message }, { status, headers: NO_STORE });

/** The gate, the wiring and the secret. Anything short of all three is a 404, indistinguishable from no route. */
function admitted(req: Request, d: TestSigninDeps): TestEnrolment | null {
  if (!d.configured || !testSigninEnabled(d.env)) return null;
  if (!testSecretMatches(req.headers.get(TEST_SECRET_HEADER), d.env)) return null;
  return d.enrolment();
}

export async function testSessionStatus(req: Request, d: TestSigninDeps): Promise<Response> {
  const enrolment = admitted(req, d);
  if (!enrolment) return notFound();
  const users = [];
  for (const id of testSigninUsers(d.env)) {
    const e = await enrolment.load(id);
    users.push({ zohoUserId: id, enrolled: e.token !== null, source: e.source, seat: e.seat, seatName: seatNameOf(e.seat) });
  }
  return Response.json({ ok: true, users }, { headers: NO_STORE });
}

export async function testSessionMint(req: Request, d: TestSigninDeps): Promise<Response> {
  const enrolment = admitted(req, d);
  if (!enrolment) return notFound();
  const body: unknown = await req.json().catch(() => null);
  const who = body && typeof body === "object" ? (body as { zohoUserId?: unknown }).zohoUserId : null;
  if (typeof who !== "string" || !USER_ID.test(who)) return fail(400, "bad-request", "Send { \"zohoUserId\": \"<Zoho user id>\" }.");
  if (!testSigninUsers(d.env).includes(who)) return fail(403, "not-allowlisted", "This Zoho user id is not on GZ_TEST_SIGNIN_USERS.");
  const e = await enrolment.load(who);
  if (e.token === null) {
    return fail(409, "not-enrolled", "Not enrolled: sign in to the console once as this user with the normal Zoho sign-in (or set its GZ_TEST_REFRESH_ variable).");
  }
  try {
    if ((await d.state().incr(`test-mint|${who}`, 600)) > MINTS_PER_10_MIN) {
      return fail(429, "zoho-token-budget", `At most ${MINTS_PER_10_MIN} test sign-ins per user per 10 minutes (Zoho's access-token limit). Reuse the session.`);
    }
  } catch { /* the store not answering does not block a test sign-in; Zoho's own limit still stands */ }
  const sessions = d.sessions();
  const r = await sessions.signInWithRefreshToken(e.token);
  if (!r.ok) return fail(r.code === "failed" ? 502 : 403, r.code, r.message);
  if (r.session.who !== who) {
    /* a pasted token that belongs to somebody else: no session for anyone */
    await sessions.signOut(r.sid, "revoked");
    return fail(409, "token-user-mismatch", "The enrolled token does not belong to this Zoho user id.");
  }
  const cookie = [`${SID_COOKIE}=${r.sid}`, "Path=/", `Max-Age=${SESSION_ABSOLUTE_MS / 1000}`, "HttpOnly", "SameSite=Lax", ...(d.cookie.secure ? ["Secure"] : [])].join("; ");
  return Response.json({ ok: true, who, seat: r.session.seat, seatName: seatNameOf(r.session.seat) },
    { headers: { ...NO_STORE, "Set-Cookie": cookie } });
}
