/* W3-2: the live investor carries the origin lead's NAME (Origin_Lead lookup), so no screen prints the lead's record id. */
import { describe, expect, it } from "vitest";
import { parseContact } from "./contact-row";
import { investorOf } from "./live";

const ID = "1454168000003024655";
const LEAD = "1454168000003022169";
const rec = (origin: unknown) => ({ id: ID, Last_Name: "Menon", First_Name: "Radhika", ARL_ID: "ARL-INV-0206", Origin_Lead: origin }) as never;

describe("origin lead name", () => {
  it("parseContact keeps the lookup's name beside its id; investorOf carries both", () => {
    const c = parseContact(rec({ id: LEAD, name: "Radhika Menon" }))!;
    expect(c.originLeadId).toBe(LEAD);
    expect(c.originLeadName).toBe("Radhika Menon");
    const x = investorOf(c, [], () => "");
    expect(x.lead).toBe(LEAD);
    expect(x.leadName).toBe("Radhika Menon");
  });
  it("a lookup with no name (or a bare id) carries no leadName", () => {
    expect(investorOf(parseContact(rec({ id: LEAD }))!, [], () => "").leadName).toBeUndefined();
    expect(investorOf(parseContact(rec(LEAD))!, [], () => "").leadName).toBeUndefined();
  });
});
