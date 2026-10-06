/* Cluster C1 — contact and next step: the endpoints (both halves) and the hooks the shared pages swap in.
   Live halves post to the routes with the lead's Modified_Time; fixture halves run the reducer action they replace. */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState, type FollowupDraft } from "@/lib/state";
import type { LeadId, PersonKey } from "@/domain";
import { lost } from "@/lib/selectors";
import { runWrite, type ApiMode } from "../api";
import {
  followupBody, followupSave, istAt, leadFinish, leadLose, lostClose, lostReopen, nextMove, nextSave, reachedOf, touchRecord,
} from "./followup";

beforeAll(() => pinClock("15:36"));
const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const lead = (s: ConsoleState, id: string) => s.LEADS.find((l) => l.id === id)!;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const sent = (f: ReturnType<typeof fetchOf>) => JSON.parse(f.mock.calls[0]![1]!.body as string);
const headers = (f: ReturnType<typeof fetchOf>) => f.mock.calls[0]![1]!.headers as Record<string, string>;
const MT = "2026-08-27T09:00:00+05:30";
const draft = (over: Partial<FollowupDraft> = {}): FollowupDraft => ({
  channel: "call", outcome: "Interested", obj: [], note: "", d: "2026-08-28", tm: "15:36", keep: false, complete: true,
  t: "Call back", nd: "2026-08-29", ntm: "18:00", nch: "call", noNext: false, ...over,
});
const args = (over: Record<string, unknown> = {}) => ({ id: "L4", mt: MT, d: draft(), today: "2026-08-28", ...over });

describe("the body a draft becomes", () => {
  it("istAt is Asia/Kolkata, with a default hour when none was given", () => {
    expect(istAt("2026-08-29", "18:00", "23:59")).toBe("2026-08-29T18:00:00+05:30");
    expect(istAt("2026-08-29", "", "23:59")).toBe("2026-08-29T23:59:00+05:30");
    expect(istAt("2026-08-29", "6pm", "00:00")).toBe("2026-08-29T00:00:00+05:30");
  });
  it("a call answered or a visit held is reached; a message is made", () => {
    expect(reachedOf("call", "Interested")).toBe(true);
    expect(reachedOf("call", "No answer")).toBe(false);
    expect(reachedOf("call", "Wrong number")).toBe(false);
    expect(reachedOf("visit", "Investor unavailable")).toBe(false);
    expect(reachedOf("visit", "Visit completed")).toBe(true);
    expect(reachedOf("msg", "Message sent")).toBe(true);
  });
  it("a normal save carries the contact, the dated step and the lead's Modified_Time; there is no activity id to name", () => {
    expect(followupBody(args())).toEqual({
      expectedModifiedTime: MT,
      contact: { channel: "call", outcome: "Interested", occurredAt: "2026-08-28T15:36:00+05:30", reached: true },
      scheduled: null, complete: true, keep: false,
      next: { text: "Call back", at: "2026-08-29T18:00:00+05:30", channel: "call" },
    });
  });
  it("objections ride in the note; no time on the step means the end of the day; no date means today", () => {
    const b = followupBody(args({ d: draft({ note: "Wants a visit", obj: ["Price", "Lock-in"], ntm: "", nd: "" }) }));
    expect((b.contact as { note: string }).note).toBe("Wants a visit · Objections: Price, Lock-in");
    expect(b.next).toEqual({ text: "Call back", at: "2026-08-28T23:59:00+05:30", channel: "call" });
  });
  it("keeping the appointment or leaving no step sends no next step; keep never also completes", () => {
    expect(followupBody(args({ d: draft({ keep: true, complete: true }) }))).toMatchObject({ keep: true, complete: false, next: null });
    expect(followupBody(args({ d: draft({ noNext: true }) }))).toMatchObject({ keep: false, next: null });
  });
  it("a loss carries its reason, no next step and no keep, and never completes", () => {
    const b = followupBody(args({ d: draft({ outcome: "Not interested" }), lostWhy: "Price too high" }));
    expect(b).toMatchObject({ lost: { reason: "Price too high" }, next: null, keep: false, complete: false });
  });
  it("a lead the page never read the Modified_Time of sends null, which the route refuses", () => {
    expect(followupBody(args({ mt: undefined })).expectedModifiedTime).toBeNull();
  });
});

describe("live halves post to the routes", () => {
  const live = (ep: never, a: never, f: ReturnType<typeof fetchOf>, key?: string) =>
    runWrite("live" as ApiMode, ep, {} as never, (() => {}) as never, a, { fetch: f, idempotencyKey: key });

  it("follow-up save, finish and lose: POST /followup under a press key", async () => {
    for (const ep of [followupSave, leadFinish, leadLose]) {
      const f = fetchOf(200, { touchId: "1", nextId: "2", undoToken: "t", undoUntil: 9 });
      const r = await live(ep as never, args({ lostWhy: ep === leadLose ? "Price too high" : undefined }) as never, f, "key-1");
      expect(r).toEqual({ ok: true, data: { touchId: "1", nextId: "2", undoToken: "t", undoUntil: 9 } });
      expect(f.mock.calls[0]![0]).toBe("/api/leads/L4/followup");
      expect(f.mock.calls[0]![1]!.method).toBe("POST");
      expect(headers(f)["Idempotency-Key"]).toBe("key-1");
      expect(sent(f).expectedModifiedTime).toBe(MT);
    }
  });
  it("touch: POST /touches with the channel, when, and reached only for a call or a visit", async () => {
    const f = fetchOf(200, { touchId: "1", modifiedTime: MT, firstTouch: true });
    await live(touchRecord as never, { id: "L4", mt: MT, k: "call", at: "2026-08-28T09:00:00+05:30", reached: true, action: { type: "saveTouch", id: "L4" } } as never, f);
    expect(f.mock.calls[0]![0]).toBe("/api/leads/L4/touches");
    expect(sent(f)).toEqual({ expectedModifiedTime: MT, channel: "call", occurredAt: "2026-08-28T09:00:00+05:30", reached: true });
    expect(headers(f)["Idempotency-Key"]).toBeTruthy();
    const g = fetchOf(200, {});
    await live(touchRecord as never, { id: "L4", mt: MT, k: "msg", action: { type: "logTouch", id: "L4", k: "msg" } } as never, g);
    expect(sent(g)).toEqual({ expectedModifiedTime: MT, channel: "msg" });
  });
  it("next step: PUT /next with the step as a Zoho datetime and no activity", async () => {
    const f = fetchOf(200, { nextId: "7", modifiedTime: MT });
    await live(nextSave as never, { id: "L4", mt: MT, text: " Call back ", d: "2026-08-30", tm: "", ch: "call" } as never, f);
    expect(f.mock.calls[0]![0]).toBe("/api/leads/L4/next");
    expect(f.mock.calls[0]![1]!.method).toBe("PUT");
    expect(sent(f)).toEqual({ expectedModifiedTime: MT, next: { text: "Call back", at: "2026-08-30T23:59:00+05:30", channel: "call" }, scheduled: null });
    expect(headers(f)["Idempotency-Key"]).toBeTruthy();
  });
  it("move: POST /next/move with the shift in days, no press key", async () => {
    const f = fetchOf(200, { nextStepAt: MT, undoToken: "u", undoUntil: 1 });
    await live(nextMove as never, { id: "L4", mt: MT, days: -2, action: { type: "pullIn", id: "L4" } } as never, f);
    expect(f.mock.calls[0]![0]).toBe("/api/leads/L4/next/move");
    expect(sent(f)).toEqual({ expectedModifiedTime: MT, days: -2, activity: null });
    expect(headers(f)["Idempotency-Key"]).toBeUndefined();
  });
  it("close: POST /lost with the reason (the note only when there is one) under a press key; re-open: DELETE /lost with the next step", async () => {
    const f = fetchOf(200, { noteId: null, modifiedTime: MT });
    await live(lostClose as never, { id: "L4", mt: MT, why: "Price too high", note: "  " } as never, f);
    expect(f.mock.calls[0]![0]).toBe("/api/leads/L4/lost");
    expect(sent(f)).toEqual({ expectedModifiedTime: MT, reason: "Price too high" });
    expect(headers(f)["Idempotency-Key"]).toBeTruthy();
    const g = fetchOf(200, { modifiedTime: MT });
    const next = { text: "Call back", at: "2026-08-30T10:00:00+05:30", channel: "call" };
    await live(lostReopen as never, { id: "L15", mt: MT, next } as never, g);
    expect(g.mock.calls[0]![0]).toBe("/api/leads/L15/lost");
    expect(g.mock.calls[0]![1]!.method).toBe("DELETE");
    expect(sent(g)).toEqual({ expectedModifiedTime: MT, next });
    expect(headers(g)["Idempotency-Key"]).toBeUndefined();
  });
  it("a refusal is the route's own words; a 409 lead-changed is the shared 'changed by someone else'", async () => {
    const r = await live(followupSave as never, args() as never, fetchOf(403, { error: "Not saved — nope.", code: "no-consent" }));
    expect(r).toMatchObject({ ok: false, status: 403, code: "no-consent", error: "Not saved — nope." });
    const c = await live(followupSave as never, args() as never, fetchOf(409, { error: "x", code: "lead-changed" }));
    expect(c).toMatchObject({ ok: false, status: 409, error: "Changed by someone else — reload." });
  });
});

describe("fixture halves run the reducer action they replace", () => {
  it("finish: the lead gets its next step and the answer is ok; the action goes to the reducer", () => {
    const s = as("rohit"), dispatch = vi.fn();
    const r = leadFinish.fixture(s, dispatch, args() as never);
    expect(r.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "lpFinish", id: "L4", d: draft() });
  });
  it("finish: a refusal by the reducer is a 422 in the route's words, and an unknown lead a 404", () => {
    const s = as("rohit");
    expect(leadFinish.fixture(s, vi.fn(), args({ d: draft({ outcome: "" }) }) as never)).toMatchObject({ ok: false, status: 422, code: "refused" });
    expect(leadFinish.fixture(s, vi.fn(), args({ id: "L999" }) as never)).toMatchObject({ ok: false, status: 404 });
  });
  it("save follow-up: reads the drawer's draft from the book", () => {
    const s0 = as("rohit"), dispatch = vi.fn();
    expect(followupSave.fixture(s0, dispatch, args() as never)).toMatchObject({ ok: false, status: 422 });
    const s1 = { ...s0, ui: { ...s0.ui, FU: draft() } };
    expect(followupSave.fixture(s1, vi.fn(), args() as never).ok).toBe(true);
  });
  it("lose: ok only when the lead ends up closed; money in is refused", () => {
    const s = as("rohit");
    expect(leadLose.fixture(s, vi.fn(), args({ d: draft({ outcome: "Not interested" }), lostWhy: "Price too high" }) as never).ok).toBe(true);
    expect(leadLose.fixture(s, vi.fn(), args({ id: "L6", d: draft({ outcome: "Not interested" }), lostWhy: "Price too high" }) as never)).toMatchObject({ ok: false, status: 422 });
  });
  it("close and re-open", () => {
    const s = as("rohit");
    expect(lostClose.fixture(s, vi.fn(), { id: "L4", mt: undefined, why: "Price too high", note: "n" })).toMatchObject({ ok: true });
    expect(lostClose.fixture(s, vi.fn(), { id: "L6", mt: undefined, why: "Price too high", note: "" })).toMatchObject({ ok: false, status: 422 });
    expect(lostReopen.fixture(s, vi.fn(), { id: "L15", mt: undefined, next: null }).ok).toBe(true);
    expect(lostReopen.fixture(s, vi.fn(), { id: "L4", mt: undefined, next: null })).toMatchObject({ ok: false, status: 409 });
    expect(lost(lead(s, "L15"))).toBe(true);
  });
  it("touch: a consented channel is recorded; a channel with no consent is refused", () => {
    const s = as("rohit");
    expect(touchRecord.fixture(s, vi.fn(), { id: "L4", mt: undefined, k: "msg", action: { type: "logTouch", id: "L4" as LeadId, k: "msg" } }).ok).toBe(true);
    const none = { ...s, LEADS: s.LEADS.map((l) => (l.id === "L4" ? { ...l, con: { msg: false, email: false, call: false, visit: false } } : l)) };
    expect(touchRecord.fixture(none, vi.fn(), { id: "L4", mt: undefined, k: "msg", action: { type: "logTouch", id: "L4" as LeadId, k: "msg" } })).toMatchObject({ ok: false, status: 422 });
  });
  it("move: a lead with a dated step moves; one without is refused", () => {
    const s = as("rohit");
    expect(nextMove.fixture(s, vi.fn(), { id: "L4", mt: undefined, days: 0, action: { type: "moveNextTo", id: "L4" as LeadId, days: 3 } }).ok).toBe(true);
    expect(nextMove.fixture(s, vi.fn(), { id: "L2", mt: undefined, days: 0, action: { type: "moveNextTo", id: "L2" as LeadId, days: 3 } })).toMatchObject({ ok: false, status: 422 });
  });
  it("next step: refused with an empty draft", () => {
    const s = as("rohit");
    expect(nextSave.fixture(s, vi.fn(), { id: "L2", mt: undefined, text: "", d: "", tm: "", ch: "call" })).toMatchObject({ ok: false, status: 422 });
  });
});
