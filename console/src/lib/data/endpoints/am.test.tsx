/* M09-S04-W2 / M09-S02-W2 — the account-management list endpoint (GET /api/investors/am/managers): the path, and the fixture half for the
   Head of AM, a KAM and a refused seat, asserting the figures TC-IM04-014 reads off the manager dropdown ("Neha Bhandari — 4 accounts"). */
import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImState } from "@/lib/im";
import type { ApiResult } from "../api";
import { amManagers } from "./investors";

const book = (me: string) => ({ s: { data: imDemoData(), ui: initialImUi() } as ImState, me });
const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };

describe("the account-management list", () => {
  it("path: only an account-management seat reads GET /api/investors/am/managers", () => {
    expect(amManagers.path(true)).toBe("/api/investors/am/managers");
    expect(amManagers.path(false)).toBeNull();
  });
  it("Divya (Head of AM): the managers with their accounts, Neha with 4; the pool with one account that should be named; 13 rows", () => {
    const d = data(amManagers.fixture(book("divya"), true));
    expect(d.book).toBe("head");
    expect(d.managers.map(m => [m.name, m.accounts])).toEqual(expect.arrayContaining([["Neha Bhandari", 4], ["Imran Sheikh", 4]]));
    expect(d.managers.every(m => m.tiers.A + m.tiers.B + m.tiers.C === m.accounts)).toBe(true);
    expect(d.pool?.shouldBeNamed).toBe(1);
    expect(d.accounts).toHaveLength(13);
    expect(d.accounts.find(a => a.name === "Vikram Anand")).toMatchObject({ kamUserId: null, tier: "B" });
  });
  it("Imran (KAM): his own row and no pool; his four accounts, none of them Prakash Bhat", () => {
    const d = data(amManagers.fixture(book("imran"), true));
    expect([d.book, d.managers.map(m => m.id), d.pool]).toEqual(["kam", ["imran"], null]);
    expect(d.accounts.map(a => a.name)).toEqual(expect.arrayContaining(["Radhika Menon", "Sanjay Kulkarni", "Fatima Zaidi", "Deepak Chandra"]));
    expect(d.accounts).toHaveLength(4);
  });
  it("a seat that is not account management is refused 403, as the route refuses it", () => {
    const r = amManagers.fixture(book("harsha"), true);
    expect(!r.ok && [r.status, r.code]).toEqual([403, "seat-denied"]);
  });
});
