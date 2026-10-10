/* W6-KAM-1 (read-only origin lead) and W7-FIN-2 (Digital Infrastructure sets Originating_IR from the lead owner) — server/investors/origin
   on a scripted Zoho double. Synthetic ids only. Run: npx vitest run src/server/investors/origin.test.ts */
import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "@/lib/zoho/client";
import { createMemorySink, createOpsLog } from "@/lib/zoho/log";
import { createOrigin, LEAD_VIEW_FIELDS } from "./origin";

const P = "9007199254";
const DI = "9007199254740990801", IR = "9007199254740990802";
const LEAD = "9007199254740991101", CONTACT = "9007199254740991103";
const MT = "2026-10-10T11:00:00+05:30";
const SID = "session_fixture_origin_0001";
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => 0,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: DI, status: "active" }] }), { status: 200 }) } as never);
});
const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
const bad = (kind: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { kind, status: 400, ...extra }, creditsRemaining: null });

type Calls = unknown[][];
function double(o: { ir?: string | null; irHidden?: boolean; leadHidden?: boolean; hide?: string; drop?: boolean; noOrigin?: boolean } = {}) {
  const calls: Calls = [];
  const st = { ir: o.ir === undefined ? null : o.ir };
  const crm = {
    async getRecord(_c: unknown, module: string, id: string, opts: { fields: string[] }) {
      calls.push(["GET", module, id, opts.fields]);
      if (module === "Contacts") {
        if (o.irHidden && opts.fields.includes("Originating_IR")) return bad("invalid-data", { field: "Originating_IR" });
        return ok({ id, Origin_Lead: o.noOrigin ? null : { id: LEAD, name: "x" }, Modified_Time: MT, ...(opts.fields.includes("Originating_IR") ? { Originating_IR: st.ir ? { id: st.ir } : null } : {}) });
      }
      if (module === "Leads") {
        if (o.leadHidden) return bad("forbidden");
        if (o.hide && opts.fields.includes(o.hide)) return bad("invalid-data", { field: o.hide });
        return ok({ id, Lead_Status: "Reserved - 10% in", Lead_Source: "Events", Owner: { id: IR, name: "IR A Test", email: "x@example.invalid" }, Units_Interested: 2,
          Created_Time: "2026-07-01T10:00:00+05:30", Said_Yes_At: "2026-08-20T11:00:00+05:30", Lost_At: null, First_Name: "MUST-NOT-ASK" });
      }
      return ok(null);
    },
    async update(_c: unknown, module: string, id: string, fields: Record<string, unknown>, opts: { ifUnmodifiedSince: string | null }) {
      calls.push(["PUT", module, id, fields, opts.ifUnmodifiedSince]);
      if (!o.drop) st.ir = (fields.Originating_IR as { id: string }).id;   // drop: Zoho accepts, stores nothing (a profile without edit)
      return ok({ id, modifiedTime: MT });
    },
  };
  const sink = createMemorySink();
  return { crm: crm as never, calls, st, sink, log: createOpsLog(sink) };
}
const di = { async mayFixOriginatingIr() { return true; } };
const notDi = { async mayFixOriginatingIr() { return false; } };
const who = () => ({ credential: cred, sessionId: SID });

describe("W6-KAM-1 — the origin lead, read only", () => {
  it("reads the Contact's Origin_Lead, then the lead with an identity-free projection", async () => {
    const d = double({ ir: IR });
    const r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P }).view(who(), CONTACT);
    expect(r).toMatchObject({ ok: true, value: { leadId: LEAD, readable: true, status: "Reserved - 10% in", source: "Events", owner: { id: IR, name: "IR A Test" },
      unitsInterested: 2, saidYesAt: "2026-08-20T11:00:00+05:30", hiddenFields: [], originatingIrSet: true } });
    const leadAsk = d.calls.find((c) => c[1] === "Leads")![3] as string[];
    expect(leadAsk).toEqual([...LEAD_VIEW_FIELDS]);
    for (const f of ["First_Name", "Last_Name", "Email", "Mobile", "Phone", "Street"]) expect(leadAsk).not.toContain(f);
    expect(JSON.stringify(r)).not.toContain("example.invalid");
  });
  it("a column Zoho hides is dropped and named; a lead Zoho does not share is readable:false, never an error", async () => {
    let d = double({ hide: "Lead_Source" });
    let r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P }).view(who(), CONTACT);
    expect(r.ok && r.value).toMatchObject({ readable: true, source: null, hiddenFields: ["Lead_Source"] });
    d = double({ leadHidden: true });
    r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P }).view(who(), CONTACT);
    expect(r.ok && r.value).toMatchObject({ readable: false, reason: "not-shared", status: null });
    d = double({ noOrigin: true });
    r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P }).view(who(), CONTACT);
    expect(r.ok && r.value).toMatchObject({ readable: false, reason: "no-origin" });
  });
});

describe("W7-FIN-2 — Digital Infrastructure sets Originating_IR from the lead owner", () => {
  it("writes Originating_IR = Origin_Lead.Owner on DI's token, guarded, and reads it back", async () => {
    const d = double();
    const r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P, authority: di }).fixOriginatingIr(who(), CONTACT);
    expect(r).toEqual({ ok: true, value: { contactId: CONTACT, originatingIrId: IR, already: false } });
    expect(d.calls.find((c) => c[0] === "PUT")).toEqual(["PUT", "Contacts", CONTACT, { Originating_IR: { id: IR } }, MT]);
    expect(d.calls.filter((c) => c[0] === "GET" && c[1] === "Contacts").length).toBe(2);   // the read back
    expect(JSON.stringify(d.sink.records())).not.toContain("IR A Test");
  });
  it("never overwrites a set Originating_IR; refuses any seat but DI before a read", async () => {
    let d = double({ ir: "9007199254740990899" });
    const r = await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P, authority: di }).fixOriginatingIr(who(), CONTACT);
    expect(r).toEqual({ ok: true, value: { contactId: CONTACT, originatingIrId: "9007199254740990899", already: true } });
    expect(d.calls.some((c) => c[0] === "PUT")).toBe(false);
    d = double();
    expect(await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P, authority: notDi }).fixOriginatingIr(who(), CONTACT))
      .toMatchObject({ ok: false, reasonCode: "not-allowed" });
    expect(d.calls).toEqual([]);
  });
  it("Zoho accepts the write but stores nothing (profile cannot edit the field): not-written, not a false success", async () => {
    const d = double({ drop: true });
    expect(await createOrigin({ crm: d.crm, log: d.log, recordIdPrefix: P, authority: di }).fixOriginatingIr(who(), CONTACT))
      .toMatchObject({ ok: false, kind: "refused", reasonCode: "not-written" });
  });
});
