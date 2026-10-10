/* D137 (owner rulings 9 Oct 2026) — the server half, on a scripted Zoho double. Synthetic ids, names and references only.
 *   GC-1527   the investor is created only after Finance confirms the 10% (server/investors/convert), on Finance's token
 *   ruling 2  the 10% sums Part payments; the trail masks the reference (convert + matched-receipts)
 *   ruling 3  full conversion: automatic after a Finance match (money/match → full-paid auto), by hand with a reason (full-paid
 *             manual); the IR's balance to-do (ir-list buildChase)
 * Run: npx vitest run src/server/investors/d137.test.ts */
import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "@/lib/zoho/client";
import { createMemorySink, createOpsLog } from "@/lib/zoho/log";
import { createConversion, holdFrom } from "./convert";
import { createFullPaid, VIA_AUTO, VIA_MANUAL } from "./full-paid";
import { buildChase } from "./ir-list";
import { irMoneyOf } from "./ir-money";
import { createReceiptMatch } from "../money/match";

const P = "9007199254";
const FIN = "9007199254740990901", IR = "9007199254740990902";
const LEAD = "9007199254740991001", LLP = "9007199254740991002", CONTACT = "9007199254740991003", ALLOT = "9007199254740991004";
const R1 = "9007199254740991011", R2 = "9007199254740991012", NOTE = "9007199254740991021";
const NOW = Date.parse("2026-10-09T06:30:00Z");   // 12:00 IST
const MT = "2026-10-09T11:00:00+05:30";
const SID = "session_fixture_d137_0001";
const FULL_UTR = "SYNTHUTRD137000123456";
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: FIN, status: "active" }] }), { status: 200 }) } as never);
});
const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
const bad = (kind: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { kind, status: 400, ...extra }, creditsRemaining: null });
const page = (records: unknown[]) => ok({ records, moreRecords: false });
const made = (id: string) => ok([{ index: 0, ok: true, id, code: "SUCCESS", field: null, action: null }]);

type Call = [string, string, unknown?];
/** A Zoho double: `state` drives the answers; every call is kept. */
function double(o: { receipts?: Record<string, unknown>[]; contact?: boolean; leadMissing?: boolean; noLeadField?: boolean; originatingIrRefused?: boolean;
  allot?: Record<string, unknown> | null; noConverted?: boolean; noMatchedAt?: boolean } = {}) {
  const calls: Call[] = [];
  const st = { receipts: [...(o.receipts ?? [])], contact: o.contact ? CONTACT : null as string | null, allot: o.allot === undefined ? null : o.allot };
  const crm = {
    async getRecord(_c: unknown, module: string, id: string) {
      calls.push(["GET", `${module}/${id}`]);
      if (module === "Leads") return o.leadMissing ? bad("forbidden") : ok({ id, First_Name: "Synth", Last_Name: "Investor D137", Email: "synth.d137@example.invalid",
        Mobile: "+91 90000 00137", Owner: { id: IR }, Units_Interested: 10, Said_Yes_At: "2026-10-01T10:00:00+05:30" });
      if (module === "LLP_Creation_Module") return ok({ id, Name: "Synthetic Farm", Pet_Unit_Price: 100_000, LLP_Status: "Open for Reservation" });
      if (module === "LLP_UnitAllocation_Module") return st.allot ? ok({ id, ...st.allot }) : ok(null);
      if (module === "Receipts") return ok(st.receipts.find((r) => r.id === id) ?? null);
      return ok(null);
    },
    async coql(_c: unknown, q: string) {
      calls.push(["COQL", q]);
      if (/from Receipts where Lead = /.test(q)) return o.noLeadField ? bad("invalid-data", { field: "Lead" }) : page(st.receipts.filter((r) => (r.Lead as { id: string } | undefined)?.id === LEAD));
      if (/from Receipts where Allotment/.test(q)) return o.noMatchedAt && /Matched_At/.test(q) ? bad("invalid-data", { field: "Matched_At" }) : page(st.receipts.filter((r) => (r.Allotment as { id: string } | undefined)?.id === ALLOT));
      if (/from Receipts where UTR = /.test(q)) return page(st.receipts.filter((r) => q.includes(String(r.UTR))));
      if (/from Contacts where Origin_Lead = /.test(q)) return page(st.contact ? [{ id: st.contact, ARL_ID: "ARL-INV-0137" }] : []);
      if (/from Contacts where ARL_ID like/.test(q)) return page([{ ARL_ID: "ARL-INV-0136" }]);
      if (/select id, LLP, Allocation_Status, Hold_Until from LLP_UnitAllocation_Module where Customer/.test(q)) return page(st.allot ? [{ id: ALLOT, LLP: { id: LLP }, Allocation_Status: "Reserved", Hold_Until: "2026-11-08" }] : []);
      if (/Converted_At, Converted_By, Converted_Via from LLP_UnitAllocation_Module/.test(q)) return o.noConverted ? bad("invalid-data", { field: "Converted_At" }) : page([]);
      throw new Error("unexpected query " + q);
    },
    async insert(_c: unknown, module: string, records: Record<string, unknown>[]) {
      const r = records[0]!;
      calls.push(["POST", module, r]);
      if (module === "Receipts") {
        if (o.noMatchedAt && "Matched_At" in r) return bad("invalid-data", { records: [{ index: 0, ok: false, id: null, code: "INVALID_DATA", field: "Matched_At", action: null }] });
        const id = st.receipts.length ? R2 : R1;
        st.receipts.push({ id, ...r, Modified_Time: MT });
        return made(id);
      }
      if (module === "Contacts") {
        if (o.originatingIrRefused && "Originating_IR" in r) return bad("invalid-data", { records: [{ index: 0, ok: false, id: null, code: "INVALID_DATA", field: "Originating_IR", action: null }] });
        st.contact = CONTACT; return made(CONTACT);
      }
      if (module === "LLP_UnitAllocation_Module") { st.allot = { ...r, Modified_Time: MT }; return made(ALLOT); }
      if (module === "Notes") return made(NOTE);
      throw new Error("unexpected insert " + module);
    },
    async update(_c: unknown, module: string, id: string, fields: Record<string, unknown>, opts: { ifUnmodifiedSince: string | null }) {
      calls.push(["PUT", `${module}/${id}`, { fields, ius: opts.ifUnmodifiedSince }]);
      if (module === "LLP_UnitAllocation_Module" && o.noConverted && "Converted_At" in fields) return bad("invalid-data", { field: "Converted_At" });
      if (module === "Receipts") { const r = st.receipts.find((x) => x.id === id); if (r) Object.assign(r, fields); }
      if (module === "LLP_UnitAllocation_Module" && st.allot) Object.assign(st.allot, fields);
      return ok({ id, modifiedTime: MT });
    },
    async deleteRecord(_c: unknown, module: string, id: string) { calls.push(["DELETE", `${module}/${id}`]); return ok({ id }); },
  };
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const planeC: unknown[][] = [];
  const events = { investorConverted: (...x: unknown[]) => { planeC.push(x); } };
  return { crm: crm as never, calls, st, sink, log, planeC, events };
}
const finance = { async mayConfirm() { return true; }, async mayRead() { return true; } };
const oversell = { async check() { return { ok: true as const, llp: {} as never, held: 0, free: 100 }; } };
const principal = () => ({ credential: cred, sessionId: SID, seat: "fin-ops" });
const receipt = (amount: number, kind = "Part", utr = FULL_UTR) => ({ kind, amount, mode: "NEFT", utr, receivedOn: "2026-10-08" });
const leadReceipt = (id: string, amount: number, kind = "Part") =>
  ({ id, Lead: { id: LEAD }, Kind: kind, Amount: amount, UTR: "SYNTHUTR" + id.slice(-4), Received_On: "2026-10-05", Match_State: "Matched", Matched_By: { id: FIN }, Matched_At: "2026-10-05T10:00:00+05:30", Modified_Time: MT });

describe("GC-1527 — the investor is created only after Finance confirms the 10%", () => {
  it("under 10%: the receipt is recorded matched on the lead, nothing else is created; the trail says what is still to go", async () => {
    const d = double();
    const conv = createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, events: d.events, recordIdPrefix: P, clock: () => NOW });
    const r = await conv.confirm(principal(), LEAD, { receipt: receipt(40_000), terms: { llpId: LLP, units: 10 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.converted).toBeNull();
    expect(r.value.money.trail).toMatchObject({ committed: 1_000_000, threshold: 100_000, matched: 40_000, reached: false });
    const posts = d.calls.filter((c) => c[0] === "POST");
    expect(posts.map((c) => c[1])).toEqual(["Receipts"]);
    expect(posts[0]![2]).toMatchObject({ Lead: { id: LEAD }, Kind: "Part", Amount: 40_000, Match_State: "Matched", Matched_By: { id: FIN }, Matched_At: "2026-10-09T12:00:00+05:30" });
    expect(r.value.recorded?.refMasked).toBe("••• 3456");
    expect(JSON.stringify(r)).not.toContain(FULL_UTR);
    expect(JSON.stringify(d.sink.records())).not.toContain(FULL_UTR);
    expect(JSON.stringify(d.sink.records())).not.toContain("synth.d137@example.invalid");
  });

  it("two Parts reaching 10%: the Contact (Origin_Lead, Originating_IR, App_Access Hold), the Reserved allotment (Hold_Until +30 d) and the receipts linked — on Finance's token", async () => {
    const d = double({ receipts: [leadReceipt(R1, 60_000)] });
    const conv = createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, events: d.events, recordIdPrefix: P, clock: () => NOW });
    const r = await conv.confirm(principal(), LEAD, { receipt: receipt(50_000), terms: { llpId: LLP } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.converted).toMatchObject({ contactId: CONTACT, code: "ARL-INV-0137", allotmentId: ALLOT, holdUntil: holdFrom(NOW), relinked: 2, originatingIr: "written", already: false });
    expect(holdFrom(NOW)).toBe("2026-11-08");
    const contact = d.calls.find((c) => c[0] === "POST" && c[1] === "Contacts")![2];
    expect(contact).toMatchObject({ First_Name: "Synth", Last_Name: "Investor D137", ARL_ID: "ARL-INV-0137", App_Access: "Hold", Origin_Lead: { id: LEAD }, Originating_IR: { id: IR } });
    const allot = d.calls.find((c) => c[0] === "POST" && c[1] === "LLP_UnitAllocation_Module")![2];
    expect(allot).toMatchObject({ Customer: { id: CONTACT }, LLP: { id: LLP }, Allocation_Status: "Reserved", Reserved_Units: 10, Unit_Price: 100_000, Hold_Until: "2026-11-08" });
    const links = d.calls.filter((c) => c[0] === "PUT" && String(c[1]).startsWith("Receipts/"));
    expect(links.map((c) => (c[2] as { fields: unknown }).fields)).toEqual([{ Allotment: { id: ALLOT } }, { Allotment: { id: ALLOT } }]);
    expect(d.planeC).toEqual([[FIN, "fin-ops", [LEAD, CONTACT, ALLOT], "ok", "ten-percent-confirmed"]]);
  });

  it("not reached and no receipt in the press: refused, nothing written", async () => {
    const d = double({ receipts: [leadReceipt(R1, 40_000)] });
    const conv = createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, recordIdPrefix: P, clock: () => NOW });
    const r = await conv.confirm(principal(), LEAD, { terms: { llpId: LLP, units: 10 } });
    expect(r).toMatchObject({ ok: false, reasonCode: "ten-percent-not-reached" });
    expect(d.calls.filter((c) => c[0] !== "GET" && c[0] !== "COQL")).toEqual([]);
  });

  it("resumable: a second press after the Contact exists reuses it and the allotment, and answers already", async () => {
    const d = double({ receipts: [leadReceipt(R1, 120_000)], contact: true, allot: { Customer: { id: CONTACT }, LLP: { id: LLP }, Allocation_Status: "Reserved" } });
    const conv = createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, events: d.events, recordIdPrefix: P, clock: () => NOW });
    const r = await conv.confirm(principal(), LEAD, { terms: { llpId: LLP, units: 10 } });
    expect(r.ok && r.value.converted).toMatchObject({ contactId: CONTACT, allotmentId: ALLOT, already: true, relinked: 1 });
    expect(d.calls.filter((c) => c[0] === "POST")).toEqual([]);
    expect(d.planeC).toEqual([]);
  });

  it("Originating_IR refused for Finance (D122): the Contact is written without it and the answer says so", async () => {
    const d = double({ receipts: [leadReceipt(R1, 100_000, "Advance")], originatingIrRefused: true });
    const conv = createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, recordIdPrefix: P, clock: () => NOW });
    const r = await conv.confirm(principal(), LEAD, { terms: { llpId: LLP, units: 10 } });
    expect(r.ok && r.value.converted?.originatingIr).toBe("not-written");
    const contacts = d.calls.filter((c) => c[0] === "POST" && c[1] === "Contacts");
    expect(contacts.length).toBe(2);
    expect(contacts[1]![2]).not.toHaveProperty("Originating_IR");
  });

  it("degrades: no Receipts.Lead field → fields-missing; lead not shared → lead-not-visible; not Finance → refused before any read", async () => {
    let d = double({ noLeadField: true });
    let r = await createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, recordIdPrefix: P, clock: () => NOW }).trail(principal(), LEAD);
    expect(r).toMatchObject({ ok: false, reasonCode: "fields-missing" });
    d = double({ leadMissing: true });
    r = await createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, recordIdPrefix: P, clock: () => NOW }).trail(principal(), LEAD);
    expect(r).toMatchObject({ ok: false, reasonCode: "lead-not-visible" });
    d = double();
    r = await createConversion({ crm: d.crm, oversell, authority: { async mayConfirm() { return false; } }, log: d.log, recordIdPrefix: P, clock: () => NOW })
      .confirm(principal(), LEAD, { receipt: receipt(1) });
    expect(r).toMatchObject({ ok: false, reasonCode: "not-finance" });
    expect(d.calls).toEqual([]);
  });

  it("Receipts.Matched_At missing: the lead receipt is recorded without it", async () => {
    const d = double({ noMatchedAt: true });
    const r = await createConversion({ crm: d.crm, oversell, authority: finance, log: d.log, recordIdPrefix: P, clock: () => NOW }).confirm(principal(), LEAD, { receipt: receipt(10_000) });
    expect(r.ok).toBe(true);
    const posts = d.calls.filter((c) => c[0] === "POST" && c[1] === "Receipts");
    expect(posts.length).toBe(2);
    expect(posts[1]![2]).not.toHaveProperty("Matched_At");
  });
});

describe("D137 ruling 3 — full conversion", () => {
  /* D138: the supplementary is signed and verified here — without it no stamp is written (d138.test.ts) */
  const reservedAllot = { Customer: { id: CONTACT }, LLP: { id: LLP }, Allocation_Status: "Reserved", Reserved_Units: 10, Issued_Units: 0, Unit_Price: 100_000,
    Supplementary_Verified_At: MT, Modified_Time: MT };
  const onAllot = (id: string, amount: number, kind = "Part") => ({ ...leadReceipt(id, amount, kind), Allotment: { id: ALLOT } });

  it("auto: matched money covering units × price stamps Converted_At / _By (the matcher) / _Via 'Finance match', guarded", async () => {
    const d = double({ allot: { ...reservedAllot }, receipts: [onAllot(R1, 100_000, "Advance"), onAllot(R2, 900_000)] });
    const fp = createFullPaid({ crm: d.crm, log: d.log, events: d.events, recordIdPrefix: P, clock: () => NOW });
    expect(await fp.auto(cred, ALLOT)).toEqual({ ok: true, value: "converted", code: null });
    const put = d.calls.find((c) => c[0] === "PUT")!;
    expect(put[2]).toEqual({ fields: { Converted_At: "2026-10-09T12:00:00+05:30", Converted_By: { id: FIN }, Converted_Via: VIA_AUTO }, ius: MT });
    expect(d.planeC).toEqual([[FIN, null, [ALLOT, CONTACT], "ok", "fully-paid-auto"]]);
  });
  it("auto: short of the committed amount → not-yet, nothing written; fields missing → fields-missing, reported", async () => {
    let d = double({ allot: { ...reservedAllot }, receipts: [onAllot(R1, 100_000, "Advance")] });
    expect(await createFullPaid({ crm: d.crm, log: d.log, recordIdPrefix: P }).auto(cred, ALLOT)).toEqual({ ok: true, value: "not-yet", code: null });
    expect(d.calls.some((c) => c[0] === "PUT")).toBe(false);
    d = double({ allot: { ...reservedAllot }, receipts: [onAllot(R1, 1_000_000, "Full")], noConverted: true });
    expect(await createFullPaid({ crm: d.crm, log: d.log, recordIdPrefix: P }).auto(cred, ALLOT)).toEqual({ ok: false, value: null, code: "fields-missing" });
  });
  it("manual: Finance / DI with a reason — the Note first (under their name), then Converted_Via 'Manual'; a short reason or another seat is refused", async () => {
    const d = double({ allot: { ...reservedAllot }, receipts: [] });
    const fp = createFullPaid({ crm: d.crm, log: d.log, events: d.events, recordIdPrefix: P, clock: () => NOW, authority: { async mayMarkManually() { return true; } } });
    const r = await fp.manual({ ...principal(), seat: "di" }, ALLOT, "  Paid by demand draft, cleared  ", MT, undefined, CONTACT);
    expect(r.ok).toBe(true);
    expect(d.calls.filter((c) => c[0] !== "GET" && c[0] !== "COQL").map((c) => c[0] + " " + c[1])).toEqual(["POST Notes", `PUT LLP_UnitAllocation_Module/${ALLOT}`]);
    expect((d.calls.find((c) => c[0] === "PUT")![2] as { fields: Record<string, unknown> }).fields.Converted_Via).toBe(VIA_MANUAL);
    expect(d.planeC).toEqual([[FIN, "di", [ALLOT, CONTACT], "ok", "fully-paid-manual"]]);
    expect(JSON.stringify(d.sink.records())).not.toContain("demand draft");
    expect(await fp.manual(principal(), ALLOT, "short", MT)).toMatchObject({ ok: false, reasonCode: "reason-short" });
    expect(await fp.manual(principal(), ALLOT, "a long enough reason here", MT, undefined, "9007199254740999999")).toMatchObject({ ok: false, reasonCode: "not-visible" });
    const no = createFullPaid({ crm: double().crm, log: d.log, recordIdPrefix: P, authority: { async mayMarkManually() { return false; } } });
    expect(await no.manual(principal(), ALLOT, "a long enough reason here", MT)).toMatchObject({ ok: false, reasonCode: "not-allowed" });
  });
});

describe("money/match — D137: Matched_At on the match, and the automatic full conversion", () => {
  it("writes Matched_At (retrying without it when Zoho lacks the field) and runs full-paid auto after an inbound match", async () => {
    const receiptRow = { id: R1, Allotment: { id: ALLOT }, Kind: "Part", Amount: 900_000, Match_State: "Pending", Created_By: { id: FIN }, Modified_Time: MT };
    const puts: Record<string, unknown>[] = [];
    let autoCalled = "";
    const crm = {
      async getRecord(_c: unknown, module: string) {
        if (module === "Receipts") return ok(receiptRow);
        if (module === "LLP_UnitAllocation_Module") return ok({ id: ALLOT, Allocation_Status: "Reserved", Customer: { id: CONTACT }, LLP: { id: LLP }, Supplementary_Verified_At: MT, Modified_Time: MT });
        return ok(null);
      },
      async coql() { return page([]); },
      async update(_c: unknown, module: string, id: string, fields: Record<string, unknown>) {
        if (module === "Receipts") { puts.push(fields); if ("Matched_At" in fields) return bad("invalid-data", { field: "Matched_At" }); }
        return ok({ id, modifiedTime: MT });
      },
    };
    const m = createReceiptMatch({
      crm: crm as never, writes: { async paymentStatus() { return { ok: false } as never; } }, authority: { async mayMatch() { return true; } },
      publish: async () => ({ ok: true, eventId: "e" }), log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
      fullPaid: { async auto(_c, a) { autoCalled = a; return { ok: true, value: "converted", code: null }; } },
    });
    const r = await m.match({ credential: cred, sessionId: SID }, R1);
    expect(r.ok).toBe(true);
    expect(puts).toEqual([
      { Match_State: "Matched", Matched_By: { id: FIN }, Matched_At: "2026-10-09T12:00:00+05:30" },
      { Match_State: "Matched", Matched_By: { id: FIN } },
    ]);
    expect(autoCalled).toBe(ALLOT);
    expect(r.ok && r.value.converted).toEqual({ ok: true, value: "converted", code: null });
  });
});

describe("ir-list buildChase — the IR's balance to-do (D137 ruling 3)", () => {
  const contact = { id: CONTACT, code: "ARL-INV-0137", firstName: "Synth", lastName: "Investor", originLeadId: LEAD } as never;
  const allot = (id: string, holdUntil: string | null) => ({ id, Customer: CONTACT, LLP_Lookup: LLP, Committed_Units: 10, Allocation_Status: "Reserved", holdUntil }) as never;
  const farms = new Map([[LLP, { name: "Synthetic Farm", block: "S" }]]);
  it("lists Reserved allotments with the deadline and days left; drops converted ones and ones Zoho says owe nothing", () => {
    const money = (receivable: number, received: number) => irMoneyOf({ id: "x", Total_Amount_Receivable: receivable, Total_Amount_Received: received }, ["Total_Amount_Receivable", "Total_Amount_Received"]);
    const rows = buildChase([contact], [allot(ALLOT, "2026-10-20"), allot(R1, null), allot(R2, "2026-10-12")], farms, new Map([[R1, {}]]),
      new Map([[ALLOT, money(1_000_000, 100_000)], [R2, money(1_000_000, 1_000_000)]]), NOW);
    expect(rows).toEqual([{ contactId: CONTACT, code: "ARL-INV-0137", name: "Synth Investor", leadId: LEAD, allotmentId: ALLOT, farm: "Synthetic Farm", units: 10,
      holdUntil: "2026-10-20", daysLeft: 11, due: 900_000, fromDay: "2026-09-20", extendedBy: 0 }]);
  });
  it("the amount is null when Zoho hides it from the IR (field-level security)", () => {
    expect(buildChase([contact], [allot(ALLOT, "2026-10-20")], farms, new Map(), null, NOW)[0]!.due).toBeNull();
  });
});
