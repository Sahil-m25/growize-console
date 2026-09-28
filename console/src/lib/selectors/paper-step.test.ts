import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { irPaperStep, PRSTEP } from "@/lib/selectors";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });

describe("irPaperStep — the IR's one paperwork move (ir-merged.js:3290, D61)", () => {
  it("names the owner's step on a waiting round in PRSTEP's words", () => {
    const s = as("rohit");
    const l = s.LEADS.find((x) => x.id === "L4")!;
    const st = irPaperStep(s, l);
    expect(st).not.toBeNull();
    expect(Object.values(PRSTEP)).toContain(st!.t);
    expect(st!.t).toBe("Chase the signature");
  });
  it("is nobody's move for a seat that cannot work the lead", () => {
    const s = as("kavya");
    const l = s.LEADS.find((x) => x.id === "L4")!;
    expect(irPaperStep(s, l)).toBeNull();
    expect(irPaperStep(s, null)).toBeNull();
  });
});
