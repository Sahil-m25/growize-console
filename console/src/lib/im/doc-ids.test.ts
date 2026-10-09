import { describe, expect, it } from "vitest";
import { docRecordWords, investorCode } from "./doc-ids";

describe("W4-E-1: Documents shows ARL IDs, not Zoho ids", () => {
  const x = { id: "1454168000003024657", code: "ARL-INV-0208" };
  it("investorCode prefers the code and never returns a Zoho id", () => {
    expect(investorCode(x)).toBe("ARL-INV-0208");
    expect(investorCode({ id: "1454168000003024657" }, "1454168000003024657")).toBe("");
    expect(investorCode({ id: "ARL-INV-0209" })).toBe("ARL-INV-0209"); /* the demo book's id is already the code */
    expect(investorCode(null, "ARL-INV-0210")).toBe("ARL-INV-0210");
  });
  it("row sub-lines carry the ARL ID and the block", () => {
    expect(docRecordWords({ module: "Allotments", recordId: "1454168000003024816", party: "Prakash Bhat / B" }, "ARL-INV-0208")).toBe("Allotment · Block B");
    expect(docRecordWords({ module: "Contacts", recordId: "1454168000003024657", party: "Prakash Bhat" }, "ARL-INV-0208")).toBe("Personal · ARL-INV-0208");
    expect(docRecordWords({ module: "Allotments", recordId: "1454168000003024816", party: null }, "")).toBe("Allotment");
  });
});
