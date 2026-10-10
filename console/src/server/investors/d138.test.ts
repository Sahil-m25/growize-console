/* D138 (owner rulings 10 Oct 2026) — on a scripted Zoho double. Synthetic ids, names and words only; no real investor data.
 *   B-10  the IR's rupee figures come only from Zoho on the IR's own token, per field (./ir-money), never the prototype UNIT
 *   G4    the 30-day balance deadline says which day it counts from (lib/money/balance-clock), the writers' own anchor
 *   Q1    no full conversion (auto or manual) before the signed supplementary — 409 supplementary-not-signed
 *   Q3    a KAM can NOT stamp fully paid; the KAM asks Finance (./full-paid-request) and Finance's to-do lists it
 *   D136  Leads.NDA_Requested_By and LLP_UnitAllocation_Module.Unit_Cert_Verified_By (deleted 10 Oct) are named nowhere
 * Run: npx vitest run src/server/investors/d138.test.ts */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { userCredential, type UserCredential } from "@/lib/zoho/client";
import { createMemorySink, createOpsLog } from "@/lib/zoho/log";
import { BALANCE_DAYS, balanceClock, balanceDueFor, balanceDueText, shortDay } from "@/lib/money/balance-clock";
import { createFullPaid, SUPPLEMENTARY_NOT_SIGNED_TEXT } from "./full-paid";
import { createFullPaidRequest, REQUEST_FIELD, REQUEST_NOTE_TITLE } from "./full-paid-request";
import { buildChase } from "./ir-list";
import { irMoneyOf, readIrMoney, IR_MONEY_FIELDS } from "./ir-money";
import { HOLD_DAYS as CONVERT_HOLD_DAYS, holdFrom } from "./convert";
import { HOLD_DAYS as MATCH_HOLD_DAYS, holdUntilFrom } from "../money/match";
import { gateMet, SUPPLEMENTARY_HELD_TEXT, type GateFacts } from "../leads/gates";
import { confirmText } from "../queues/rules";

const P = "9007199254";
const KAM = "9007199254740990903", FIN = "9007199254740990901";
const LLP = "9007199254740991002", CONTACT = "9007199254740991003", ALLOT = "9007199254740991004", ALLOT2 = "9007199254740991005";
const NOTE = "9007199254740991021", LEAD = "9007199254740991001";
const NOW = Date.parse("2026-10-10T06:30:00Z");   // 12:00 IST
const MT = "2026-10-10T11:00:00+05:30";
const SID = "session_fixture_d138_0001";
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred: UserCredential;
beforeAll(async () => {
  cred = await userCredential({ access_token: "synthetic-token-never-live", api_domain: "https://www.zohoapis.in", expires_in: 3_600 },
    { recordIdPrefix: P, gate: gate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: KAM, status: "active" }] }), { status: 200 }) } as never);
});
const ok = <T>(value: T) => ({ ok: true as const, value, status: 200, creditsRemaining: null });
const bad = (kind: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { kind, status: 400, ...extra }, creditsRemaining: null });
const page = (records: unknown[]) => ok({ records, moreRecords: false });
const made = (id: string) => ok([{ index: 0, ok: true, id, code: "SUCCESS", field: null, action: null }]);

describe("G4 — the balance deadline says which day it counts from (rule 9)", () => {
  it("30 days back from Hold_Until is the day Finance confirmed the 10%; the sentence names both days", () => {
    const c = balanceClock("2026-11-09")!;
    expect(c).toEqual({ dueDay: "2026-11-09", fromDay: "2026-10-10", extendedBy: 0 });
    expect(balanceDueText(c)).toBe("Balance due 9 Nov — 30 days from Finance confirming the 10% on 10 Oct");
    expect(shortDay("2026-03-01")).toBe("1 Mar");
  });
  it("is the inverse of the two writers' anchor (convert holdFrom, match holdUntilFrom): both start the 30 days at Finance's confirmation", () => {
    expect(BALANCE_DAYS).toBe(CONVERT_HOLD_DAYS);
    expect(BALANCE_DAYS).toBe(MATCH_HOLD_DAYS);
    for (const at of [NOW, Date.parse("2026-12-31T20:00:00Z") /* 1 Jan IST */, Date.parse("2026-02-28T19:00:00Z")]) {
      const istDay = new Date(at + 5.5 * 3_600_000).toISOString().slice(0, 10);
      expect(balanceClock(holdFrom(at))!.fromDay).toBe(istDay);
      expect(balanceClock(holdUntilFrom(at))!.fromDay).toBe(istDay);
    }
  });
  it("an approved extension moves the start back by its days and says so; requested / declined / unreadable do not", () => {
    expect(balanceDueFor("2026-11-16", { state: "Approved", days: 7 })).toBe("Balance due 16 Nov — 30 days from Finance confirming the 10% on 10 Oct, extended by 7 days");
    expect(balanceClock("2026-11-16", { state: "Requested", days: 7 })!.fromDay).toBe("2026-10-17");
    expect(balanceClock("2026-11-16", { state: "Declined", days: 7 })!.extendedBy).toBe(0);
    expect(balanceDueFor(null)).toBe("");
    expect(balanceClock("not a day")).toBeNull();
  });
});

describe("B-10 — the IR's money read: Zoho's values on the IR's token, per field, nothing guessed", () => {
  it("selects the three money columns and the extension, no identity field", () => {
    expect([...IR_MONEY_FIELDS]).toEqual(["id", "Unit_Price", "Total_Amount_Receivable", "Total_Amount_Received", "Hold_Extension_State", "Hold_Extension_Days"]);
  });
  it("a column Zoho hides is dropped and the read repeats; what it hides stays null — the amount due needs both totals", async () => {
    const qs: string[] = [];
    const crm = { async coql(_c: unknown, q: string) {
      qs.push(q);
      if (q.includes("Total_Amount_Received")) return bad("invalid-data", { field: "Total_Amount_Received" });
      return page([{ id: ALLOT, Unit_Price: 100_000, Total_Amount_Receivable: 1_000_000, Hold_Extension_State: null }]);
    } };
    const m = await readIrMoney(crm as never, cred, [ALLOT]);
    expect(qs.length).toBe(2);
    expect(m!.get(ALLOT)).toEqual({ unitPrice: 100_000, receivable: 1_000_000, received: null, due: null, extension: { state: null, days: null } });
  });
  it("Zoho naming no column: each is probed alone and only the readable ones are kept", async () => {
    const crm = { async coql(_c: unknown, q: string) {
      const sel = q.split(" from ")[0]!;
      if (/Hold_Extension/.test(sel)) return bad("invalid-data");   // hidden from this IR, and Zoho does not say which
      return page([{ id: ALLOT, Unit_Price: 100_000, Total_Amount_Receivable: 1_000_000, Total_Amount_Received: 100_000 }]);
    } };
    const m = await readIrMoney(crm as never, cred, [ALLOT]);
    expect(m!.get(ALLOT)).toEqual({ unitPrice: 100_000, receivable: 1_000_000, received: 100_000, due: 900_000, extension: { state: null, days: null } });
  });
  it("a failed read is null (no amount shown); the chase row then carries due null, never a figure", async () => {
    const crm = { async coql() { return bad("server"); } };
    expect(await readIrMoney(crm as never, cred, [ALLOT])).toBeNull();
    const contact = { id: CONTACT, code: "ARL-INV-0138", firstName: "Synth", lastName: "Investor", originLeadId: LEAD } as never;
    const allot = { id: ALLOT, Customer: CONTACT, LLP_Lookup: LLP, Committed_Units: 10, Allocation_Status: "Reserved", holdUntil: "2026-11-09" } as never;
    const [row] = buildChase([contact], [allot], new Map(), new Map(), null, NOW);
    expect(row).toMatchObject({ due: null, fromDay: "2026-10-10", extendedBy: 0, daysLeft: 30 });
  });
  it("receivable − received where Zoho shows both; an approved extension reaches the chase row's start day", () => {
    const m = irMoneyOf({ id: ALLOT, Total_Amount_Receivable: 2_500_000, Total_Amount_Received: 250_000, Hold_Extension_State: "Approved", Hold_Extension_Days: 7 },
      ["Total_Amount_Receivable", "Total_Amount_Received", "Hold_Extension_State", "Hold_Extension_Days"]);
    expect(m.due).toBe(2_250_000);
    const contact = { id: CONTACT, code: "ARL-INV-0138", firstName: "Synth", lastName: "Investor", originLeadId: LEAD } as never;
    const allot = { id: ALLOT, Customer: CONTACT, LLP_Lookup: LLP, Committed_Units: 10, Allocation_Status: "Reserved", holdUntil: "2026-11-16" } as never;
    expect(buildChase([contact], [allot], new Map(), new Map(), new Map([[ALLOT, m]]), NOW)[0]).toMatchObject({ due: 2_250_000, fromDay: "2026-10-10", extendedBy: 7 });
  });
  it("no client or server file multiplies by the prototype's lead unit price for a figure on screen", () => {
    const root = join(__dirname, "..", "..");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) { if (f !== "node_modules") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\./.test(f)) continue;
        const src = readFileSync(p, "utf8");
        if (/from "@\/domain"|from "\.\.\/\.\.\/domain\/plan"/.test(src) && /\bUNIT\b(?!S)/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) && /import[^;]*\bUNIT\b[^;]*from "(?:@\/domain|\.\.\/\.\.\/domain\/plan)"/.test(src)) hits.push(p.slice(root.length));
      }
    };
    walk(join(root, "features")); walk(join(root, "server")); walk(join(root, "components"));
    /* what remains outside features/server/components is the BU plan's own target arithmetic (lib/selectors/plan), the demo
       book's fixtures and reducers (fixture mode only), and investor-copy's review flag — see D138 */
    expect(hits.filter((h) => !/features[\\/](people|pay)[\\/]reducer\.ts$/.test(h))).toEqual([]);
  });
});

describe("Q1 — no full conversion before the signed supplementary agreement", () => {
  const reserved = { Customer: { id: CONTACT }, LLP: { id: LLP }, Allocation_Status: "Reserved", Reserved_Units: 10, Issued_Units: 0, Unit_Price: 100_000, Modified_Time: MT };
  function zoho(allot: Record<string, unknown>) {
    const calls: string[] = [];
    const crm = {
      async getRecord(_c: unknown, module: string, id: string) { calls.push("GET " + module); return module === "LLP_UnitAllocation_Module" ? ok({ id, ...allot }) : ok(null); },
      async coql(_c: unknown, q: string) { calls.push("COQL"); return /from Receipts/.test(q) ? page([{ id: NOTE, Allotment: { id: ALLOT }, Kind: "Full", Amount: 1_000_000, Match_State: "Matched", Matched_By: { id: FIN }, Modified_Time: MT }]) : page([]); },
      async insert() { calls.push("POST"); return made(NOTE); },
      async update() { calls.push("PUT"); return ok({ id: ALLOT, modifiedTime: MT }); },
      async deleteRecord() { calls.push("DELETE"); return ok({ id: NOTE }); },
    };
    return { crm: crm as never, calls };
  }
  it("auto: money covering the commitment waits — waiting-supplementary, nothing written", async () => {
    const z = zoho({ ...reserved });
    expect(await createFullPaid({ crm: z.crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P }).auto(cred, ALLOT))
      .toEqual({ ok: true, value: "waiting-supplementary", code: "supplementary-not-signed" });
    expect(z.calls.filter((c) => c === "PUT" || c === "POST")).toEqual([]);
  });
  it("manual (Finance / DI): refused supplementary-not-signed before any Note; with the supplementary verified it stamps", async () => {
    let z = zoho({ ...reserved });
    const fp = (crm: never) => createFullPaid({ crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW, authority: { async mayMarkManually() { return true; } } });
    const r = await fp(z.crm).manual({ credential: cred, sessionId: SID, seat: "fin-ops" }, ALLOT, "Cleared by RTGS, statement checked", MT, undefined, CONTACT);
    expect(r).toMatchObject({ ok: false, reasonCode: "supplementary-not-signed", message: SUPPLEMENTARY_NOT_SIGNED_TEXT });
    expect(z.calls.filter((c) => c === "PUT" || c === "POST")).toEqual([]);
    z = zoho({ ...reserved, Supplementary_Verified_At: MT });
    expect((await fp(z.crm).manual({ credential: cred, sessionId: SID, seat: "fin-ops" }, ALLOT, "Cleared by RTGS, statement checked", MT, undefined, CONTACT)).ok).toBe(true);
    expect(z.calls.filter((c) => c === "PUT" || c === "POST")).toEqual(["POST", "PUT"]);
  });
  it("the lead's gate: full money without the supplementary does not open the balance (no Fully paid); the page says why", () => {
    const f: GateFacts = { contactId: CONTACT, allotmentIds: [ALLOT], amountRupees: 1_000_000, matchedRupees: 1_000_000, reported: false, notFound: false,
      holdUntil: "2026-11-09", ndaVerified: true, supplementaryVerified: false, moneyKnown: true };
    expect(gateMet("balance", f)).toBe(false);
    expect(gateMet("balance", { ...f, supplementaryVerified: true })).toBe(true);
    expect(SUPPLEMENTARY_HELD_TEXT).toMatch(/log a contact and add notes/);
  });
  it("the manual route refuses 409 and no longer admits a KAM", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "investors", "[id]", "full-paid", "route.ts"), "utf8");
    expect(src).toMatch(/"supplementary-not-signed": 409/);
    const seats = /MANUAL_SEATS[^=]*= new Set\(\[([^\]]*)\]\)/.exec(src)![1]!;
    expect(seats).not.toContain("key-account-manager");
    expect(seats).toContain("finance-operations");
  });
});

describe("Q3 — a KAM asks Finance to confirm the full payment", () => {
  const allot = { id: ALLOT, Customer: { id: CONTACT }, Allocation_Status: "Reserved", Supplementary_Verified_At: MT, Modified_Time: MT };
  function zoho(o: { allot?: Record<string, unknown>; noField?: boolean } = {}) {
    const calls: [string, string, unknown?][] = [];
    const row = { ...allot, ...(o.allot ?? {}) };
    const crm = {
      async getRecord(_c: unknown, module: string, id: string, opts: { fields: string[] }) {
        calls.push(["GET", module, opts.fields]);
        if (o.noField && opts.fields.includes(REQUEST_FIELD)) return bad("invalid-data", { field: REQUEST_FIELD });
        return ok(id === row.id ? row : null);
      },
      async insert(_c: unknown, module: string, records: Record<string, unknown>[]) { calls.push(["POST", module, records[0]]); return made(NOTE); },
      async update(_c: unknown, module: string, id: string, fields: Record<string, unknown>, opts: { ifUnmodifiedSince: string }) {
        calls.push(["PUT", `${module}/${id}`, { fields, ius: opts.ifUnmodifiedSince }]);
        return o.noField ? bad("invalid-data", { field: REQUEST_FIELD }) : ok({ id, modifiedTime: MT });
      },
      async deleteRecord(_c: unknown, module: string, id: string) { calls.push(["DELETE", `${module}/${id}`]); return ok({ id }); },
    };
    const sink = createMemorySink();
    return { crm: crm as never, calls, sink, log: createOpsLog(sink) };
  }
  const ask = (z: ReturnType<typeof zoho>, may = true) => createFullPaidRequest({ crm: z.crm, log: z.log, recordIdPrefix: P, clock: () => NOW, authority: { async mayRequest() { return may; } } });
  const kam = () => ({ credential: cred, sessionId: SID });
  const WORDS = "Investor says the balance went by RTGS yesterday";

  it("the KAM's note goes on the Contact under their name, then Convert_Requested_At (IST) on the allotment, guarded; the words never reach a log", async () => {
    const z = zoho();
    const r = await ask(z).request(kam(), ALLOT, WORDS, CONTACT);
    expect(r).toEqual({ ok: true, value: { allotmentId: ALLOT, contactId: CONTACT, requestedAt: "2026-10-10T12:00:00+05:30", already: false } });
    const writes = z.calls.filter((c) => c[0] !== "GET");
    expect(writes[0]).toEqual(["POST", "Notes", { Note_Title: REQUEST_NOTE_TITLE, Note_Content: WORDS, Parent_Id: { module: { api_name: "Contacts" }, id: CONTACT } }]);
    expect(writes[1]).toEqual(["PUT", `LLP_UnitAllocation_Module/${ALLOT}`, { fields: { [REQUEST_FIELD]: "2026-10-10T12:00:00+05:30" }, ius: MT }]);
    expect(z.calls.some((c) => c[0] === "PUT" && JSON.stringify(c[2]).includes("Converted_"))).toBe(false);
    expect(JSON.stringify(z.sink.records())).not.toContain("RTGS yesterday");
    /* the KAM's read selects no money field */
    for (const c of z.calls.filter((x) => x[0] === "GET")) expect(JSON.stringify(c[2])).not.toMatch(/Price|Amount|Receivable|Received|Receipt/);
  });
  it("refused: not a KAM; before the signed supplementary (409); not Reserved; already stamped; another investor's allotment; a short note", async () => {
    expect(await ask(zoho(), false).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "not-allowed" });
    let z = zoho({ allot: { Supplementary_Verified_At: null } });
    expect(await ask(z).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "supplementary-not-signed" });
    expect(z.calls.filter((c) => c[0] !== "GET")).toEqual([]);
    expect(await ask(zoho({ allot: { Allocation_Status: "Issued" } })).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "not-reserved" });
    expect(await ask(zoho({ allot: { Converted_At: MT } })).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "already-converted" });
    expect(await ask(zoho()).request(kam(), ALLOT, WORDS, "9007199254740999999")).toMatchObject({ ok: false, reasonCode: "not-visible" });
    expect(await ask(zoho()).request(kam(), ALLOT2, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "not-visible" });
    expect(await ask(zoho()).request(kam(), ALLOT, "too short", CONTACT)).toMatchObject({ ok: false, reasonCode: "note-short" });
    z = zoho({ allot: { [REQUEST_FIELD]: MT } });
    expect(await ask(z).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: true, value: { already: true } });
    expect(z.calls.filter((c) => c[0] !== "GET")).toEqual([]);
  });
  it("until Convert_Requested_At exists in Zoho: fields-missing, said, nothing written", async () => {
    const z = zoho({ noField: true });
    expect(await ask(z).request(kam(), ALLOT, WORDS, CONTACT)).toMatchObject({ ok: false, reasonCode: "fields-missing" });
    expect(z.calls.filter((c) => c[0] !== "GET")).toEqual([]);
  });
  it("Finance's to-do row words", () => {
    expect(confirmText(0)).toBe("Confirm the full payment — the KAM asked today");
    expect(confirmText(3)).toBe("Confirm the full payment — the KAM asked 3 days ago");
  });
});

describe("D136 note — the fields deleted in the sandbox on 10 Oct are named by no code or fixture", () => {
  it("no NDA_Requested_By and no Unit_Cert_Verified_By outside comments", () => {
    const root = join(__dirname, "..", "..", "..");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        if (f === "node_modules" || f === ".next") continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|js|cjs|mjs|json)$/.test(f) || p.endsWith("d138.test.ts")) continue;
        const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
        if (/NDA_Requested_By|Unit_Cert_Verified_By/.test(src)) hits.push(p.slice(root.length));
      }
    };
    walk(join(root, "src")); walk(join(root, "fixtures"));
    expect(hits).toEqual([]);
  });
});
