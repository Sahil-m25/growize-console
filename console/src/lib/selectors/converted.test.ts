/* GC-1523 — a converted lead is read-only on the lead side (owner, 9 Oct: "Issued means they have paid … we should have
   them under contacts and not leads"). Converted = the journey reached Reserved, or Lead_Status says the money is in, or
   the investor record from this lead holds a live allotment. Then: no next step owed, no SLA chip, off Today and the default
   Leads list, still found by search and by its own cut, and no write the IR can make. */
import { beforeAll, describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { ST } from "@/domain";
import type { Lead, PersonKey } from "@/domain";
import { pinClock } from "@/lib/format";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import {
  canEdit, converted, EXC, investorFor, lateOf, needsNext, nextUp, noNext, passes, ragOf, todayList, whyLocked, workGroup,
  type LeadFilters,
} from "@/lib/selectors";
import { linkInvestors } from "@/server/data/live";
import type { ImInvestor } from "@/lib/im";

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
beforeAll(() => pinClock("10:00"));
const F: LeadFilters = { LQ: "", LFILT: null, LSRC: null, LSTAGE: null, LSTAGEMODE: "at", LOWN: null, LLOST: false, LQUIET: null };
const base = { done: ST.CONVERTED, lost: null } as unknown as Lead;

describe("converted(l) — the rule", () => {
  it("Reserved or beyond on the stamps is converted; Said yes alone is not", () => {
    expect(converted({ ...base, done: ST.RESERVED })).toBe(true);
    expect(converted({ ...base, done: ST.ALLOCATED })).toBe(true);
    expect(converted(base)).toBe(false);
  });
  it("Lead_Status says the money is in, even when the stamps lag (the owner's 'not moved forward' lead)", () => {
    for (const s of ["Converted", "Fully paid", "Allocated", "Onboarded"]) expect(converted({ ...base, status: s })).toBe(true);
    expect(converted({ ...base, status: "Investor said yes" })).toBe(false);
  });
  it("an investor record with a live allotment converts it; one that has only said yes does not", () => {
    expect(converted({ ...base, investor: { id: "c1", code: "ARL-INV-0901", st: "allocated" } })).toBe(true);
    expect(converted({ ...base, investor: { id: "c1", code: "ARL-INV-0901", st: "reserved" } })).toBe(true);
    expect(converted({ ...base, investor: { id: "c1", code: "ARL-INV-0901", st: "said yes" } })).toBe(false);
    expect(converted({ ...base, investor: { id: "c1", code: "ARL-INV-0901", st: "lapsed" } })).toBe(false);
  });
  it("a lead closed as lost is never converted", () => {
    expect(converted({ ...base, done: ST.RESERVED, lost: { why: "Price too high" } } as unknown as Lead)).toBe(false);
  });
});

describe("linkInvestors — the lead's investor out of the Contacts this person already read", () => {
  it("links by Origin_Lead, and leaves a lead with no readable Contact alone", () => {
    const leads = [{ id: "L1" }, { id: "L2" }] as unknown as Lead[];
    const inv = [{ id: "C1", code: "ARL-INV-0901", st: "allocated", lead: "L1" }] as unknown as ImInvestor[];
    const out = linkInvestors(leads, inv);
    expect(out[0].investor).toEqual({ id: "C1", code: "ARL-INV-0901", st: "allocated" });
    expect(out[1].investor).toBeUndefined();
  });
});

describe("a converted lead in Rohit's book", () => {
  /* one of Rohit's working leads that Today lists, turned converted the way the live book reads it */
  let s: ConsoleState, l: Lead;
  const make = () => {
    const s0 = as("rohit");
    const pick = todayList(s0).find((x) => x.done >= ST.TOUCH && x.done < ST.RESERVED)!;
    expect(pick).toBeTruthy();
    const conv: Lead = { ...pick, status: "Allocated", investor: { id: "C-901", code: "ARL-INV-0901", st: "allocated" } };
    return { s: { ...s0, LEADS: s0.LEADS.map((x) => (x.id === pick.id ? conv : x)) }, l: conv };
  };
  beforeAll(() => { ({ s, l } = make()); });

  it("owes no next step and runs no clock: no 'Next step missing', no breach chip", () => {
    expect(needsNext(l)).toBe(false);
    expect(noNext(l)).toBe(false);
    expect(lateOf(l, s.NOW)).toBe(0);
    expect(ragOf(s, l).c).toBe("green");
    expect(EXC.nonext[1](s, l)).toBe(false);
    expect(EXC.overdue[1](s, l)).toBe(false);
  });
  it("its next line names the investor, offers no action, and is not 'Log a contact' work", () => {
    const u = nextUp(s, l);
    expect(u.t).toBe("Converted · investor ARL-INV-0901");
    expect([u.act, u.kind, u.urg]).toEqual([null, "closed", "ok"]);
    expect(workGroup(s, l)).toBe("upcoming");
  });
  it("is off Today and off the default Leads list, but found by search and by its own cut", () => {
    expect(todayList(s).some((x) => x.id === l.id)).toBe(false);
    expect(passes(s, l, F)).toBe(false);
    expect(passes(s, l, { ...F, LQ: l.n })).toBe(true);
    expect(passes(s, l, { ...F, LFILT: "converted" })).toBe(true);
    expect(EXC.converted[1](s, l)).toBe(true);
  });
  it("is read-only: no write is the IR's, and the page says why", () => {
    expect(canEdit(s, l)).toBe(false);
    expect(whyLocked(s, l)).toMatch(/^Converted/);
  });
  it("the investor it became: the live link first, else the Investors book's Contact from this lead", () => {
    expect(investorFor(s, l)).toEqual({ id: "C-901", code: "ARL-INV-0901" });
    const bare: Lead = { ...l, investor: undefined };
    const withBook = { ...s, IM: { ...s.IM, INV: [{ ...(s.IM.INV[0] as ImInvestor), id: "C-902", code: "ARL-INV-0902", lead: l.id }] } };
    expect(investorFor(withBook, bare)).toEqual({ id: "C-902", code: "ARL-INV-0902" });
    expect(investorFor(s, { ...bare, id: "nope" as Lead["id"] })).toBeNull();
  });
});
