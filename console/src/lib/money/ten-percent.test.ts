/* D137 ruling 2(a) — Part payments count toward the 10%; the trail is matched receipts with the running total. Synthetic ids. */
import { describe, expect, it } from "vitest";
import { istWhen, maskReference, tenPercentOf, tenPercentTrail, trailSummary, type TrailReceipt } from "./ten-percent";

const r = (id: string, kind: string, amount: number, at: string | null, state = "Matched", ref = "SYNTHUTR00001234", by = "9007199254740990001"): TrailReceipt =>
  ({ id, kind, amount, at, state, ref, matchedById: by });

describe("tenPercentTrail", () => {
  it("sums Parts: two Parts that together reach 10% reach it on the second, with the running total", () => {
    const t = tenPercentTrail(1_000_000, [r("2", "Part", 50_000, "2026-10-09T15:00:00+05:30"), r("1", "Part", 60_000, "2026-10-08T11:30:00+05:30")]);
    expect(t.threshold).toBe(100_000);
    expect(t.rows.map((x) => [x.receiptId, x.runningTotal, x.reachedTen])).toEqual([["1", 60_000, false], ["2", 110_000, true]]);
    expect([t.reached, t.reachedAt, t.fullyPaid, t.balanceDue]).toEqual([true, "2026-10-09T15:00:00+05:30", false, 890_000]);
  });
  it("one Part under 10% does not reach it; pending money counts for nothing but is reported", () => {
    const t = tenPercentTrail(1_000_000, [r("1", "Part", 40_000, "2026-10-08"), r("2", "Advance", 90_000, null, "Pending")]);
    expect([t.reached, t.matched, t.unmatched]).toEqual([false, 40_000, 90_000]);
    expect(trailSummary(t)).toMatch(/₹40,000 of ₹1,00,000 \(10% of ₹10,00,000\) matched — ₹60,000 to go\. ₹90,000 recorded/);
  });
  it("a refund takes money back out; Reversed and Not found count nowhere", () => {
    const t = tenPercentTrail(1_000_000, [r("1", "Advance", 100_000, "2026-10-01T10:00:00+05:30"), r("2", "Refund", 20_000, "2026-10-02T10:00:00+05:30"),
      r("3", "Part", 50_000, "2026-10-03T10:00:00+05:30", "Reversed"), r("4", "Part", 10_000, null, "Not found")]);
    expect([t.matched, t.reached]).toEqual([80_000, false]);
  });
  it("full: matched total >= committed is fully paid, stamped with the receipt that took it there", () => {
    const t = tenPercentTrail(500_000, [r("1", "Advance", 50_000, "2026-10-01T10:00:00+05:30"), r("2", "Part", 450_000, "2026-10-20T10:00:00+05:30", "Matched", "X", "9007199254740990002")]);
    expect([t.fullyPaid, t.fullAt, t.fullBy, t.balanceDue]).toEqual([true, "2026-10-20T10:00:00+05:30", "9007199254740990002", 0]);
  });
  it("unknown committed amount: nothing is reached", () => {
    const t = tenPercentTrail(null, [r("1", "Full", 1_000_000, "2026-10-01")]);
    expect([t.reached, t.fullyPaid, t.threshold, t.balanceDue]).toEqual([false, false, null, null]);
  });
  it("10% is rounded up to the rupee", () => { expect(tenPercentOf(100_001)).toBe(10_001); });
});

describe("the trail never carries the full reference", () => {
  it("masks to the last four", () => {
    const t = tenPercentTrail(1_000_000, [r("1", "Advance", 100_000, "2026-10-01T10:00:00+05:30", "Matched", "HDFCR52026100912345678")]);
    expect(t.rows[0]!.refMasked).toBe("••• 5678");
    expect(JSON.stringify(t)).not.toContain("HDFCR52026100912345678");
    expect(maskReference("123")).toBe("••••");
    expect(maskReference(null)).toBe("—");
  });
  it("prints date-time in IST", () => {
    expect(istWhen("2026-10-09T08:35:00Z")).toBe("9 Oct 2026, 14:05 IST");
    expect(istWhen("2026-10-09")).toBe("9 Oct 2026 (received)");
  });
});
