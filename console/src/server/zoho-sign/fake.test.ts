/* Test signing (ZOHO_SIGN_MODE=fake, sandbox only): the guard, the fake's lifecycle, the test route's gate, and the full chain
   send → tester completes → the REAL webhook handler and filer write *_Verified_At + the signed slot.
   Synthetic ids, names and tokens only; global fetch throws, so a network call fails the test.
   Run from console/: npx vitest run src/server/zoho-sign/fake.test.ts */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serviceCredential, userCredential, type UserCredential } from "../../lib/zoho/client";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createMemoryState } from "../state/memory";
import { API_ROUTES, apiRuleOf } from "../access/guard-core";
import { RATE_LIMITS } from "../http/request-gate";
import { createFakeSign, FAKE_KEY, FAKE_SIGN_TEMPLATES, FakeSignRefused, fakeSignRefusals, signMode } from "./fake";
import { testSignComplete, TEST_SIGN_COMPLETE_ROUTE, type FakeCompleteDeps } from "./fake-complete";
import { createSignSender } from "./send";
import { createSignActions } from "./actions";
import { createSignedFiler } from "./file";
import { handleZohoSignWebhook } from "./webhook";
import { signStateOf } from "./papers";
import { signModeStartupCheck, signPersonConfigured } from "./runtime";

const P = "1454168000";
const LEAD = `${P}000900001`;
const ALLOT = `${P}000900002`;
const CONTACT = `${P}000900003`;
const FIN = `${P}000900009`;
const LOADED = "2026-10-09T09:00:00+05:30";
const T0 = Date.parse("2026-10-09T05:00:00Z");
const SECRET = "s".repeat(24) + "0123456789abcdefghijklmnop";
const SANDBOX = {
  NODE_ENV: "production", // the staging AppSail runs the production build
  ZOHO_CRM_ENVIRONMENT: "sandbox", ZOHO_EXPECTED_ORG_ID: "60090668120", ZOHO_CRM_RECORD_ID_PREFIX: P, ZOHO_SIGN_MODE: "fake",
  GZ_TEST_SIGNIN_SECRET: SECRET, GZ_TEST_SIGNIN_USERS: "554023000000300004",
} as unknown as NodeJS.ProcessEnv;
const env = (over: Record<string, string | undefined>) => ({ ...SANDBOX, ...over }) as unknown as NodeJS.ProcessEnv;
const log = () => createOpsLog(createMemorySink());
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

let cred: UserCredential;
const svc = serviceCredential("provider-callback", { access_token: "synthetic-service-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 });
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: log(), clock: () => T0,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: FIN, status: "active" }] }), { status: 200 }) } as never);
});
beforeEach(() => { vi.stubGlobal("fetch", async () => { throw new Error("no network in the test-signing tests"); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/* ------------------------------------------------ the guard ------------------------------------------------ */
describe("ZOHO_SIGN_MODE guard", () => {
  it("is real when unset or 'real'", () => {
    expect(signMode({} as NodeJS.ProcessEnv)).toBe("real");
    expect(signMode(env({ ZOHO_SIGN_MODE: "real", ZOHO_CRM_ENVIRONMENT: "production" }))).toBe("real");
  });
  it("is fake on a sandbox staging deployment, even under NODE_ENV=production", () => {
    expect(fakeSignRefusals(SANDBOX)).toEqual([]);
    expect(signMode(SANDBOX)).toBe("fake");
  });
  it("refuses (throws, never silently on) in production or live, and on any production marker", () => {
    const refused: Array<[Record<string, string | undefined>, RegExp]> = [
      [{ ZOHO_CRM_ENVIRONMENT: "production" }, /not sandbox/],
      [{ ZOHO_CRM_ENVIRONMENT: undefined }, /not sandbox/],
      [{ ZOHO_EXPECTED_ORG_ID: undefined }, /ZOHO_EXPECTED_ORG_ID is not set/],
      [{ ZOHO_EXPECTED_ORG_ID: "60061770791" }, /live org/],
      [{ GZ_STATE_ENVIRONMENT: "Production" }, /Production/],
      [{ CATALYST_ENVIRONMENT: "Production" }, /Production/],
      [{ ZOHO_SIGN_API_ORIGIN: "https://sign.zoho.in" }, /real Zoho Sign/],
      [{ ZOHO_SIGN_MODE: "FAKE" }, /must be "fake" or unset/],
      [{ ZOHO_SIGN_MODE: "on" }, /must be "fake" or unset/],
    ];
    for (const [over, why] of refused) {
      expect(() => signMode(env(over)), JSON.stringify(over)).toThrow(FakeSignRefused);
      expect(() => signMode(env(over))).toThrow(why);
      expect(() => signModeStartupCheck(env(over))).toThrow(FakeSignRefused);
      expect(() => signPersonConfigured(env(over))).toThrow(FakeSignRefused);
    }
  });
  it("signPersonConfigured is true in fake mode (no Sign origin) and false with nothing configured", () => {
    expect(signPersonConfigured(SANDBOX)).toBe(true);
    expect(signPersonConfigured(env({ ZOHO_SIGN_MODE: undefined }))).toBe(false);
    expect(signModeStartupCheck(SANDBOX)).toBe("fake");
  });
});

/* ------------------------------------------------ the fake ------------------------------------------------- */
describe("the fake Sign client", () => {
  const recipient = { name: "Synthetic Investor", email: "tech+gzseed-fake@agresearchlabs.com" };
  const NDA_T = FAKE_SIGN_TEMPLATES[0]!.templateId;

  it("lists the three sandbox templates on the person's token, and refuses a service token for a person's act", async () => {
    const f = createFakeSign({ state: createMemoryState(), clock: () => T0 });
    const r = await f.listTemplates(cred);
    expect(r.ok && r.value.map((t) => t.name)).toEqual([
      "Test signing (sandbox) — Non-disclosure agreement", "Test signing (sandbox) — Supplementary agreement", "Test signing (sandbox) — Allocation letter"]);
    await expect(f.listTemplates(svc as never)).rejects.toThrow(/own token/);
  });

  it("send → out → remind → completed → signed PDF; deterministic digit ids; state holds no name or email", async () => {
    const state = createMemoryState();
    const f = createFakeSign({ state, clock: () => T0 });
    const g = createFakeSign({ state: createMemoryState(), clock: () => T0 });
    const a = await f.createFromTemplate(cred, { templateId: NDA_T, requestName: "NDA — Synthetic Investor", recipient, method: "email-otp" });
    const b = await g.createFromTemplate(cred, { templateId: NDA_T, requestName: "NDA — Synthetic Investor", recipient, method: "email-otp" });
    expect(a.ok && b.ok).toBe(true);
    const id = a.ok ? a.value.requestId : "";
    expect(id).toMatch(/^99\d{17}$/);
    expect(id).toMatch(/^\d{10,25}$/);
    expect(b.ok && b.value.requestId).toBe(id); // same clock, same sequence, same inputs → same id
    const second = await f.createFromTemplate(cred, { templateId: NDA_T, requestName: "x", recipient, method: "email-otp" });
    expect(second.ok && second.value.requestId).not.toBe(id);

    const raw = (await state.get(FAKE_KEY(id)))!;
    expect(raw).not.toContain("Synthetic");
    expect(raw).not.toContain("agresearchlabs");

    const out = await f.getRequest(cred, id);
    expect(out.ok && signStateOf(out.value)).toBe("sent");
    expect((await f.remind(cred, id)).ok).toBe(true);
    expect((await f.download(svc, id, "pdf")).ok).toBe(false); // not signed yet

    const done = await f.settle(id, "completed");
    expect(done.ok).toBe(true);
    const read = await f.getRequest(svc, id); // the webhook's re-read on the provider-callback token
    expect(read.ok && read.value.status).toBe("completed");
    expect(read.ok && signStateOf(read.value)).toBe("signed");
    const pdf = await f.download(svc, id, "pdf");
    expect(pdf.ok && new TextDecoder().decode(pdf.value.bytes.slice(0, 5))).toBe("%PDF-");
    expect(pdf.ok && new TextDecoder().decode(pdf.value.bytes)).toContain("NOT A SIGNED DOCUMENT");
    expect((await f.settle(id, "completed"))).toEqual({ ok: false, code: "not-out", status: "completed" });
    expect((await f.recall(cred, id)).ok).toBe(false);
    expect((await f.embedToken(svc, id, id, "https://app.example")).ok).toBe(false);
  });

  it("recall moves an out request to recalled; unknown ids and templates are not-found; Aadhaar on a PDF is refused", async () => {
    const f = createFakeSign({ state: createMemoryState(), clock: () => T0 });
    const a = await f.createFromTemplate(cred, { templateId: NDA_T, requestName: "x", recipient, method: "aadhaar" });
    const id = a.ok ? a.value.requestId : "";
    expect((await f.recall(cred, id)).ok).toBe(true);
    const r = await f.getRequest(cred, id);
    expect(r.ok && signStateOf(r.value)).toBe("recalled");
    const unknown = await f.getRequest(cred, "9912345678901234567");
    expect(!unknown.ok && unknown.error.kind).toBe("not-found");
    const tpl = await f.createFromTemplate(cred, { templateId: "1234567890123", requestName: "x", recipient, method: "email-otp" });
    expect(!tpl.ok && tpl.error.kind).toBe("not-found");
    const pdf = await f.createFromPdf(cred, { file: { fileName: "a.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4") },
      requestName: "x", recipient, method: "aadhaar", field: { page: 0, x: 1, y: 1, width: 10, height: 10 } });
    expect(!pdf.ok && pdf.error.kind === "invalid-data" && pdf.error.code).toBe("AADHAAR_NEEDS_TEMPLATE");
  });

  it("keeps the sandbox mail guard: a recipient outside GZ_SANDBOX_MAIL_ALLOW is refused as the real adapter does", async () => {
    vi.stubEnv("ZOHO_CRM_ENVIRONMENT", "sandbox");
    const f = createFakeSign({ state: createMemoryState(), clock: () => T0 });
    const r = await f.createFromTemplate(cred, { templateId: NDA_T, requestName: "x", recipient: { name: "X", email: "someone@example.com" }, method: "email-otp" });
    expect(!r.ok && r.error.kind === "refused" && r.error.reason).toBe("sandbox-mail-blocked");
  });
});

/* -------------------------------- the full chain on stubbed CRM (sandbox records) -------------------------------- */
type Rec = Record<string, unknown> & { id: string };
function crmStub(records: Record<string, Rec>) {
  const updates: Array<{ module: string; id: string; data: Record<string, unknown> }> = [];
  const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
  const crm = {
    async getRecord(_c: unknown, _m: string, id: string) { return records[id] ? ok({ ...records[id] }) : { ok: false as const, error: { kind: "not-found", status: 404, code: "x" }, creditsRemaining: null }; },
    async update(_c: unknown, module: string, id: string, data: Record<string, unknown>) {
      updates.push({ module, id, data });
      Object.assign(records[id]!, data, { Modified_Time: "2026-10-09T10:00:00+05:30" });
      return ok({ id });
    },
    async insert() { return ok([{ ok: true, id: `${P}000900099` }]); },
    async search(_c: unknown, module: string, q: { criteria: string }) {
      const m = /^\((\w+):equals:(\d+)\)$/.exec(q.criteria)!;
      const hits = Object.values(records).filter((r) => r.__module === module && r[m[1]!] === m[2]);
      return ok({ records: hits.map((r) => ({ id: r.id, [m[1]!]: r[m[1]!] })), moreRecords: false });
    },
    async uploadAttachment() { return ok({ attachmentId: `${P}000900077` }); },
    async uploadFile() { return ok({ fileId: "synthetic-zfs-file-id" }); },
    async deleteAttachment() { return ok({ deleted: true }); },
  };
  return { crm, updates };
}

function chain() {
  const records: Record<string, Rec> = {
    [LEAD]: { id: LEAD, __module: "Leads", First_Name: "Synthetic", Last_Name: "Lead", Email: "tech+gzseed-lead@agresearchlabs.com", Modified_Time: LOADED },
    [CONTACT]: { id: CONTACT, __module: "Contacts", First_Name: "Synthetic", Last_Name: "Investor", Email: "tech+gzseed-inv@agresearchlabs.com", Residency: "Resident", Modified_Time: LOADED },
    [ALLOT]: { id: ALLOT, __module: "LLP_UnitAllocation_Module", Customer: { id: CONTACT }, Modified_Time: LOADED },
  };
  const { crm, updates } = crmStub(records);
  const state = createMemoryState();
  let now = T0;
  const clock = () => now;
  const fake = createFakeSign({ state, clock });
  const sender = createSignSender({ crm: crm as never, sign: fake, log: log(), state, clock });
  const actions = createSignActions({ crm: crm as never, sign: fake, log: log(), clock });
  const hookSecret = "synthetic-fake-webhook-secret-0123456789";
  const filer = createSignedFiler({ crm: crm as never, sign: fake, log: log(), clock });
  const webhookDeps = {
    secrets: [hookSecret], sign: fake, crm: crm as never, credential: async () => svc, invalidateCredential: () => undefined, log: log(), state, clock,
    file: (c: typeof svc, target: never, requestId: string) => filer.file(c, target, requestId),
  };
  const deps: FakeCompleteDeps = {
    env: SANDBOX, configured: true, fake: () => fake, secret: () => hookSecret, clock,
    webhook: (body, signature) => handleZohoSignWebhook({ body, signature }, webhookDeps as never),
  };
  return { records, updates, fake, sender, actions, deps, tick: (ms: number) => { now += ms; } };
}
const complete = (deps: FakeCompleteDeps, body: unknown, secret: string | null = SECRET) =>
  testSignComplete(new Request(`https://x.invalid${TEST_SIGN_COMPLETE_ROUTE}`, {
    method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-test-signin-secret": secret }) }, body: JSON.stringify(body),
  }), deps);
const principal = () => ({ credential: cred, seat: "fin" });
const KEY = (n: number) => `press-key-${String(n).padStart(12, "0")}`;

describe("NDA cycle: Finance sends, the tester completes, the real webhook path stamps NDA_Verified_At", () => {
  it("writes NDA_Sign_Req_Id on send and NDA_Verified_At + the NDA slot on completion", async () => {
    const c = chain();
    const pre = await c.sender.prefill(principal(), "nda", LEAD);
    expect(pre.ok && pre.value.maySend).toBe(true);
    const sent = await c.sender.commit(principal(), { paper: "nda", recordId: LEAD, method: "email-otp", expectedModifiedTime: LOADED,
      source: { kind: "template", templateId: FAKE_SIGN_TEMPLATES[0]!.templateId } }, KEY(1));
    expect(sent.ok).toBe(true);
    const requestId = sent.ok ? sent.value.requestId : "";
    expect(c.records[LEAD]!.NDA_Sign_Req_Id).toBe(requestId);
    expect(c.records[LEAD]!.NDA_Signed_Via).toBe("Zoho Sign - Email OTP");

    // out: a second send is refused; prefill names it
    const again = await c.sender.prefill(principal(), "nda", LEAD);
    expect(again.ok && again.value.current?.state).toBe("sent");
    expect(again.ok && again.value.maySend).toBe(false);
    expect((await c.actions.remind(principal(), "nda", LEAD)).ok).toBe(true);

    c.tick(60_000);
    const r = await complete(c.deps, { requestId });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, requestId, status: "completed", webhook: { outcome: "filed", recordId: LEAD } });
    expect(typeof c.records[LEAD]!.NDA_Verified_At).toBe("string");
    expect(c.records[LEAD]!.NDA).toEqual([{ file_id: "synthetic-zfs-file-id" }]);
    const stamp = c.updates.find((u) => u.data.NDA_Verified_At);
    expect(stamp).toMatchObject({ module: "Leads", id: LEAD });

    // calling again re-delivers: the filer answers "already filed", nothing is written twice
    const n = c.updates.length;
    const re = await complete(c.deps, { requestId });
    expect(await re.json()).toMatchObject({ ok: true, redelivered: true, webhook: { outcome: "observed" } });
    expect(c.updates.length).toBe(n);
    const after = await c.sender.prefill(principal(), "nda", LEAD);
    expect(after.ok && after.value.current?.state).toBe("verified");
  });

  it("a declined request is observed (nothing stamped) and may be sent again", async () => {
    const c = chain();
    const sent = await c.sender.commit(principal(), { paper: "nda", recordId: LEAD, method: "email-otp", expectedModifiedTime: LOADED,
      source: { kind: "template", templateId: FAKE_SIGN_TEMPLATES[0]!.templateId } }, KEY(2));
    const requestId = sent.ok ? sent.value.requestId : "";
    const r = await complete(c.deps, { requestId, outcome: "declined" });
    expect(await r.json()).toMatchObject({ ok: true, status: "declined", webhook: { outcome: "observed", recordId: LEAD } });
    expect(c.records[LEAD]!.NDA_Verified_At).toBeUndefined();
    const pre = await c.sender.prefill(principal(), "nda", LEAD);
    expect(pre.ok && pre.value.current?.state).toBe("declined");
    expect(pre.ok && pre.value.maySend).toBe(true);
  });
});

describe("Supplementary cycle on the allotment: Supplementary_Verified_At (the console's Agreement_Signed)", () => {
  it("sends to the allotment's Customer and stamps the allotment on completion", async () => {
    const c = chain();
    const sent = await c.sender.commit(principal(), { paper: "supplementary", recordId: ALLOT, method: "email-otp", expectedModifiedTime: LOADED,
      source: { kind: "template", templateId: FAKE_SIGN_TEMPLATES[1]!.templateId } }, KEY(3));
    expect(sent.ok).toBe(true);
    const requestId = sent.ok ? sent.value.requestId : "";
    expect(c.records[ALLOT]!.Supplementary_Sign_Req_Id).toBe(requestId);
    const r = await complete(c.deps, { requestId });
    expect(await r.json()).toMatchObject({ ok: true, webhook: { outcome: "filed", recordId: ALLOT } });
    expect(typeof c.records[ALLOT]!.Supplementary_Verified_At).toBe("string");
    expect(c.records[ALLOT]!.Supplementary_Agreement).toEqual([{ file_id: "synthetic-zfs-file-id" }]);
    expect(c.records[LEAD]!.NDA_Verified_At).toBeUndefined();
  });
});

/* ------------------------------------------------ the route gate ------------------------------------------------ */
describe("POST /api/test/sign/complete gate", () => {
  it("404 unless wired, test sign-in on, fake on and the secret matches", async () => {
    const c = chain();
    const off: Array<[Partial<FakeCompleteDeps>, string | null]> = [
      [{ configured: false }, SECRET],
      [{ env: env({ ZOHO_CRM_ENVIRONMENT: "production" }) }, SECRET],
      [{ env: env({ ZOHO_SIGN_MODE: undefined }) }, SECRET],
      [{ env: env({ ZOHO_SIGN_MODE: "fake", ZOHO_EXPECTED_ORG_ID: "60061770791" }) }, SECRET],
      [{ env: env({ GZ_TEST_SIGNIN_SECRET: undefined }) }, SECRET],
      [{ env: env({ GZ_TEST_SIGNIN_USERS: "" }) }, SECRET],
      [{}, null],
      [{}, "wrong-secret-wrong-secret-wrong-secret-xx"],
    ];
    for (const [over, secret] of off) {
      const r = await complete({ ...c.deps, ...over }, { requestId: "9912345678901234567" }, secret);
      expect(r.status, JSON.stringify(over)).toBe(404);
      expect(await r.text()).toBe("Not found");
    }
  });
  it("400 on a bad body, 409 on an unknown request or one no longer out", async () => {
    const c = chain();
    expect((await complete(c.deps, { requestId: "abc" })).status).toBe(400);
    expect((await complete(c.deps, { requestId: "9912345678901234567", outcome: "signed" })).status).toBe(400);
    const unknown = await complete(c.deps, { requestId: "9912345678901234567" });
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toMatchObject({ why: "unknown-request" });
    const sent = await c.sender.commit(principal(), { paper: "nda", recordId: LEAD, method: "email-otp", expectedModifiedTime: LOADED,
      source: { kind: "template", templateId: FAKE_SIGN_TEMPLATES[0]!.templateId } }, KEY(4));
    const requestId = sent.ok ? sent.value.requestId : "";
    expect((await c.actions.recall(principal(), "nda", LEAD, "Wrong investor picked")).ok).toBe(true);
    const r = await complete(c.deps, { requestId });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ why: "not-out", status: "recalled" });
  });
  it("is an open route in the guard table and rate-limited with the test sign-in", () => {
    expect(apiRuleOf(TEST_SIGN_COMPLETE_ROUTE)?.rule.kind).toBe("open");
    expect(Object.keys(API_ROUTES)).toContain(TEST_SIGN_COMPLETE_ROUTE);
    expect(RATE_LIMITS.find((r) => r.matches(TEST_SIGN_COMPLETE_ROUTE))?.name).toBe("test-signin");
  });
});
