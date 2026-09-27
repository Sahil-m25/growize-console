import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { ConsoleState } from "@/lib/store";
import type { Cap, NavKey, PersonKey } from "@/domain";
import { SEATCAPS, SEATDEF } from "@/domain";
import { canGrant, capsFor, consoleAccount, navFor, reachBase, seatShape } from "@/lib/selectors";

const as = (k: string, s?: ConsoleState) =>
  reducer(s ?? initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const J = "jhalak" as PersonKey;

describe("D60 — who uses this console (ir-merged.js:170-560)", () => {
  it("the Operations Lead's seat presets nothing but Profile", () => {
    expect(SEATCAPS.exec).toEqual({ me: ["view"] });
    expect(SEATDEF.exec).toEqual([]);
    expect(SEATDEF.ir).toEqual(["today", "leads", "updates", "add", "activity", "events", "pay", "docs", "me"]);
  });

  it("a granted-only seat has no console until a page is granted", () => {
    const s = as("sahil");
    expect(consoleAccount(s.PEOPLE, J, s.CAPS)).toBe(false);
    expect(reachBase(s.PEOPLE, J, s.CAPS)).toEqual([]);
  });

  it("granting Jhalak Leads · See it admits her to Leads only, and logs both facts", () => {
    let s = as("sahil");
    s = reducer(s, { type: "toggleCap", k: J, p: "leads" as NavKey, c: "view" as Cap });
    expect(consoleAccount(s.PEOPLE, J, s.CAPS)).toBe(true);
    expect(reachBase(s.PEOPLE, J, s.CAPS).sort()).toEqual(["leads", "me", "teamscope"]);
    expect(s.LOG[0]!.what).toBe("Console access granted");
    expect(s.LOG[0]!.note).toBe("Jhalak Mehta · first page granted: Leads");
    expect(s.LOG[1]!.what).toBe("Changed access");
    const j = as("jhalak", s);
    expect(j.WHO).toBe(J);
    expect(navFor(j).map((n) => n.k)).toEqual(["leads"]);
    expect(capsFor(j, J, "leads")).toEqual(["view"]);
    /* and taking it back ends her access */
    s = reducer(s, { type: "toggleCap", k: J, p: "leads" as NavKey, c: "view" as Cap });
    expect(consoleAccount(s.PEOPLE, J, s.CAPS)).toBe(false);
    expect(s.LOG[0]!.what).toBe("Console access ended");
    expect(s.LOG[0]!.note).toBe("Jhalak Mehta · no page left granted");
  });

  it("an Operations Lead's role can never hold Change things on Leads", () => {
    const s = as("sahil");
    expect(seatShape(s.PEOPLE, J, "leads", ["view", "edit", "assign"])).toEqual(["view"]);
  });

  it("only Digital Infrastructure and the IR Manager grant, and the IR Manager only IRs", () => {
    expect(canGrant(as("sahil"), "exec")).toBe(true);
    expect(canGrant(as("sahil"), "fin")).toBe(false);
    expect(canGrant(as("tasneem"), "ir")).toBe(true);
    expect(canGrant(as("tasneem"), "conv")).toBe(false);
  });

  it("the IR Manager's rail carries Transfers", () => {
    expect(navFor(as("tasneem")).some((n) => n.k === "xfer" && n.t === "Transfers")).toBe(true);
  });
});
