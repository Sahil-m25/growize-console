/* M11-S07-W2 — the receipt drawer's Record it through the oversell rule (TC-IM06-012): the fixture half refuses what the live
   half would (an allotment's units claim on a full block), and still records money against an existing reservation (D21). */
import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImInvestor, type ImState } from "@/lib/im";
import { runWrite } from "../api";
import { receiptRecord, type RecordArgs } from "./claims";

const prepared = { preparedAt: 0, contextToken: "fixture", expected: {} as never, amountDueRupees: 0, matchable: true, matchNote: null };
const args = (inv: string, kind: RecordArgs["kind"]): RecordArgs => ({ inv, allotmentId: null, kind, mode: "RTGS", ref: "UTR9", prepared });

function kiranOnFullBlockB(): ImState {
  const data = imDemoData();
  data.FARMS.find(f => f.k === "B")!.released = 11;
  data.INV.push({ id: "ARL-INV-0220", n: "Kiran Rao", ph: "+91 90000 11220", em: "kiran.rao@gmail.com", city: "Bengaluru", addr: "1, MG Road", nri: false,
    pan: "AKRPR1234K", aadh: "1111", aref: "UIDAI-2508-100220", kyc: "passed", kycOn: "01 Sep", bank: { acct: "50100000220220", ifsc: "HDFC0000001", name: "KIRAN RAO", drop: "matched" },
    units: 2, blocks: { B: 2 }, st: "new" as ImInvestor["st"], ir: "rohit", src: "Events", since: "01 Sep", nominee: "—" } as ImInvestor);
  return { data, ui: initialImUi() };
}

describe("receiptRecord — fixture half", () => {
  it("refuses the advance that would take Block B below zero, naming Block B, the investor and the units; the reducer's note carries the same words", async () => {
    const s = kiranOnFullBlockB(), seen: ImAction[] = [];
    const r = await runWrite("fixture", receiptRecord, { s, me: "meena" }, (a: ImAction) => seen.push(a), args("ARL-INV-0220", "advance"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Block B has no free units for Kiran Rao's 2 units.");
    expect(seen.map(a => a.type)).toEqual(["recordPay"]);
  });
  it("records money against an investor who already holds units (D21)", async () => {
    const s = kiranOnFullBlockB();
    const held = s.data.INV.find(x => x.st === "reserved")!;
    const r = await runWrite("fixture", receiptRecord, { s, me: "meena" }, () => {}, args(held.id, "balance"));
    expect(r.ok).toBe(true);
  });
});
