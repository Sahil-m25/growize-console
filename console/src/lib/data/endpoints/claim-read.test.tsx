/* M10-S03-W1 — the lead page reads Finance's answer to a report (GET /api/leads/[id]/claim): the path, the pick,
   and the fixture half telling "did not find it" from "found it" (the gate's payment.notFound is true for both). */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { openable } from "@/lib/selectors";
import type { ApiResult } from "../api";
import { leadClaimRead } from "./claims";

const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });

describe("leadClaimRead", () => {
  it("path and pick", () => {
    expect(leadClaimRead.path("L1")).toBe("/api/leads/L1/claim");
    expect(leadClaimRead.path(null)).toBeNull();
    expect(leadClaimRead.pick({ claim: { state: "waiting" } })).toEqual({ state: "waiting" });
  });
  it("fixture: none, waiting, found and not found, with the reason only for not found", () => {
    const s = as("sahil");
    const id = openable(s)[0]!.id;
    const withClaim = (c: unknown): ConsoleState => ({ ...s, CLAIM: { ...s.CLAIM, [id]: c as never } });
    const base = { id: "PR-x-1", by: "harsha", at: "x", kind: "advance", mode: "SWIFT", ref: "r", amount: 1, on: "x", did: "x" };
    const none = data(leadClaimRead.fixture({ ...s, CLAIM: {} }, id));
    expect([none.state, none.answer, none.says]).toEqual(["none", null, null]);
    expect(data(leadClaimRead.fixture(withClaim({ ...base, state: "waiting" }), id)).state).toBe("waiting");
    const nf = data(leadClaimRead.fixture(withClaim({ ...base, state: "notfound", why: "Nothing from HDFC yet" }), id));
    expect([nf.state, nf.answer, nf.reason, nf.says]).toEqual(["answered", "not-found", "Nothing from HDFC yet", "Finance did not find it: Nothing from HDFC yet"]);
    const f = data(leadClaimRead.fixture(withClaim({ ...base, state: "confirmed" }), id));
    expect([f.state, f.answer, f.says]).toEqual(["answered", "found", null]);
  });
});
