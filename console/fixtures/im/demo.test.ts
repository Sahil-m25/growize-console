import { describe, expect, it } from "vitest";
import {
  appOf, count, finQueue, freeUnits, imReach, imTitle, initialImUi, markLeft, stamp,
} from "@/lib/im";
import { imDemoData } from "./demo";

describe("the Investors demo book", () => {
  const s = { data: imDemoData(), ui: initialImUi() };
  it("is the prototype's book on the prototype's date", () => {
    expect(stamp(s.data.NOW)).toBe("02 Sep 00:00");
    expect(s.data.INV.length).toBe(15);
    expect(s.data.TXN.length).toBe(15);
    expect(s.data.DOCS.length).toBe(45);
    expect(s.data.SIGNINS.every(k => !!s.data.P[k])).toBe(true);
    expect(freeUnits(s)).toBe(96 - 40);
  });
  it("seeds every app account from its receipts, as seedApp did", () => {
    expect(Object.keys(s.data.APP).length).toBe(15);
    expect(appOf(s, "harsha", "ARL-INV-0208")!.mark).toBe("tentative");
    expect(appOf(s, "harsha", "ARL-INV-0219")).toMatchObject({ mark: "permanent", markAt: "30 Aug 11:40", markBy: "harsha" });
    expect(markLeft(s, "harsha", "ARL-INV-0219")).toBe(4);
  });
  it("reads the same queues and rails as the prototype", () => {
    expect(finQueue(s, "harsha").some(q => q.kind === "claim" && q.inv.id === "ARL-INV-0208")).toBe(true);
    expect(imTitle(s.data, "latha")).toBe("Auditor — read only");
    expect(imReach(s, "pradeep")).toEqual(["sys", "act", "team"]);
    expect(count(s, "harsha", "tkt")).toBe(6);
  });
});
