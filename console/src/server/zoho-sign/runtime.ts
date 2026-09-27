/** Server-only composition for the Zoho Sign callback. Secrets are read lazily. */

import { createGate } from "../../lib/zoho/gate";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createZohoServiceClient } from "../../lib/zoho/client";
import { createZohoSignClient } from "../../lib/zoho/sign";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import type { ZohoSignWebhookDeps } from "./webhook";

const gate = createGate();
export const providerCallbackOps = createMemorySink();
const log = createOpsLog(providerCallbackOps);
const INDIA_ACCOUNTS_ORIGIN = "https://accounts.zoho.in";
const INDIA_SIGN_ORIGIN = "https://sign.zoho.in";
const INDIA_API_DOMAIN = "https://www.zohoapis.in";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function requiredExact(name: string, expected: string): string {
  const value = required(name);
  if (value !== expected) throw new Error(`${name} must use the India data centre.`);
  return value;
}

/** Route-boundary failures have no Zoho call of their own, so record the refusal here. */
export function logProviderCallbackBoundary(reason: string): void {
  log.refusal({
    at: Date.now(),
    actor: { kind: "service", job: "provider-callback" },
    action: "signWebhook",
    reason,
    recordIds: [],
  });
}

let tokenProvider: ServiceTokenProvider | null = null;

function provider(): ServiceTokenProvider {
  tokenProvider ??= createServiceTokenProvider({
    job: "provider-callback",
    accountsOrigin: requiredExact("ZOHO_ACCOUNTS_ORIGIN", INDIA_ACCOUNTS_ORIGIN),
    clientId: required("ZOHO_OAUTH_CLIENT_ID"),
    clientSecret: required("ZOHO_OAUTH_CLIENT_SECRET"),
    refreshToken: required("ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN"),
    expectedApiDomain: INDIA_API_DOMAIN,
    refreshTimeoutMs: 2_500,
    log,
  });
  return tokenProvider;
}

export function zohoSignWebhookDeps(): ZohoSignWebhookDeps {
  const origin = requiredExact("ZOHO_SIGN_API_ORIGIN", INDIA_SIGN_ORIGIN);
  const current = required("ZOHO_SIGN_WEBHOOK_SECRET");
  const previous = process.env.ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS;
  return {
    secrets: previous ? [current, previous] : [current],
    credential: (signal) => provider().credential(signal),
    invalidateCredential: (credential) => provider().invalidate(credential),
    log,
    // A webhook must answer promptly.  Redelivery is the retry mechanism; this
    // request path never sleeps through client backoff.
    crm: createZohoServiceClient({ gate, log, maxAttempts: 1 }),
    sign: createZohoSignClient({ origin, gate, log, maxAttempts: 1 }),
  };
}
