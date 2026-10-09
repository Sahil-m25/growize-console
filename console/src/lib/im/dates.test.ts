/* W2-KAM-2 / W2-KAM-3 / B-16: live ISO and Zoho datetimes read as IST wall time and print as people write them — never raw. */
import { describe, expect, it } from "vitest";
import { aged, day6, isoWall, when } from "./dates";
import { fmtAt } from "./money";

const NOW = "2026-10-09T10:00";

describe("live datetimes", () => {
  it("naive route strings are IST wall time; offset and Z strings are converted to it", () => {
    const wall = Date.UTC(2026, 9, 5, 4, 15);
    expect(isoWall("2026-10-05T04:15")).toBe(wall);
    expect(isoWall("2026-10-05T04:15:00+05:30")).toBe(wall);
    expect(isoWall("2026-10-05T04:15:00+0530")).toBe(wall);
    expect(isoWall("2026-10-04T22:45:00Z")).toBe(wall);
    expect(isoWall("05 Oct")).toBeNull();
    expect(isoWall("")).toBeNull();
  });
  it("day6 / fmtAt print a live stamp as a day, never the first six characters of the ISO", () => {
    expect(day6("2026-10-05T04:15")).toBe("05 Oct");
    expect(day6("26 Aug 10:00")).toBe("26 Aug");
    expect(fmtAt("2026-10-08T22:05")).toBe("08 Oct 22:05");
    expect(fmtAt("2026-08-25")).toBe("25 Aug");
    expect(fmtAt("2026-10-04T22:45:00Z")).toBe("05 Oct 04:15");
    expect(fmtAt("26 Aug 10:00")).toBe("26 Aug 10:00");
    expect(fmtAt(null)).toBe("");
  });
  it("aged counts days from a live opened stamp (a ticket opened today is 0, not null)", () => {
    expect(aged(NOW, "2026-10-05T04:15")).toBe(4);
    expect(aged(NOW, "2026-10-09T08:00")).toBe(0);
    expect(aged(NOW, "04 Oct")).toBe(5);
    expect(when(NOW, "2026-10-05T04:15")).toBe(Date.UTC(2026, 9, 5, 4, 15));
  });
});

describe("B-16: the Finance journey prints live stamps formatted", () => {
  it("a Payment received on a bare ISO day and an Account opened on an ISO datetime read '25 Aug' / '26 Aug 12:00', and sort by their real time", async () => {
    const { imDemoData } = await import("@fixtures/im/demo");
    const { initialImUi } = await import("./reducer");
    const { journey, money } = await import("./index");
    const data = imDemoData();
    const x = { ...data.INV[0]!, since: "2026-08-26T12:00" };
    data.INV[0] = x;
    data.TXN = [{ ...data.TXN[0]!, inv: x.id, kind: "balance", on: "2026-08-25", by: "harsha" } as never, ...data.TXN];
    const ev = journey({ data, ui: initialImUi() }, "harsha", x, money);
    const pay = ev.find(e => e.t === "Payment received")!;
    expect(fmtAt(pay.at)).toBe("25 Aug");
    expect(fmtAt(ev.find(e => e.t === "Account opened")!.at)).toBe("26 Aug 12:00");
    expect(ev.findIndex(e => e.t === "Account opened")).toBeLessThan(ev.findIndex(e => e.t === "Payment received"));
  });
});

describe("W3-2: the origin lead is named in words, never a raw Zoho record id", () => {
  it("Journey 'Account opened' names the lead (live) or shows the code (demo); a bare record id reads as nothing", async () => {
    const { imDemoData } = await import("@fixtures/im/demo");
    const { initialImUi } = await import("./reducer");
    const { journey, money, leadWords } = await import("./index");
    const data = imDemoData();
    const opened = (patch: object) => {
      data.INV[0] = { ...data.INV[0]!, ...patch } as never;
      return journey({ data, ui: initialImUi() }, "harsha", data.INV[0]!, money).find(e => e.t === "Account opened")!.m!;
    };
    expect(opened({ lead: "1454168000003022169", leadName: "Radhika Menon" })).toContain(" · lead Radhika Menon");
    expect(opened({ lead: "1454168000003022169", leadName: null })).not.toMatch(/lead|\d{10,}/);
    expect(opened({ lead: "L-0412", leadName: undefined })).toContain(" · lead L-0412");
    expect(leadWords({ lead: "1454168000003022169" })).toBeNull();
  });
});
