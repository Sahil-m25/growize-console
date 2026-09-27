/**
 * Refresh-token credential provider for an approved background job.
 *
 * Refresh tokens and client secrets stay in the host secret store.  Neither a
 * token response nor an error body is logged; Plane B receives only the
 * service job, endpoint template, response class and timing.
 */

import { apiDomainOf, serviceCredential, type ApiDomain, type FetchResponseLike, type ServiceCredential, type ServiceJob } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";

export const SERVICE_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1_000;
export const DEFAULT_SERVICE_TOKEN_REFRESH_TIMEOUT_MS = 10_000;

const ACCOUNTS_HOSTS = new Set([
  "accounts.zoho.com",
  "accounts.zoho.eu",
  "accounts.zoho.in",
  "accounts.zoho.com.au",
  "accounts.zoho.jp",
  "accounts.zohocloud.ca",
  "accounts.zoho.sa",
]);

export interface TokenFetch {
  (
    url: string,
    init: {
      readonly method: "POST";
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<FetchResponseLike>;
}

export interface ServiceTokenProvider {
  credential(signal?: AbortSignal): Promise<ServiceCredential>;
  /** Clear only the credential that was rejected; never evict a newer grant. */
  invalidate(credential: ServiceCredential): void;
}

export interface ServiceTokenProviderOptions {
  readonly job: ServiceJob;
  readonly accountsOrigin: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  /** Optional hard DC binding for a single-region deployment. */
  readonly expectedApiDomain?: string;
  /** Provider-owned bound; a caller's deadline only stops that caller waiting. */
  readonly refreshTimeoutMs?: number;
  readonly log: OpsLog;
  readonly fetch?: TokenFetch;
  readonly clock?: () => number;
}

export function accountsOriginOf(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") throw new TypeError("Zoho OAuth needs an explicit accounts origin.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Invalid Zoho accounts origin.");
  }
  const bare = !url.username && !url.password && !url.port && !url.search && !url.hash && (url.pathname === "/" || url.pathname === "");
  if (url.protocol !== "https:" || !bare || !ACCOUNTS_HOSTS.has(url.hostname.toLowerCase())) {
    throw new TypeError("Zoho accounts origin must be an exact https Zoho data-centre origin.");
  }
  return url.origin;
}

function secret(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 4_096 || /[\r\n\0]/.test(value)) {
    throw new TypeError(`${name} is not configured safely.`);
  }
  return value;
}

function responseClass(status: number | null, failed: boolean, aborted: boolean): ZohoFailureKind | null {
  if (aborted) return "aborted";
  if (status === null) return "network";
  if (status >= 200 && status < 300) return failed ? "unexpected" : null;
  if (status === 401) return "auth-rejected";
  if (status === 403) return "forbidden";
  if (status >= 500) return "server";
  return "unexpected";
}

function tokenGrant(text: string): { readonly access_token: string; readonly api_domain: string; readonly expires_in: number } | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const expires = typeof body.expires_in === "number"
    ? body.expires_in
    : typeof body.expires_in === "string" && /^\d+$/.test(body.expires_in)
      ? Number(body.expires_in)
      : Number.NaN;
  if (
    typeof body.access_token !== "string"
    || body.access_token === ""
    || typeof body.api_domain !== "string"
    || !Number.isSafeInteger(expires)
    || expires <= 0
  ) return null;
  return { access_token: body.access_token, api_domain: body.api_domain, expires_in: expires };
}

function waitFor<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return pending;
  if (signal.aborted) return Promise.reject(new Error("Zoho service credential is unavailable."));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener("abort", aborted);
      reject(new Error("Zoho service credential is unavailable."));
    };
    signal.addEventListener("abort", aborted, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export function createServiceTokenProvider(options: ServiceTokenProviderOptions): ServiceTokenProvider {
  const accountsOrigin = accountsOriginOf(options.accountsOrigin);
  const clientId = secret(options.clientId, "OAuth client id");
  const clientSecret = secret(options.clientSecret, "OAuth client secret");
  const refreshToken = secret(options.refreshToken, "OAuth refresh token");
  const expectedApiDomain: ApiDomain | null = options.expectedApiDomain === undefined ? null : apiDomainOf(options.expectedApiDomain);
  const fetchImpl: TokenFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const clock = options.clock ?? Date.now;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_SERVICE_TOKEN_REFRESH_TIMEOUT_MS;
  if (!Number.isSafeInteger(refreshTimeoutMs) || refreshTimeoutMs < 100 || refreshTimeoutMs > 60_000) {
    throw new RangeError("refreshTimeoutMs must be 100–60000 ms.");
  }
  let cached: ServiceCredential | null = null;
  let refreshing: Promise<ServiceCredential> | null = null;

  const refresh = async (signal?: AbortSignal): Promise<ServiceCredential> => {
    const startedAt = clock();
    let status: number | null = null;
    let thrown = false;
    try {
      const form = new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      });
      const response = await fetchImpl(`${accountsOrigin}/oauth/v2/token`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal,
      });
      status = response.status;
      const grant = tokenGrant(await response.text());
      if (status < 200 || status >= 300 || grant === null) throw new Error("Zoho OAuth refresh was refused.");
      const credential = serviceCredential(options.job, grant, startedAt);
      if (expectedApiDomain !== null && credential.apiDomain !== expectedApiDomain) {
        throw new Error("Zoho OAuth returned the wrong data centre.");
      }
      return credential;
    } catch {
      thrown = true;
      throw new Error("Zoho service credential is unavailable.");
    } finally {
      options.log.call({
        at: startedAt,
        actor: { kind: "service", job: options.job },
        op: "refreshToken",
        method: "POST",
        endpoint: "/oauth/v2/token",
        callClass: "simple",
        status,
        durationMs: clock() - startedAt,
        gateWaitMs: 0,
        attempt: 1,
        creditsRemaining: null,
        errorClass: responseClass(status, thrown, thrown && signal?.aborted === true),
        recordIds: [],
      });
    }
  };

  return Object.freeze({
    async credential(signal?: AbortSignal): Promise<ServiceCredential> {
      if (signal?.aborted) throw new Error("Zoho service credential is unavailable.");
      const now = clock();
      if (cached !== null && cached.expiresAt !== null && cached.expiresAt > now + SERVICE_TOKEN_REFRESH_SKEW_MS) return cached;
      if (refreshing === null) {
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), refreshTimeoutMs);
        refreshing = refresh(controller.signal)
          .then((credential) => {
            cached = credential;
            return credential;
          })
          .finally(() => {
            clearTimeout(deadline);
            refreshing = null;
          });
      }
      return waitFor(refreshing, signal);
    },
    invalidate(credential: ServiceCredential): void {
      if (cached === credential) cached = null;
    },
  });
}
