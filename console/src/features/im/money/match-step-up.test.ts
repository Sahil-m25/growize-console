/* M10-S02-NOTE-10 — the Match button's step-up path (pure parts; the component only wires them) */
import { describe, expect, it } from "vitest";
import { fail, ok } from "@/lib/data/api";
import { dropMatch, holdMatch, MATCH_PENDING_KEY, needsStepUp, pressMatch, takeHeldMatch } from "./match-step-up";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const STEP = fail(403, "step-up", "Confirm it is you with a fresh sign-in first.");
const LOCKED = fail(423, "locked", "Too many failed confirmations.");

describe("needsStepUp", () => {
  it("is only the 403 step-up answer", () => {
    expect(needsStepUp(STEP)).toBe(true);
    expect(needsStepUp(LOCKED)).toBe(false);
    expect(needsStepUp(fail(403, "same-hand", "no"))).toBe(false);
    expect(needsStepUp(ok({}))).toBe(false);
  });
});

describe("pressMatch", () => {
  it("opens the panel on 403 step-up, retries once it is open, never loops", async () => {
    const calls: boolean[] = [];
    const answers = [STEP, ok({ receiptId: "r1", state: "matched" })];
    const go = async () => { calls.push(true); return answers.shift()!; };
    expect(await pressMatch(go, false)).toBe("step-up");
    expect(await pressMatch(go, true)).toBe("matched");
    expect(calls.length).toBe(2);
    expect(await pressMatch(async () => STEP, true)).toBe("refused");
  });
  it("423 locked is a refusal carrying its message, no panel", async () => {
    expect(await pressMatch(async () => LOCKED, false)).toBe("refused");
  });
  it("any other refusal and a plain success are unchanged", async () => {
    expect(await pressMatch(async () => fail(409, "changed", "x"), false)).toBe("refused");
    expect(await pressMatch(async () => ok({}), false)).toBe("matched");
  });
});

describe("held match across the Zoho round trip", () => {
  it("is taken once, only for the same receipt, only after ?stepup=ok", () => {
    const st = mem();
    holdMatch("r1", st);
    expect(st.m.get(MATCH_PENDING_KEY)).toBe("r1");
    expect(takeHeldMatch("r1", "failed", st)).toBe(false);
    expect(takeHeldMatch("r2", "ok", st)).toBe(false);
    expect(takeHeldMatch("r1", "ok", st)).toBe(true);
    expect(takeHeldMatch("r1", "ok", st)).toBe(false);
  });
  it("cancel drops it; blocked storage never throws", () => {
    const st = mem(); holdMatch("r1", st); dropMatch(st);
    expect(takeHeldMatch("r1", "ok", st)).toBe(false);
    const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
    expect(() => { holdMatch("r1", bad); dropMatch(bad); }).not.toThrow();
    expect(takeHeldMatch("r1", "ok", bad)).toBe(false);
  });
});
