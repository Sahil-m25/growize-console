/* M19-S06-T01 — first-touch SLA and the overdue definition, off the lead's own stamps (no second clock). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import { TOUCHSLA, ST, type Lead, type PersonKey } from "@/domain";
import { lateOf, missingTouch, workGroup } from "@/lib/selectors/leads";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const lead = (s: ReturnType<typeof as>, id: string) => s.LEADS.find((l: Lead) => l.id === id)!;

describe("first-touch SLA", () => {
  it("is WhatsApp same day, intro email day 1, call connected by day 3 — all inside stage 2", () => {
    expect(TOUCHSLA.map((x) => [x.k, x.days])).toEqual([["msg", 0], ["email", 1], ["call", 3]]);
    expect(ST.TOUCH).toBe(2);
  });
  it("a lead still owed its intro email is late by the days past day 1 (demo L2, NOW 28 Aug)", () => {
    const s = as("rohit");
    const m = missingTouch(s, lead(s, "L2"));
    expect(m).toMatchObject({ k: "email", days: 1, state: "overdue", late: 6 });
    expect(lateOf(lead(s, "L2"), s.NOW)).toBe(6);
  });
  it("a new lead owed its same-day WhatsApp is overdue from the day after assignment (demo L12)", () => {
    const s = as("rohit");
    expect(missingTouch(s, lead(s, "L12"))).toMatchObject({ k: "msg", days: 0, state: "overdue" });
    expect(workGroup(s, lead(s, "L12"))).toBe("overdue");
  });
});

describe("overdue", () => {
  /* "due today" vs "overdue" turns on the time of day; pin 10:00 IST so the suite does not fail after 16:30 (D109 build audit). */
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-28T04:30:00Z")); });
  afterAll(() => { vi.useRealTimers(); });
  it("a dated next step due today is 'today', tomorrow is 'upcoming', and neither is late", () => {
    const s = as("rohit");
    expect(workGroup(s, lead(s, "L4"))).toBe("today");
    expect(workGroup(s, lead(s, "L3"))).toBe("upcoming");
    expect(lateOf(lead(s, "L4"), s.NOW)).toBe(0);
  });
  it("a dated next step in the past is overdue and late by whole days", () => {
    const s = as("rohit");
    const l4 = lead(s, "L4");
    const past = { ...l4, nx: { ...l4.nx!, d: "2026-08-25", by: "25 Aug" } } as Lead;
    const s2 = { ...s, LEADS: s.LEADS.map((l: Lead) => (l.id === "L4" ? past : l)) };
    expect(workGroup(s2, past)).toBe("overdue");
    expect(lateOf(past, s2.NOW)).toBeGreaterThanOrEqual(2);
  });
  it("an unowned or empty lead is never late", () => {
    const s = as("rohit");
    expect(lateOf(null, s.NOW)).toBe(0);
    expect(lateOf({ ...lead(s, "L2"), own: null } as unknown as Lead, s.NOW)).toBe(0);
  });
});
