/**
 * Zoho Sign webhook boundary (M20-S08, D72; M12-S05-T01 dedupe + dead-letter, M12-S06-T02 filing on completed).
 *
 * Verification is over the exact bytes Zoho sent.  Only after HMAC succeeds do
 * we parse the request id, re-fetch the Sign request, and resolve the CRM record
 * by a request-id field already stored on that record.  Names, emails, IPs and
 * every other webhook field are ignored and never logged.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ServiceCredential, ZohoServiceClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { ZohoSignClient } from "../../lib/zoho/sign";
import type { FileResult } from "./file";

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
  /** M12-S05-T01: events already handled (dedupe key: request id + operation + time). Marked only after success. */
  readonly seen?: { has(key: string): Promise<boolean>; add(key: string): Promise<void> };
  /** M12-S05-T01: a failed or refused callback, ids and a code only (never the body). */
  readonly deadLetter?: (entry: { readonly at: number; readonly reason: string; readonly requestId: string | null; readonly retryable: boolean }) => void;
  /** M12-S06-T02: file the signed copy when the re-read says completed. */
  readonly file?: (credential: ServiceCredential, target: SignTarget, requestId: string, signal?: AbortSignal) => Promise<FileResult>;
  readonly clock?: () => number;
}

export type ZohoSignWebhookResult =
  | { readonly ok: true; readonly outcome: "observed" | "unlinked" | "filed" | "duplicate"; readonly requestId: string; readonly recordId: string | null }
  | { readonly ok: false; readonly kind: "invalid-signature" | "invalid-payload" | "provider-failed" | "crm-failed" | "ambiguous" | "file-failed"; readonly retryable: boolean };

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

/** The event's dedupe key: request id + Zoho's operation + its time; without those, the exact body. */
export function webhookEventKey(body: string, requestId: string): string {
  let n: Obj | null = null;
  try { n = obj(obj(JSON.parse(body) as unknown)?.notifications); } catch { n = null; }
  const op = typeof n?.operation_type === "string" ? n.operation_type : null;
  const at = typeof n?.performed_at === "number" || typeof n?.performed_at === "string" ? String(n.performed_at) : null;
  const basis = op && at ? `${requestId}|${op}|${at}` : `${requestId}|body|${body}`;
  return createHash("sha256").update(basis).digest("hex");
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
  const r = await handleOnce(input, deps);
  if (!r.ok && deps.deadLetter) {
    // Only a verified body may name its request id in the dead-letter list.
    const requestId = r.kind === "invalid-signature" ? null : requestIdFrom(input.body);
    try { deps.deadLetter({ at: (deps.clock ?? Date.now)(), reason: r.kind, requestId, retryable: r.retryable }); } catch { /* the answer stands */ }
  }
  return r;
}

async function handleOnce(
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

  const eventKey = deps.seen ? webhookEventKey(input.body, requestId) : null;
  if (deps.seen && eventKey) {
    let dup = false;
    try { dup = await deps.seen.has(eventKey); } catch { dup = false; }
    if (dup) {
      deps.log.event?.({ at: Date.now(), actor: { kind: "service", job: "provider-callback" }, action: "signWebhook", reason: "duplicate", recordIds: [] });
      return { ok: true, outcome: "duplicate", requestId, recordId: null };
    }
  }
  const markSeen = async (): Promise<void> => { if (deps.seen && eventKey) { try { await deps.seen.add(eventKey); } catch { /* a redelivery re-checks */ } } };

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
    await markSeen();
    return { ok: true, outcome: "unlinked", requestId, recordId: null };
  }

  // D77/D79 keep status live in Sign. The filer (./file.ts) puts the PDF, the certificate and the
  // verified stamp (Agreement_Signed) down as one compensated act, never the stamp alone.
  // M12-S06: only Zoho Sign's re-read "completed" files the signed copy (the webhook body is a hint, D72).
  // Other states stay in Zoho Sign and are read live per viewer (D77) — nothing to write.
  if (source.value.status === "completed" && deps.file) {
    let filed: FileResult;
    try { filed = await deps.file(credential, found.target, requestId, input.signal); } catch { return { ok: false, kind: "file-failed", retryable: true }; }
    if (!filed.ok) {
      if (filed.retryable) return { ok: false, kind: "file-failed", retryable: true };
      await markSeen();
      return { ok: true, outcome: "observed", requestId, recordId: found.target.id };
    }
    await markSeen();
    return { ok: true, outcome: filed.outcome === "filed" ? "filed" : "observed", requestId, recordId: found.target.id };
  }
  await markSeen();
  return { ok: true, outcome: "observed", requestId, recordId: found.target.id };
}
