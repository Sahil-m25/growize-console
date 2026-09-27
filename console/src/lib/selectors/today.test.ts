import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { may, sidesOf, todayList } from "@/lib/selectors";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });

describe("todayList — merged prototype (ir-merged.js:1731)", () => {
  it("is the seat's own work only: an unowned lead is never on Today", () => {
    const s = as("rohit");
    const list = todayList(s);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((l) => !!l.own)).toBe(true);
  });
});

describe("the ops seat is the super user (D68, ir-merged.js:638)", () => {
  it("reaches the lead-side Today, so a both-sides holder gets the Lead side switch", () => {
    const s = as("sahil");
    expect(may(s, "today", "view")).toBe(true);
    expect(sidesOf(s, "today").ir).toBe(true);
  });
});
