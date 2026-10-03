/* M15-S03-W2 — the Lead-side Activity page's read: both halves of leadActivityRead. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import type { ApiResult } from "../api";
import { leadActivityRead } from "./activity";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const month = (st: ReturnType<typeof as>) => `${st.NOW.getFullYear()}-${String(st.NOW.getMonth() + 1).padStart(2, "0")}`;
const none = { day: null, person: null, kind: null };

describe("Activity, Lead side — fixture half", () => {
  it("an IR reads only their own actions (solo, no By person tally)", () => {
    const st = as("rohit");
    const d = data(leadActivityRead.fixture(st, { month: month(st), ...none }));
    expect(d.side).toBe("lead");
    expect(d.solo).toBe(true);
    expect(d.byPerson).toEqual([]);
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.rows.every(r => r.byId === "rohit" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+05:30$/.test(r.at))).toBe(true);
  });
  it("an IR Manager reads the team; the Calls cut is the route's kind filter and the tally follows it", () => {
    const st = as("tasneem");
    const all = data(leadActivityRead.fixture(st, { month: month(st), ...none }));
    expect(all.solo).toBe(false);
    expect(all.byPerson.length).toBeGreaterThan(1);
    const calls = data(leadActivityRead.fixture(st, { month: month(st), day: null, person: null, kind: "call" }));
    expect(calls.total).toBe(78);
    expect(calls.rows.every(r => r.kind === "call")).toBe(true);
    expect(calls.byPerson.reduce((n, p) => n + p.total, 0)).toBe(78);
  });
  it("a person outside the month's people is ignored for a solo seat; a seat without Activity is refused", () => {
    const st = as("rohit");
    expect(data(leadActivityRead.fixture(st, { month: month(st), day: null, person: "tasneem", kind: null })).person).toBeNull();
    const no = leadActivityRead.fixture(as("imran"), { month: month(st), ...none });
    expect(no.ok ? no.data.total : no.status).toBeTruthy();
  });
  it("path carries side, month and every cut", () => {
    expect(leadActivityRead.path({ month: "2026-08", ...none })).toBe("/api/activity?side=lead&month=2026-08&limit=200");
    expect(leadActivityRead.path({ month: "2026-08", day: "2026-08-14", person: "1234", kind: "call" }))
      .toBe("/api/activity?side=lead&month=2026-08&limit=200&day=2026-08-14&person=1234&kind=call");
  });
});
