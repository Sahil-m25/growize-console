/* M06-S03-W2 / M06-S05-W2 — the top-bar search follows the seat (D110): fixture half per seat, and the live path. */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import { liveRead } from "../api";
import { topPlan, topSearch } from "./search";

const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k });
const run = (k: string, q: string) => { const r = topSearch.fixture(as(k), q); if (!r.ok) throw new Error(r.error); return r.data; };

describe("topSearch — the scope follows the seat", () => {
  it("an IR: their own book only, leads only (TC-E06-009)", () => {
    const r = run("rohit", "rahul");
    expect(topPlan(as("rohit"))).toEqual({ leads: true, investors: false });
    expect(r.book).toBe("yours");
    expect(r.investorBook).toBeNull();
    expect(r.hits).toEqual([]);
  });
  it("the IR Manager: the organisation's leads as the prototype scopes her, capped at eight (TC-E06-010)", () => {
    const r = run("tasneem", "a");
    expect(r.book).toBe("all");
    expect(r.hits).toHaveLength(8);
    expect(r.hits.every((h) => h.kind === "lead")).toBe(true);
    expect(r.more).toBe(10);
  });
  it("Digital Infrastructure: leads AND investors, each hit with its kind (TC-E06-012 keeps its lead heading)", () => {
    expect(topPlan(as("sahil"))).toEqual({ leads: true, investors: true });
    const r = run("sahil", "rahul");
    expect(r.book).toBe("all");
    expect(r.investorBook).toBe("all");
    expect(r.hits.find((h) => h.kind === "lead" && h.name === "Rahul Sethi")).toBeTruthy();
    const inv = run("sahil", "Prakash");
    expect(inv.hits.some((h) => h.kind === "investor" && h.name === "Prakash Bhat")).toBe(true);
  });
  it("the Head of Finance: investors within scope, never a lead", () => {
    expect(topPlan(as("harsha"))).toEqual({ leads: false, investors: true });
    const r = run("harsha", "Prakash");
    expect(r.book).toBeNull();
    expect(r.investorBook).toBe("org");
    expect(r.hits.map((h) => h.kind)).toEqual(["investor"]);
    expect(run("harsha", "rahul").hits.filter((h) => h.kind === "lead")).toEqual([]);
  });
  it("a KAM: their own accounts only", () => {
    const r = run("imran", "a");
    expect(r.investorBook).toBe("own-book");
    expect(r.hits.every((h) => h.kind === "investor")).toBe(true);
  });
  it("hits never carry the full number", () => {
    for (const h of run("sahil", "a").hits) expect(h.phoneLast4 === null || /^\d{4}$/.test(h.phoneLast4)).toBe(true);
  });
  it("live: the route, one q only, encoded; nothing asked for an empty box", async () => {
    expect(topSearch.path("  ")).toBeNull();
    expect(topSearch.path(" asha rao ")).toBe("/api/leads/search?q=asha%20rao");
    const body = { book: null, investorBook: "org", hits: [{ kind: "investor", id: "1", name: "X", code: "ARL-INV-0001", city: null, phoneLast4: "1234" }], more: 0 };
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
    expect(await liveRead(topSearch, "/api/leads/search?q=x", { fetch: f })).toEqual({ state: "ok", data: body });
  });
});
