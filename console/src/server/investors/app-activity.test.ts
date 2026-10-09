/* GC-1525 — the App activity read: the seat's own scope in the WHERE, rows re-admitted, a missing Zoho field degrades, nothing blanks.
   Run: npx vitest run src/server/investors/app-activity.test.ts   (a stub CRM; no request reaches Zoho) */
import { describe, expect, it } from "vitest";
import { APP_ACTIVITY_BASE_FIELDS, APP_ACTIVITY_FIELDS, createAppActivity, parseActivity } from "./app-activity";

const P = "9007199254";
const KAM = `${P}740994001`, OTHER_KAM = `${P}740994002`, IR = `${P}740995001`, OTHER_IR = `${P}740995002`, FIN = `${P}740993001`;
const C1 = `${P}740100001`, C2 = `${P}740100002`, LEAD = `${P}740200001`;
const cred = (userId: string) => ({ userId }) as never;

type Call = string;
function stub(answer: (q: string, n: number) => { ok: true; records: Record<string, unknown>[] } | { ok: false; kind: string }) {
  const calls: Call[] = [];
  const refusals: string[][] = [];
  const crm = {
    async coql(_c: unknown, q: string) {
      calls.push(q);
      const a = answer(q, calls.length);
      return a.ok ? { ok: true, value: { records: a.records, moreRecords: false } } : { ok: false, error: { kind: a.kind } };
    },
  };
  const events = { refusal: (...a: unknown[]) => { refusals.push(a.map(String)); } };
  return { svc: createAppActivity({ crm: crm as never, events: events as never }), calls, refusals };
}
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, App_Access: "Invite", App_Welcome_At: "2026-10-06T09:30:00+05:30", App_Welcome_Channel: "Email",
  KAM: { id: KAM }, Origin_Lead: { id: LEAD }, Originating_IR: { id: IR }, ...extra });

describe("the projection", () => {
  it("is the three account fields plus the five the investor app writes — timestamps and counts, no identity", () => {
    expect(APP_ACTIVITY_FIELDS).toEqual(expect.arrayContaining(["App_Access", "App_Welcome_At", "App_Welcome_Channel",
      "App_First_Sign_In_At", "App_Last_Sign_In_At", "App_Sign_In_Count", "App_Last_Failed_Sign_In_At", "App_Failed_Sign_In_Count"]));
    expect(APP_ACTIVITY_BASE_FIELDS).not.toContain("App_Sign_In_Count");
    expect(APP_ACTIVITY_FIELDS.join(",")).not.toMatch(/PAN|Aadhaar|Bank|Email\b|Mobile|IP_|Device/i);
  });
});

describe("parseActivity", () => {
  it("reads datetimes and counts; anything of the wrong shape reads as empty", () => {
    const a = parseActivity(row(C1, { App_First_Sign_In_At: "2026-10-07T10:00:00+05:30", App_Last_Sign_In_At: "2026-10-08T11:00:00+05:30", App_Sign_In_Count: 2,
      App_Last_Failed_Sign_In_At: "garbage", App_Failed_Sign_In_Count: -1 }));
    expect(a).toMatchObject({ contactId: C1, access: "Invite", welcomeChannel: "Email", firstSignInAt: "2026-10-07T10:00:00+05:30", signInCount: 2, lastFailedAt: null, failedCount: null });
    expect(parseActivity({ id: "x" })).toBeNull();
    expect(parseActivity(row(C1, { App_Access: "Other", App_Welcome_Channel: "Pigeon" }))).toMatchObject({ access: null, welcomeChannel: null });
  });
});

describe("read", () => {
  it("a KAM: their own book in the WHERE, on their own token, the five new fields selected", async () => {
    const { svc, calls } = stub(() => ({ ok: true, records: [row(C1, { App_Sign_In_Count: 3, App_Last_Sign_In_At: "2026-10-08T11:00:00+05:30" })] }));
    const r = await svc.read(cred(KAM), "kam", [C1], undefined);
    expect(r).toMatchObject({ ok: true, activityUnavailable: false });
    expect(r.ok && r.rows[0]).toMatchObject({ contactId: C1, signInCount: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("from Contacts");
    expect(calls[0]).toContain(`id in ('${C1}')`);
    expect(calls[0]).toContain(`KAM = '${KAM}'`);
    expect(calls[0]).toContain("App_Last_Failed_Sign_In_At");
  });
  it("Finance and the Head of AM: the book, no per-person filter", async () => {
    const { svc, calls } = stub(() => ({ ok: true, records: [row(C1), row(C2)] }));
    expect((await svc.read(cred(FIN), "fin", [C1, C2])).ok).toBe(true);
    expect(calls[0]).toContain("id is not null");
  });
  it("an IR: only investors from their own leads, and read-only data", async () => {
    const { svc, calls } = stub(() => ({ ok: true, records: [row(C1)] }));
    const r = await svc.read(cred(IR), "ir", [C1]);
    expect(r.ok).toBe(true);
    expect(calls[0]).toContain(`Originating_IR = '${IR}'`);
    expect(calls[0]).toContain("Origin_Lead is not null");
  });
  it("a row outside the scope refuses the whole read — never trimmed", async () => {
    const { svc, refusals } = stub(() => ({ ok: true, records: [row(C1), row(C2, { Originating_IR: { id: OTHER_IR } })] }));
    const r = await svc.read(cred(IR), "ir", [C1, C2]);
    expect(r).toMatchObject({ ok: false, kind: "refused", reason: "not-own-lead" });
    expect(refusals[0]).toEqual(expect.arrayContaining([IR, "app-activity", "not-own-lead"]));
    const k = stub(() => ({ ok: true, records: [row(C1, { KAM: { id: OTHER_KAM } })] }));
    expect(await k.svc.read(cred(KAM), "kam", [C1])).toMatchObject({ ok: false, kind: "refused" });
  });
  it("a seat with no Investors book is refused with no Zoho call; bad or too many ids are refused", async () => {
    const { svc, calls, refusals } = stub(() => ({ ok: true, records: [] }));
    expect(await svc.read(cred(IR), "cp", [C1])).toMatchObject({ ok: false, kind: "refused", reason: "seat-denied" });
    expect(await svc.read(cred(KAM), "kam", ["1' or 1=1 --"])).toMatchObject({ ok: false, kind: "refused", reason: "invalid-request" });
    expect(await svc.read(cred(KAM), "kam", Array.from({ length: 201 }, (_, i) => `${P}7402${String(i).padStart(5, "0")}`))).toMatchObject({ reason: "invalid-request" });
    expect(calls).toHaveLength(0);
    expect(refusals.length).toBe(3);
    expect(await svc.read(cred(KAM), "kam", [])).toEqual({ ok: true, rows: [], activityUnavailable: false });
  });
  it("a sign-in field missing in Zoho (invalid-data): retried without them, marked unavailable, the account facts still come back", async () => {
    const { svc, calls } = stub((q) => q.includes("App_Sign_In_Count") ? { ok: false, kind: "invalid-data" } : { ok: true, records: [row(C1)] });
    const r = await svc.read(cred(KAM), "kam", [C1]);
    expect(r).toMatchObject({ ok: true, activityUnavailable: true });
    expect(r.ok && r.rows[0]).toMatchObject({ contactId: C1, access: "Invite", welcomeChannel: "Email", signInCount: null, firstSignInAt: null });
    expect(calls).toHaveLength(2);
    expect(calls[1]).not.toContain("App_Sign_In_Count");
    expect(calls[1]).toContain("App_Welcome_At");
  });
  it("a real outage is a source error, not 'unavailable'; if even the base read is refused it says so", async () => {
    const down = stub(() => ({ ok: false, kind: "server" }));
    expect(await down.svc.read(cred(KAM), "kam", [C1])).toEqual({ ok: false, kind: "source-error", errorKind: "server" });
    expect(down.calls).toHaveLength(1);
    const bad = stub(() => ({ ok: false, kind: "invalid-data" }));
    expect(await bad.svc.read(cred(KAM), "kam", [C1])).toMatchObject({ ok: false, kind: "source-error", errorKind: "invalid-data" });
  });
  it("ids Zoho does not return are simply absent (not visible to this person)", async () => {
    const { svc } = stub(() => ({ ok: true, records: [row(C1)] }));
    const r = await svc.read(cred(KAM), "kam", [C1, C2]);
    expect(r.ok && r.rows.map((x) => x.contactId)).toEqual([C1]);
  });
});
