/* TC-E14-014 (R5): ending a live temporary grant revokes it. The pages-a slice used to return state for any action carrying an
   `id` that is not an openable lead, and a grant's id ("T-01") is not a lead's — so End access was a silent no-op and the
   save queue reported "1 save failed". */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { PersonKey } from "@/domain";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });

describe("revokeTemp", () => {
  it("the grantor ends a live grant: it is revoked and the log says so", () => {
    const s = as("tasneem");
    expect(s.TEMP.find((g) => g.id === "T-01")?.state).toBe("live");
    const n = reducer(s, { type: "revokeTemp", id: "T-01" });
    expect(n).not.toBe(s);
    expect(n.TEMP.find((g) => g.id === "T-01")?.state).toBe("revoked");
    expect(n.LOG[0]?.what).toBe("Revoked temporary access");
  });
  it("someone with no hand in the grant cannot end it", () => {
    const s = as("rohit");
    const n = reducer(s, { type: "revokeTemp", id: "T-01" });
    expect(n.TEMP.find((g) => g.id === "T-01")?.state).toBe("live");
  });
  it("a lead action naming a lead the person cannot open is still refused", () => {
    const s = as("rohit");
    const other = s.LEADS.find((l) => l.own && l.own !== "rohit")?.id;
    expect(other).toBeTruthy();
    expect(reducer(s, { type: "tick", id: other! })).toBe(s);
  });
});
