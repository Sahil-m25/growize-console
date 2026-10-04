/* M18-S09-NOTE-8 (r7-idempotency) — the remaining per-process idempotency maps now run through state/idempotent.ts:
 * Zoho Sign send, document upload, IR payment claim, lead email (receipt-replay's guards are in
 * money/receipt-replay.test.cjs). For each: the same press on TWO instances writes once — on the memory adapter (one
 * Map both instances share) and on two catalyst adapters over one fake backend — and what the guard stored holds no
 * identity or bank reference (rule 7). Everything is synthetic; no request leaves the process. */

import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "../../lib/zoho/client";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createMemoryState } from "./memory";
import { createCatalystState } from "./catalyst";
import { createFakeCatalyst, FAKE_CONFIG } from "./fake-catalyst";
import type { SharedState } from "./shared-state";
import { createSignSender } from "../zoho-sign/send";
import { PAPER_FIELDS } from "../zoho-sign/papers";
import { createUploader } from "../documents/upload";
import { createPaymentClaims, maskRef } from "../leads/claim";
import { createEmailSender } from "../leads/email";

const P = "9007199254";
const IR = `${P}740995001`;
const LEAD = `${P}740996101`;
const CONTACT = `${P}740996201`;
const ALLOT = `${P}740999401`;
const CLAIM_ID = `${P}740997801`;
const TOUCH = `${P}740997701`;
const SESSION = "session_fixture_idem_0001";
const MOD = "2026-09-27T09:00:00+05:30";
const T0 = Date.parse("2026-09-28T05:30:00Z");
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Resolves when the first press is inside its write — the other instance then presses for certain after the claim. */
const latch = () => { let go!: () => void; const reached = new Promise<void>((r) => { go = r; }); return { go, reached }; };

let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => T0,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: IR, status: "active" }] }), { status: 200 }) } as never);
});

/** Two instances over one store, and every value either of them wrote. */
interface Two { readonly a: SharedState; readonly b: SharedState; readonly stored: string[] }
const spied = (s: SharedState, stored: string[]): SharedState => ({ ...s, async set(k: string, v: string, ttl?: number) { stored.push(v); return s.set(k, v, ttl); } });
const BACKENDS: ReadonlyArray<{ name: string; make: () => Two }> = [
  { name: "memory", make: () => { const s = createMemoryState(); const stored: string[] = []; return { a: spied(s, stored), b: spied(s, stored), stored }; } },
  { name: "fake catalyst", make: () => {
    const fake = createFakeCatalyst({ seed: 21 }); const stored: string[] = [];
    const mk = () => spied(createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, sleep: async () => undefined }), stored);
    return { a: mk(), b: mk(), stored };
  } },
];
const clean = (stored: string[], ...secrets: string[]) => {
  expect(stored.length).toBeGreaterThan(0);
  for (const v of stored) for (const x of secrets) expect(v).not.toContain(x);
};
const log = () => createOpsLog(createMemorySink());

describe.each(BACKENDS)("one write across two instances — $name", ({ make }) => {
  it("Zoho Sign send: one Sign request, one record write; the answer holds no recipient; another key for that paper is busy", async () => {
    const { a, b, stored } = make();
    const f = PAPER_FIELDS.nda;
    const EMAIL = "synthetic.signer@example.com";
    let created = 0, updates = 0;
    const inside = latch();
    const crm = {
      async getRecord() { return { ok: true, value: { id: LEAD, Modified_Time: MOD, First_Name: "Synthetic", Last_Name: "Signer", Email: EMAIL, [f.req]: null, [f.verifiedAt]: null } }; },
      async update() { updates++; return { ok: true, value: { id: LEAD } }; },
    };
    const sign = {
      async createFromTemplate() { inside.go(); await sleep(60); created++; return { ok: true, value: { requestId: `${P}740998101` } }; },
      async createFromPdf() { throw new Error("not used"); },
      async getRequest() { return { ok: false, error: { kind: "not-found" } }; },
      async recall() { return { ok: true, value: {} }; },
    };
    const mk = (state: SharedState) => createSignSender({ crm, sign, log: log(), clock: () => T0, state } as never);
    const A = mk(a), B = mk(b);
    const input = () => ({ paper: "nda" as const, recordId: LEAD, method: "email-otp" as const, source: { kind: "template" as const, templateId: "90071992547409970" }, expectedModifiedTime: MOD });
    const who = { credential: cred, seat: "fin" };
    const K1 = "press_key_sign_000001", K2 = "press_key_sign_000002";
    const first = A.commit(who, input(), K1);
    await inside.reached;
    const [same, other] = await Promise.all([B.commit(who, input(), K1), B.commit(who, input(), K2)]);
    const one = await first;
    expect(one.ok && one.value.duplicate).toBe(false);
    expect(same).toMatchObject({ ok: true, value: { duplicate: true, requestId: `${P}740998101` } });
    expect(other).toMatchObject({ ok: false, reasonCode: "busy" });
    expect({ created, updates }).toEqual({ created: 1, updates: 1 });
    clean(stored, EMAIL, "Synthetic Signer");
  });

  it("document upload: one file lands; a lost answer is recovered from another instance by counting, never by uploading twice", async () => {
    const { a, b, stored } = make();
    const files: { name: string; size: number }[] = [];
    let mode: "ok" | "lost" | "missed" = "ok";
    const crm = {
      async getRelated() { return { ok: true, value: { records: files.map((x, i) => ({ id: `${i}`, File_Name: x.name, Size: x.size })) } }; },
      async uploadAttachment(_c: unknown, _m: string, _id: string, file: { fileName: string; bytes: Uint8Array }) {
        await sleep(40);
        if (mode !== "missed") files.push({ name: file.fileName, size: file.bytes.byteLength });
        return mode === "ok" ? { ok: true, value: { attachmentId: `${P}740998201` } } : { ok: false, error: { kind: "network" } };
      },
    };
    const mk = (state: SharedState) => createUploader({ crm, log: log(), clock: () => T0, state } as never);
    const A = mk(a), B = mk(b);
    const NAME = "synthetic-bank-statement-4242.pdf";
    const bytes = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5]);
    const input = (extra = 0) => ({ scope: "lead" as const, recordId: LEAD, slot: null, fileName: NAME, contentType: "application/pdf", bytes: bytes().subarray(0, 10 - extra) });
    const who = { credential: cred, seat: "ops" };

    // 1. the same press on both instances: one file
    const [x, y] = await Promise.all([A.commit(who, input(), "press_key_upload_001"), B.commit(who, input(), "press_key_upload_001")]);
    expect(files).toHaveLength(1);
    expect([x, y].filter((r) => r.ok && r.value.duplicate).length).toBe(1);
    const replayed = [x, y].find((r) => r.ok && r.value.duplicate);
    expect(replayed).toMatchObject({ ok: true, value: { fileName: "synthetic-bank-statement-4242.pdf" } });
    clean(stored, "4242", "bank-statement");

    // 2. the answer is lost after the file landed: instance B counts, finds it, uploads nothing
    files.length = 0; mode = "lost";
    const lost = await A.commit(who, input(), "press_key_upload_002");
    expect(lost).toMatchObject({ ok: false, kind: "not-saved", unknownOutcome: true });
    expect(files).toHaveLength(1);
    mode = "ok";
    const recovered = await B.commit(who, input(), "press_key_upload_002");
    expect(recovered).toMatchObject({ ok: true, value: { recovered: true, duplicate: true } });
    expect(files).toHaveLength(1);

    // 3. the answer is lost and nothing landed: the same key goes again once, on the other instance
    files.length = 0; mode = "missed";
    expect(await A.commit(who, input(), "press_key_upload_003")).toMatchObject({ ok: false, unknownOutcome: true });
    expect(files).toHaveLength(0);
    mode = "ok";
    const again = await B.commit(who, input(), "press_key_upload_003");
    expect(again).toMatchObject({ ok: true, value: { duplicate: false } });
    expect(files).toHaveLength(1);
    clean(stored, "4242", "bank-statement");
  });

  it("payment claim: one Claimed receipt; the answer holds no reference; a different report on that lead waits its turn", async () => {
    const { a, b, stored } = make();
    const REF = "SYNTHETIC-UTR-90017788";
    const rows: Record<string, unknown>[] = [];
    let inserts = 0;
    const inside = latch();
    const crm = {
      async coql(_c: unknown, q: string) {
        if (q.includes("from Contacts")) return { ok: true, value: { records: [{ id: CONTACT, Origin_Lead: { id: LEAD } }], moreRecords: false } };
        if (q.includes("from LLP_UnitAllocation_Module")) return { ok: true, value: { records: [{ id: ALLOT, Customer: { id: CONTACT }, Allocation_Status: "Reserved" }], moreRecords: false } };
        if (q.includes("where UTR like")) return { ok: true, value: { records: rows, moreRecords: false } };
        throw new Error(`unrouted ${q}`);
      },
      async insert(_c: unknown, _m: string, recs: Record<string, unknown>[]) {
        inserts++;
        inside.go();
        await sleep(60);
        rows.push({ id: CLAIM_ID, UTR: recs[0]!.UTR, Allotment: recs[0]!.Allotment, Kind: recs[0]!.Kind, Amount: recs[0]!.Amount, Mode: recs[0]!.Mode, Received_On: recs[0]!.Received_On, Match_State: "Claimed" });
        return { ok: true, value: [{ ok: true, index: 0, code: "SUCCESS", id: CLAIM_ID }] };
      },
    };
    const gates = { async read() { return { ok: true, value: { done: 6, gate: { kind: "payment" }, payment: null, docs: { nda: true, supplementary: true } } }; } };
    const mk = (state: SharedState) => createPaymentClaims({ crm, gates, authority: { async mayReport() { return true; } }, log: log(), recordIdPrefix: P, clock: () => T0, state } as never);
    const A = mk(a), B = mk(b);
    const principal = { credential: cred, sessionId: SESSION };
    const body = (over: Record<string, unknown> = {}) => ({ kind: "balance", mode: "SWIFT", amount: "1500000", said_on: "2026-08-27", ref: REF, ...over });
    const first = A.report(principal, LEAD, body());
    await inside.reached;
    const [same, other] = await Promise.all([B.report(principal, LEAD, body()), B.report(principal, LEAD, body({ amount: "900000" }))]);
    const one = await first;
    expect(one).toMatchObject({ ok: true, value: { duplicate: false, claimId: CLAIM_ID } });
    expect(same).toMatchObject({ ok: true, value: { duplicate: true, claimId: CLAIM_ID, ref: maskRef(REF) } });
    expect(other).toMatchObject({ ok: false, reasonCode: "in-progress" });
    expect(inserts).toBe(1);
    clean(stored, REF, "7788");
  });

  it("lead email: one mail; the answer holds no address or text; a different email to that lead is 'sending'", async () => {
    const { a, b, stored } = make();
    const FROM = "synthetic.ir@agresearchlabs.com", TO = "synthetic.lead@example.com", TEXT = "A synthetic body that must never be stored";
    let sent = 0;
    const inside = latch();
    const crm = {
      async getRecord() { return { ok: true, value: { id: LEAD, Modified_Time: MOD, Owner: { id: IR }, Email: TO, Consent_Email: true, Email_Opt_Out: false, Full_Name: "Synthetic Lead", Lost_At: null } }; },
      async fromAddresses() { return { ok: true, value: [{ email: FROM, type: "primary", userName: null, isDefault: true }] }; },
      async sendMail() { inside.go(); await sleep(60); sent++; return { ok: true, value: { sent: true, messageId: "m1" } }; },
      async update() { return { ok: true, value: { id: LEAD } }; },
    };
    const access = { async recheck(c: UserCredential) { return { actor: { userId: c.userId }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
    const followups = { async save() { return { ok: true, value: { touchId: TOUCH } }; } };
    const mk = (state: SharedState) => createEmailSender({ crm, followups, access, log: log(), recordIdPrefix: P, orgDomains: ["agresearchlabs.com"], clock: () => T0, state } as never);
    const A = mk(a), B = mk(b);
    const principal = { credential: cred, sessionId: SESSION };
    const cmd = (subject = "Growize") => ({ leadId: LEAD, expectedModifiedTime: MOD, template: "intro", subject, message: TEXT });
    const first = A.send(principal, cmd());
    await inside.reached;
    const [same, other] = await Promise.all([B.send(principal, cmd()), B.send(principal, cmd("Growize again"))]);
    const one = await first;
    expect(one).toMatchObject({ ok: true, value: { sent: true, from: FROM, touchId: TOUCH } });
    expect(same).toMatchObject({ ok: true, value: { sent: true, touchId: TOUCH, from: "" } });
    expect(other).toMatchObject({ ok: false, reasonCode: "sending" });
    expect(sent).toBe(1);
    clean(stored, FROM, TO, TEXT, "Synthetic Lead");
  });

  it("lead email: a store that cannot answer refuses it, nothing is sent (no write runs unguarded)", async () => {
    const down: SharedState = { kind: "down", claim: async () => { throw new (await import("./shared-state")).SharedStateError("unavailable"); },
      release: async () => undefined, get: async () => { throw new (await import("./shared-state")).SharedStateError("unavailable"); },
      set: async () => undefined, incr: async () => 0, take: async () => 0 } as never;
    let sent = 0;
    const crm = {
      async getRecord() { return { ok: true, value: { id: LEAD, Modified_Time: MOD, Owner: { id: IR }, Email: "synthetic.lead@example.com", Consent_Email: true, Email_Opt_Out: false, Lost_At: null } }; },
      async fromAddresses() { return { ok: true, value: [{ email: "synthetic.ir@agresearchlabs.com", type: "primary", userName: null, isDefault: true }] }; },
      async sendMail() { sent++; return { ok: true, value: { sent: true, messageId: "m1" } }; },
    };
    const svc = createEmailSender({ crm, followups: { async save() { return { ok: true, value: { touchId: TOUCH } }; } },
      access: { async recheck(c: UserCredential) { return { actor: { userId: c.userId }, mayRecordFollowup: true, teamOwnerIds: [] }; } },
      log: log(), recordIdPrefix: P, orgDomains: ["agresearchlabs.com"], clock: () => T0, state: down } as never);
    const r = await svc.send({ credential: cred, sessionId: SESSION }, { leadId: LEAD, expectedModifiedTime: MOD, template: "intro", subject: "Growize", message: "Hello" });
    expect(r).toMatchObject({ ok: false, reasonCode: "sending" });
    expect(sent).toBe(0);
  });
});
