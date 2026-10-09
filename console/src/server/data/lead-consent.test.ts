/* B-03 — permission saved on a lead reads back: the live mapper (server/data/live.ts leadOf) turns the Lead's
   Consent_* fields into the console's consent flag, per-channel `con`, how, when and by whom. Synthetic rows only. */
import { describe, expect, it } from "vitest";
import { conFor } from "@/lib/selectors/leads";
import type { LeadRow } from "../leads/book";
import { leadOf } from "./live";

const ROW: LeadRow = {
  id: "554023000000700001", firstName: "Synthetic", lastName: "Lead", mobile: null, ownerId: "554023000000300004",
  secondaryOwnerId: null, coverById: null, coverUntil: null, source: "Website", status: null,
  createdAt: "2026-10-01T10:00:00+05:30", lostAt: null, onboardedAt: null, unitsInterested: null, nextStepAt: null,
  lastReplyAt: null, why: "owner",
};
const detail = (f: Record<string, unknown>) => ({ id: ROW.id, ...f });

describe("leadOf — Lead_Status (GC-1523)", () => {
  it("carries the blueprint's status when Zoho has one, and leaves it off when it has none", () => {
    expect(leadOf({ ...ROW, status: "Allocated" }, detail({})).status).toBe("Allocated");
    expect("status" in leadOf(ROW, detail({}))).toBe(false);
  });
});

describe("leadOf — permission (B-03)", () => {
  it("a lead with permission on WhatsApp and Call reads as consented on those channels only", () => {
    const l = leadOf(ROW, detail({ Consent_WhatsApp: true, Consent_Email: false, Consent_Call: true, Consent_How: "Verbal",
      Consent_At: "2026-10-07T23:32:00+05:30", Consent_By: { id: "554023000000300004" } }));
    expect(l.consent).toBe(true);
    expect(l.con).toEqual({ msg: true, email: false, call: true });
    expect(conFor(l, "call")).toBe(true);
    expect(conFor(l, "msg")).toBe(true);
    expect(conFor(l, "email")).toBe(false);
    expect(l.conHow).toBe("person");
    expect(l.conAt).toBe("07 Oct 23:32");
    expect(l.conAtIso).toBe("2026-10-07T23:32");
    expect(l.conBy).toBe("554023000000300004");
  });
  it("no channel granted (or none recorded) is not consent", () => {
    expect(leadOf(ROW, detail({ Consent_WhatsApp: false, Consent_Email: false, Consent_Call: false })).consent).toBe(false);
    const bare = leadOf(ROW, detail({}));
    expect(bare.consent).toBe(false);
    expect(conFor(bare, "call")).toBe(false);
    expect(bare).not.toHaveProperty("conAtIso");
  });
  it("permission given on a call reads back as a call, not in person", () => {
    expect(leadOf(ROW, detail({ Consent_Call: true, Consent_How: "Call" })).conHow).toBe("call");
    expect(leadOf(ROW, detail({ Consent_Call: true, Consent_How: "Verbal" })).conHow).toBe("person");
  });
  it("visits stay closed until a ruling says otherwise (Leads has no Consent_Visit)", () => {
    expect(conFor(leadOf(ROW, detail({ Consent_Call: true })), "visit")).toBe(false);
  });
});
