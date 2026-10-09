import { describe, expect, it } from "vitest";
import { describeChange } from "./history-words";

describe("W4-4: record of changes in plain words", () => {
  it("a rung stamp names the journey rung", () => expect(describeChange({ action: "updated", fields: ["Said_Yes_At"] })).toBe("Moved to Investor said yes"));
  it("next-step fields read as planning the next step", () =>
    expect(describeChange({ action: "updated", fields: ["Next_Step_Channel", "Next_Step_At"] })).toBe("Planned the next step"));
  it("a reply with a next step", () =>
    expect(describeChange({ action: "updated", fields: ["Last_Reply_At", "Next_Step_At"] })).toBe("Logged a reply and planned the next step"));
  it("the consent block is one phrase, no raw names", () => {
    const t = describeChange({ action: "updated", fields: ["Consent_WhatsApp", "Consent_Email", "Consent_Call", "Consent_How", "Consent_At", "Consent_By"] });
    expect(t).toBe("Recorded consent");
  });
  it("unknown fields are lower-cased words, not api names", () => expect(describeChange({ action: "updated", fields: ["Lead_Source", "Weird_Field"] })).toBe("Updated source and weird field"));
  it("a bare Added says what it is", () => {
    expect(describeChange({ action: "added", fields: [] })).toBe("Added a note, touch or task");
    expect(describeChange({ action: "added", fields: [] }, true)).toBe("Lead record created");
  });
  it("never prints an underscore or 'Updated:'", () => {
    for (const f of ["Said_Yes_At", "Next_Step_Channel", "Consent_By", "Some_Field"]) expect(describeChange({ action: "updated", fields: [f] })).not.toMatch(/_|Updated:/);
  });
});
