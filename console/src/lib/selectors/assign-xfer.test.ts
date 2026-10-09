import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { applyFixtures } from "@fixtures/apply";
import { initialState, reducer } from "@/lib/state";
import { ST, type PersonKey } from "@/domain";
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

describe("Transfers — xfMonths (ir-merged.js 6899, re-dated by D137 / GC-1527)", () => {
  it("counts leads by the month Finance confirmed the 10% (Reserved) — a said-yes lead is not an investor yet", () => {
    const s = as("tasneem");
    const M = xfMonths(s);
    expect(M.map(m => [m.d.getMonth(), m.rows.length])).toEqual([[7, 2], [6, 1]]);
    expect(M.flatMap(m => m.rows).every(r => r.l.done >= ST.RESERVED)).toBe(true);
    const yesOnly = s.LEADS.filter(l => l.done === ST.CONVERTED);
    expect(M.flatMap(m => m.rows).some(r => yesOnly.includes(r.l))).toBe(false);
  });
  it("a lead lost after the 10% still counts, marked Lost after the 10%; one lost after only saying yes does not", () => {
    const s0 = as("tasneem", "DEEPA_LOST_AFTER_YES");
    const deepa = s0.LEADS.find(l => l.n === "Deepa Varghese")!;
    expect(xfMonths(s0).flatMap(m => m.rows).some(r => r.l.id === deepa.id)).toBe(deepa.done >= ST.RESERVED);
    const r0 = xfMonths(as("tasneem")).flatMap(m => m.rows)[0]!.l;
    const s1 = { ...s0, LEADS: s0.LEADS.map(l => (l.id === r0.id ? { ...l, lost: { why: "Changed their mind" } } as unknown as typeof l : l)) };
    const row = xfMonths(s1).flatMap(m => m.rows).find(r => r.l.id === r0.id)!;
    expect(xfAfter(row.l).t).toBe("Lost after the 10%");
  });
  it("an IR has no Transfers", () => {
    expect(xfMonths(as("rohit"))).toEqual([]);
  });
});
