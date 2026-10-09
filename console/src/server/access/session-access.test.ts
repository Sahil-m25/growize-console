/* B-15 / B-26 — the session's one-person book carries the person's saved badge (colour, shape, initials from
   PUT /api/me/style), which was written and never read back; and the display name Zoho gave at sign-in.
   Synthetic ids; no store but an in-memory reader. */
import { describe, expect, it } from "vitest";
import { ZOHO_SEAT_OF_TOKEN } from "./guard-core";
import { NO_GRANTS } from "./policy";
import { sessionAccessOf } from "./session-access";
import { mobileOfCurrentUser, nameOfCurrentUser } from "../oauth/user-session";

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

describe("nameOfCurrentUser", () => {
  it("full_name, else first + last, tidied; nothing usable is null", () => {
    expect(nameOfCurrentUser({ users: [{ full_name: "  Asha   Rao " }] })).toBe("Asha Rao");
    expect(nameOfCurrentUser({ users: [{ first_name: "Asha", last_name: "Rao" }] })).toBe("Asha Rao");
    expect(nameOfCurrentUser({ users: [{ full_name: "A<b>\u0007sha" }] })).toBe("Absha");
    expect(nameOfCurrentUser({ users: [{}] })).toBeNull();
    expect(nameOfCurrentUser(null)).toBeNull();
  });
});

describe("sessionAccessOf with a name (B-15)", () => {
  it("fills n and initials; a saved badge's initials win; blank stays blank", async () => {
    const named = await sessionAccessOf(session, NO_GRANTS, undefined, "Asha Rao");
    expect(named?.lead).toMatchObject({ n: "Asha Rao", i: "AR" });
    const badge = await sessionAccessOf(session, NO_GRANTS, { get: async () => ({ i: "XY" }) }, "Asha Rao");
    expect(badge?.lead).toMatchObject({ n: "Asha Rao", i: "XY" });
    const blank = await sessionAccessOf(session, NO_GRANTS);
    expect(blank?.lead).toMatchObject({ n: "", i: "" });
  });
});

describe("B-26 reopened: the person's own mobile", () => {
  it("fills ph from the session's own Zoho user; none stays blank", async () => {
    expect((await sessionAccessOf(session, NO_GRANTS, undefined, "Asha Rao", "+91 90000 07781"))?.lead.ph).toBe("+91 90000 07781");
    expect((await sessionAccessOf(session, NO_GRANTS, undefined, "Asha Rao"))?.lead.ph).toBe("");
  });
  it("reads only the CurrentUser's own mobile (else phone), shown +91 XXXXX XXXXX", () => {
    expect(mobileOfCurrentUser({ users: [{ mobile: "+919000007781" }] })).toBe("+91 90000 07781");
    expect(mobileOfCurrentUser({ users: [{ mobile: null, phone: "080-2345 6789" }] })).toBe("080-2345 6789");
    expect(mobileOfCurrentUser({ users: [{ mobile: "9845033021" }] })).toBe("+91 98450 33021");
    expect(mobileOfCurrentUser({ users: [{}] })).toBeNull();
    expect(mobileOfCurrentUser(null)).toBeNull();
  });
});
