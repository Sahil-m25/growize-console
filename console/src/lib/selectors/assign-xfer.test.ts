import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { applyFixtures } from "@fixtures/apply";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { arData, arPeriods, arTo } from "./assign";
import { xfAfter, xfMonths } from "./xfer";

const as = (k: string, ...fx: string[]) =>
  reducer(initialState(fx.length ? applyFixtures(demoBook(), fx).ds : demoBook()), { type: "signIn", k: k as PersonKey });

describe("Assignments by IR — arData (ir-merged.js 11205)", () => {
  it("periods are This week, Last week, Earlier this month, Before this month, Total", () => {
    expect(arPeriods(new Date(2026, 7, 28)).map(p => p.t))
      .toEqual(["This week", "Last week", "Earlier this month", "Before this month", "Total"]);
  });
  it("the IR Manager sees a row per IR on her team", () => {
    const D = arData(as("tasneem"));
    expect(D.rows.map(r => r.k).sort()).toEqual(["ananya", "kavya", "nikhil", "rohit"]);
  });
  it("an IR sees only their own row", () => {
    expect(arData(as("rohit")).rows.map(r => r.k)).toEqual(["rohit"]);
  });
  it("Ananya's missed first touch names Farida Contractor", () => {
    const r = arData(as("tasneem")).rows.find(x => x.k === "ananya")!;
    expect(r.missed.map(x => x.l.n)).toEqual(["Farida Contractor"]);
  });
  it("a lead assigned today is This week and not yet worked", () => {
    const r = arData(as("tasneem", "RITU_ASSIGNED_TO_KAVYA_TODAY")).rows.find(x => x.k === "kavya")!;
    expect(r.per[0].nw.map(x => x.l.n)).toEqual(["Ritu Anand"]);
    expect(r.per[0].nw[0].cap).toBe(false);
  });
  it("reads the handover target off 'X carries it', 'A → B · why' and a bare name", () => {
    const s = as("tasneem");
    const e = { d: "2026-08-28", at: "28 Aug 10:00", who: "tasneem", what: "Assigned owner", lead: "L1", kind: "admin" as const };
    expect(arTo(s, { ...e, note: "Kavya Nair carries it" })).toBe("kavya");
    expect(arTo(s, { ...e, note: "Rohit Deshpande → Kavya Nair · Workload" })).toBe("kavya");
    expect(arTo(s, { ...e, note: "Kavya Nair" })).toBe("kavya");
  });
});

describe("Transfers — xfMonths (ir-merged.js 6899)", () => {
  it("counts leads by the month they said yes", () => {
    const M = xfMonths(as("tasneem"));
    expect(M.map(m => [m.d.getMonth(), m.rows.length])).toEqual([[7, 3], [6, 1]]);
  });
  it("a lead lost after yes still counts, marked Lost after yes", () => {
    const M = xfMonths(as("tasneem", "DEEPA_LOST_AFTER_YES"));
    const deepa = M[0].rows.find(r => r.l.n === "Deepa Varghese")!;
    expect(M[0].rows.length).toBe(3);
    expect(xfAfter(deepa.l).t).toBe("Lost after yes");
  });
  it("an IR has no Transfers", () => {
    expect(xfMonths(as("rohit"))).toEqual([]);
  });
});
