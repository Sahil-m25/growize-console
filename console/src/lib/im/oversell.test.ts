/* M11-S07 — the demo reducer's receipt path and the oversell rule (TC-IM06-012, D21). Fixture and live agree:
   money that OPENS a reservation is a units claim and is refused on a full block, in server/farms/oversell's words;
   money against a reservation that already exists is always recorded. */
import { describe, expect, it } from "vitest";
import { imReducer, oversellGate, recordPayGate } from "./index";
import type { ImInvestor } from "./types";
import { act, invOf, kit } from "./test-kit";

/** Block X of the kit has `released` units; add a "said yes" investor who wants `units` of it. */
function withFresh(released: number, units: number) {
  const s = kit();
  s.data.FARMS.find(f => f.k === "X")!.released = released;
  s.data.INV.push({ ...invOf(s, "A1"), id: "F1", n: "Kiran Rao", st: "said yes", units, blocks: { X: units }, hold: undefined } as ImInvestor);
  return s;
}
const held = (s: ReturnType<typeof kit>) => s.data.INV.filter(x => x.id !== "F1" && ["reserved", "paid", "allocated"].includes(x.st)).reduce((a, x) => a + (x.blocks.X || 0), 0);

describe("the receipt that opens a reservation", () => {
  it("is refused naming the block and its free units when the block is full — and nothing is recorded", () => {
    const s0 = kit(); const s = withFresh(held(s0), 2);
    expect(recordPayGate(s, "fin", "F1", "advance")).toEqual({ ok: false, msg: "Block X has no free units for Kiran Rao's 2 units." });
    const after = act(s, "fin", { type: "recordPay", id: "F1", kind: "advance", mode: "RTGS", utr: "UTR1" });
    expect(after.data.TXN.filter(t => t.inv === "F1")).toEqual([]);
    expect(invOf(after, "F1").st).toBe("said yes");
    expect(after.ui.NOTE?.msg).toBe("Block X has no free units for Kiran Rao's 2 units.");
  });
  it("names what is left when the block has some but not enough", () => {
    const s = withFresh(held(kit()) + 1, 2);
    expect(oversellGate(s, invOf(s, "F1"))).toEqual({ ok: false, msg: "Block X has only 1 free unit for Kiran Rao's 2 units." });
  });
  it("goes through when the units are free", () => {
    const s = withFresh(held(kit()) + 2, 2);
    expect(recordPayGate(s, "fin", "F1", "advance").ok).toBe(true);
  });
  it("paying in full as the first receipt is the same claim", () => {
    const s = withFresh(held(kit()), 2);
    expect(recordPayGate(s, "fin", "F1", "balance").ok).toBe(false);
  });
});

describe("D21: recording money against a reservation that exists is never refused for oversell", () => {
  it("a reserved investor's balance is recorded even when the block is over-released", () => {
    const s = kit();
    s.data.FARMS.find(f => f.k === "X")!.released = 0;   /* cut below what is held */
    expect(invOf(s, "R1").st).toBe("reserved");
    expect(recordPayGate(s, "fin", "R1", "balance").ok).toBe(true);
    expect(imReducer(s, "fin", { type: "recordPay", id: "R1", kind: "balance", mode: "RTGS", utr: "UTR2" }).data.TXN.some(t => t.inv === "R1")).toBe(true);
  });
});
