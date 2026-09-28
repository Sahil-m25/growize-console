/* M19-S06-T01 — seat permissions (may / hasCap equivalents) through the server's own door (D60, D68).
 * Imports the real modules only: server/access/policy.ts over lib/selectors/access.ts. */
import { describe, expect, it } from "vitest";
import { admitZohoSeat, readGrants, seatAccess, ZOHO_SEAT_SIDES, type GrantReader } from "../access/policy";

const WHO = "9007199254740995001";

describe("seat permissions — the server asks the front end's own may/hasCap", () => {
  it("refuses Administrator-profile seats before the policy is asked (corporate root, Digital Infrastructure)", () => {
    for (const seat of ["corporate-root", "digital-infrastructure"] as const) {
      expect(admitZohoSeat(seat, WHO, {})).toEqual({ ok: false, code: "no-seat", reason: "administrator-profile" });
      expect(seatAccess(seat, WHO, {}).may("leads", "view")).toBe(false);
    }
  });
  it("refuses an unknown Zoho seat as no-seat", () => {
    expect(admitZohoSeat("marketing" as never, WHO, {})).toEqual({ ok: false, code: "no-seat", reason: "unknown-role" });
  });
  it("a granted-only seat (BU owner, channel partner, viewer) has no console until a page is granted", () => {
    for (const seat of ["business-unit-owner", "channel-partner", "viewer"] as const) {
      expect(admitZohoSeat(seat, WHO, {})).toEqual({ ok: false, code: "no-grant", reason: "no-grant" });
      expect(seatAccess(seat, WHO, {}).reach).toEqual([]);
    }
  });
  it("an IR works leads but cannot manage the roster or reach Teams/System", () => {
    const a = seatAccess("investor-relations", WHO, {});
    expect(a.admission).toMatchObject({ ok: true, lead: "ir", im: null });
    expect(a.may("leads", "view")).toBe(true);
    expect(a.may("leads", "edit")).toBe(true);
    expect(a.hasCap("leads", "edit")).toBe(true);
    expect(a.may("people", "roster")).toBe(false);
    expect(a.reach).not.toContain("people");
    expect(a.reach).not.toContain("system");
  });
  it("the IR Manager reaches Teams and may roster; reach never exceeds the seat's ceiling", () => {
    const a = seatAccess("ir-manager", WHO, {});
    expect(a.may("people", "roster")).toBe(true);
    expect(a.reach).toContain("people");
    for (const p of a.reach) expect(a.ceiling).toContain(p);
  });
  it("Finance seats sign in on the Investors side only: no lead page, and only pay-seats hold pay", () => {
    for (const seat of ["head-of-finance", "finance-operations", "compliance-audit"] as const) {
      const a = seatAccess(seat, WHO, {});
      expect(a.admission).toMatchObject({ ok: true, sides: { leads: false, investors: true } });
      expect(a.may("leads", "view")).toBe(false);
    }
    expect(seatAccess("head-of-finance", WHO, {}).imCan("pay" as never)).toBe(true);
    expect(seatAccess("compliance-audit", WHO, {}).imCan("pay" as never)).toBe(false);
  });
  it("every Zoho seat maps to exactly one lead seat", () => {
    for (const [seat, sides] of Object.entries(ZOHO_SEAT_SIDES)) expect(typeof sides.lead, seat).toBe("string");
  });
  it("a grant lookup that throws or answers nonsense counts as no grant (fail closed)", async () => {
    const throwing: GrantReader = { grantsOf: () => { throw new Error("down"); } };
    const junk: GrantReader = { grantsOf: () => ["leads"] as never };
    const mixed: GrantReader = { grantsOf: () => ({ leads: ["view", 7, null], docs: "view" }) as never };
    expect(await readGrants(throwing, WHO, "bu")).toEqual({});
    expect(await readGrants(junk, WHO, "bu")).toEqual({});
    expect(await readGrants(mixed, WHO, "bu")).toEqual({ leads: ["view"] });
  });
});
