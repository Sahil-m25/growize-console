/**
 * Zoho Sign webhook boundary (M20-S08, D72).
 *
 * Verification is over the exact bytes Zoho sent.  Only after HMAC succeeds do
 * we parse the request id, re-fetch the Sign request, and resolve the CRM record
 * by a request-id field already stored on that record.  Names, emails, IPs and
 * every other webhook field are ignored and never logged.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ServiceCredential, ZohoServiceClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { ZohoSignClient } from "../../lib/zoho/sign";

export const ZOHO_SIGN_SIGNATURE_HEADER = "x-zs-webhook-signature";
export const MAX_WEBHOOK_BYTES = 256 * 1024;

export type SignPaper = "nda" | "fema" | "supplementary" | "allocation-letter";

export interface SignTarget {
  readonly module: "Leads" | "Contacts" | "LLP_UnitAllocation_Module";
  readonly id: string;
  readonly paper: SignPaper;
}

export interface ZohoSignWebhookDeps {
  readonly secrets: readonly string[];
  readonly sign: ZohoSignClient;
  readonly crm: ZohoServiceClient;
  /** Resolved only after HMAC and payload validation, so junk cannot refresh OAuth. */
  readonly credential: (signal?: AbortSignal) => Promise<ServiceCredential>;
  readonly invalidateCredential: (credential: ServiceCredential) => void;
  readonly log: OpsLog;
}

export type ZohoSignWebhookResult =
  | { readonly ok: true; readonly outcome: "observed" | "unlinked"; readonly requestId: string; readonly recordId: string | null }
  | { readonly ok: false; readonly kind: "invalid-signature" | "invalid-payload" | "provider-failed" | "crm-failed" | "ambiguous"; readonly retryable: boolean };

type Obj = Readonly<Record<string, unknown>>;
const obj = (value: unknown): Obj | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : null;

function safeSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512 && !/[\r\n\0]/.test(value);
}

/** Constant-time comparison for every configured rotation key. */
export function verifyZohoSignSignature(body: string, signature: string | null, secrets: readonly string[]): boolean {
  if (typeof signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const received = Buffer.from(signature, "base64");
  if (received.length !== 32) return false;
  let matched = 0;
  for (const secret of secrets) {
    if (!safeSecret(secret)) continue;
    const calculated = createHmac("sha256", secret).update(body, "utf8").digest();
    matched |= timingSafeEqual(calculated, received) ? 1 : 0;
  }
  return matched === 1;
}

function requestIdFrom(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return null;
  }
  const id = obj(obj(parsed)?.requests)?.request_id;
  // Never coerce a JSON number: real Zoho ids can exceed Number.MAX_SAFE_INTEGER.
  return typeof id === "string" && /^\d{10,25}$/.test(id) ? id : null;
}

const SEARCHES: readonly {
  readonly module: SignTarget["module"];
  readonly field: string;
  readonly paper: SignPaper;
}[] = Object.freeze([
  { module: "Leads", field: "NDA_Sign_Req_Id", paper: "nda" },
  { module: "Contacts", field: "FEMA_Sign_Req_Id", paper: "fema" },
  { module: "LLP_UnitAllocation_Module", field: "Supplementary_Sign_Req_Id", paper: "supplementary" },
  { module: "LLP_UnitAllocation_Module", field: "Alloc_Letter_Sign_Req_Id", paper: "allocation-letter" },
]);

async function findTarget(
  requestId: string,
  deps: ZohoSignWebhookDeps,
  credential: ServiceCredential,
  signal?: AbortSignal,
): Promise<{ ok: true; target: SignTarget | null } | { ok: false; ambiguous: boolean; authFailed: boolean }> {
  const matches: SignTarget[] = [];
  const reads = await Promise.all(SEARCHES.map(async (search) => ({
    search,
    found: await deps.crm.search(
      credential,
      search.module,
      { criteria: `(${search.field}:equals:${requestId})` },
      { fields: ["id", search.field], perPage: 2, signal },
    ),
  })));
  const failures = reads.filter(({ found }) => !found.ok);
  if (failures.length > 0) {
    const authFailed = failures.some(({ found }) => !found.ok && (found.error.kind === "auth-expired" || found.error.kind === "auth-rejected"));
    return { ok: false, ambiguous: false, authFailed };
  }
  for (const { search, found } of reads) {
    if (!found.ok) continue; // narrowed by the check above; keeps TypeScript explicit
    if (found.value.invalidRecordIds === true) {
      deps.log.refusal({
        at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
        reason: "invalid-target-id", recordIds: [],
      });
      return { ok: false, ambiguous: true, authFailed: false };
    }
    if (found.value.moreRecords) {
      deps.log.refusal({
        at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
        reason: "truncated-targets", recordIds: found.value.records.map((record) => record.id),
      });
      return { ok: false, ambiguous: true, authFailed: false };
    }
    for (const record of found.value.records) {
      // Bind to the value Zoho returned, not merely to our search criteria.
      if (record[search.field] !== requestId) {
        deps.log.refusal({
          at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
          reason: "request-id-mismatch", recordIds: [record.id],
        });
        return { ok: false, ambiguous: true, authFailed: false };
      }
      if (!/^\d{15,22}$/.test(record.id)) {
        deps.log.refusal({
          at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
          reason: "invalid-target-id", recordIds: [],
        });
        return { ok: false, ambiguous: true, authFailed: false };
      }
      matches.push({
        module: search.module,
        id: record.id,
        paper: search.paper,
      });
    }
  }
  if (matches.length > 1) {
    deps.log.refusal({
      at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
      reason: "ambiguous-target", recordIds: matches.map((match) => match.id),
    });
    return { ok: false, ambiguous: true, authFailed: false };
  }
  return { ok: true, target: matches[0] ?? null };
}

export async function handleZohoSignWebhook(
  input: { readonly body: string; readonly signature: string | null; readonly signal?: AbortSignal },
  deps: ZohoSignWebhookDeps,
): Promise<ZohoSignWebhookResult> {
  if (Buffer.byteLength(input.body, "utf8") > MAX_WEBHOOK_BYTES || !verifyZohoSignSignature(input.body, input.signature, deps.secrets)) {
    deps.log.refusal({
      at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
      reason: "invalid-signature", recordIds: [],
    });
    return { ok: false, kind: "invalid-signature", retryable: false };
  }

  const requestId = requestIdFrom(input.body);
  if (requestId === null) {
    deps.log.refusal({
      at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
      reason: "invalid-payload", recordIds: [],
    });
    return { ok: false, kind: "invalid-payload", retryable: false };
  }

  let credential: ServiceCredential;
  try {
    credential = await deps.credential(input.signal);
  } catch {
    return { ok: false, kind: "provider-failed", retryable: true };
  }

  let source = await deps.sign.getRequest(credential, requestId, { signal: input.signal });
  if (!source.ok && (source.error.kind === "auth-expired" || source.error.kind === "auth-rejected")) {
    deps.invalidateCredential(credential);
    try {
      credential = await deps.credential(input.signal);
    } catch {
      return { ok: false, kind: "provider-failed", retryable: true };
    }
    source = await deps.sign.getRequest(credential, requestId, { signal: input.signal });
  }
  if (!source.ok) return { ok: false, kind: "provider-failed", retryable: true };

  let found = await findTarget(requestId, deps, credential, input.signal);
  if (!found.ok && found.authFailed) {
    deps.invalidateCredential(credential);
    try {
      credential = await deps.credential(input.signal);
    } catch {
      return { ok: false, kind: "provider-failed", retryable: true };
    }
    found = await findTarget(requestId, deps, credential, input.signal);
  }
  if (!found.ok) return { ok: false, kind: found.ambiguous ? "ambiguous" : "crm-failed", retryable: !found.ambiguous };
  if (found.target === null) {
    deps.log.refusal({
      at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook",
      reason: "target-not-found", recordIds: [],
    });
    return { ok: true, outcome: "unlinked", requestId, recordId: null };
  }

  // D77/D79 keep status live in Sign.  M12-S06 will file PDF + certificate and set
  // Agreement_Signed as one compensated act; doing that boolean write here would
  // open a paper gate without its evidence.
  return { ok: true, outcome: "observed", requestId, recordId: found.target.id };
}
