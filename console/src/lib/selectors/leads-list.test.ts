import { beforeAll, describe, expect, it } from "vitest";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { bookFor, canAssign, EXC } from "@/lib/selectors";
import { fqFind, orgSearchScope } from "@/lib/selectors/find";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
beforeAll(() => pinClock("10:00")); /* CLOCK_28AUG_1000 */
const names = (ls: { n: string }[]) => ls.map((l) => l.n).sort();

describe("EXC.overdue — Today's rule (ir-merged.js:4809)", () => {
  it("Rohit's book: only Sanjay Menon is overdue", () => {
    const s = as("rohit");
    expect(names(bookFor(s, "leads").filter((l) => l.own && EXC.overdue[1](s, l)))).toEqual(["Sanjay Menon"]);
  });
  it("the team book: Sanjay Menon and Farida Contractor", () => {
    const s = reducer(as("tasneem"), { type: "setScope", view: "leads", to: "team" });
    expect(names(bookFor(s, "leads").filter((l) => l.own && EXC.overdue[1](s, l)))).toEqual(["Farida Contractor", "Sanjay Menon"]);
  });
});

describe("canAssign — conv and ops (ir-merged.js:1657)", () => {
  it("Digital Infrastructure may assign; an IR may not", () => {
    expect(canAssign(as("sahil"))).toBe(true);
    expect(canAssign(as("rohit"))).toBe(false);
  });
});

describe("Find investor — D60 b scope (ir-merged.js:10911)", () => {
  it("an IR searches their own book only", () => {
    const s = as("rohit");
    expect(orgSearchScope(s)).toBe(false);
    expect(fqFind(s, "rahul")).toEqual([]);
    expect(fqFind(s, "12277").map((x) => x.l.n)).toEqual(["Meera Krishnan"]);
  });
  it("Digital Infrastructure and the IR Manager search the organisation", () => {
    expect(orgSearchScope(as("sahil"))).toBe(true);
    expect(fqFind(as("sahil"), "rahul").map((x) => x.l.n)).toContain("Rahul Sethi");
    expect(orgSearchScope(as("tasneem"))).toBe(true);
    expect(fqFind(as("tasneem"), "a").length).toBe(18);
  });
});
