/** Server-only composition for the Zoho Sign callback. Secrets are read lazily. */

import { createGate } from "../../lib/zoho/gate";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createZohoServiceClient } from "../../lib/zoho/client";
import { createZohoSignClient } from "../../lib/zoho/sign";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import type { ZohoSignWebhookDeps } from "./webhook";
import { alertingOpsSink } from "../ops/runtime";
import { createZohoClient } from "../../lib/zoho/client";
import { logSinks } from "../logs/factory";
import { createJsonlStore } from "../logs/jsonl";
import { createSeenEvents } from "../contracts/inbound";
import { contractKeys, loadSchemas, investorAppMode } from "../contracts/stub";
import { dataRuntime } from "../data/zoho-source";
import { createSignApi, type SignApi } from "./api";
import { createSignSender, type SignSender } from "./send";
import { createSignActions, createOpenRequestCheck } from "./actions";
import { createPaperBlocker } from "./block";
import { createHandVerifier, createSignedFiler, type SignedFiler } from "./file";
import { createEmbedEndpoint, type EmbedEndpoint } from "./embed";

const gate = createGate();
export const providerCallbackOps = createMemorySink();
// M18-S04: the same Plane B lines also feed the alerts (token refresh, webhook failure, credits header).
const log = createOpsLog(alertingOpsSink(providerCallbackOps));
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

const planeStore = (plane: string) => {
  const s = logSinks();
  return s.kind === "jsonl" && s.dir ? createJsonlStore({ dir: s.dir, plane }) : null;
};

/* ---- M12-S05-T01: dedupe and the dead-letter list (ids and codes only; survive a restart when LOG_DIR is set) ---- */
export interface DeadLetter { readonly at: number; readonly reason: string; readonly requestId: string | null; readonly retryable: boolean }
const G = globalThis as typeof globalThis & {
  __gzSignSeen?: ReturnType<typeof createSeenEvents>; __gzSignDead?: DeadLetter[]; __gzSignPerson?: SignPersonRuntime;
  __gzSignService?: { api: SignApi; filer: SignedFiler }; __gzSignTimer?: ReturnType<typeof setInterval> | null; __gzSignEmbed?: EmbedEndpoint;
};
const seen = () => (G.__gzSignSeen ??= createSeenEvents(planeStore("sign-webhook")));
export function signDeadLetters(): readonly DeadLetter[] {
  const mem = (G.__gzSignDead ??= []);
  if (mem.length) return mem.slice();
  const store = planeStore("sign-dead");
  const out: DeadLetter[] = [];
  if (store) for (const day of store.days().slice(-14)) for (const l of store.read(day)) out.push(l as DeadLetter);
  return out;
}
function deadLetter(entry: DeadLetter): void {
  const mem = (G.__gzSignDead ??= []);
  mem.push(entry);
  if (mem.length > 1_000) mem.splice(0, mem.length - 1_000);
  planeStore("sign-dead")?.append(entry);
}

/** The service half (provider-callback): Sign API + the M12-S06 filer. */
function serviceHalf(): { api: SignApi; filer: SignedFiler } {
  if (G.__gzSignService) return G.__gzSignService;
  const api = createSignApi({ origin: requiredExact("ZOHO_SIGN_API_ORIGIN", INDIA_SIGN_ORIGIN), gate, log, maxAttempts: 1 });
  const crm = createZohoServiceClient({ gate, log, recordIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"), maxAttempts: 1 });
  G.__gzSignService = { api, filer: createSignedFiler({ crm, sign: api, log }) };
  return G.__gzSignService;
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
    crm: createZohoServiceClient({
      gate,
      log,
      recordIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"),
      maxAttempts: 1,
    }),
    sign: createZohoSignClient({ origin, gate, log, maxAttempts: 1 }),
    seen: seen(),
    deadLetter,
    file: (credential, target, requestId, signal) => serviceHalf().filer.file(credential, target, requestId, signal),
  };
}

/** Route-boundary failures before the handler ran (bad size, unreadable body) also go to the dead-letter list. */
export function deadLetterBoundary(reason: string): void {
  try { deadLetter({ at: Date.now(), reason, requestId: null, retryable: false }); } catch { /* ignore */ }
}

/* ---- M12-S04/S05/S06/S07: the person-token acts (the signed-in person's own Zoho token, D53) ---- */
export interface SignPersonRuntime {
  readonly sender: SignSender;
  readonly actions: ReturnType<typeof createSignActions>;
  readonly blocker: ReturnType<typeof createPaperBlocker>;
  readonly verifier: ReturnType<typeof createHandVerifier>;
}
export function signPersonRuntime(env: NodeJS.ProcessEnv = process.env): SignPersonRuntime {
  if (G.__gzSignPerson) return G.__gzSignPerson;
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX! });
  const sign = createSignApi({ origin: requiredExact("ZOHO_SIGN_API_ORIGIN", INDIA_SIGN_ORIGIN), gate: rt.gate, log: rt.log });
  G.__gzSignPerson = Object.freeze({
    sender: createSignSender({ crm, sign, log: rt.log }),
    actions: createSignActions({ crm, sign, log: rt.log }),
    blocker: createPaperBlocker({ crm, sign, log: rt.log }),
    verifier: createHandVerifier({ crm, log: rt.log }),
  });
  return G.__gzSignPerson;
}

/** A Plane B line for the background check (feeds the M18-S04 alerts through alertingOpsSink). */
function opsLine(reason: string): void {
  try { log.refusal({ at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "sign-check", reason, recordIds: [] }); } catch { /* ignore */ }
}

/* ---- M12-S05-T02: the periodic check of open requests (every 10 minutes while the process runs) ---- */
export const SIGN_CHECK_EVERY_MS = 10 * 60_000;
export async function runSignCheck(): Promise<void> {
  const svc = serviceHalf();
  const crm = createZohoServiceClient({ gate, log, recordIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"), maxAttempts: 2 });
  const check = createOpenRequestCheck({ crm, sign: svc.api, filer: svc.filer, log });
  let cred;
  try { cred = await provider().credential(); } catch { opsLine("sign-check-credential"); return; }
  const r = await check.run(cred);
  if (!r.ok) opsLine(`sign-check-${r.errorKind}`);
}
/** Starts the timer once per process (idempotent). Needs Zoho Sign configured; otherwise does nothing. */
export function ensureSignCheck(): void {
  if (G.__gzSignTimer || !process.env.ZOHO_SIGN_API_ORIGIN || !process.env.ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN) return;
  G.__gzSignTimer = setInterval(() => { void runSignCheck().catch(() => opsLine("sign-check-threw")); }, SIGN_CHECK_EVERY_MS);
  (G.__gzSignTimer as { unref?: () => void }).unref?.();
}

/* ---- M12-S08: the embed-token endpoint for the investor app ---- */
export function signEmbedEndpoint(env: NodeJS.ProcessEnv = process.env): EmbedEndpoint {
  if (G.__gzSignEmbed) return G.__gzSignEmbed;
  const keys = contractKeys(env);
  if (!keys.all.length) throw new Error("CONTRACT_SIGNING_KEY is not set.");
  const mode = investorAppMode(env);
  const hosts = (env.SIGN_EMBED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (mode.kind === "app") hosts.push(new URL(mode.url).origin);
  const svc = serviceHalf();
  const crm = createZohoServiceClient({ gate, log, recordIdPrefix: required("ZOHO_CRM_RECORD_ID_PREFIX"), maxAttempts: 1 });
  G.__gzSignEmbed = createEmbedEndpoint({
    schemas: loadSchemas(), keys: keys.all, seen: createSeenEvents(planeStore("sign-embed")), allowedHosts: hosts,
    crm, sign: svc.api, credential: (signal) => provider().credential(signal), log,
  });
  return G.__gzSignEmbed;
}
