import { beforeAll, describe, expect, it } from "vitest";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer } from "@/lib/state";
import type { ConsoleState } from "@/lib/state";
import type { LeadId, PersonKey } from "@/domain";
import { lost } from "@/lib/selectors";
import { emTpls, lpNeedsStep, lpNextChoices, lpPrefSlot, lpStepPast, zKind, type LpDraft } from "./lp";
import { lpSnap } from "./reducer";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const lead = (s: ConsoleState, id: string) => s.LEADS.find((l) => l.id === id)!;
beforeAll(() => pinClock("15:36")); /* CLOCK_28AUG_1536 */

const draft = (over: Partial<LpDraft>): LpDraft => ({
  channel: "call", outcome: "Interested", obj: [], note: "", d: "2026-08-28", tm: "15:36", keep: false, complete: true,
  t: "Call back", nd: "2026-08-29", ntm: "18:00", nch: "call", noNext: false, ...over,
});

describe("lpNextChoices / emTpls — D60: nothing goes out before the NDA (ir-merged.js 4997, 10465)", () => {
  it("before the NDA, no deck, no yield note, no deck/webinar template", () => {
    const l = lead(as("rohit"), "L4");
    expect(lpNextChoices(l, false)).toEqual(["Call back", "Nurture — check back"]);
    expect(emTpls(false).map(([, t]) => t.t)).toEqual(["Introduction", "Paperwork reminder", "Balance reminder"]);
    expect(emTpls(true).map(([k]) => k)).toContain("deck");
  });
});

describe("lpPrefSlot / zKind (ir-merged.js 5016, 4995)", () => {
  it("'not before 6pm' in the latest note is the evening slot", () => {
    const l = lead(as("rohit"), "L2");
    expect(lpPrefSlot(l, "Asked us not to call before 6pm. Evenings only.")).toEqual({ slot: "18:00", src: "note" });
    expect(lpPrefSlot({ ...l, contactPreference: "" }, null)).toBeNull();
  });
  it("calls and meetings take a time; everything else is a task", () => {
    expect(zKind("Call back")).toBe("call");
    expect(zKind("Office meeting")).toBe("meeting");
    expect(zKind("Nurture — check back")).toBe("task");
  });
});

describe("lpFinish / lpRestore — one save, one Undo (ir-merged.js 5113, 5086)", () => {
  it("saves the contact and the dated step, says the Zoho kind, and Undo puts it all back", () => {
    const s0 = as("rohit");
    const s1 = reducer(s0, { type: "lpFinish", id: "L4" as LeadId, d: draft({}) });
    const l1 = lead(s1, "L4");
    expect(l1.nx?.t).toBe("Call back");
    expect(l1.nx?.by).toBe("29 Aug");
    expect(l1.nx?.tm).toBe("18:00");
    const n = s1.ui.LPNOTICE as { msg: string; snap: ReturnType<typeof lpSnap>; label: string };
    expect(n.msg).toBe("Saved · Scheduled call: Call back · 29 Aug 18:00");
    expect(s1.LOG.find((e) => e.lead === "L4")!.note).toContain("Zoho: Scheduled call, reminder 15 min before");
    const s2 = reducer(s1, { type: "lpRestore", id: "L4" as LeadId, snap: n.snap, label: n.label });
    expect(lead(s2, "L4")).toEqual(lead(s0, "L4"));
    expect(s2.INTERACTIONS["L4"] || []).toEqual(s0.INTERACTIONS["L4"] || []);
    expect(s2.LOG[0].what).toBe("Undid a follow-up");
  });
  it("a task is saved with no time", () => {
    const s1 = reducer(as("rohit"), { type: "lpFinish", id: "L4" as LeadId, d: draft({ channel: "msg", nch: "other", t: "Nurture — check back", nd: "2026-08-28", ntm: "" }) });
    expect((s1.ui.LPNOTICE as { msg: string }).msg).toBe("Saved · Task: Nurture — check back · 28 Aug");
  });
});

describe("lpLose — the contact and the loss in one write (ir-merged.js 5127)", () => {
  it("closes the lead with the reason; a lead with money in cannot be lost", () => {
    const s1 = reducer(as("rohit"), { type: "lpLose", id: "L4" as LeadId, d: draft({ outcome: "Not interested" }), why: "Price too high" });
    expect(lost(lead(s1, "L4"))).toBe(true);
    expect((s1.ui.LPNOTICE as { msg: string }).msg).toBe("Closed as lost — Price too high");
    const s0 = as("rohit");
    expect(reducer(s0, { type: "lpLose", id: "L6" as LeadId, d: draft({ outcome: "Not interested" }), why: "Price too high" })).toBe(s0);
  });
});

describe("keeping the scheduled step, and a next-step time already past (M19-S12)", () => {
  it("a save that keeps the appointment does not ask for a default next step", () => {
    expect(lpNeedsStep(draft({ t: "", keep: true }))).toBe(false);
    expect(lpNeedsStep(draft({ t: "", keep: false }))).toBe(true);
    const s1 = reducer(as("rohit"), { type: "lpFinish", id: "L4" as LeadId, d: draft({ t: "", keep: true, complete: false }) });
    expect(lead(s1, "L4").nx).toEqual(lead(as("rohit"), "L4").nx);
  });
  it("09:00 is refused at 15:36 on the same day; 18:00 and a later day are not", () => {
    const now = new Date("2026-08-28T15:36:00");
    expect(lpStepPast("2026-08-28", "09:00", now)).toBe(true);
    expect(lpStepPast("2026-08-28", "18:00", now)).toBe(false);
    expect(lpStepPast("2026-08-29", "09:00", now)).toBe(false);
    expect(lpStepPast("2026-08-28", "", now)).toBe(false);
  });
});
