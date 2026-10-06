/* Cluster C2 endpoints (ir-write-map.md): the ladder (./journey) and the lead record (./record). Live halves: the route,
   the method, the body (the page's Modified_Time, only what changed, never a visit consent). Fixture halves: the reducer
   action each replaces, answered with the reducer's own verdict. Everything is the demo book. */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import type { Lead, PersonKey } from "@/domain";
import { ST } from "@/domain";
import { canNote, canPlan, canWork, openable } from "@/lib/selectors";
import { runWrite } from "../api";
import { journeySkip, journeyTick, journeyUntick } from "./journey";
import { detailsBody, leadDetailsSave, leadForecastSet, leadNoteAdd, leadPermissionSave } from "./record";

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const sent = (f: ReturnType<typeof fetchOf>) => JSON.parse(f.mock.calls[0][1]!.body as string);
const nop = () => {};
/** A dispatch that runs the reducer, so a fixture's effect can be read back. */
const store = (s0: ConsoleState) => { let s = s0; return { get: () => s, dispatch: (a: Action) => { s = reducer(s, a); } }; };
const L0 = { id: "L1", mt: "2026-10-06T10:00:00+05:30", n: "Asha Rao", ph: "9876543210", em: "", city: "Pune", units: 2, done: 3, contactPreference: "", introducedBy: null } as unknown as Lead;

describe("live halves", () => {
  it("the ladder posts to /journey with the op and the page's Modified_Time; recordRung states the scorecard", async () => {
    let f = fetchOf(200, { rung: 4, modifiedTime: "m" });
    await runWrite("live", journeyTick, {} as never, nop, { id: "L1", expectedModifiedTime: "t", via: "recordRung" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/journey");
    expect(sent(f)).toEqual({ op: "tick", expectedModifiedTime: "t", scorecard: true });
    f = fetchOf(200, { rung: 4 });
    await runWrite("live", journeyTick, {} as never, nop, { id: "L1", expectedModifiedTime: "t", via: "tickCommit" }, { fetch: f });
    expect(sent(f)).toEqual({ op: "tick", expectedModifiedTime: "t" });
    f = fetchOf(200, { rung: 4 });
    await runWrite("live", journeySkip, {} as never, nop, { id: "L1", expectedModifiedTime: "t" }, { fetch: f });
    expect(sent(f)).toEqual({ op: "skip", expectedModifiedTime: "t" });
    f = fetchOf(200, { rung: 2 });
    await runWrite("live", journeyUntick, {} as never, nop, { id: "L1", expectedModifiedTime: "t", reason: "Ticked the wrong rung", note: "n", via: "undoRung" }, { fetch: f });
    expect(sent(f)).toEqual({ op: "untick", expectedModifiedTime: "t", reason: "Ticked the wrong rung" });
  });
  it("a field Zoho lacks comes back as the route's code and words", async () => {
    const f = fetchOf(422, { error: "Zoho has no field for this yet (Leads.Rung_Undone_At)", code: "field-missing", field: "Rung_Undone_At" });
    const r = await runWrite("live", journeyUntick, {} as never, nop, { id: "L1", expectedModifiedTime: "t", reason: "x", via: "untick" }, { fetch: f });
    expect(r).toMatchObject({ ok: false, status: 422, code: "field-missing", detail: { field: "Rung_Undone_At" } });
  });
  it("a note posts the text with a per-press Idempotency-Key", async () => {
    const f = fetchOf(200, { noteId: "n1", leadId: "L1" });
    await runWrite("live", leadNoteAdd, {} as never, nop, { id: "L1", text: "Hello" }, { fetch: f, idempotencyKey: "press-1" });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/notes");
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("press-1");
    expect(sent(f)).toEqual({ text: "Hello" });
  });
  it("permission never sends visit; details send only what changed; the forecast sends category or a date", async () => {
    let f = fetchOf(200, {});
    await runWrite("live", leadPermissionSave, {} as never, nop, { id: "L1", expectedModifiedTime: "t", con: { msg: true, call: false, email: false, visit: true }, how: "call", date: "2026-10-06", time: "09:00" }, { fetch: f });
    expect(f.mock.calls[0][1]!.method).toBe("PUT");
    expect(sent(f)).toEqual({ expectedModifiedTime: "t", con: { msg: true, email: false, call: false }, how: "call", date: "2026-10-06", time: "09:00" });
    expect(detailsBody({ id: "L1", expectedModifiedTime: "t", was: L0,
      patch: { n: "Asha Rao", ph: "9876543210", em: "a@b.in", city: "Pune", units: "3", introducedBy: "", contactPreference: "WhatsApp" } }))
      .toEqual({ expectedModifiedTime: "t", email: "a@b.in", units: "3", contactPreference: "WhatsApp" });
    expect(detailsBody({ id: "L1", expectedModifiedTime: "t", was: { ...L0, done: ST.RESERVED } as Lead,
      patch: { n: "Asha Rao", ph: "9876543210", em: "", city: "Pune", units: "5", introducedBy: "", contactPreference: "" } }))
      .toEqual({ expectedModifiedTime: "t" });
    f = fetchOf(200, {});
    await runWrite("live", leadForecastSet, {} as never, nop, { id: "L1", expectedModifiedTime: "t", via: "setFc", c: "commit" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/forecast");
    expect(sent(f)).toEqual({ expectedModifiedTime: "t", category: "commit" });
    f = fetchOf(200, {});
    await runWrite("live", leadForecastSet, {} as never, nop, { id: "L1", expectedModifiedTime: "t", via: "setFcBy", days: 10, now: new Date("2026-10-06T12:00:00") }, { fetch: f });
    expect(sent(f)).toEqual({ expectedModifiedTime: "t", paidBy: "2026-10-16" });
  });
});

describe("fixture halves run the reducer", () => {
  it("a note lands in NOTES; an empty one is refused", () => {
    const s = as("rohit");
    const l = openable(s).find(x => canNote(s, x))!;
    const st = store(s);
    const r = leadNoteAdd.fixture(st.get(), st.dispatch, { id: l.id, text: "Wants the yield note" });
    expect(r.ok).toBe(true);
    expect(st.get().NOTES[l.id]![0]!.t).toBe("Wants the yield note");
    expect(leadNoteAdd.fixture(st.get(), st.dispatch, { id: l.id, text: "  " }).ok).toBe(false);
  });
  it("the forecast category is set from Qualified on", () => {
    const s = as("rohit");
    const l = openable(s).find(x => canPlan(s, x) && x.done >= ST.QUALIFIED)!;
    const st = store(s);
    const r = leadForecastSet.fixture(st.get(), st.dispatch, { id: l.id, expectedModifiedTime: null, via: "setFc", c: "probable" });
    expect(r).toMatchObject({ ok: true, data: { forecast: "probable" } });
  });
  it("a permission withdrawal changes the lead; a details save that changes nothing is refused", () => {
    const s = as("rohit");
    const l = openable(s).find(x => canWork(s, x))!;
    const st = store(s);
    expect(leadPermissionSave.fixture(st.get(), st.dispatch, { id: l.id, expectedModifiedTime: null, con: { msg: false, call: false, email: false, visit: false }, how: "", date: "", time: "" }).ok).toBe(true);
    const same = { n: l.n, ph: l.ph, em: l.em || "", city: l.city || "", units: l.units ? String(l.units) : "", introducedBy: l.introducedBy || "", contactPreference: l.contactPreference || "" };
    expect(leadDetailsSave.fixture(st.get(), st.dispatch, { id: l.id, expectedModifiedTime: null, patch: same, was: l }).ok).toBe(false);
  });
  it("a lead this seat cannot open is refused as the route would (404)", () => {
    const s = as("rohit");
    expect(journeyTick.fixture(s, nop, { id: "no-such-lead", expectedModifiedTime: null, via: "tick" })).toMatchObject({ ok: false, status: 404 });
  });
});
