/* M14-S01-W1 / S02-W1 / S03-W1 — Events, both halves (book = the lead side's ConsoleState). */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import { evDraft } from "@/features/events/eventDraft";
import { liveRead, runWrite } from "../api";
import { askedOf, changedNote, eventChange, eventCreate, eventDates, eventList, eventOne, eventPicker, eventRemove, ruleOf, sheetLoad, sheetState } from "./events";

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const withDraft = (s: ConsoleState, id: string | null, patch: Record<string, unknown> = {}): ConsoleState => {
  const e = id ? s.EVENTS.find(x => x.id === id)! : null;
  return { ...s, ui: { ...s.ui, EVD: { ...evDraft(e ?? null, s.NOW.getFullYear()), ...patch } } };
};
const args = (s: ConsoleState) => { const d = s.ui.EVD as ReturnType<typeof evDraft>; return { id: d.id, n: d.n, type: d.type, ch: d.ch, from: d.from, to: d.to, city: d.city, cost: d.cost, state: d.state, off: d.off, staff: d.staff }; };

describe("M14-S01-W1 — the Events list and one event, fixture half", () => {
  it("Upcoming soonest first with the team, Completed with what it produced (TC-E10-001/002)", () => {
    const r = eventList.fixture(as("rohit"), undefined);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.upcoming.map(e => e.name)).toEqual(["Sobha Dream Acres", "Bangalore Club", "Embassy Springs"]);
    expect(r.data.upcoming[0]!.staff.map(x => x.name)).toEqual(["Kavya Iyer", "Nikhil Rao"].map(n => expect.stringContaining(n.split(" ")[0]!)));
    expect(r.data.completed.map(e => e.name)).toEqual(["Prestige Falcon City", "Koramangala Club", "Brigade Cornerstone", "AgriTech Expo"]);
    expect(r.data.upcoming[0]).toMatchObject({ startsOn: expect.stringMatching(/^\d{4}-09-05$/), endsOn: expect.stringMatching(/^\d{4}-09-06$/) });
    expect(eventList.path()).toBe("/api/events");
  });
  it("cost per qualified is withheld while a captured lead is untagged", () => {
    const r = eventList.fixture(as("tasneem"), undefined);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.completed.some(e => e.stats.costHiddenWhy === null)).toBe(false);
    expect(r.data.completed.filter(e => e.stats.costHiddenWhy === "untagged").length).toBeGreaterThan(0);
  });
  it("one event names only the leads the viewer may open and counts the rest (TC-E10-003)", () => {
    const s = as("rohit");
    const id = s.EVENTS.find(e => e.n === "Prestige Falcon City")!.id;
    const r = eventOne.fixture(s, id);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.leads.map(l => l.name)).toEqual(["Meera Krishnan"]);
    expect(r.data.othersCount).toBe(2);
    expect(eventOne.fixture(s, "E-99")).toMatchObject({ ok: false, status: 404 });
    expect(eventOne.path(null)).toBeNull();
    expect(eventOne.path(id)).toBe(`/api/events/${id}`);
  });
  it("dates print without the year inside this year, with it on the event's own page", () => {
    expect(eventDates({ startsOn: "2026-09-05", endsOn: "2026-09-06" }, 2026)).toBe("5–6 Sep");
    expect(eventDates({ startsOn: "2026-08-30", endsOn: "2026-09-02" }, 2026)).toBe("30 Aug – 2 Sep");
    expect(eventDates({ startsOn: "2027-01-05", endsOn: "2027-01-06" }, 2026)).toBe("5–6 Jan 2027");
  });
  it("the capture picker reads nothing until the source is Events", () => {
    expect(eventPicker.path(false)).toBeNull();
    expect(eventPicker.path(true)).toBe("/api/events");
  });
});

describe("M14-S02-W1 — add, correct, remove", () => {
  it("live: POST /api/events with the route's body; an IR is refused with the route's words (TC-E10-004)", async () => {
    const s = withDraft(as("tasneem"), null, { n: "Adarsh Palm Retreat", from: "2026-10-03", to: "2026-10-04", staff: ["rohit"] });
    const f = fetchOf(200, { event: { eventId: "9", name: "Adarsh Palm Retreat", startsOn: "2026-10-03", endsOn: "2026-10-04", city: "Bengaluru", staffIds: ["rohit"], state: "planned" } });
    const r = await runWrite("live", eventCreate, s, () => {}, args(s), { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/events");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toMatchObject({ name: "Adarsh Palm Retreat", startsOn: "2026-10-03", endsOn: "2026-10-04", city: "Bengaluru", kind: "Society", channel: "MyGate", state: "planned", cost: 70000, staffIds: ["rohit"] });
    expect(r).toMatchObject({ ok: true, data: { eventId: "9" } });
    const ir = withDraft(as("rohit"), null, { n: "X", from: "2026-10-03", to: "2026-10-04" });
    expect(await runWrite("fixture", eventCreate, ir, () => {}, args(ir))).toMatchObject({ ok: false, status: 403, code: "capability-missing" });
  });
  it("fixture: the IR Manager's add runs saveEvent and answers the new id; an end before the start is a 422 with the gaps", async () => {
    const seen: Action[] = [];
    const s = withDraft(as("tasneem"), null, { n: "Adarsh Palm Retreat", from: "2026-10-03", to: "2026-10-04", staff: ["rohit"] });
    const r = await runWrite("fixture", eventCreate, s, (a: Action) => seen.push(a), args(s));
    expect(seen).toEqual([{ type: "saveEvent" }]);
    expect(r).toMatchObject({ ok: true, data: { name: "Adarsh Palm Retreat", startsOn: "2026-10-03", state: "planned", staffIds: ["rohit"] } });
    const bad = withDraft(as("tasneem"), null, { n: "Test", from: "2026-10-10", to: "2026-10-08" });
    const g = await runWrite("fixture", eventCreate, bad, () => {}, args(bad));
    expect(g).toMatchObject({ ok: false, status: 422, code: "gaps", detail: { gaps: ["end date on or after start"] } });
  });
  it("live: PATCH /api/events/[id] with modifiedTime; the answer words the activity line", async () => {
    const s = withDraft(as("tasneem"), "E-02");
    const f = fetchOf(200, { event: { eventId: "E-02", name: "Koramangala Club", moved: [{ field: "cost", from: 96000, to: 99000 }], taggedStay: 3, modifiedTime: "t" } });
    const r = await runWrite("live", eventChange, s, () => {}, { ...args(s), id: "E-02", modifiedTime: "2026-09-01T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][1]!.method).toBe("PATCH");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string).modifiedTime).toBe("2026-09-01T10:00:00+05:30");
    if (!r.ok) throw new Error(r.error);
    expect(changedNote(r.data.name, r.data.moved, r.data.taggedStay, k => k)).toBe("Koramangala Club — cost: ₹96,000 → ₹99,000 · 3 leads stay tagged to it");
    expect(changedNote("A", [{ field: "dates", from: "2026-08-23/2026-08-24", to: "2026-08-24/2026-08-25" }], null, k => k)).toBe("A — dates: 23–24 Aug 2026 → 24–25 Aug 2026");
  });
  it("remove asks first: the 428 carries the tagged count and writes nothing; confirmed, dropEvent runs", async () => {
    const s = as("tasneem");
    const id = s.EVENTS.find(e => e.n === "Brigade Cornerstone")!.id;
    const seen: Action[] = [];
    const ask = await runWrite("fixture", eventRemove, s, (a: Action) => seen.push(a), { id, confirm: false });
    expect(seen).toEqual([]);
    if (ask.ok) throw new Error("asked");
    expect(ask.status).toBe(428);
    expect(askedOf(ask)).toEqual({ taggedLeads: expect.any(Number), eventName: "Brigade Cornerstone" });
    const done = await runWrite("fixture", eventRemove, s, (a: Action) => seen.push(a), { id, confirm: true });
    expect(seen).toEqual([{ type: "dropEvent", id }]);
    expect(done).toMatchObject({ ok: true, data: { eventId: id, name: "Brigade Cornerstone" } });
  });
  it("live: DELETE, then DELETE ?confirm=1; the route's 428 numbers come through as detail", async () => {
    const s = as("tasneem");
    const f = fetchOf(428, { error: "removing an event is confirmed on the page first", code: "confirm-needed", taggedLeads: 3, eventName: "Koramangala Club" });
    const r = await runWrite("live", eventRemove, s, () => {}, { id: "9", confirm: false }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/events/9");
    expect(f.mock.calls[0][1]!.method).toBe("DELETE");
    if (r.ok) throw new Error("asked");
    expect(askedOf(r)).toEqual({ taggedLeads: 3, eventName: "Koramangala Club" });
    const g = fetchOf(200, { removed: { eventId: "9", name: "Koramangala Club", leadsUntagged: 3 } });
    expect(await runWrite("live", eventRemove, s, () => {}, { id: "9", confirm: true }, { fetch: g })).toMatchObject({ ok: true, data: { leadsUntagged: 3 } });
    expect(g.mock.calls[0][0]).toBe("/api/events/9?confirm=1");
  });
});

describe("M14-S03-W1 — the sheet card", () => {
  const ready = (who: string) => { const s = as(who); const id = Object.keys(s.SHEET).find(k => s.SHEET[k]!.state === "ready")!; return { s, id }; };
  it("the card's rule select as the route's rule", () => {
    expect(ruleOf("roster", null)).toEqual({ kind: "round-robin" });
    expect(ruleOf("self", null)).toEqual({ kind: "me" });
    expect(ruleOf("none", null)).toEqual({ kind: "unassigned" });
    expect(ruleOf("one", "ananya")).toEqual({ kind: "one", ownerId: "ananya" });
  });
  it("live: POST /api/events/[id]/sheet {rule, rows}", async () => {
    const { s, id } = ready("rohit");
    const f = fetchOf(200, { load: { eventId: id, rule: "round-robin", inFile: 1, loaded: 1, duplicates: 0, refused: 0, split: [{ ownerId: "u1", count: 1 }], assigned: [], rows: [], countsSaved: true } });
    const rows = [{ name: "Asha", mobile: "+91 98765 01234", consent: { msg: true, call: true } }];
    const r = await runWrite("live", sheetLoad, s, () => {}, { eventId: id, rule: { kind: "round-robin" }, rows }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe(`/api/events/${id}/sheet`);
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ rule: { kind: "round-robin" }, rows });
    expect(r).toMatchObject({ ok: true, data: { loaded: 1 } });
  });
  it("fixture: round-robin across the staff runs loadSheet; a second load is a 409 'A sheet loads once.'", async () => {
    const { s, id } = ready("rohit");
    const seen: Action[] = [];
    const r = await runWrite("fixture", sheetLoad, s, (a: Action) => seen.push(a), { eventId: id, rule: { kind: "round-robin" }, rows: [] });
    expect(seen).toEqual([{ type: "loadSheet", ev: id }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ inFile: s.SHEET[id]!.rows, loaded: expect.any(Number), duplicates: expect.any(Number) });
    expect(r.data.split.reduce((a, x) => a + x.count, 0)).toBe(r.data.loaded);
    const done = { ...s, SHEET: { ...s.SHEET, [id]: { ...s.SHEET[id]!, state: "loaded" as const } } };
    expect(await runWrite("fixture", sheetLoad, done, () => {}, { eventId: id, rule: { kind: "round-robin" }, rows: [] })).toMatchObject({ ok: false, status: 409, error: "A sheet loads once." });
  });
  it("fixture: 'All to one person' needs the person; a seat that does not load is refused", async () => {
    const { s, id } = ready("rohit");
    expect(await runWrite("fixture", sheetLoad, s, () => {}, { eventId: id, rule: { kind: "one", ownerId: null }, rows: [] })).toMatchObject({ ok: false, status: 422, code: "owner-missing" });
    const dev = ready("pradeep");
    expect(await runWrite("fixture", sheetLoad, dev.s, () => {}, { eventId: dev.id, rule: { kind: "round-robin" }, rows: [] })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M14-S03-W2 — the sheet card's state, and the event page's Owner, Total and later bars", () => {
  const prestige = (who: string) => { const s = as(who); return { s, id: s.EVENTS.find(e => e.n === "Prestige Falcon City")!.id }; };
  const view = (s: ConsoleState, id: string) => { const r = sheetState.fixture(s, id); if (!r.ok) throw new Error(r.error); return r.data; };
  it("the route is per event; nothing is read without an id", () => {
    expect(sheetState.path(null)).toBeNull();
    expect(sheetState.path("E-04")).toBe("/api/events/E-04/sheet");
  });
  it("fixture, a ready sheet: the counts the card prints, who filled it, the staff in named order, and the load right (TC-E10-010/012/013)", () => {
    const { s, id } = ready("rohit");
    const v = view(s, id);
    const sh = s.SHEET[id]!;
    expect(v).toMatchObject({ state: "ready", inFile: sh.rows, willLoad: sh.ok, duplicates: sh.dupe, refused: sh.bad, loaded: null, mayLoad: true, filledAt: sh.at });
    expect(v.filledBy?.id).toBe(sh.by);
    expect(v.staff.map(x => x.id)).toEqual(s.EVENTS.find(e => e.id === id)!.staff);
    const dev = ready("pradeep");
    expect(sheetState.fixture(dev.s, dev.id)).toMatchObject({ ok: false, status: 403 });   // a seat without the Events page
    function ready(who: string) { const x = as(who); return { s: x, id: Object.keys(x.SHEET).find(k => x.SHEET[k]!.state === "ready")! }; }
  });
  it("fixture, a loaded sheet: loaded by, the rule, skipped as duplicates and the log line the reducer wrote; an event with no sheet says none", async () => {
    const x = as("rohit");
    const id = Object.keys(x.SHEET).find(k => x.SHEET[k]!.state === "ready")!;
    let s = x;
    await runWrite("fixture", sheetLoad, s, (a: Action) => { s = reducer(s, a); }, { eventId: id, rule: { kind: "round-robin" }, rows: [] });
    const v = view(s, id);
    expect(v).toMatchObject({ state: "loaded", loaded: s.SHEET[id]!.ok, willLoad: null, rule: "Round-robin across who staffed it", loadedBy: { id: "rohit" } });
    expect(v.log).toHaveLength(1);
    expect(v.log[0]).toMatchObject({ what: "Loaded the event sheet", note: expect.stringContaining("leads") });
    const none = x.EVENTS.find(e => !x.SHEET[e.id])!;
    expect(view(x, none.id)).toMatchObject({ state: "none", inFile: null, willLoad: null, log: [] });
    expect(sheetState.fixture(x, "E-99")).toMatchObject({ ok: false, status: 404 });
  });
  it("live: the route's sheet, the staff and the log as arrays", async () => {
    const sheet = { eventId: "7", eventName: "Prestige", state: "loaded", inFile: 38, willLoad: null, duplicates: 4, refused: 3, loaded: 31, filledBy: null, filledAt: null,
      loadedBy: { id: "u1", name: "Rohit" }, loadedAt: "2026-09-28T11:30", rule: null, staff: [{ id: "u1", name: "Rohit" }], mayLoad: true, log: [] };
    const f = fetchOf(200, { sheet });
    const r = await liveRead(sheetState, "/api/events/7/sheet", { fetch: f });
    expect(r).toEqual({ state: "ok", data: sheet });
  });
  it("the event page's lead rows carry the owner and units; the stats carry Fully paid and Investor (TC-E10-003)", () => {
    const { s, id } = prestige("rohit");
    const r = eventOne.fixture(s, id);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.leads[0]).toMatchObject({ name: "Meera Krishnan", ownerId: expect.any(String), ownerName: expect.any(String), units: expect.any(Number) });
    expect(r.data.event.stats).toMatchObject({ paid: expect.any(Number), investor: expect.any(Number) });
    expect(Object.keys(r.data.leads[0]!).sort()).toEqual(["id", "name", "ownerId", "ownerName", "status", "units"]);   // no phone, e-mail or any identity field
  });
});
