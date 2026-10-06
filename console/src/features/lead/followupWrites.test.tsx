/* Cluster C1's hooks for the shared pages. The hooks are plain closures over the console and the api adapter, so they run here
   with React's useCallback and the store stubbed: what is proved is what each one sends in live mode (and when it sends nothing),
   what it does to the page on success and on a refusal, and that fixture mode still runs the reducer action as before. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState, type FollowupDraft } from "@/lib/state";
import type { PersonKey } from "@/domain";
import type { ApiMode } from "@/lib/data/api";

let mode: ApiMode = "live";
let state: ConsoleState;
const dispatch = vi.fn();
const reloadData = vi.fn();
const fetchMock = vi.fn();

vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useCallback: (f: unknown) => f }));
vi.mock("@/lib/store", () => ({ useConsole: () => ({ state, dispatch, reloadData }) }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return {
    ...real,
    useApiMode: () => mode,
    useApiWrite: (ep: never, book: never, d: never) => (a: never) => real.runWrite(mode, ep, book, d, a, { fetch: fetchMock }),
  };
});

const { useFinishLead, useLoseLead, usePullIn, useMoveNextTo, useLogTouchWrite, useReopenLost } = await import("./followupWrites");

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const MT = "2026-08-27T09:00:00+05:30";
const lead = (id: string, mt: string | null = MT) => ({ ...state.LEADS.find((l) => l.id === id)!, mt });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const draft = (over: Partial<FollowupDraft> = {}) => ({
  channel: "call", outcome: "Interested", obj: [], note: "", d: "2026-08-28", tm: "15:36", keep: false, complete: true,
  t: "Call back", nd: "2026-08-29", ntm: "18:00", nch: "call", noNext: false, ...over,
}) as FollowupDraft;
const body = () => JSON.parse(fetchMock.mock.calls[0]![1].body as string);
const patches = () => dispatch.mock.calls.map((c) => c[0]).filter((a) => a.type === "setUi").map((a) => a.patch);

beforeAll(() => pinClock("15:36"));
beforeEach(() => { mode = "live"; state = as("rohit"); vi.clearAllMocks(); fetchMock.mockImplementation(async () => json(200, { touchId: "1", nextId: "2", undoToken: null, undoUntil: null })); });

describe("useFinishLead (lpFinish)", () => {
  it("live: posts the draft, then closes the flow, says what was saved (no Undo) and reads the book again", async () => {
    const r = await useFinishLead()(lead("L4"), draft());
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/leads/L4/followup");
    expect(body()).toMatchObject({ expectedModifiedTime: MT, keep: false, next: { text: "Call back", at: "2026-08-29T18:00:00+05:30", channel: "call" } });
    const p = patches()[0]!;
    expect(p).toMatchObject({ LP: null, FU: null, NXASK: null, LPNOTICE: { id: "L4", msg: "Saved · Scheduled call: Call back · 29 Aug 18:00", snap: null } });
    expect(reloadData).toHaveBeenCalledOnce();
  });
  it("live: a refusal goes to the open flow's error line and nothing else changes", async () => {
    const lp = { who: "rohit", id: "L4", flow: "log", d: draft() };
    state = { ...state, ui: { ...state.ui, LP: lp } };
    fetchMock.mockImplementation(async () => json(403, { error: "Not saved — nope.", code: "no-consent" }));
    const r = await useFinishLead()(lead("L4"), draft());
    expect(r).toMatchObject({ ok: false, error: "Not saved — nope." });
    expect(patches()).toEqual([{ LP: { ...lp, d: { ...lp.d, error: "Not saved — nope." } } }]);
    expect(reloadData).not.toHaveBeenCalled();
  });
  it("live: a lead whose Modified_Time was never read sends nothing", async () => {
    const r = await useFinishLead()(lead("L4", null), draft());
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("a kept appointment says so", async () => {
    await useFinishLead()(lead("L4"), draft({ keep: true, complete: false }));
    expect((patches()[0]!.LPNOTICE as { msg: string }).msg).toBe("Saved · appointment kept");
  });
  it("fixture: runs lpFinish on the reducer, as the page did, and calls no route", async () => {
    mode = "fixture";
    const r = await useFinishLead()(lead("L4"), draft());
    expect(r.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "lpFinish", id: "L4" }));
  });
});

describe("useLoseLead (lpLose)", () => {
  it("live: the contact and the loss in one post; the notice names the reason", async () => {
    const r = await useLoseLead()(lead("L4"), draft({ outcome: "Not interested" }), "Price too high");
    expect(r.ok).toBe(true);
    expect(body()).toMatchObject({ lost: { reason: "Price too high" }, next: null, keep: false });
    expect((patches()[0]!.LPNOTICE as { msg: string }).msg).toBe("Closed as lost — Price too high");
  });
  it("fixture: runs lpLose", async () => {
    mode = "fixture";
    await useLoseLead()(lead("L4"), draft({ outcome: "Not interested" }), "Price too high");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "lpLose", id: "L4", why: "Price too high" }));
  });
});

describe("usePullIn / useMoveNextTo (pullIn, moveNextTo)", () => {
  it("live: moveNextTo sends the shift from where the step is now (28 Aug → 1 Sep is +4) and reads again", async () => {
    fetchMock.mockImplementation(async () => json(200, { nextStepAt: MT, undoToken: null, undoUntil: null }));
    const r = await useMoveNextTo()(lead("L4"), 4);   /* four days from today, 28 Aug = 1 Sep */
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/leads/L4/next/move");
    expect(body()).toEqual({ expectedModifiedTime: MT, days: 4, activity: null });
    expect(reloadData).toHaveBeenCalledOnce();
  });
  it("live: pullIn is a negative shift, decided by the reducer's own target", async () => {
    fetchMock.mockImplementation(async () => json(200, { nextStepAt: MT, undoToken: null, undoUntil: null }));
    const before = lead("L6");   /* a step on 29 Aug; pull-in lands two days earlier */
    const r = await usePullIn()(before);
    expect(r.ok).toBe(true);
    expect(body().days).toBeLessThan(0);
  });
  it("live: a move onto the day it is already on sends nothing", async () => {
    const r = await useMoveNextTo()(lead("L4"), 0);   /* today, 28 Aug, is where it is */
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live: a lead with no dated step, or no Modified_Time, sends nothing", async () => {
    expect(await useMoveNextTo()(lead("L2"), 2)).toMatchObject({ ok: false });
    expect(await useMoveNextTo()(lead("L4", null), 2)).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fixture: runs the reducer action", async () => {
    mode = "fixture";
    await usePullIn()(lead("L4"));
    await useMoveNextTo()(lead("L4"), 2);
    expect(dispatch.mock.calls.map((c) => c[0].type)).toEqual(["pullIn", "moveNextTo"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useLogTouchWrite (logTouch)", () => {
  it("live: a message is logged; a call that was not reached does not count toward First touch", async () => {
    const log = useLogTouchWrite();
    expect(await log(lead("L4"), "msg")).toBeNull();
    expect(body()).toEqual({ expectedModifiedTime: MT, channel: "msg" });
    fetchMock.mockClear();
    expect(await log(lead("L4"), "call")).toBeNull();
    expect(body()).toEqual({ expectedModifiedTime: MT, channel: "call", reached: false });
    fetchMock.mockClear();
    expect(await log(lead("L4"), "call", { reached: true })).toBeNull();
    expect(body().reached).toBe(true);
    expect(reloadData).toHaveBeenCalledTimes(3);
  });
  it("a channel with no consent is refused in the prototype's words, before any call", async () => {
    const none = { ...lead("L4"), con: { msg: false, email: false, call: false, visit: false } };
    const r = await useLogTouchWrite()(none, "msg");
    expect(typeof r).toBe("string");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live: the route's refusal comes back as text", async () => {
    fetchMock.mockImplementation(async () => json(409, { error: "x", code: "lead-changed" }));
    expect(await useLogTouchWrite()(lead("L4"), "msg")).toBe("Changed by someone else — reload.");
    expect(reloadData).not.toHaveBeenCalled();
  });
  it("fixture: runs logTouch on the reducer", async () => {
    mode = "fixture";
    expect(await useLogTouchWrite()(lead("L4"), "msg")).toBeNull();
    expect(dispatch).toHaveBeenCalledWith({ type: "logTouch", id: "L4", k: "msg" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useReopenLost (reopenLost)", () => {
  it("live: a step still ahead comes back with the lead; the caller supplies it", async () => {
    const was = { t: "Call back", by: "30 Aug", d: "2026-08-30", tm: "10:00", ch: "call", who: "rohit", at: "20 Aug 09:00" };
    state = { ...state, LEADS: state.LEADS.map((l) => (l.id === "L15" ? { ...l, lost: { ...l.lost!, nx: was } } : l)) as never };
    fetchMock.mockImplementation(async () => json(200, { modifiedTime: MT }));
    const r = await useReopenLost()(lead("L15"));
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/leads/L15/lost");
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
    expect(body()).toEqual({ expectedModifiedTime: MT, next: { text: "Call back", at: "2026-08-30T10:00:00+05:30", channel: "call" } });
    expect(reloadData).toHaveBeenCalledOnce();
  });
  it("live: a held step that has gone by is not brought back", async () => {
    const was = { t: "Call back", by: "20 Aug", d: "2026-08-20", tm: "10:00", ch: "call", who: "rohit", at: "18 Aug 09:00" };
    state = { ...state, LEADS: state.LEADS.map((l) => (l.id === "L15" ? { ...l, lost: { ...l.lost!, nx: was } } : l)) as never };
    fetchMock.mockImplementation(async () => json(200, { modifiedTime: MT }));
    await useReopenLost()(lead("L15"));
    expect(body().next).toBeNull();
  });
  it("live: a step on a channel the investor no longer permits comes back as an internal task", async () => {
    const was = { t: "Call back", by: "30 Aug", d: "2026-08-30", tm: "10:00", ch: "call", who: "rohit", at: "20 Aug 09:00" };
    state = { ...state, LEADS: state.LEADS.map((l) => (l.id === "L15" ? { ...l, con: { msg: true, email: true, call: false, visit: false }, lost: { ...l.lost!, nx: was } } : l)) as never };
    fetchMock.mockImplementation(async () => json(200, { modifiedTime: MT }));
    await useReopenLost()({ ...lead("L15"), con: { msg: true, email: true, call: false, visit: false } });
    expect(body().next.channel).toBe("other");
  });
  it("live: no Modified_Time sends nothing; fixture runs reopenLost", async () => {
    expect(await useReopenLost()(lead("L15", null))).toMatchObject({ ok: false, status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
    mode = "fixture";
    await useReopenLost()(lead("L15"));
    expect(dispatch).toHaveBeenCalledWith({ type: "reopenLost", id: "L15" });
  });
});
