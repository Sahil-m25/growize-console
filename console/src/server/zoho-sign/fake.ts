/**
 * TEST SIGNING (SANDBOX ONLY) — a stand-in for Zoho Sign so the NDA, supplementary-agreement and allocation-letter flows
 * can be driven end to end on staging before the Zoho Sign API plan (D72 AP3, D78) is bought.
 *
 * SWITCH. ZOHO_SIGN_MODE=fake. `signMode(env)` throws (and src/instrumentation.ts refuses the server start) unless
 * every one of these holds — the same shape as the D124 test sign-in gate, never silently on:
 *   ZOHO_CRM_ENVIRONMENT=sandbox · ZOHO_EXPECTED_ORG_ID set and not the live org · GZ_STATE_ENVIRONMENT (or its legacy
 *   name) not Production · ZOHO_SIGN_API_ORIGIN unset (a real Zoho Sign and the fake are never configured together).
 * NODE_ENV is not a usable marker: the staging AppSail runs the production build (NODE_ENV=production).
 *
 * WHAT IT IS. The same SignApi (./api.ts) and ZohoSignClient (lib/zoho/sign.ts) interfaces the real adapters implement,
 * so the sender, remind/recall, block, the webhook handler, the filer and the periodic check run unchanged. It makes no
 * network call, sends no email and never touches sign.zoho.*. Request state lives in the app's shared state store
 * (server/state, `fake-sign|req|<id>`), ids, codes and times only — never a name, an email or a file (rule 7): the
 * recipient is kept as a hash. Fixed templates: NDA, Supplementary agreement, Allocation letter. A sent request is
 * "inprogress" until a tester completes (or declines) it through POST /api/test/sign/complete (./fake-complete.ts),
 * which then runs the real webhook path, so *_Verified_At and the signed-file slot are written exactly as in production.
 * The signed PDF and certificate it hands the filer are a one-page placeholder that says it is not a signed document.
 */

import { createHash } from "node:crypto";
import { assertServiceCredential, isUserCredential, type ServiceCredential, type ZohoResult } from "../../lib/zoho/client";
import type { ZohoFailure } from "../../lib/zoho/errors";
import type { ZohoSignClient, ZohoSignRequest } from "../../lib/zoho/sign";
import { assertMailAllowed, hashRecipient, MailBlockedError, SANDBOX_MAIL_BLOCKED } from "../../lib/mail-guard";
import type { SharedState } from "../state/shared-state";
import { SIGN_ID, type SignApi, type SignCredential, type SignRecipient, type SignRequestDetail, type SignTemplate } from "./api";

/* ------------------------------------------------ the guard ------------------------------------------------ */

export const SIGN_MODE_ENV = "ZOHO_SIGN_MODE";
export type SignMode = "real" | "fake";
/** The live Zoho CRM org (catalyst/README.md "Staging against the sandbox"): fake signing never runs against it. */
export const LIVE_ORG_IDS: readonly string[] = Object.freeze(["60061770791"]);

export class FakeSignRefused extends Error {
  constructor(message: string) { super(message); this.name = "FakeSignRefused"; }
}

/** Every reason fake signing may not run here (variable names only, never a value); empty = allowed. */
export function fakeSignRefusals(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if ((env.ZOHO_CRM_ENVIRONMENT ?? "").trim().toLowerCase() !== "sandbox") out.push("ZOHO_CRM_ENVIRONMENT is not sandbox");
  const org = (env.ZOHO_EXPECTED_ORG_ID ?? "").trim();
  if (!/^\d{1,25}$/.test(org)) out.push("ZOHO_EXPECTED_ORG_ID is not set");
  else if (LIVE_ORG_IDS.includes(org)) out.push("ZOHO_EXPECTED_ORG_ID names the live org");
  const stateEnv = ((env.GZ_STATE_ENVIRONMENT ?? "").trim() || (env.CATALYST_ENVIRONMENT ?? "").trim()).toLowerCase();
  if (stateEnv === "production") out.push("GZ_STATE_ENVIRONMENT is Production");
  if ((env.ZOHO_SIGN_API_ORIGIN ?? "").trim() !== "") out.push("ZOHO_SIGN_API_ORIGIN is set (a real Zoho Sign is configured)");
  return out;
}

/** "real" (unset or "real") or "fake" (allowed only where fakeSignRefusals is empty). Anything else throws: fail closed. */
export function signMode(env: NodeJS.ProcessEnv = process.env): SignMode {
  const v = (env[SIGN_MODE_ENV] ?? "").trim();
  if (v === "" || v === "real") return "real";
  if (v !== "fake") throw new FakeSignRefused(`${SIGN_MODE_ENV} must be "fake" or unset.`);
  const why = fakeSignRefusals(env);
  if (why.length) throw new FakeSignRefused(`${SIGN_MODE_ENV}=fake refused: ${why.join("; ")}. Test signing runs only on a sandbox staging deployment.`);
  return "fake";
}
export const fakeSignOn = (env: NodeJS.ProcessEnv = process.env): boolean => signMode(env) === "fake";

/* ------------------------------------------------ the fake ------------------------------------------------- */

/** The fixed sandbox templates (one signer each, as the real send requires). Names say "Test signing" on purpose. */
export const FAKE_SIGN_TEMPLATES: readonly SignTemplate[] = Object.freeze([
  Object.freeze({ templateId: "9900000000000000101", name: "Test signing (sandbox) — Non-disclosure agreement" }),
  Object.freeze({ templateId: "9900000000000000102", name: "Test signing (sandbox) — Supplementary agreement" }),
  Object.freeze({ templateId: "9900000000000000103", name: "Test signing (sandbox) — Allocation letter" }),
]);

export type FakeStatus = "inprogress" | "completed" | "declined" | "recalled";
/** What the store holds per request: ids, codes and times (no name, no email, no file). */
export interface FakeRequest {
  readonly v: 1;
  readonly id: string;
  readonly status: FakeStatus;
  readonly by: string;
  readonly src: "template" | "pdf";
  readonly tpl: string | null;
  readonly method: string;
  /** hash of the recipient's email (mail-guard hashRecipient), never the address */
  readonly rh: string;
  readonly act: string;
  readonly doc: string;
  readonly sentAt: number;
  readonly modAt: number;
  readonly reminders: number;
  readonly declineReason: string | null;
}

export const FAKE_KEY = (id: string): string => `fake-sign|req|${id}`;
const SEQ_KEY = "fake-sign|seq";
const TTL_S = 90 * 86_400;
const NO_EMBED = "FAKE_SIGN_NO_EMBED";

/** 19 digits beginning "99", from a sha-256 of the parts: deterministic, matches /^\d{10,25}$/ and the 15–22-digit log ids. */
export function fakeId(...parts: readonly (string | number)[]): string {
  const h = BigInt(`0x${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 30)}`);
  return `99${(h % 10n ** 17n).toString().padStart(17, "0")}`;
}

/** A one-page PDF that says what it is. Fresh bytes per call (the filer zeroes what it is handed). */
export function placeholderPdf(what: "pdf" | "certificate", requestId: string): Uint8Array {
  const line = `TEST SIGNING (SANDBOX) - NOT A SIGNED DOCUMENT - ${what === "pdf" ? "signed copy" : "completion certificate"} ${requestId}`;
  const stream = `BT /F1 12 Tf 48 780 Td (${line}) Tj ET`;
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export interface FakeSignDeps {
  readonly state: SharedState;
  readonly clock?: () => number;
}

/** The fake: SignApi for the person-token acts and the filer, ZohoSignClient for the webhook re-read. */
export interface FakeSign extends SignApi, ZohoSignClient {
  readonly fake: true;
  /** one read for both interfaces: a person or the provider-callback service; the answer carries both shapes */
  getRequest(as: SignCredential, requestId: string, o?: { readonly signal?: AbortSignal }): Promise<ZohoResult<SignRequestDetail & ZohoSignRequest>>;
  /** The tester's act (POST /api/test/sign/complete): the signer signed, or declined. Only a request still out moves. */
  settle(requestId: string, outcome: "completed" | "declined"): Promise<{ ok: true; request: FakeRequest } | { ok: false; code: "not-found" | "not-out"; status: FakeStatus | null }>;
  /** The stored request, or null. */
  peek(requestId: string): Promise<FakeRequest | null>;
}

export function createFakeSign(deps: FakeSignDeps): FakeSign {
  const clock = deps.clock ?? Date.now;
  const state = deps.state;

  const done = <T>(value: T): ZohoResult<T> => ({ ok: true, value, status: 200, creditsRemaining: null });
  const fail = <T>(error: ZohoFailure): ZohoResult<T> => ({ ok: false, error, creditsRemaining: null });
  const notFound = <T>(): ZohoResult<T> => fail<T>({ kind: "not-found", status: 404, code: "FAKE_SIGN_NOT_FOUND" });
  const userOnly = (as: unknown): void => { if (!isUserCredential(as)) throw new TypeError("This Zoho Sign act runs on the signed-in person's own token (D53)."); };
  const anyCred = (as: SignCredential): void => { if (!isUserCredential(as)) assertServiceCredential(as, "provider-callback"); };
  const checkId = (id: string, what = "request"): void => { if (typeof id !== "string" || !SIGN_ID.test(id)) throw new TypeError(`Invalid Zoho Sign ${what} id.`); };

  async function load(id: string): Promise<FakeRequest | null> {
    const raw = await state.get(FAKE_KEY(id));
    if (raw === null) return null;
    try { const r = JSON.parse(raw) as FakeRequest; return r && r.v === 1 && r.id === id ? r : null; } catch { return null; }
  }
  const save = (r: FakeRequest): Promise<void> => state.set(FAKE_KEY(r.id), JSON.stringify(r), TTL_S);

  /** The real adapter refuses a sandbox send to a recipient outside GZ_SANDBOX_MAIL_ALLOW (D131); so does the fake. */
  function mailBlocked<T>(recipient: SignRecipient, op: string): ZohoResult<T> | null {
    try { assertMailAllowed([recipient.email], "sign-fake-" + op); return null; } catch (e) {
      if (!(e instanceof MailBlockedError)) throw e;
      return fail<T>({ kind: "refused", status: null, reason: SANDBOX_MAIL_BLOCKED });
    }
  }

  async function create(as: SignCredential, src: "template" | "pdf", tpl: string | null, recipient: SignRecipient, method: string): Promise<ZohoResult<{ readonly requestId: string }>> {
    userOnly(as);
    const by = (as as { userId: string }).userId;
    const seq = await state.incr(SEQ_KEY);
    const at = clock();
    const id = fakeId("request", at, seq, by, src, tpl ?? "pdf");
    await save(Object.freeze({
      v: 1, id, status: "inprogress", by, src, tpl, method, rh: hashRecipient(recipient.email),
      act: fakeId("action", id), doc: fakeId("document", id), sentAt: at, modAt: at, reminders: 0, declineReason: null,
    }) as FakeRequest);
    return done({ requestId: id });
  }

  const detailOf = (r: FakeRequest): SignRequestDetail => Object.freeze({
    requestId: r.id, status: r.status, sentAt: r.sentAt, modifiedTime: r.modAt, expiresAt: r.sentAt + 14 * 86_400_000,
    declineReason: r.declineReason,
    actions: Object.freeze([Object.freeze({
      actionId: r.act, type: "SIGN", status: r.status === "completed" ? "SIGNED" : r.status === "declined" ? "DECLINED" : "UNOPENED",
      recipientEmail: null, embedded: false,
    })]),
    documentIds: Object.freeze([r.doc]),
  });

  async function move(as: SignCredential, requestId: string, to: FakeStatus, op: "remind" | "recall"): Promise<ZohoResult<FakeRequest>> {
    userOnly(as);
    checkId(requestId);
    const r = await load(requestId);
    if (!r) return notFound();
    if (r.status !== "inprogress") return fail({ kind: "invalid-data", status: 400, code: "FAKE_SIGN_NOT_OUT", field: null, records: null });
    const next = Object.freeze({ ...r, status: to, modAt: clock(), reminders: r.reminders + (op === "remind" ? 1 : 0) }) as FakeRequest;
    await save(next);
    return done(next);
  }

  const api: FakeSign = {
    fake: true,

    async listTemplates(as) {
      userOnly(as);
      return done(FAKE_SIGN_TEMPLATES);
    },

    async createFromTemplate(as, t) {
      userOnly(as);
      checkId(t.templateId, "template");
      { const b = mailBlocked<{ readonly requestId: string }>(t.recipient, "createFromTemplate"); if (b) return b; }
      if (!FAKE_SIGN_TEMPLATES.some((x) => x.templateId === t.templateId)) return notFound();
      return create(as, "template", t.templateId, t.recipient, t.method);
    },

    async createFromPdf(as, p) {
      userOnly(as);
      { const b = mailBlocked<{ readonly requestId: string }>(p.recipient, "createFromPdf"); if (b) return b; }
      if (p.method === "aadhaar") return fail({ kind: "invalid-data", status: 0, code: "AADHAAR_NEEDS_TEMPLATE", field: null, records: null });
      if (p.file.contentType !== "application/pdf" || !(p.file.bytes instanceof Uint8Array) || p.file.bytes.byteLength < 5) throw new TypeError("Only a PDF of up to 20 MB can be sent for signature.");
      return create(as, "pdf", null, p.recipient, p.method);
    },

    /* both interfaces: SignApi.getRequest (person or service) → SignRequestDetail; it also carries ZohoSignRequest's actionTime */
    async getRequest(as: SignCredential, requestId: string) {
      anyCred(as);
      checkId(requestId);
      const r = await load(requestId);
      if (!r) return notFound();
      return done(Object.freeze({ ...detailOf(r), actionTime: r.modAt }));
    },

    async remind(as, requestId) {
      const r = await move(as, requestId, "inprogress", "remind");
      return r.ok ? done({ reminded: true } as const) : fail(r.error);
    },

    async recall(as, requestId) {
      const r = await move(as, requestId, "recalled", "recall");
      return r.ok ? done({ recalled: true } as const) : fail(r.error);
    },

    async download(as: ServiceCredential, requestId, what) {
      assertServiceCredential(as, "provider-callback");
      checkId(requestId);
      const r = await load(requestId);
      if (!r) return notFound();
      if (r.status !== "completed") return fail({ kind: "invalid-data", status: 400, code: "FAKE_SIGN_NOT_COMPLETED", field: null, records: null });
      return done({ bytes: placeholderPdf(what, requestId), contentType: "application/pdf" } as const);
    },

    async embedToken(as) {
      assertServiceCredential(as, "provider-callback");
      // Embedded signing needs a real Sign origin to frame; test signing has none.
      return fail({ kind: "invalid-data", status: 400, code: NO_EMBED, field: null, records: null });
    },

    async settle(requestId, outcome) {
      checkId(requestId);
      const r = await load(requestId);
      if (!r) return { ok: false, code: "not-found", status: null };
      if (r.status !== "inprogress") return { ok: false, code: "not-out", status: r.status };
      const next = Object.freeze({ ...r, status: outcome, modAt: clock(), declineReason: outcome === "declined" ? "Declined in test signing (sandbox)." : null }) as FakeRequest;
      await save(next);
      return { ok: true, request: next };
    },

    peek: load,
  };
  return Object.freeze(api);
}
