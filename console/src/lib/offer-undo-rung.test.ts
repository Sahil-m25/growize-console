/* W2-REG-1: a live tick (route answers the new rung) offers the top bar's take-back the way the fixture reducer's tick does. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "./state";
import type { PersonKey } from "@/domain";

describe("offerUndoRung", () => {
  it("sets TJUST to the rung the route answered; an unrelated action leaves it alone", () => {
    const s0 = reducer(initialState(demoBook()), { type: "signIn", k: "rohit" as PersonKey });
    expect(s0.TJUST).toBeNull();
    const s1 = reducer(s0, { type: "offerUndoRung", id: "1454168000000000001", r: 3, at: "09 Oct 10:05" });
    expect(s1.TJUST).toEqual({ w: "rung", id: "1454168000000000001", r: 3, at: "09 Oct 10:05" });
    expect(reducer(s1, { type: "setTheme", theme: "dark" }).TJUST).toEqual(s1.TJUST);
  });
});
