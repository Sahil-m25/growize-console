/* The integration pass's swapped call sites (ir-write-map.md): leads/actions' three hooks now go through the wired writes —
   logTouch → C1 touches, tick → C2 journey tick, untick → C2 journey untick (with a reason, live). Fixture mode still runs the
   very reducer action the page ran before; live sends the route and returns its refusal in its own words. Also the notes read
   (C2 record: GET /api/leads/[id]/notes) the lead page's "Latest note" and the notes list now use. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
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

const { useLogTouch, useTick, useUntick } = await import("./actions");
const { leadNotesRead } = await import("@/lib/data/endpoints/record");

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const MT = "2026-08-27T09:00:00+05:30";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lead = (id: string) => ({ ...state.LEADS.find((l) => l.id === id)!, mt: MT });
const sent = () => fetchMock.mock.calls.map((c) => ({ url: c[0] as string, body: JSON.parse((c[1] as { body: string }).body) }));

beforeAll(() => pinClock("15:36"));
beforeEach(() => {
  mode = "live"; state = as("rohit"); vi.clearAllMocks();
  fetchMock.mockImplementation(async () => json(200, { rung: 3, modifiedTime: MT, touchId: "1", firstTouch: false }));
});

/** A lead in rohit's book the selector lets him tick (its next rung is his and its gate is open). */
function tickable() {
  const t = state.LEADS.find((l) => l.own === "rohit" && l.done >= 2 && l.done < 5 && !l.lost);
  if (!t) throw new Error("no tickable lead in the demo book");
  return lead(t.id);
}

describe("useTick (Leads, Today panels): C2 journey tick", () => {
  it("live: posts op tick with the Modified_Time the page read, then reads the book again", async () => {
    const l = tickable();
    const why = await useTick()(l);
    expect(why).toBeNull();
    expect(sent()[0]).toEqual({ url: `/api/leads/${l.id}/journey`, body: { op: "tick", expectedModifiedTime: MT } });
    expect(reloadData).toHaveBeenCalledOnce();
  });
  it("live: the route's refusal comes back in its own words", async () => {
    const l = tickable();
    fetchMock.mockImplementation(async () => json(422, { error: "Not saved — that rung waits on Finance.", code: "gate-shut" }));
    const why = await useTick()(l);
    expect(why).toBe("Not saved — that rung waits on Finance.");
    expect(reloadData).not.toHaveBeenCalled();
  });
  it("fixture: dispatches the reducer's tick, as before, and calls no route", async () => {
    mode = "fixture";
    const l = tickable();
    await useTick()(l);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: "tick", id: l.id });
  });
});

describe("useUntick (Leads): C2 journey untick, now with a reason", () => {
  const fresh = () => {
    /* tick one in the reducer first so the take-back window is open */
    const l = tickable();
    state = reducer(state, { type: "tick", id: l.id });
    return lead(l.id);
  };
  it("asks first, then live refuses to send without one of the five reasons", async () => {
    const l = fresh();
    expect(l.done).toBeGreaterThan(1);
    expect(await useUntick()(l)).toMatch(/^Un-tick "/);
    expect(await useUntick()(l, true)).toBe("Pick the reason for the correction first.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live: posts op untick with the reason", async () => {
    const l = fresh();
    const why = await useUntick()(l, true, "Ticked the wrong rung");
    expect(why).toBeNull();
    expect(sent()[0]).toEqual({ url: `/api/leads/${l.id}/journey`, body: { op: "untick", expectedModifiedTime: MT, reason: "Ticked the wrong rung" } });
  });
  it("fixture: the reducer's untick, no reason needed, no route", async () => {
    mode = "fixture";
    const l = fresh();
    await useUntick()(l, true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: "untick", id: l.id });
  });
});

describe("useLogTouch (Today panels): C1 touches", () => {
  const consented = () => {
    const l = state.LEADS.find((x) => x.own === "rohit" && !x.lost && (x.consent || x.con?.msg));
    if (!l) throw new Error("no consented lead");
    return lead(l.id);
  };
  it("live: posts the touch and resolves null", async () => {
    const l = consented();
    expect(await useLogTouch()(l, "msg")).toBeNull();
    expect(sent()[0]!.url).toBe(`/api/leads/${l.id}/touches`);
    expect(reloadData).toHaveBeenCalledOnce();
  });
  it("fixture: dispatches logTouch as before", async () => {
    mode = "fixture";
    const l = consented();
    await useLogTouch()(l, "msg");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "logTouch", id: l.id, k: "msg" }));
  });
});

describe("leadNotesRead (the lead page's Latest note and notes list)", () => {
  it("live: picks the route's rows into the console's notes, newest first as sent, stamped in IST", () => {
    const notes = leadNotesRead.pick({ leadId: "L1", notes: [
      { id: "1", text: "Newest", at: "2026-09-27T10:00:00+05:30", by: "9007199254740995001", title: "Note" },
      { id: "2", text: "", at: "2026-09-26T10:00:00+05:30", by: null, title: "Note" },
    ] });
    expect(notes).toEqual([{ t: "Newest", who: "9007199254740995001", at: "27 Sep 10:00", d: "2026-09-27" }]);
    expect(leadNotesRead.path("L1")).toBe("/api/leads/L1/notes");
    expect(leadNotesRead.path(null)).toBeNull();
  });
  it("fixture: the book's own notes for a lead the seat can open; another's is refused", () => {
    const l = state.LEADS.find((x) => x.own === "rohit")!;
    const r = leadNotesRead.fixture(state, l.id);
    expect(r).toEqual({ ok: true, data: state.NOTES[l.id] || [] });
    expect(leadNotesRead.fixture(state, "NO-SUCH-LEAD")).toMatchObject({ ok: false, status: 404 });
  });
});
