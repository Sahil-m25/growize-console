/**
 * ZOHO ACCOUNTS FOR A HUMAN (M01-S02-T01/T02, D53): the authorization-code grant with PKCE, the
 * refresh of that person's access token, and the revoke on sign-out.
 *
 * Every call goes to the one configured accounts origin (the data centre is pinned; a callback's
 * `accounts-server` that names another is refused before a code is ever sent). Zoho Accounts answers
 * a refused grant with HTTP 200 and `{"error":"invalid_code"}`, so success is "a well-formed grant",
 * never "a 2xx". Plane B gets one line per call — endpoint template, status and class; never the
 * code, a token, the client secret or any body.
 */

import type { FetchResponseLike } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { LogActor, OpsLog } from "../../lib/zoho/log";
import { accountsOriginOf, type TokenFetch } from "./service-token";

export const ACCOUNTS_TIMEOUT_MS = 10_000;

/** A token grant, normalised (Zoho sends expires_in as a number or a numeric string). */
export interface TokenGrant {
  readonly access_token: string;
  readonly api_domain: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
}

/** Zoho's own error word ("invalid_client", "invalid_code"), for diagnostics only: lowercase letters and _ only, never a value. */
function zohoErrorOf(text: string): { zohoError?: string } {
  try {
    const e = (JSON.parse(text) as { error?: unknown }).error;
    return typeof e === "string" && /^[a-z_]{1,40}$/.test(e) ? { zohoError: e } : {};
  } catch {
    return {};
  }
}

export type AccountsResult<T> =
  | { readonly ok: true; readonly value: T }
  /** refused: Zoho said no (revoked, expired, reused code). unavailable: we could not ask. */
  | { readonly ok: false; readonly reason: "refused" | "unavailable"; readonly status?: number | null; readonly zohoError?: string };

export interface ZohoAccountsOptions {
  readonly accountsOrigin: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
  readonly log: OpsLog;
  readonly fetch?: TokenFetch;
  readonly clock?: () => number;
  readonly timeoutMs?: number;
  /** M01-S10-T01: this deployment's exact …/api/auth/step-up/callback, registered on the same Zoho client. */
  readonly stepUpRedirectUri?: string | null;
}

/** M01-S10-T01: the step-up asks only enough to learn who signed in again (the CRM CurrentUser). */
export const STEP_UP_SCOPES: readonly string[] = Object.freeze(["ZohoCRM.users.READ"]);

export interface ZohoAccounts {
  readonly accountsOrigin: string;
  authorizeUrl(p: { readonly state: string; readonly codeChallenge: string }): string;
  exchangeCode(p: { readonly code: string; readonly codeVerifier: string }): Promise<AccountsResult<TokenGrant>>;
  refresh(refreshToken: string, actor: LogActor): Promise<AccountsResult<TokenGrant>>;
  revoke(refreshToken: string, actor: LogActor): Promise<AccountsResult<null>>;
  /** M01-S10-T01: true when a step-up redirect URI is configured. */
  readonly stepUpReady: boolean;
  /**
   * M01-S10-T01: a re-authentication round trip — prompt=login and max_age force a fresh Zoho
   * sign-in even when a Zoho session is open; access_type=online, so no refresh token is issued.
   */
  stepUpUrl(p: { readonly state: string; readonly codeChallenge: string; readonly maxAgeS: number }): string;
  /** Trades a step-up code (the step-up redirect URI, PKCE). The grant is used once to name the person, then dropped. */
  exchangeStepUpCode(p: { readonly code: string; readonly codeVerifier: string }): Promise<AccountsResult<TokenGrant>>;
}

function configured(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 4_096 || /[\r\n\0\s]/.test(value)) {
    throw new TypeError(`${name} is not configured safely.`);
  }
  return value;
}

/** https, or http on localhost for a developer's own machine; no query, no fragment, no credentials. */
export function redirectUriOf(raw: unknown): string {
  if (typeof raw !== "string") throw new TypeError("The OAuth redirect URI is not configured.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new TypeError("The OAuth redirect URI is not a URL.");
  }
  const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  if ((u.protocol !== "https:" && !local) || u.username || u.password || u.search || u.hash) {
    throw new TypeError("The OAuth redirect URI must be an exact https URL (http only on localhost).");
  }
  return u.toString();
}

const SCOPE = /^[A-Za-z][A-Za-z0-9_.]{2,127}$/;

export function parseGrant(text: string): TokenGrant | null {
  let v: unknown;
  try {
    v = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (typeof b.error === "string") return null;
  const expires = typeof b.expires_in === "number" ? b.expires_in
    : typeof b.expires_in === "string" && /^\d{1,9}$/.test(b.expires_in) ? Number(b.expires_in) : Number.NaN;
  if (typeof b.access_token !== "string" || b.access_token === "" || typeof b.api_domain !== "string"
    || !Number.isSafeInteger(expires) || expires <= 0) return null;
  const refresh = typeof b.refresh_token === "string" && b.refresh_token !== "" ? { refresh_token: b.refresh_token } : {};
  return { access_token: b.access_token, api_domain: b.api_domain, expires_in: expires, ...refresh };
}

/** A definitive answer: Zoho sent an `error` body, or refused the client/grant outright. */
function refusedBy(status: number, text: string): boolean {
  if (status === 400 || status === 401) return true;
  if (status < 200 || status >= 300) return false;
  try {
    const b = JSON.parse(text) as unknown;
    return typeof b === "object" && b !== null && typeof (b as { error?: unknown }).error === "string";
  } catch {
    return false;
  }
}

function errorClass(status: number | null, outcome: "ok" | "refused" | "unavailable", aborted: boolean): ZohoFailureKind | null {
  if (outcome === "ok") return null;
  if (aborted) return "aborted";
  if (status === null) return "network";
  if (outcome === "refused") return "auth-rejected";
  if (status >= 500) return "server";
  return "unexpected";
}

export function createZohoAccounts(o: ZohoAccountsOptions): ZohoAccounts {
  const origin = accountsOriginOf(o.accountsOrigin);
  const clientId = configured(o.clientId, "OAuth client id");
  const clientSecret = configured(o.clientSecret, "OAuth client secret");
  const redirectUri = redirectUriOf(o.redirectUri);
  if (!Array.isArray(o.scopes) || o.scopes.length === 0 || !o.scopes.every((s) => typeof s === "string" && SCOPE.test(s))) {
    throw new TypeError("OAuth scopes must be a non-empty list of Zoho scope names.");
  }
  const scope = o.scopes.join(",");
  const stepUpRedirect = o.stepUpRedirectUri ? redirectUriOf(o.stepUpRedirectUri) : null;
  const fetchImpl: TokenFetch = o.fetch ?? ((url, init) => fetch(url, { ...init, redirect: "error" }));
  const clock = o.clock ?? Date.now;
  const timeoutMs = o.timeoutMs ?? ACCOUNTS_TIMEOUT_MS;

  async function post<T>(
    op: string, endpoint: string, url: string, form: URLSearchParams | null, actor: LogActor,
    read: (text: string) => { readonly v: T } | null,
  ): Promise<AccountsResult<T>> {
    const startedAt = clock();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
    let status: number | null = null;
    let outcome: "ok" | "refused" | "unavailable" = "unavailable";
    try {
      let response: FetchResponseLike;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: form ? form.toString() : "",
          signal: deadline.signal,
        });
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      status = response.status;
      let text: string;
      try {
        text = await response.text();
      } catch {
        return { ok: false, reason: "unavailable" };
      }
      if (text.length > 65_536) return { ok: false, reason: "unavailable" };
      const got = status >= 200 && status < 300 ? read(text) : null;
      if (got !== null) {
        outcome = "ok";
        return { ok: true, value: got.v };
      }
      outcome = refusedBy(status, text) ? "refused" : "unavailable";
      return { ok: false, reason: outcome, status, ...zohoErrorOf(text) };
    } finally {
      clearTimeout(timer);
      o.log.call({
        at: startedAt,
        actor,
        op,
        method: "POST",
        endpoint,
        callClass: "simple",
        status,
        durationMs: Math.max(0, clock() - startedAt),
        gateWaitMs: 0,
        attempt: 1,
        creditsRemaining: null,
        errorClass: errorClass(status, outcome, deadline.signal.aborted),
        recordIds: [],
      });
    }
  }

  const nobody: LogActor = { kind: "user", userId: "unrecognised" };

  return Object.freeze({
    accountsOrigin: origin,
    authorizeUrl({ state, codeChallenge }: { readonly state: string; readonly codeChallenge: string }): string {
      const q = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope,
        redirect_uri: redirectUri,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${origin}/oauth/v2/auth?${q.toString()}`;
    },
    exchangeCode({ code, codeVerifier }: { readonly code: string; readonly codeVerifier: string }) {
      const form = new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, code, code_verifier: codeVerifier,
      });
      return post("exchangeCode", "/oauth/v2/token", `${origin}/oauth/v2/token`, form, nobody, (t) => {
        const g = parseGrant(t);
        return g && g.refresh_token ? { v: g } : null;
      });
    },
    refresh(refreshToken: string, actor: LogActor) {
      const form = new URLSearchParams({
        grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
      });
      return post("refreshToken", "/oauth/v2/token", `${origin}/oauth/v2/token`, form, actor, (t) => {
        const g = parseGrant(t);
        return g ? { v: g } : null;
      });
    },
    stepUpReady: stepUpRedirect !== null,
    stepUpUrl({ state, codeChallenge, maxAgeS }: { readonly state: string; readonly codeChallenge: string; readonly maxAgeS: number }): string {
      if (!stepUpRedirect) throw new TypeError("The step-up redirect URI is not configured.");
      const q = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        scope: STEP_UP_SCOPES.join(","),
        redirect_uri: stepUpRedirect,
        access_type: "online",
        prompt: "login",
        max_age: String(Math.max(0, Math.floor(maxAgeS))),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });
      return `${origin}/oauth/v2/auth?${q.toString()}`;
    },
    exchangeStepUpCode({ code, codeVerifier }: { readonly code: string; readonly codeVerifier: string }) {
      if (!stepUpRedirect) return Promise.resolve({ ok: false, reason: "unavailable" } as const);
      const form = new URLSearchParams({
        grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret,
        redirect_uri: stepUpRedirect, code, code_verifier: codeVerifier,
      });
      return post("exchangeStepUpCode", "/oauth/v2/token", `${origin}/oauth/v2/token`, form, nobody, (t) => {
        const g = parseGrant(t);
        return g ? { v: g } : null;
      });
    },
    revoke(refreshToken: string, actor: LogActor) {
      /* Zoho's documented form: POST /oauth/v2/token/revoke?token=<refresh token>. */
      const url = `${origin}/oauth/v2/token/revoke?${new URLSearchParams({ token: refreshToken }).toString()}`;
      return post("revokeToken", "/oauth/v2/token/revoke", url, null, actor, (t) => (refusedBy(200, t) ? null : { v: null }));
    },
  });
}
