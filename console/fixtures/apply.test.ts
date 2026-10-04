import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoBook } from "./book";
import { applyFixtures, FIXTURES } from "./apply";
import { resolveFixture } from "@/lib/fixture-mode";
import { initialState, reducer } from "@/lib/state";
import { admitted } from "@/lib/data/admission";
import { nowT, pinClock } from "@/lib/format";
import { reviveClock } from "@/lib/data/clock";

const root = path.resolve(__dirname, "..", "..");
const catalogue = JSON.parse(readFileSync(path.join(root, "pm/merge-audit/ui-sahil/fixtures-merged.json"), "utf8")) as Record<string, unknown>;
const cases = (JSON.parse(readFileSync(path.join(root, "pm/plan-merged/ui-cases.json"), "utf8")) as { cases: { fixtures?: string[] }[] }).cases;
const cited = [...new Set(cases.flatMap((c) => c.fixtures || []))];
const apply = (...names: string[]) => applyFixtures(demoBook(), names);

describe("the fixture registry", () => {
  it("registers every fixture ui-cases.json cites, under its catalogue name", () => {
    expect(cited.length).toBeGreaterThan(40);
    const missing = cited.filter((n) => { const k = resolveFixture(n, catalogue); return !k || !FIXTURES[k]; });
    expect(missing).toEqual([]);
  });
  it("registers every catalogue entry (the __C/__E/__F variants included)", () => {
    expect(Object.keys(catalogue).filter((k) => !FIXTURES[k])).toEqual([]);
  });
  it("applies every registered fixture to the demo book without throwing", () => {
    for (const k of Object.keys(FIXTURES)) expect(() => apply(k), k).not.toThrow();
  });
});

describe("record edits", () => {
  it("KAVYA_DEACTIVATED takes Kavya off the record and off the sign-in list", () => {
    const { ds } = apply("KAVYA_DEACTIVATED");
    expect(ds.PEOPLE.kavya!.on).toBe(false);
    expect(admitted(ds)).not.toContain("kavya");
    expect(admitted(ds)).toContain("rohit");
  });
  it("GOKUL_ACTIVE puts Gokul back on, still with no page granted", () => {
    const { ds } = apply("GOKUL_ACTIVE");
    expect(ds.PEOPLE.gokul!.on).toBe(true);
    expect(admitted(ds)).not.toContain("gokul");
  });
  it("L2_NDA_TOLD_BY_WHATSAPP, L4_NDA_DOC_WAITING, L4_NO_NEXT_STEP, UPDATES_TODAY_L4_L5", () => {
    const { ds } = apply("L2_NDA_TOLD_BY_WHATSAPP", "L4_NDA_DOC_WAITING", "L4_NO_NEXT_STEP", "UPDATES_TODAY_L4_L5");
    expect(ds.PAPER.L2!.nda!.told).toMatchObject({ by: "rohit", ch: "msg" });
    expect(ds.DOCS.find((d) => d.id === "D-099")).toMatchObject({ lead: "L4", state: "sent", by: "harsha" });
    expect(ds.LEADS.find((l) => l.id === "L4")!.nx).toBeNull();
    expect(ds.LOG[0]).toMatchObject({ d: "2026-08-28", who: "harsha", what: "NDA signed copy verified", lead: "L4" });
  });
  it("GIRISH_SAID_YES_TODAY and NO_TRANSFERS move the ladder", () => {
    expect(apply("GIRISH_SAID_YES_TODAY").ds.LEADS.find((l) => l.id === "L3")!.done).toBe(5);
    expect(apply("NO_TRANSFERS").ds.LEADS.every((l) => l.done < 5)).toBe(true);
  });
  it("IM:HOLD_EXPIRED_PRAKASH sets ARL-INV-0208's hold to 30 Aug", () => {
    const { ds } = apply("IM:HOLD_EXPIRED_PRAKASH");
    expect(ds.im.INV.find((i) => i.id === "ARL-INV-0208")!.hold).toBe("30 Aug");
  });
  it("IM:PRAKASH_PAID_LETTER_OUT pays Prakash and sends the allocation letter", () => {
    const { ds } = apply("IM:PRAKASH_PAID_LETTER_OUT");
    const x = ds.im.INV.find((i) => i.id === "ARL-INV-0208")!;
    expect(x.st).toBe("paid");
    expect(x.hold).toBeUndefined();
    expect(ds.im.TXN[0]).toMatchObject({ id: "T-0049", rec: "matched" });
    expect(ds.im.APP["ARL-INV-0208"]!.mark).toBe("permanent");
    expect(ds.im.DOCS[0]).toMatchObject({ id: "D-045", state: "awaiting" });
  });
  it("IM:KIRAN_ON_FULL_BLOCK_B cuts block B to 11 and adds Kiran Rao", () => {
    const { ds } = apply("IM:KIRAN_ON_FULL_BLOCK_B");
    expect(ds.im.FARMS.find((f) => f.k === "B")!.released).toBe(11);
    expect(ds.im.INV.some((i) => i.id === "ARL-INV-0220" && i.n === "Kiran Rao")).toBe(true);
  });
  it("L3_NDA_SENT_BACK leaves Girish Rao's NDA round holding Finance's word that it is not signed", () => {
    const { ds } = apply("L3_NDA_SENT_BACK");
    const r = ds.PAPER.L3!.nda!;
    expect(r.back).toMatchObject({ by: "harsha" });
    expect(r.back!.why).toMatch(/nothing has come back signed/);
    expect(r.said).toBeUndefined();
    expect(r.ok).toBeUndefined();
  });
  it("IM:ALLOTMENT_NO_CUSTOMER adds an allotment on Block A with no Customer", () => {
    const { ds } = apply("IM:ALLOTMENT_NO_CUSTOMER");
    expect(ds.im.ALLOT!.find((a) => a.id === "AL-ORPHAN-1")).toMatchObject({ Customer: "", LLP_Lookup: "LLP-A" });
    expect(applyFixtures(demoBook(), []).ds.im.ALLOT!.some((a) => a.id === "AL-ORPHAN-1")).toBe(false);
  });
  it("IM:ALLOTMENT_NO_LLP empties the LLP on Fatima Zaidi's allotment", () => {
    const { ds } = apply("IM:ALLOTMENT_NO_LLP");
    expect(ds.im.ALLOT!.find((a) => a.Customer === "ARL-INV-0213")!.LLP_Lookup).toBe("");
  });
  it("leaves the book it was given alone", () => {
    const book = demoBook();
    applyFixtures(book, ["KAVYA_DEACTIVATED"]);
    expect(book.PEOPLE.kavya!.on).toBe(true);
  });
});

describe("writes made as a person run the console's own reducer", () => {
  it("E04_SHEET_LOADED_BY_ROHIT loads 31 new leads round-robin: Kavya 11, Rohit 10, Nikhil 10", () => {
    const before = demoBook();
    const { ds } = apply("E04_SHEET_LOADED_BY_ROHIT");
    const fresh = ds.LEADS.filter((l) => !before.LEADS.some((b) => b.id === l.id));
    expect(fresh.length).toBe(31);
    const by = (k: string) => fresh.filter((l) => l.own === k).length;
    expect([by("kavya"), by("rohit"), by("nikhil")]).toEqual([11, 10, 10]);
    expect(ds.SHEET["E-04"]).toMatchObject({ state: "loaded", loadedBy: "rohit" });
    expect(ds.LOG[0]).toMatchObject({ who: "rohit", what: "Loaded the event sheet" });
  });
  it("RITU_ASSIGNED_TO_KAVYA_TODAY gives Ritu Anand to Kavya", () => {
    const { ds } = apply("RITU_ASSIGNED_TO_KAVYA_TODAY");
    expect(ds.LEADS.find((l) => l.n === "Ritu Anand")!.own).toBe("kavya");
  });
  it("JHALAK_GRANTED_LEADS grants Jhalak 'See it' on Leads, so the sign-in screen offers her", () => {
    expect(admitted(demoBook())).not.toContain("jhalak");
    const { ds } = apply("JHALAK_GRANTED_LEADS");
    expect(ds.GRANT.jhalak!.leads).toContain("view");
    expect(admitted(ds)).toContain("jhalak");
    expect(ds.LOG[1]).toMatchObject({ who: "sahil", what: "Changed access" });
  });
  it("DEEPA_LOST_AFTER_YES closes L5 as lost, 'Price too high'", () => {
    const { ds } = apply("DEEPA_LOST_AFTER_YES");
    const l = ds.LEADS.find((x) => x.id === "L5")!;
    expect(JSON.stringify(l)).toContain("Price too high");
  });
});

describe("the clock", () => {
  it("CLOCK_28AUG_1000 and CLOCK_28AUG_1536 pin the hour nowT reads", () => {
    for (const [n, hm] of [["CLOCK_28AUG_1000", "10:00"], ["CLOCK_28AUG_1536", "15:36"], ["CLOCK_28AUG_1000__E", "10:00"]] as const) {
      const { ds } = apply(n);
      expect(ds.CLOCKPIN).toBe(hm);
      pinClock(ds.CLOCKPIN);
      const t = nowT(reviveClock(ds.NOW));
      pinClock(null);
      expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([28, +hm.slice(0, 2), +hm.slice(3)]);
    }
  });
  it("stamps a later fixture's write at the pinned hour", () => {
    const { ds } = apply("CLOCK_28AUG_1536", "GIRISH_SAID_YES_TODAY");
    expect(ds.LEADS.find((l) => l.id === "L3")!.at[4]).toBe("28 Aug 15:36");
  });
});

describe("client actions", () => {
  const hydrated = (names: string[]) => {
    const { ds, actions } = apply(...names);
    let s = reducer(initialState(ds), { type: "hydrate", ds, version: 1, fixtures: true });
    for (const x of actions) s = reducer(s, x.a);
    return { s, actions };
  };
  it("KAVYA_SESSION_EXPIRED leaves the sign-in screen saying the session expired", () => {
    const { s } = hydrated(["KAVYA_SESSION_EXPIRED"]);
    expect(s.authed).toBe(false);
    expect(s.SIGNOUT).toBe("expired");
  });
  it("NEXT_SAVE_REFUSED arms the one-shot failure on the next sign-in", () => {
    const { s } = hydrated(["DEMO_DATA", "NEXT_SAVE_REFUSED"]);
    expect(reducer(s, { type: "signIn", k: "rohit" }).FAILNEXT).toBe(true);
  });
  it("SIDE_INVESTORS opens the two-sided pages on their Investors half once signed in", () => {
    const { ds, actions } = apply("SIDE_INVESTORS");
    let s = reducer(reducer(initialState(ds), { type: "hydrate", ds, version: 1, fixtures: true }), { type: "signIn", k: "sahil" });
    for (const x of actions) s = reducer(s, x.a);
    expect(s.MSIDE).toMatchObject({ today: "im", activity: "im", numbers: "im", system: "im" });
  });
  it("BROWSER_OFFLINE asks the client to go offline, tagged once per applied fixture", () => {
    const { actions } = apply("DEMO_STAFF", "BROWSER_OFFLINE");
    expect(actions).toEqual([{ fx: "1:BROWSER_OFFLINE:0", a: { type: "fixture", k: "offline" } }]);
  });
});
