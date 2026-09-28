/* M19-S06-T01 — the visibility scope filter: one scope per book per seat, keyed so no scope serves another (D53, D69). */
import { describe, expect, it } from "vitest";
import { BOOKS, cacheScopeOf, scopedKeyString, scopesFor } from "../data/scope";

const U = "9007199254740995001";

describe("visibility scope per seat and book", () => {
  it("an IR sees their own leads and only the investors from their own leads", () => {
    const s = scopesFor("ir", U);
    expect(s.leads).toEqual({ kind: "user", userId: U });
    expect(s.investors).toEqual({ kind: "own-lead", userId: U });
    expect(s.cases.kind).toBe("none");
    expect(s.holdings.kind).toBe("none");
  });
  it("an IR Manager sees their subtree's leads and no investor book", () => {
    const s = scopesFor("conv", U);
    expect(s.leads).toEqual({ kind: "subtree", managerId: U });
    expect(s.investors.kind).toBe("none");
  });
  it("a KAM sees only their own book; the Head of AM sees the subtree", () => {
    expect(scopesFor("kam", U).investors).toEqual({ kind: "own-book", userId: U });
    expect(scopesFor("kam", U).leads.kind).toBe("none");
    expect(scopesFor("amlead", U).investors).toEqual({ kind: "subtree", managerId: U });
  });
  it("Finance seats read the org and never the lead book", () => {
    for (const seat of ["fin", "head", "comp", "audit"]) {
      const s = scopesFor(seat, U);
      expect(s.investors.kind).toBe("org");
      expect(s.leads.kind).toBe("none");
    }
  });
  it("an unknown seat or a malformed user id gets none on every book (fail closed)", () => {
    for (const s of [scopesFor("marketing", U), scopesFor("ir", "abc"), scopesFor("ops", ""), scopesFor("ir", "123")]) {
      for (const b of BOOKS) expect(s[b].kind).toBe("none");
    }
  });
  it("a book the seat does not have has no cache key", () => {
    expect(() => cacheScopeOf({ kind: "none" })).toThrow(TypeError);
  });
  it("one person's own-lead and own-book numbers never share a cache key", () => {
    const a = scopedKeyString({ kind: "own-lead", userId: U }, "investors.count");
    const b = scopedKeyString({ kind: "own-book", userId: U }, "investors.count");
    expect(a).toBe(`user:${U}|own-lead.investors.count`);
    expect(b).not.toBe(a);
    expect(scopedKeyString({ kind: "org" }, "x")).toBe("role:org|org.x");
  });
});
