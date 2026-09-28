/* M19-S06-T01 — super-user PII masking: Digital Infrastructure reads every book, yet no read carries PAN, bank or Aadhaar (D52, D53, D68). */
import { describe, expect, it } from "vitest";
import { BOOKS, scopesFor } from "../data/scope";
import { checkProjection, isForbiddenField, PROJECTIONS } from "../data/projections";
import { REVEAL_ROLES } from "../../lib/zoho/identity";

const U = "9007199254740995001";

describe("super-user PII masking", () => {
  it("Digital Infrastructure (ops / di) has scope 'all' on every book", () => {
    for (const seat of ["ops", "di"]) for (const b of BOOKS) expect(scopesFor(seat, U)[b].kind).toBe("all");
  });
  it("no projection any seat reads with — the super user's included — names an identity field", () => {
    for (const [mod, fields] of Object.entries(PROJECTIONS)) {
      expect(fields.filter(isForbiddenField), mod).toEqual([]);
      expect(fields, mod).toContain("id");
    }
  });
  it("identity fields are refused by name and by pattern", () => {
    for (const f of ["pan", "bank_account", "Aadhaar_Number", "PAN_Number", "Bank_Name", "IFSC_Code", "KYC_Proof"]) expect(isForbiddenField(f), f).toBe(true);
    for (const f of ["Company", "Pancake_Day", "Full_Name"]) expect(isForbiddenField(f), f).toBe(false);
    expect(() => checkProjection("Contacts", ["id", "pan"])).toThrow(/identity fields/);
    expect(() => checkProjection("Contacts", ["Full_Name"])).toThrow(/selects id/);
  });
  it("revealing PAN or bank is Finance/Compliance only — never Digital Infrastructure", () => {
    for (const roles of Object.values(REVEAL_ROLES)) {
      expect(roles.some((r) => /digital|infra|ops|di|admin/i.test(r))).toBe(false);
    }
  });
});
