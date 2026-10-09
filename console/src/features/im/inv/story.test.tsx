/* GC-1524 — the investor record's Journey tab is the main view and tells the whole story in place: lead-side milestones
   (from the origin lead's stamps when the viewer reads them, else the Contact's own), a touches summary, then the investor
   side (reserved, fully paid, allocated, app account, KAM, onboarded), with "Open lead ›" kept as a secondary link.
   storyOf is the pure half of server/investors/story; the render is StoryJourney with a synthetic record. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImInvestor } from "@/lib/im";
import type { InvestorRecord } from "@/server/investors/record";
import { storyOf, touchSummary, type InvestorStory } from "@/server/investors/story";

const h = vi.hoisted(() => ({ card: null as unknown, asked: [] as unknown[] }));
vi.mock("@/features/leads/nav", () => ({ useGoLead: () => () => {} }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return { ...real, useApiRead: (_ep: unknown, _b: unknown, id: unknown) => { h.asked.push(id); return id && h.card ? { state: "ok", data: { card: h.card } } : { state: "idle" }; } };
});
const { StoryJourney, journeyFirst, touchLine } = await import("./Story");

const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const CONTACT = { saidYesAt: "2026-08-20T11:00", createdAt: "2026-08-21T09:00", kamId: null, kamSince: null };
const LEAD = { id: "554023000000700001", Created_Time: "2026-07-01T10:00:00+05:30", First_Touch_At: "2026-07-01T12:00:00+05:30",
  Qualified_At: "2026-07-10T12:00:00+05:30", Engaged_At: "2026-07-20T12:00:00+05:30", Said_Yes_At: "2026-08-20T11:00:00+05:30",
  Reserved_At: "2026-08-25T10:00:00+05:30", Fully_Paid_At: null, Allocated_At: null, Onboarded_At: null };
const receipt = (o: object) => ({ id: "r", allotmentId: "a", kind: "Advance", amount: 1, mode: null, utr: null, on: "2026-08-24", byId: null, matched: true, matchState: "Matched", reversalOf: null, ...o });

describe("storyOf — the story from what this seat read", () => {
  it("with the lead readable: captured → said yes from its stamps, Reserved from its stamp", () => {
    const st = storyOf({ contact: CONTACT, lead: LEAD, allotments: [{ Allocation_Status: "Reserved", Issued_On: null }], money: null, touches: null });
    expect(st.leadSide).toBe("lead");
    expect(st.steps.filter((e) => e.side === "lead").map((e) => [e.t, e.done, e.src])).toEqual([
      ["Lead captured", true, "lead"], ["First touch made", true, "lead"], ["Qualified", true, "lead"], ["Engagement done", true, "lead"], ["Investor said yes", true, "lead"]]);
    const inv = Object.fromEntries(st.steps.filter((e) => e.side === "investor").map((e) => [e.k, e]));
    expect([inv.Reserved_At.done, inv.Reserved_At.at, inv.Reserved_At.src]).toEqual([true, LEAD.Reserved_At, "lead"]);
    expect([inv.Fully_Paid_At.done, inv.Allocated_At.done, inv.KAM_Since.done, inv.Onboarded_At.done]).toEqual([false, false, false, false]);
  });
  it("with the lead not readable: the Contact's Said_Yes_At stands in, and an Issued allotment means paid and allocated", () => {
    const st = storyOf({ contact: { ...CONTACT, kamId: "554023000000300009", kamSince: "2026-09-02T10:00" }, lead: null,
      allotments: [{ Allocation_Status: "Issued", Issued_On: "2026-09-01" }, { Allocation_Status: "Cancelled", Issued_On: null }], money: null, touches: null });
    expect(st.leadSide).toBe("contact");
    expect(st.steps.filter((e) => e.side === "lead").map((e) => [e.t, e.at, e.src])).toEqual([["Investor said yes", "2026-08-20T11:00", "contact"]]);
    const inv = Object.fromEntries(st.steps.filter((e) => e.side === "investor").map((e) => [e.k, e]));
    expect([inv.Reserved_At.done, inv.Fully_Paid_At.done, inv.Allocated_At.at, inv.Allocated_At.src]).toEqual([true, true, "2026-09-01", "allotment"]);
    expect([inv.KAM_Since.done, inv.KAM_Since.at, inv.KAM_Since.who]).toEqual([true, "2026-09-02T10:00", "554023000000300009"]);
  });
  it("a Money seat dates reserved and fully paid off the matched receipts; a refund or an unmatched one is not money in", () => {
    const st = storyOf({ contact: CONTACT, lead: null, allotments: [{ Allocation_Status: "Reserved", Issued_On: null }],
      money: { paid: 2_500_000, due: 0, receipts: [receipt({}), receipt({ kind: "Balance", on: "2026-09-10" }), receipt({ kind: "Balance", on: "2026-09-30", matched: false }), receipt({ kind: "Refund", on: "2026-10-01" })] }, touches: null });
    const inv = Object.fromEntries(st.steps.map((e) => [e.k, e]));
    expect([inv.Reserved_At.at, inv.Reserved_At.src]).toEqual(["2026-08-24", "receipt"]);
    expect([inv.Fully_Paid_At.done, inv.Fully_Paid_At.at]).toEqual([true, "2026-09-10"]);
  });
  it("touchSummary counts human touches by channel and replies apart, first and last by Occurred_At", () => {
    const t = touchSummary([
      { id: "1", Channel: "WhatsApp", Occurred_At: "2026-07-01T12:00:00+05:30" }, { id: "2", Channel: "Call", Occurred_At: "2026-07-05T12:00:00+05:30" },
      { id: "3", Channel: "WhatsApp", Occurred_At: "2026-07-09T12:00:00+05:30" }, { id: "4", Is_Reply: true, Occurred_At: "2026-07-10T09:00:00+05:30" },
    ]);
    expect(t).toEqual({ total: 3, byChannel: { WhatsApp: 2, Call: 1 }, replies: 1, first: "2026-07-01T12:00:00+05:30", last: "2026-07-10T09:00:00+05:30" });
    expect(touchLine(t)).toBe("3 touches · WhatsApp 2 · Call 1 · 1 reply · first 01 Jul 12:00 · last 10 Jul 09:00");
  });
});

describe("journeyFirst — the record opens on Journey", () => {
  it("moves jrn to the front and keeps the rest in order; a record without it is unchanged", () => {
    expect(journeyFirst(["who", "hold", "money", "paper", "jrn", "tkt"])).toEqual(["jrn", "who", "hold", "money", "paper", "tkt"]);
    expect(journeyFirst(["who", "hold"])).toEqual(["who", "hold"]);
  });
});

describe("StoryJourney — the whole story, in place", () => {
  const s = { data: imDemoData(), ui: initialImUi() };
  const x = { id: "554023000000900001", n: "Synthetic Investor", lead: LEAD.id } as unknown as ImInvestor;
  const story: InvestorStory = storyOf({ contact: CONTACT, lead: LEAD, allotments: [{ Allocation_Status: "Reserved", Issued_On: null }], money: null,
    touches: touchSummary([{ id: "1", Channel: "Email", Occurred_At: "2026-07-01T12:00:00+05:30" }]) });
  const rec = { origin: { leadId: LEAD.id, irId: null, irVia: null, saidYesAt: null }, story } as unknown as InvestorRecord & { story: InvestorStory };
  it("lead side, touches and investor side, with Open lead › kept as a secondary link", () => {
    h.card = { openedAt: "2026-08-26T10:00:00+05:30", access: "Hold", mark: "Tentative", text: "Locked — waiting for Finance" };
    const t = text(renderToStaticMarkup(<StoryJourney s={s} me="harsha" x={x} rec={rec} irSeat={false} />));
    expect(t).toContain("Open lead ›");
    for (const w of ["✓ Lead captured", "✓ First touch made", "✓ Qualified", "✓ Investor said yes", "20 Aug 11:00 · from the lead",
      "Touches: 1 touch · Email 1", "✓ Reserved — 10% in", "25 Aug 10:00", "Fully paid not yet", "✓ App account", "Locked — waiting for Finance",
      "Account manager assigned not yet", "Onboarded not yet"]) expect(t).toContain(w);
  });
  it("an IR's view reads no app account card, and says when the lead is not readable", () => {
    h.asked = [];
    const t = text(renderToStaticMarkup(<StoryJourney s={s} me="rohit" x={x} rec={{ ...rec, story: { ...story, leadSide: "contact", touches: null } }} irSeat />));
    expect(h.asked.every((a) => a === null)).toBe(true);
    expect(t).not.toContain("App account");
    expect(t).toContain("The lead itself is not readable for your seat");
    expect(t).toContain("the lead's touches are not readable for your seat");
    expect(t).not.toContain("Open lead ›");   /* W6-KAM-1: no link to a lead this seat cannot read */
  });
  it("W6-KAM-1: a KAM or Finance seat that cannot read the lead gets the note and no Open lead link", () => {
    const t = text(renderToStaticMarkup(<StoryJourney s={s} me="rohit" x={x} rec={{ ...rec, story: { ...story, leadSide: "contact", touches: null } }} irSeat={false} />));
    expect(t).toContain("The lead itself is not readable for your seat");
    expect(t).not.toContain("Open lead ›");
  });
});
