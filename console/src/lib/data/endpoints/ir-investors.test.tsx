/* M09-S08 — an IR sees only investors from their own leads (D69, D113 ruling 2): the endpoints' fixture half, the rail, the reducer. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, imReducer, type ImState } from "@/lib/im";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { navFor, sidesOf, canReach } from "@/lib/selectors";
import { IR_SECTIONS } from "@/server/investors/record";
import { irInvestorList, investorRecord } from "./investors";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const ok = <T,>(r: { ok: boolean } & Record<string, unknown>): T => { if (!r.ok) throw new Error(String(r.error)); return r.data as T; };
type Row = { id: string; code: string; name: string; farms: { block: string; units: number }[]; state: string; leadId: string | null };
type Rec = { record: { sections: string[]; money: unknown; paper: unknown; kyc: unknown; holdings: Record<string, unknown>[]; investor: Record<string, unknown> } };

/* what an IR must never be sent, as key names anywhere in an answer and as the book's own values for the investor */
const NEVER = /price|amount|yield|receipt|paid|due|ticket|utr|capital|pan|aadh|aref|bank|ifsc|kyc|nominee|addr|fema/i;
const keysOf = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach(x => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
  return out;
};

describe("M09-S08-W1 — the IR's list (GET /api/investors/mine)", () => {
  it("path: only an IR reads it", () => {
    expect(irInvestorList.path(true)).toBe("/api/investors/mine");
    expect(irInvestorList.path(false)).toBeNull();
  });
  it("AC1: Rohit's list is his five own-lead investors, by name, in the NOTE-3 columns only", () => {
    const rows = ok<{ rows: Row[] }>(irInvestorList.fixture({ s: demo(), me: "rohit" }, true)).rows;
    expect(rows.map(r => r.code)).toEqual(["ARL-INV-0206", "ARL-INV-0215", "ARL-INV-0208", "ARL-INV-0212", "ARL-INV-0218"]);
    const prakash = rows.find(r => r.code === "ARL-INV-0208")!;
    expect(prakash).toMatchObject({ name: "Prakash Bhat", state: "reserved", leadId: "L6", farms: [{ block: "B", units: 1 }] });
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["code", "farms", "id", "leadId", "name", "state"]);
  });
  it("AC2: Kavya's list holds none of Rohit's, and the reverse", () => {
    const s = demo();
    const rohit = ok<{ rows: Row[] }>(irInvestorList.fixture({ s, me: "rohit" }, true)).rows.map(r => r.id);
    const kavya = ok<{ rows: Row[] }>(irInvestorList.fixture({ s, me: "kavya" }, true)).rows.map(r => r.id);
    expect(kavya.length).toBeGreaterThan(0);
    expect(rohit.filter(id => kavya.includes(id))).toEqual([]);
    expect(s.data.INV.filter(x => x.ir === "kavya").map(x => x.id).sort()).toEqual([...kavya].sort());
  });
  it("AC4: no price, amount, yield, receipt, KYC or identity name anywhere in the rows", () => {
    const a = ok<{ rows: unknown; chase?: { due: number | null }[]; dueReadable?: boolean }>(irInvestorList.fixture({ s: demo(), me: "rohit" }, true));
    expect(keysOf(a.rows).filter(k => NEVER.test(k))).toEqual([]);
    expect(JSON.stringify(a.rows)).not.toMatch(/₹|\d{6,}/);
    /* D137 ruling 3: the balance to-do may carry the amount due ONLY where Zoho's field security shows it to the IR (open question
       1 vs D69); the demo book holds none, so every `due` is null and dueReadable false */
    expect(a.dueReadable).toBe(false);
    expect((a.chase ?? []).every(c => c.due === null)).toBe(true);
    expect(keysOf(a.chase ?? []).filter(k => NEVER.test(k) && k !== "due")).toEqual([]);
  });
  it("a seat on the Investors side is refused: the list is an IR's own", () => {
    expect(irInvestorList.fixture({ s: demo(), me: "harsha" }, true)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M09-S08-W1 — the record an IR opens (GET /api/investors/[id]/record)", () => {
  it("Rohit opens Prakash: who, hold and journey only — the same sections the route sends an IR", () => {
    const s = demo();
    const rec = ok<Rec>(investorRecord.fixture({ s, me: "rohit" }, "ARL-INV-0208")).record;
    expect(rec.sections).toEqual([...IR_SECTIONS]);
    expect([rec.money, rec.paper, rec.kyc]).toEqual([null, null, null]);
    expect(rec.holdings).toHaveLength(1);
    expect(keysOf(rec.holdings).filter(k => /price|amount|yield|paymentStatus$/i.test(k) && rec.holdings.some(h => h[k] != null))).toEqual([]);
  });
  it("AC4: the investor object is scrubbed to what the route's IR projection carries", () => {
    const s = demo();
    const book = s.data.INV.find(x => x.id === "ARL-INV-0208")!;
    expect(book.pan || book.aadh || book.bank.acct).toBeTruthy();   /* the demo book does hold them */
    const x = ok<Rec>(investorRecord.fixture({ s, me: "rohit" }, "ARL-INV-0208")).record.investor;
    expect([x.pan, x.aadh, x.aref, x.addr, x.nominee, x.kycOn]).toEqual([null, null, null, "", "", null]);
    expect(x.bank).toEqual({ acct: "", ifsc: "", name: "", drop: "" });
    expect(JSON.stringify(x)).not.toContain(book.pan!);
  });
  it("AC2: another IR's investor does not open — refused, nothing returned", () => {
    expect(investorRecord.fixture({ s: demo(), me: "rohit" }, "ARL-INV-0209")).toMatchObject({ ok: false, status: 404, code: "not-visible" });
    expect(investorRecord.fixture({ s: demo(), me: "rohit" }, "ARL-INV-9999")).toMatchObject({ ok: false, status: 404 });
    expect(investorRecord.fixture({ s: demo(), me: "kavya" }, "ARL-INV-0209")).toMatchObject({ ok: true });
  });
  it("the Investors side's own record is unchanged for a seated person", () => {
    const rec = ok<Rec>(investorRecord.fixture({ s: demo(), me: "harsha" }, "ARL-INV-0208")).record;
    expect(rec.sections).toContain("money");
  });
});

describe("M09-S08 — the rail and the page's navigation", () => {
  const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
  it("an IR's rail carries Investors between Events and Payments, as an Investors-half entry", () => {
    const r = as("rohit");
    const keys = navFor(r).map(n => n.k);
    expect(keys).toEqual(["today", "leads", "activity", "events", "inv", "pay", "docs", "updates"]);   /* updates is the bell, not a rail row */
    expect(keys.indexOf("inv")).toBe(keys.indexOf("events") + 1);
    expect(sidesOf(r, "inv")).toEqual({ ir: false, im: true });
    expect(canReach(r, "inv" as never)).toBe(true);
    expect(canReach(r, "farms" as never) || canReach(r, "tkt" as never) || canReach(r, "invupd" as never)).toBe(false);
  });
  it("the IR Manager, a channel partner and Sahil's lead side are unchanged (Sahil reaches Investors by his own seat)", () => {
    expect(canReach(as("tasneem"), "inv" as never)).toBe(false);
    expect(canReach(as("sahil"), "inv" as never)).toBe(true);
    expect(sidesOf(as("sahil"), "inv").im).toBe(true);
  });
  it("the reducer lets an IR open and leave the Investors page, and no other Investors page", () => {
    const s = demo();
    expect(imReducer(s, "rohit", { type: "go", v: "inv", id: "ARL-INV-0208" }).ui.SEL).toBe("ARL-INV-0208");
    expect(imReducer({ data: s.data, ui: { ...s.ui, SEL: "ARL-INV-0208" } }, "rohit", { type: "go", v: "inv", id: null }).ui.SEL).toBeNull();
    expect(imReducer(s, "rohit", { type: "go", v: "txn", id: undefined }).ui.VIEW).toBe(s.ui.VIEW);   /* no other Investors page */
  });
});
