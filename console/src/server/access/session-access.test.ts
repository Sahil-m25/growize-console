/* B-15 / B-26 — the session's one-person book carries the person's saved badge (colour, shape, initials from
   PUT /api/me/style), which was written and never read back. Synthetic ids; no store but an in-memory reader. */
import { describe, expect, it } from "vitest";
import { ZOHO_SEAT_OF_TOKEN } from "./guard-core";
import { NO_GRANTS } from "./policy";
import { sessionAccessOf } from "./session-access";

const WHO = "554023000000300004";
const token = Object.entries(ZOHO_SEAT_OF_TOKEN).find(([, s]) => s === "investor-relations")?.[0] ?? Object.keys(ZOHO_SEAT_OF_TOKEN)[0]!;
const session = { who: WHO, seat: token };

describe("sessionAccessOf — saved badge (B-15/B-26)", () => {
  it("overlays the saved colour, shape and initials on the person", async () => {
    const a = await sessionAccessOf(session, NO_GRANTS, { get: async () => ({ c: 5, sq: true, i: "IA" }) });
    expect(a?.lead).toMatchObject({ c: 5, sq: true, i: "IA" });
    if (a?.im) expect(a.im).toMatchObject({ c: 5, i: "IA" });
  });
  it("no reader, a failed read or nonsense is no badge, never a refusal", async () => {
    const plain = await sessionAccessOf(session, NO_GRANTS);
    expect(plain?.lead.i).toBe("");
    const failed = await sessionAccessOf(session, NO_GRANTS, { get: async () => { throw new Error("store down"); } });
    expect(failed?.lead).toEqual(plain?.lead);
    const junk = await sessionAccessOf(session, NO_GRANTS, { get: async () => ({ c: 99, i: "toolong" }) as never });
    expect(junk?.lead).toEqual(plain?.lead);
  });
});
