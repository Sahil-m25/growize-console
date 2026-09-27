/**
 * ZOHO SIGN READS FOR PROVIDER CALLBACKS.
 *
 * A Sign webhook is only a hint (D72).  This client re-fetches the request from
 * Zoho Sign before any CRM consequence is written.  It deliberately accepts
 * only the `provider-callback` service credential; a screen must use the
 * signed-in person's token through its own server route.
 *
 * As with the CRM client, bodies never enter Plane B.  The log contains only
 * the service job, endpoint template, status, timing and request id.
 */

import {
  backoffDelay,
  classifyResponse,
  classifyThrown,
  isFailure,
  retryAfterOf,
  retryPolicy,
  type ZohoFailure,
} from "./errors";
import { GateQueueFullError, type Gate, type GateLease } from "./gate";
import { assertServiceCredential, type FetchLike, type ServiceCredential, type ZohoResult } from "./client";
import type { OpsLog } from "./log";

export const SIGN_API_VERSION = "v1";
export const MAX_SIGN_ATTEMPTS = 5;

export interface ZohoSignRequest {
  readonly requestId: string;
  /** Zoho's source value, normalised only for case and surrounding space. */
  readonly status: string;
  readonly actionTime: number | null;
  readonly modifiedTime: number | null;
  readonly documentIds: readonly string[];
}

export interface ZohoSignClient {
  getRequest(as: ServiceCredential, requestId: string, options?: { readonly signal?: AbortSignal }): Promise<ZohoResult<ZohoSignRequest>>;
}

export interface ZohoSignClientOptions {
  readonly origin: string;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly fetch?: FetchLike;
  readonly clock?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly maxAttempts?: number;
}

type Obj = Readonly<Record<string, unknown>>;
const obj = (value: unknown): Obj | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;

const SIGN_API_DOMAINS: ReadonlyMap<string, string> = new Map([
  ["sign.zoho.com", "https://www.zohoapis.com"],
  ["sign.zoho.eu", "https://www.zohoapis.eu"],
  ["sign.zoho.in", "https://www.zohoapis.in"],
  ["sign.zoho.jp", "https://www.zohoapis.jp"],
  ["sign.zoho.com.au", "https://www.zohoapis.com.au"],
  ["sign.zohocloud.ca", "https://www.zohoapis.ca"],
  ["sign.zoho.sa", "https://www.zohoapis.sa"],
]);

/** A configured Sign origin, never inferred from the CRM api_domain. */
export function signOriginOf(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") throw new TypeError("Zoho Sign needs an explicit data-centre origin.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Invalid Zoho Sign origin.");
  }
  if (url.protocol !== "https:" || !SIGN_API_DOMAINS.has(url.hostname.toLowerCase()) || url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new TypeError("Zoho Sign origin must be an exact https Zoho Sign data-centre origin.");
  }
  return url.origin;
}

function requestIdOf(value: unknown): string | null {
  return typeof value === "string" && /^\d{10,25}$/.test(value) ? value : null;
}

function millis(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function parseRequest(body: unknown, expectedId: string): ZohoSignRequest | null {
  const request = obj(obj(body)?.requests);
  if (!request) return null;
  const carriesRequestId = Object.prototype.hasOwnProperty.call(request, "request_id");
  const responseId = requestIdOf(request.request_id);
  // Zoho's documented GET response may omit request_id.  If it is present,
  // however, it is source data and must be a valid exact match; a malformed
  // value must never be treated as the documented omission case.
  if (carriesRequestId && responseId !== expectedId) return null;
  const rawStatus = typeof request.request_status === "string" ? request.request_status.trim().toLowerCase() : "";
  if (!rawStatus || !/^[a-z][a-z _-]{0,63}$/.test(rawStatus)) return null;
  const docs = Array.isArray(request.document_ids)
    ? request.document_ids.map(obj).map((d) => requestIdOf(d?.document_id)).filter((id): id is string => id !== null)
    : [];
  return Object.freeze({
    requestId: responseId ?? expectedId,
    status: rawStatus,
    actionTime: millis(request.action_time),
    modifiedTime: millis(request.modified_time),
    documentIds: Object.freeze([...new Set(docs)]),
  });
}

function parseJson(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

export function createZohoSignClient(options: ZohoSignClientOptions): ZohoSignClient {
  const origin = signOriginOf(options.origin);
  const credentialApiDomain = SIGN_API_DOMAINS.get(new URL(origin).hostname);
  if (credentialApiDomain === undefined) throw new TypeError("Zoho Sign origin has no matching API data centre.");
  const fetchImpl = options.fetch ?? (fetch as unknown as FetchLike);
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_SIGN_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_SIGN_ATTEMPTS) {
    throw new RangeError(`maxAttempts is 1–${MAX_SIGN_ATTEMPTS}.`);
  }

  return {
    async getRequest(as, requestId, call = {}) {
      assertServiceCredential(as, "provider-callback");
      if (as.apiDomain !== credentialApiDomain) throw new TypeError("Zoho Sign and OAuth credentials must use the same data centre.");
      if (!/^\d{10,25}$/.test(requestId)) throw new TypeError("Invalid Zoho Sign request id.");
      const actor = { kind: "service", job: "provider-callback" } as const;
      if (as.expiresAt !== null && clock() >= as.expiresAt) {
        options.log.refusal({ at: clock(), actor, action: "signGetRequest", reason: "token-expired", recordIds: [requestId] });
        return { ok: false, error: { kind: "auth-expired", status: null, code: "TOKEN_EXPIRED" }, creditsRemaining: null };
      }
      let lastCredits: number | null = null;

      for (let attempt = 1; ; attempt++) {
        const queuedAt = clock();
        let lease: GateLease;
        try {
          lease = await options.gate.acquire("simple", call.signal);
        } catch (error) {
          const failure: ZohoFailure = error instanceof GateQueueFullError
            ? { kind: "busy", status: null }
            : { kind: "aborted", status: null };
          options.log.call({
            at: queuedAt, actor, op: "signGetRequest", method: "GET", endpoint: "/requests/{id}", callClass: "simple",
            status: null, durationMs: 0, gateWaitMs: clock() - queuedAt, attempt, creditsRemaining: null,
            errorClass: failure.kind, recordIds: [requestId],
          });
          return { ok: false, error: failure, creditsRemaining: lastCredits };
        }

        const startedAt = clock();
        let status: number | null = null;
        let outcome;
        try {
          const response = await fetchImpl(`${origin}/api/${SIGN_API_VERSION}/requests/${requestId}`, {
            method: "GET",
            headers: { Accept: "application/json", Authorization: `Zoho-oauthtoken ${as.accessToken}` },
            signal: call.signal,
          });
          status = response.status;
          outcome = classifyResponse({ status, body: parseJson(await response.text()) });
        } catch (error) {
          outcome = classifyThrown(error, call.signal);
        } finally {
          lease.release();
        }

        options.log.call({
          at: startedAt, actor, op: "signGetRequest", method: "GET", endpoint: "/requests/{id}", callClass: "simple",
          status, durationMs: clock() - startedAt, gateWaitMs: startedAt - queuedAt, attempt, creditsRemaining: null,
          errorClass: isFailure(outcome) ? outcome.kind : null, recordIds: [requestId],
        });

        if (!isFailure(outcome)) {
          const parsed = outcome.kind === "ok" ? parseRequest(outcome.body, requestId) : null;
          if (parsed) return { ok: true, value: parsed, status: outcome.status, creditsRemaining: lastCredits };
          options.log.refusal({
            at: clock(), actor, action: "signGetRequest", reason: "invalid-source-response", recordIds: [requestId],
          });
          return {
            ok: false,
            error: { kind: "invalid-data", status: outcome.status, code: "INVALID_SIGN_RESPONSE", field: null, records: null },
            creditsRemaining: lastCredits,
          };
        }

        const policy = retryPolicy(outcome, { idempotent: true });
        if (!policy.retry || attempt >= Math.min(policy.maxAttempts, maxAttempts)) {
          return { ok: false, error: outcome, creditsRemaining: lastCredits };
        }
        try {
          await sleep(backoffDelay(attempt, policy, retryAfterOf(outcome), random), call.signal);
        } catch {
          return { ok: false, error: { kind: "aborted", status: null }, creditsRemaining: lastCredits };
        }
      }
    },
  };
}
