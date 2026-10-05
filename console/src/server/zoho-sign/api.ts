/**
 * M12-S04-T03 / S05-T02 / S06-T02 / S08-T01 — THE ZOHO SIGN API ADAPTER (D45, D53, D72).
 *
 * lib/zoho/sign.ts reads one request for the provider callback only. This adapter is the rest of the Sign API
 * the console needs, on the credential D53 names for each act:
 *
 *   act                                   endpoint (India DC, sign.zoho.in, /api/v1)               credential
 *   list the templates to pick from      GET /templates                                              the person (Finance)
 *   send from a template                  GET /templates/{id} → POST /templates/{id}/createdocument   the person (Finance)
 *   send an uploaded PDF                  POST /requests (multipart) → POST /requests/{id}/submit      the person
 *   read a request                        GET /requests/{id}                                          the person, or provider-callback
 *   remind / recall                       POST /requests/{id}/remind | /recall                        the person
 *   download signed PDF / certificate     GET /requests/{id}/pdf | /completioncertificate             provider-callback (filing is background)
 *   embedded signing URL                  POST /requests/{id}/actions/{action_id}/embedtoken          provider-callback (the investor has no Zoho token)
 *
 * Signing method (D72, OD8): "email-otp" → verify_recipient + verification_type EMAIL. "aadhaar" is a signer
 * setting the Zoho Sign template carries (MA2); an uploaded PDF cannot ask for Aadhaar through the documented
 * API, so the adapter refuses that pair rather than send a weaker method under an Aadhaar label.
 *
 * Plane B: one line per attempt — actor, op, endpoint template, status, request id when it is a 15–22 digit id.
 * Never a body, a recipient, a file byte or a signing URL. GETs retry with the shared policy; POSTs never do.
 */

import { backoffDelay, classifyThrown, retryAfterOf, retryPolicy, type ZohoFailure } from "../../lib/zoho/errors";
import { GateQueueFullError, type Gate, type GateLease } from "../../lib/zoho/gate";
import { assertServiceCredential, crmApiOriginOf, isUserCredential, uploadFileName, MAX_UPLOAD_BYTES, type ServiceCredential, type UploadFile, type UserCredential, type ZohoResult } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { signOriginOf } from "../../lib/zoho/sign";

export const SIGN_ID = /^\d{10,25}$/;
export const EMBED_URL_TTL_MS = 2 * 60_000;
export const MAX_SIGN_ATTEMPTS = 4;
export type SignMethod = "aadhaar" | "email-otp";
export type SignCredential = UserCredential | ServiceCredential;

export interface SignRecipient { readonly name: string; readonly email: string }
/** Where Finance placed the signature on an uploaded PDF (points, page from 0 as Zoho counts). */
export interface SignField { readonly page: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface SignAction {
  readonly actionId: string;
  readonly type: string;
  readonly status: string;
  /** lower-cased; compared, never logged */
  readonly recipientEmail: string | null;
  readonly embedded: boolean;
}
export interface SignRequestDetail {
  readonly requestId: string;
  /** Zoho's request_status, lower-cased: draft, inprogress, completed, declined, recalled, expired… */
  readonly status: string;
  readonly sentAt: number | null;
  readonly modifiedTime: number | null;
  readonly expiresAt: number | null;
  readonly declineReason: string | null;
  readonly actions: readonly SignAction[];
  readonly documentIds: readonly string[];
}
/** One of Finance's Zoho Sign templates (MA2) — what the send panel offers. */
export interface SignTemplate { readonly templateId: string; readonly name: string }
export const MAX_TEMPLATES = 100;
export interface SignDownload { readonly bytes: Uint8Array; readonly contentType: "application/pdf" }

export interface SignFetchResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type SignFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<SignFetchResponse>;

export interface SignApiOptions {
  readonly origin: string;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly fetch?: SignFetch;
  readonly clock?: () => number;
  readonly random?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly maxAttempts?: number;
}
interface Call { readonly signal?: AbortSignal }

export interface SignApi {
  /** Finance's templates, on the person's own token: GET /templates (up to MAX_TEMPLATES, by name). */
  listTemplates(as: UserCredential, o?: Call): Promise<ZohoResult<readonly SignTemplate[]>>;
  createFromTemplate(as: UserCredential, t: { readonly templateId: string; readonly requestName: string; readonly recipient: SignRecipient; readonly method: SignMethod }, o?: Call): Promise<ZohoResult<{ readonly requestId: string }>>;
  createFromPdf(as: UserCredential, p: { readonly file: UploadFile; readonly requestName: string; readonly recipient: SignRecipient; readonly method: SignMethod; readonly field: SignField }, o?: Call): Promise<ZohoResult<{ readonly requestId: string }>>;
  getRequest(as: SignCredential, requestId: string, o?: Call): Promise<ZohoResult<SignRequestDetail>>;
  remind(as: UserCredential, requestId: string, o?: Call): Promise<ZohoResult<{ readonly reminded: true }>>;
  recall(as: UserCredential, requestId: string, o?: Call): Promise<ZohoResult<{ readonly recalled: true }>>;
  download(as: ServiceCredential, requestId: string, what: "pdf" | "certificate", o?: Call): Promise<ZohoResult<SignDownload>>;
  embedToken(as: ServiceCredential, requestId: string, actionId: string, host: string, o?: Call): Promise<ZohoResult<{ readonly signUrl: string }>>;
}

type Obj = Readonly<Record<string, unknown>>;
const obj = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const idText = (v: unknown): string | null => (typeof v === "string" && SIGN_ID.test(v) ? v : null);
const millis = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[A-Za-z]{2,24}$/;
const logId = (id: string): string[] => (/^\d{15,22}$/.test(id) ? [id] : []);

const API_DOMAIN_OF_SIGN: Readonly<Record<string, string>> = Object.freeze({
  "sign.zoho.com": "https://www.zohoapis.com", "sign.zoho.eu": "https://www.zohoapis.eu", "sign.zoho.in": "https://www.zohoapis.in",
  "sign.zoho.jp": "https://www.zohoapis.jp", "sign.zoho.com.au": "https://www.zohoapis.com.au", "sign.zohocloud.ca": "https://www.zohoapis.ca",
  "sign.zoho.sa": "https://www.zohoapis.sa",
});

/** Zoho Sign answers `{ code: 0, status: "success" }`; anything else on a 2xx is a refusal. */
function classifySign(status: number, body: unknown): { ok: true; body: Obj } | { ok: false; failure: ZohoFailure } {
  const b = obj(body);
  const code = b && (typeof b.code === "number" || typeof b.code === "string") ? String(b.code) : "";
  if (status >= 200 && status < 300) {
    if (b && (b.status === "success" || b.code === 0)) return { ok: true, body: b };
    return { ok: false, failure: { kind: "invalid-data", status, code: code || "SIGN_FAILURE", field: null, records: null } };
  }
  if (status === 401) return { ok: false, failure: code === "9041" || /token/i.test(String(b?.message ?? "")) ? { kind: "auth-expired", status, code: code || "INVALID_TOKEN" } : { kind: "auth-rejected", status, code } };
  if (status === 403) return { ok: false, failure: { kind: "forbidden", status, code } };
  if (status === 404) return { ok: false, failure: { kind: "not-found", status, code } };
  if (status === 429) return { ok: false, failure: { kind: "rate-limited-unclassified", status: 429, code, retryAfterMs: null } };
  if (status >= 400 && status < 500) return { ok: false, failure: { kind: "invalid-data", status, code: code || "SIGN_INVALID", field: null, records: null } };
  if (status >= 500 && status < 600) return { ok: false, failure: { kind: "server", status, code } };
  return { ok: false, failure: { kind: "unexpected", status, code } };
}

function parseDetail(body: Obj, expectedId: string): SignRequestDetail | null {
  const r = obj(body.requests);
  if (!r) return null;
  if (Object.prototype.hasOwnProperty.call(r, "request_id") && idText(r.request_id) !== expectedId) return null;
  const status = typeof r.request_status === "string" ? r.request_status.trim().toLowerCase() : "";
  if (!/^[a-z][a-z _-]{0,63}$/.test(status)) return null;
  const actions: SignAction[] = [];
  for (const a of Array.isArray(r.actions) ? r.actions.slice(0, 20) : []) {
    const x = obj(a);
    const actionId = idText(x?.action_id);
    if (!x || !actionId) continue;
    const email = typeof x.recipient_email === "string" && EMAIL.test(x.recipient_email.trim()) ? x.recipient_email.trim().toLowerCase() : null;
    actions.push(Object.freeze({
      actionId, type: String(x.action_type ?? "").toUpperCase().slice(0, 20), status: String(x.action_status ?? "").toUpperCase().slice(0, 30),
      recipientEmail: email, embedded: x.is_embedded === true,
    }));
  }
  const docs = Array.isArray(r.document_ids) ? r.document_ids.map(obj).map((d) => idText(d?.document_id)).filter((d): d is string => d !== null) : [];
  // Zoho names the decline note differently across versions; kept short, it is shown to Finance, never logged.
  const reasonRaw = [r.decline_reason, r.declined_reason, r.reason, ...(Array.isArray(r.actions) ? r.actions.map((a) => obj(a)?.decline_reason) : [])]
    .find((v) => typeof v === "string" && v.trim() !== "");
  return Object.freeze({
    requestId: expectedId, status,
    sentAt: millis(r.sign_submitted_time) ?? millis(r.submitted_time),
    modifiedTime: millis(r.modified_time), expiresAt: millis(r.expire_by),
    declineReason: typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 300) : null,
    actions: Object.freeze(actions), documentIds: Object.freeze([...new Set(docs)]),
  });
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

const form = (pairs: Record<string, string>): string => Object.entries(pairs).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

function methodKeys(method: SignMethod): Record<string, unknown> {
  return method === "email-otp" ? { verify_recipient: true, verification_type: "EMAIL" } : { verify_recipient: false };
}

function checkRecipient(r: SignRecipient): void {
  if (!r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 200) throw new TypeError("A recipient needs a name.");
  if (typeof r.email !== "string" || !EMAIL.test(r.email.trim())) throw new TypeError("A recipient needs a valid email.");
}

export function createSignApi(options: SignApiOptions): SignApi {
  const origin = signOriginOf(options.origin);
  const signDc = API_DOMAIN_OF_SIGN[new URL(origin).hostname];
  if (!signDc) throw new TypeError("Zoho Sign origin has no matching API data centre.");
  /* the OAuth credential's CRM origin for that data centre (sandbox.zohoapis.* when ZOHO_CRM_ENVIRONMENT=sandbox) */
  const apiDomain: string = crmApiOriginOf(signDc);
  const fetchImpl: SignFetch = options.fetch ?? ((url, init) => fetch(url, init) as unknown as Promise<SignFetchResponse>);
  const clock = options.clock ?? Date.now;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? MAX_SIGN_ATTEMPTS;

  function actorOf(as: SignCredential, serviceOnly = false) {
    if (isUserCredential(as)) {
      if (serviceOnly) throw new TypeError("This Zoho Sign act runs on the provider-callback service credential.");
      if (as.apiDomain !== apiDomain) throw new TypeError("Zoho Sign and OAuth credentials must use the same data centre.");
      return { kind: "user", userId: as.userId } as const;
    }
    assertServiceCredential(as, "provider-callback");
    if (as.apiDomain !== apiDomain) throw new TypeError("Zoho Sign and OAuth credentials must use the same data centre.");
    return { kind: "service", job: "provider-callback" } as const;
  }
  const userOnly = (as: unknown): void => { if (!isUserCredential(as)) throw new TypeError("This Zoho Sign act runs on the signed-in person's own token (D53)."); };

  type Raw = { ok: true; status: number; res: SignFetchResponse } | { ok: false; failure: ZohoFailure };
  async function call(as: SignCredential, op: string, method: "GET" | "POST", path: string, endpoint: string, idsForLog: readonly string[],
    body: { text: string; type: string } | { bytes: Uint8Array; type: string } | null, signal: AbortSignal | undefined, consume: (r: SignFetchResponse) => Promise<unknown>)
    : Promise<{ ok: true; status: number; value: unknown } | { ok: false; failure: ZohoFailure }> {
    const actor = actorOf(as);
    if (as.expiresAt !== null && clock() >= as.expiresAt) {
      options.log.refusal({ at: clock(), actor, action: op, reason: "token-expired", recordIds: idsForLog });
      return { ok: false, failure: { kind: "auth-expired", status: null, code: "TOKEN_EXPIRED" } };
    }
    const idempotent = method === "GET";
    for (let attempt = 1; ; attempt++) {
      const queuedAt = clock();
      let lease: GateLease;
      try { lease = await options.gate.acquire("simple", signal); } catch (e) {
        const failure: ZohoFailure = e instanceof GateQueueFullError ? { kind: "busy", status: null } : { kind: "aborted", status: null };
        options.log.call({ at: queuedAt, actor, op, method, endpoint, callClass: "simple", status: null, durationMs: 0, gateWaitMs: clock() - queuedAt, attempt, creditsRemaining: null, errorClass: failure.kind, recordIds: idsForLog });
        return { ok: false, failure };
      }
      const startedAt = clock();
      let raw: Raw;
      let value: unknown = undefined;
      try {
        const headers: Record<string, string> = { Accept: "application/json", Authorization: `Zoho-oauthtoken ${as.accessToken}` };
        if (body) headers["Content-Type"] = body.type;
        const res = await fetchImpl(`${origin}/api/v1${path}`, { method, headers, body: body ? ("text" in body ? body.text : body.bytes) : undefined, signal });
        raw = { ok: true, status: res.status, res };
        if (res.status >= 200 && res.status < 300) value = await consume(res);
      } catch (e) {
        raw = { ok: false, failure: classifyThrown(e, signal) };
      } finally { lease.release(); }
      let outcome: { ok: true; status: number; value: unknown } | { ok: false; failure: ZohoFailure };
      if (!raw.ok) outcome = raw;
      else if (raw.status >= 200 && raw.status < 300) outcome = value instanceof Error ? { ok: false, failure: { kind: "unexpected", status: raw.status, code: value.message.slice(0, 40) } } : { ok: true, status: raw.status, value };
      else {
        let parsed: unknown = null;
        try { parsed = JSON.parse(await raw.res.text()); } catch { parsed = null; }
        const c = classifySign(raw.status, parsed);
        outcome = c.ok ? { ok: false, failure: { kind: "unexpected", status: raw.status, code: "SIGN_STATUS" } } : { ok: false, failure: c.failure };
      }
      options.log.call({ at: startedAt, actor, op, method, endpoint, callClass: "simple", status: raw.ok ? raw.status : null, durationMs: clock() - startedAt,
        gateWaitMs: startedAt - queuedAt, attempt, creditsRemaining: null, errorClass: outcome.ok ? null : outcome.failure.kind, recordIds: idsForLog });
      if (outcome.ok) return outcome;
      const policy = retryPolicy(outcome.failure, { idempotent });
      if (!policy.retry || attempt >= Math.min(policy.maxAttempts, maxAttempts)) return outcome;
      try { await sleep(backoffDelay(attempt, policy, retryAfterOf(outcome.failure), random), signal); } catch { return { ok: false, failure: { kind: "aborted", status: null } }; }
    }
  }

  /** JSON endpoint: consume the body, then Sign's own success check. */
  async function json(as: SignCredential, op: string, method: "GET" | "POST", path: string, endpoint: string, ids: readonly string[],
    body: { text: string; type: string } | { bytes: Uint8Array; type: string } | null, signal?: AbortSignal): Promise<{ ok: true; status: number; body: Obj } | { ok: false; failure: ZohoFailure }> {
    const r = await call(as, op, method, path, endpoint, ids, body, signal, async (res) => {
      const text = await res.text();
      if (text.length > 2 * 1024 * 1024) return new Error("TOO_LARGE");
      try { return JSON.parse(text) as unknown; } catch { return new Error("NOT_JSON"); }
    });
    if (!r.ok) return r;
    const c = classifySign(r.status, r.value);
    if (!c.ok) {
      options.log.refusal({ at: clock(), actor: actorOf(as), action: op, reason: "sign-refused", recordIds: ids });
      return { ok: false, failure: c.failure };
    }
    return { ok: true, status: r.status, body: c.body };
  }
  const fail = <T>(failure: ZohoFailure): ZohoResult<T> => ({ ok: false, error: failure, creditsRemaining: null });
  const done = <T>(value: T, status: number): ZohoResult<T> => ({ ok: true, value, status, creditsRemaining: null });
  const malformed = <T>(status: number, code = "MALFORMED_SIGN_RESPONSE"): ZohoResult<T> => fail<T>({ kind: "unexpected", status, code });
  const checkId = (id: string, what = "request"): void => { if (typeof id !== "string" || !SIGN_ID.test(id)) throw new TypeError(`Invalid Zoho Sign ${what} id.`); };

  const api: SignApi = {
    async listTemplates(as, o = {}) {
      userOnly(as);
      const page = { page_context: { row_count: MAX_TEMPLATES, start_index: 1, search_columns: {}, sort_column: "template_name", sort_order: "ASC" } };
      const r = await json(as, "signTemplateList", "GET", `/templates?data=${encodeURIComponent(JSON.stringify(page))}`, "/templates", [], null, o.signal);
      if (!r.ok) return fail(r.failure);
      if (!Array.isArray(r.body.templates)) return malformed(r.status);
      const out: SignTemplate[] = [];
      for (const t of r.body.templates.slice(0, MAX_TEMPLATES)) {
        const x = obj(t), templateId = idText(x?.template_id), name = typeof x?.template_name === "string" ? x.template_name.trim().slice(0, 200) : "";
        if (templateId && name) out.push(Object.freeze({ templateId, name }));
      }
      return done(Object.freeze(out), r.status);
    },

    async createFromTemplate(as, t, o = {}) {
      userOnly(as);
      checkId(t.templateId, "template");
      checkRecipient(t.recipient);
      const tpl = await json(as, "signTemplateRead", "GET", `/templates/${t.templateId}`, "/templates/{id}", [], null, o.signal);
      if (!tpl.ok) return fail(tpl.failure);
      const signers = (Array.isArray(obj(tpl.body.templates)?.actions) ? (obj(tpl.body.templates)!.actions as unknown[]) : []).map(obj)
        .filter((a): a is Obj => a !== null && String(a.action_type ?? "").toUpperCase() === "SIGN" && idText(a.action_id) !== null);
      // One investor signs; a template with any other shape is Finance's to fix in Zoho Sign (MA2), never guessed.
      if (signers.length !== 1) return fail({ kind: "invalid-data", status: tpl.status, code: "TEMPLATE_SHAPE", field: null, records: null });
      const a = signers[0]!;
      const data = { templates: {
        request_name: t.requestName.slice(0, 250),
        actions: [{ action_id: a.action_id, action_type: "SIGN", role: typeof a.role === "string" ? a.role : undefined,
          recipient_name: t.recipient.name.trim(), recipient_email: t.recipient.email.trim(), ...methodKeys(t.method) }],
      } };
      const r = await json(as, "signCreateFromTemplate", "POST", `/templates/${t.templateId}/createdocument`, "/templates/{id}/createdocument", [],
        { text: form({ data: JSON.stringify(data), is_quicksend: "true" }), type: "application/x-www-form-urlencoded" }, o.signal);
      if (!r.ok) return fail(r.failure);
      const id = idText(obj(r.body.requests)?.request_id);
      return id ? done({ requestId: id }, r.status) : malformed(r.status);
    },

    async createFromPdf(as, p, o = {}) {
      userOnly(as);
      checkRecipient(p.recipient);
      if (p.method === "aadhaar") return fail({ kind: "invalid-data", status: 0, code: "AADHAAR_NEEDS_TEMPLATE", field: null, records: null });
      const f = p.field;
      if (!f || ![f.page, f.x, f.y, f.width, f.height].every((n) => Number.isFinite(n) && n >= 0 && n <= 20_000) || !Number.isInteger(f.page) || f.width < 1 || f.height < 1) {
        throw new TypeError("The signature field needs a page and a box.");
      }
      if (p.file.contentType !== "application/pdf" || !(p.file.bytes instanceof Uint8Array) || p.file.bytes.byteLength < 5 || p.file.bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new TypeError("Only a PDF of up to 20 MB can be sent for signature.");
      }
      let boundary = "----gzsign";
      for (let i = 0; i < 24; i++) boundary += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36) % 36];
      const enc = new TextEncoder();
      const data = { requests: { request_name: p.requestName.slice(0, 250), is_sequential: true,
        actions: [{ action_type: "SIGN", recipient_name: p.recipient.name.trim(), recipient_email: p.recipient.email.trim(), signing_order: 1, ...methodKeys(p.method) }] } };
      const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${uploadFileName(p.file.fileName, "application/pdf")}"\r\nContent-Type: application/pdf\r\n\r\n`);
      const tail = enc.encode(`\r\n--${boundary}--\r\n`);
      const bytes = new Uint8Array(head.byteLength + p.file.bytes.byteLength + tail.byteLength);
      bytes.set(head, 0); bytes.set(p.file.bytes, head.byteLength); bytes.set(tail, head.byteLength + p.file.bytes.byteLength);
      const created = await json(as, "signCreateFromPdf", "POST", "/requests", "/requests", [], { bytes, type: `multipart/form-data; boundary=${boundary}` }, o.signal);
      bytes.fill(0);
      if (!created.ok) return fail(created.failure);
      const req = obj(created.body.requests);
      const requestId = idText(req?.request_id);
      const documentId = idText(obj(Array.isArray(req?.document_ids) ? (req!.document_ids as unknown[])[0] : null)?.document_id);
      const actionId = idText(obj(Array.isArray(req?.actions) ? (req!.actions as unknown[])[0] : null)?.action_id);
      if (!requestId || !documentId || !actionId) return malformed(created.status);
      const submit = { requests: { actions: [{ action_id: actionId, action_type: "SIGN", recipient_name: p.recipient.name.trim(), recipient_email: p.recipient.email.trim(),
        signing_order: 1, ...methodKeys(p.method),
        fields: [{ field_type_name: "Signature", field_category: "image", document_id: documentId, action_id: actionId, page_no: f.page,
          x_coord: Math.round(f.x), y_coord: Math.round(f.y), abs_width: Math.round(f.width), abs_height: Math.round(f.height), is_mandatory: true }] }] } };
      const sent = await json(as, "signSubmit", "POST", `/requests/${requestId}/submit`, "/requests/{id}/submit", logId(requestId),
        { text: form({ data: JSON.stringify(submit) }), type: "application/x-www-form-urlencoded" }, o.signal);
      // A request created but not submitted is a draft in Zoho Sign: nobody is asked to sign it.
      if (!sent.ok) return fail(sent.failure);
      return done({ requestId }, sent.status);
    },

    async getRequest(as, requestId, o = {}) {
      checkId(requestId);
      const r = await json(as, "signGetRequest", "GET", `/requests/${requestId}`, "/requests/{id}", logId(requestId), null, o.signal);
      if (!r.ok) return fail(r.failure);
      const d = parseDetail(r.body, requestId);
      if (!d) {
        options.log.refusal({ at: clock(), actor: actorOf(as), action: "signGetRequest", reason: "invalid-source-response", recordIds: logId(requestId) });
        return malformed(r.status);
      }
      return done(d, r.status);
    },

    async remind(as, requestId, o = {}) {
      userOnly(as);
      checkId(requestId);
      const r = await json(as, "signRemind", "POST", `/requests/${requestId}/remind`, "/requests/{id}/remind", logId(requestId), null, o.signal);
      return r.ok ? done({ reminded: true } as const, r.status) : fail(r.failure);
    },

    async recall(as, requestId, o = {}) {
      userOnly(as);
      checkId(requestId);
      const r = await json(as, "signRecall", "POST", `/requests/${requestId}/recall`, "/requests/{id}/recall", logId(requestId), null, o.signal);
      return r.ok ? done({ recalled: true } as const, r.status) : fail(r.failure);
    },

    async download(as, requestId, what, o = {}) {
      actorOf(as, true);
      checkId(requestId);
      const path = what === "pdf" ? `/requests/${requestId}/pdf` : `/requests/${requestId}/completioncertificate`;
      const r = await call(as, what === "pdf" ? "signDownloadPdf" : "signDownloadCertificate", "GET", path, what === "pdf" ? "/requests/{id}/pdf" : "/requests/{id}/completioncertificate",
        logId(requestId), null, o.signal, async (res) => {
          const declared = Number(res.headers.get("content-length"));
          if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) return new Error("TOO_LARGE");
          const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
          const b = new Uint8Array(await res.arrayBuffer());
          if (b.byteLength > MAX_UPLOAD_BYTES) { b.fill(0); return new Error("TOO_LARGE"); }
          // More than one document comes back as a zip: not filed as a signed PDF (one paper = one document here).
          if (type === "application/zip" || (b[0] === 0x50 && b[1] === 0x4b)) { b.fill(0); return new Error("MULTI_DOCUMENT"); }
          if (!(b.byteLength >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d)) { b.fill(0); return new Error("NOT_PDF"); }
          return b;
        });
      if (!r.ok) return fail(r.failure);
      return done({ bytes: r.value as Uint8Array, contentType: "application/pdf" } as const, r.status);
    },

    async embedToken(as, requestId, actionId, host, o = {}) {
      actorOf(as, true);
      checkId(requestId);
      checkId(actionId, "action");
      let h: URL;
      try { h = new URL(host); } catch { throw new TypeError("The embed host is an https origin."); }
      if (h.protocol !== "https:" || h.pathname !== "/" || h.search || h.hash || h.username || h.password) throw new TypeError("The embed host is an https origin.");
      const r = await json(as, "signEmbedToken", "POST", `/requests/${requestId}/actions/${actionId}/embedtoken`, "/requests/{id}/actions/{id}/embedtoken",
        logId(requestId), { text: form({ host: h.origin }), type: "application/x-www-form-urlencoded" }, o.signal);
      if (!r.ok) return fail(r.failure);
      const url = typeof r.body.sign_url === "string" ? r.body.sign_url : "";
      let u: URL | null = null;
      try { u = new URL(url); } catch { u = null; }
      // Only a URL on the configured Sign origin is handed on: nothing else can be opened in the app's frame.
      if (!u || u.origin !== origin) return malformed(r.status, "EMBED_URL_ORIGIN");
      return done({ signUrl: u.toString() }, r.status);
    },
  };
  return Object.freeze(api);
}
