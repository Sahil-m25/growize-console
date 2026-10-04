/* TC-E16-013 (M18-S02) — an IR cannot write on a manager page: Rohit's Plan writes change nothing, where a seat that holds the
   Plan can write the same fields. The Plan is console state (state.PLAN, the demo book's targets), so its write is a reducer
   action, not a server route; the server half — an IR refused 403, logged, on every write route of a page they do not hold —
   is src/server/http/contract/seat-refusal-cases.test.cjs.
   TC-E14-022 (M17-S02), the console half — Sahil grants Jhalak Leads · See it; she reads leads, and every lead write is
   refused. The Zoho half (a read-only profile refusing the edit itself, field-level security hiding the bank field from her
   token) needs staging Zoho with D51-D54 in place. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { applyFixtures } from "@fixtures/apply";
import { initialState, reducer, LEAD_WRITES } from "@/lib/state";
import { canOperateLeads, openable } from "@/lib/selectors";
import { canReveal, revealFields } from "@/lib/zoho/identity";
import type { PersonKey } from "@/domain";

const as = (k: string, fixtures: string[] = []) => reducer(initialState(applyFixtures(demoBook(), fixtures).ds), { type: "signIn", k: k as PersonKey });

describe("TC-E16-013: an IR cannot write on a manager page", () => {
  const plan = (s: ReturnType<typeof as>) => s.PLAN;
  const writes = [
    { type: "bump", k: "eventDays", d: 1, lo: 0, hi: 30 },
    { type: "setNum", pk: "", f: "target", v: "55" },
    { type: "setTarget", pk: "", d: 1 },
    { type: "setPeriodDate", pk: "", f: "to", v: "2026-09-29" },
  ] as const;

  it("Rohit (IR): every Plan write returns the state untouched, and nothing is logged as a plan change", () => {
    const s = as("rohit");
    const pk = s.PLAN.periods[0]!.k;
    for (const w of writes) {
      const a = { ...w, ...("pk" in w ? { pk } : {}) } as never;
      const n = reducer(s, a);
      expect(n, JSON.stringify(w)).toBe(s);
      expect(plan(n)).toBe(plan(s));
    }
    expect(s.LOG.some(l => l.what === "Changed the plan")).toBe(false);
  });

  it("the same writes land for a seat that holds the Plan (so the refusal above is the seat, not a dead action)", () => {
    const s = as("sahil");
    const pk = s.PLAN.periods[0]!.k;
    const n = reducer(s, { type: "setNum", pk, f: "target", v: String((s.PLAN.periods[0]!.target || 0) + 1) } as never);
    expect(n).not.toBe(s);
    expect(n.PLAN.periods[0]!.target).toBe((s.PLAN.periods[0]!.target || 0) + 1);
    expect(n.LOG[0]?.what).toBe("Changed the plan");
    const b = reducer(s, { type: "bump", k: "eventDays", d: 1, lo: 0, hi: 30 } as never);
    expect(b.PLAN.eventDays).toBe(s.PLAN.eventDays + 1);
  });
});

describe("TC-E14-022 (console half): a granted person's console access matches the grant", () => {
  const s = as("jhalak", ["JHALAK_GRANTED_LEADS"]);

  it("Jhalak holds Leads · See it, and no lead write is allowed to her", () => {
    expect(s.CAPS.jhalak?.leads).toContain("view");
    expect(canOperateLeads(s)).toBe(false);
    const lead = openable(s)[0]?.id;
    expect(lead, "she can open a lead to read it").toBeTruthy();
    const attempts = ["logTouch", "tick", "saveNext", "addNote", "closeLost", "assign", "handover", "saveFollowup"].filter(t => LEAD_WRITES.has(t));
    expect(attempts.length).toBeGreaterThanOrEqual(5);
    for (const type of attempts) expect(reducer(s, { type, id: lead } as never), type).toBe(s);
  });

  it("she is not given a reveal: no seat of hers may ask for a PAN or a bank account", () => {
    for (const role of ["viewer", "exec"]) {
      expect(canReveal(role, "pan")).toBe(false);
      expect(canReveal(role, "bank_account")).toBe(false);
      expect(() => revealFields(role, "pan")).toThrow(/may not reveal/);
    }
  });
});
