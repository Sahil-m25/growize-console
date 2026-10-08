/* Cluster C1 routes: /api/leads/[id]/{followup,touches,next,next/move,lost}. Through the real route modules and the real shared door
 * (app/api/leads/http.ts) and the real double-press guard; the session, the services and the guards are stubbed.
 * What is proved: the services get the lead id from the path and the command from the body, a press key is required on the writes
 * that insert (and a replay answers once), a refusal's status and code are the route's, and a body that is not JSON is a 400. */
import { describe, expect, it, vi, beforeEach } from "vitest";

const LEAD = "554023000000700001";
const USER = "554023000000300004";
const save = vi.fn(), setNext = vi.fn(), close = vi.fn(), reopen = vi.fn(), reschedule = vi.fn(), record = vi.fn();
let configured = true;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "S".repeat(43) }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (h: unknown) => h }));
vi.mock("@/server/http/error-capture", () => ({ noteZohoFailure: () => {} }));
vi.mock("@/server/oauth/request", () => ({ sessionCredential: async () => ({ ok: true, credential: { userId: USER } }) }));
vi.mock("@/server/leads/email-runtime", () => ({ emailConfigured: () => configured, sessionAccess: () => ({}) }));
vi.mock("@/server/data/zoho-source", () => ({ dataRuntime: () => ({ gate: {}, log: {} }) }));
vi.mock("@/server/oauth/runtime", () => ({ userSessions: () => ({}) }));
vi.mock("@/lib/zoho/client", () => ({ createZohoClient: () => ({}) }));
vi.mock("@/server/leads/followup-runtime", async () => {
  const real = await vi.importActual<typeof import("@/server/leads/followup-runtime")>("@/server/leads/followup-runtime");
  return { ...real, followupService: () => ({ save, setNext, close, reopen, reschedule }), touchesService: () => ({ record }) };
});

const ctx = { params: Promise.resolve({ id: LEAD }) };
const req = (method: string, body: unknown, key?: string) => new Request(`http://localhost/api/leads/${LEAD}/x`, {
  method, body: typeof body === "string" ? body : JSON.stringify(body), headers: key ? { "Idempotency-Key": key } : {},
});
const done = (value: unknown) => ({ ok: true, value });
const refused = (reasonCode: string, reason = "because") => ({ ok: false, kind: "refused", reasonCode, reason });
let n = 0;
const fresh = () => `press-key-${++n}-abcdefgh`;
const MT = "2026-10-06T09:00:00+05:30";

const followup = await import("./[id]/followup/route");
const touches = await import("./[id]/touches/route");
const next = await import("./[id]/next/route");
const move = await import("./[id]/next/move/route");
const lost = await import("./[id]/lost/route");

beforeEach(() => { configured = true; vi.clearAllMocks(); });

describe("POST /followup", () => {
  const body = { expectedModifiedTime: MT, contact: { channel: "call", outcome: "Spoke", occurredAt: MT, reached: true }, scheduled: null, complete: false, keep: false,
    next: { text: "Call back", at: "2026-10-08T10:00:00+05:30", channel: "call" } };

  it("hands the lead id and the command to the follow-up save, and answers its value", async () => {
    save.mockResolvedValueOnce(done({ touchId: "1", nextId: "2", undoToken: "t", undoUntil: 5 }));
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ touchId: "1", nextId: "2", undoToken: "t", undoUntil: 5 });
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]![0]).toMatchObject({ credential: { userId: USER } });
    expect(save.mock.calls[0]![1]).toMatchObject({ leadId: LEAD, expectedModifiedTime: MT, keep: false, complete: false, scheduled: null, next: body.next });
    expect(save.mock.calls[0]![1]).not.toHaveProperty("lost");
  });
  it("carries a loss in the same save", async () => {
    save.mockResolvedValueOnce(done({}));
    await followup.POST(req("POST", { ...body, next: null, lost: { reason: "Price too high" } }, fresh()), ctx);
    expect(save.mock.calls[0]![1]).toMatchObject({ lost: { reason: "Price too high" }, next: null });
  });
  it("needs a press key: none, or a malformed one, is a 400 and nothing is saved", async () => {
    for (const key of [undefined, "short"]) {
      const r = await followup.POST(req("POST", body, key), ctx);
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("idempotency-key-needed");
    }
    expect(save).not.toHaveBeenCalled();
  });
  it("the same key and body runs once and replays the first answer; the same key on a different body is refused", async () => {
    save.mockResolvedValue(done({ touchId: "9", nextId: null, undoToken: null, undoUntil: null }));
    const key = fresh();
    const a = await followup.POST(req("POST", body, key), ctx);
    const b = await followup.POST(req("POST", body, key), ctx);
    expect(await a.json()).toEqual(await b.json());
    expect(save).toHaveBeenCalledOnce();
    const c = await followup.POST(req("POST", { ...body, keep: true }, key), ctx);
    expect(c.status).toBe(422);
    expect((await c.json()).code).toBe("key-reused");
    expect(save).toHaveBeenCalledOnce();
  });
  it("a refusal keeps no key: the same press may be sent again after it", async () => {
    save.mockResolvedValueOnce(refused("lead-changed")).mockResolvedValueOnce(done({}));
    const key = fresh();
    expect((await followup.POST(req("POST", body, key), ctx)).status).toBe(409);
    expect((await followup.POST(req("POST", body, key), ctx)).status).toBe(200);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["session-changed", 401], ["capability-missing", 403], ["not-in-book", 403], ["not-visible", 404], ["no-consent", 403], ["lead-changed", 409],
    ["lead-lost", 409], ["money-in", 409], ["followup-partial", 502], ["next-step-needed", 422], ["contact-in-future", 422],
  ])("refusal %s → %i with its code and an inline message", async (code, status) => {
    save.mockResolvedValueOnce(refused(code as string, "the reason"));
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(status);
    const j = await r.json();
    expect(j.code).toBe(code);
    expect(j.error).toBe("Not saved — the reason.");
  });
  it("a Zoho failure is a 502/503 with the failure's code, never a Zoho body", async () => {
    save.mockResolvedValueOnce({ ok: false, kind: "source-error", source: "zoho", errorKind: "server", retryable: true });
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Not saved — Zoho is not answering. Try again.", code: "server" });
  });
  it("B-01: a profile with no Create on the activity is a 403 activity-forbidden naming the module and Zoho's code", async () => {
    save.mockResolvedValueOnce({ ok: false, kind: "source-error", source: "zoho", errorKind: "forbidden", retryable: false,
      detail: { module: "Events", kind: "forbidden", code: "NO_PERMISSION", field: null } });
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Not saved — your Zoho profile cannot save Meetings; nothing was kept.", code: "activity-forbidden",
      zoho: { module: "Events", code: "NO_PERMISSION", field: null } });
  });
  it("B-01: an invalid-data refusal names Zoho's code and field, not 'Zoho is not answering'", async () => {
    setNext.mockResolvedValueOnce({ ok: false, kind: "source-error", source: "zoho", errorKind: "invalid-data", retryable: false,
      detail: { module: "Calls", kind: "invalid-data", code: "INVALID_DATA", field: "Call_Start_Time" } });
    const r = await next.PUT(req("PUT", { expectedModifiedTime: MT, next: { text: "Call back", at: "2026-10-08T10:00:00+05:30", channel: "call" }, scheduled: null }, fresh()), ctx);
    expect(r.status).toBe(502);
    const j = await r.json();
    expect(j.code).toBe("zoho-refused");
    expect(j.error).toBe("Not saved — Zoho refused the Call (INVALID_DATA on Call_Start_Time); nothing was kept.");
  });
  it("a forbidden Zoho failure with no detail is a 403, not 'Zoho is not answering'", async () => {
    save.mockResolvedValueOnce({ ok: false, kind: "source-error", source: "zoho", errorKind: "forbidden", retryable: false });
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("zoho-forbidden");
  });
  it("a body that is not a JSON object is a 400; an oversize one a 413; not configured is a 503", async () => {
    expect((await followup.POST(req("POST", "nope", fresh()), ctx)).status).toBe(400);
    expect((await followup.POST(req("POST", "[]", fresh()), ctx)).status).toBe(400);
    expect((await followup.POST(req("POST", JSON.stringify({ x: "y".repeat(20_000) }), fresh()), ctx)).status).toBe(413);
    configured = false;
    const r = await followup.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("not-configured");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("POST /touches", () => {
  it("passes only what was sent, to the touch recorder, under a press key", async () => {
    record.mockResolvedValue(done({ touchId: "1", modifiedTime: MT, firstTouch: true }));
    const r = await touches.POST(req("POST", { expectedModifiedTime: MT, channel: "call", reached: true, occurredAt: MT }, fresh()), ctx);
    expect(r.status).toBe(200);
    expect(record.mock.calls[0]![1]).toEqual({ leadId: LEAD, expectedModifiedTime: MT, channel: "call", reached: true, occurredAt: MT });
    await touches.POST(req("POST", { expectedModifiedTime: MT, channel: "msg" }, fresh()), ctx);
    expect(record.mock.calls[1]![1]).toEqual({ leadId: LEAD, expectedModifiedTime: MT, channel: "msg" });
    expect((await touches.POST(req("POST", { expectedModifiedTime: MT, channel: "msg" }), ctx)).status).toBe(400);
  });
  it("answers a consent refusal as a 403 no-consent", async () => {
    record.mockResolvedValueOnce(refused("no-consent"));
    const r = await touches.POST(req("POST", { expectedModifiedTime: MT, channel: "email" }, fresh()), ctx);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("no-consent");
  });
});

describe("PUT /next", () => {
  it("sets the next step; the open activity defaults to none", async () => {
    setNext.mockResolvedValueOnce(done({ nextId: "7", modifiedTime: MT }));
    const nx = { text: "Call back", at: "2026-10-08T10:00:00+05:30", channel: "call" };
    const r = await next.PUT(req("PUT", { expectedModifiedTime: MT, next: nx }, fresh()), ctx);
    expect(r.status).toBe(200);
    expect(setNext.mock.calls[0]![1]).toEqual({ leadId: LEAD, expectedModifiedTime: MT, next: nx, scheduled: null });
    expect((await next.PUT(req("PUT", { expectedModifiedTime: MT, next: nx }), ctx)).status).toBe(400);
  });
  it("has no DELETE: clearing the next step waits on a ruling", () => {
    expect((next as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

describe("POST /next/move", () => {
  it("moves by days with no press key (an update, not an insert); the activity defaults to none", async () => {
    reschedule.mockResolvedValueOnce(done({ nextStepAt: MT, undoToken: "u", undoUntil: 1 }));
    const r = await move.POST(req("POST", { expectedModifiedTime: MT, days: -2 }), ctx);
    expect(r.status).toBe(200);
    expect(reschedule.mock.calls[0]!.slice(1, 5)).toEqual([LEAD, MT, null, -2]);
  });
  it("answers nothing-to-reschedule as a 422", async () => {
    reschedule.mockResolvedValueOnce(refused("nothing-to-reschedule"));
    expect((await move.POST(req("POST", { expectedModifiedTime: MT, days: 1 }), ctx)).status).toBe(422);
  });
});

describe("/lost", () => {
  it("POST closes with a reason and a note, under a press key", async () => {
    close.mockResolvedValueOnce(done({ noteId: "5", modifiedTime: MT }));
    const r = await lost.POST(req("POST", { expectedModifiedTime: MT, reason: "Price too high", note: "said no" }, fresh()), ctx);
    expect(r.status).toBe(200);
    expect(close.mock.calls[0]![1]).toEqual({ leadId: LEAD, expectedModifiedTime: MT, reason: "Price too high", note: "said no" });
    expect((await lost.POST(req("POST", { expectedModifiedTime: MT, reason: "Price too high" }), ctx)).status).toBe(400);
  });
  it("POST once money is in is a 409 money-in", async () => {
    close.mockResolvedValueOnce(refused("money-in"));
    const r = await lost.POST(req("POST", { expectedModifiedTime: MT, reason: "Price too high" }, fresh()), ctx);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("money-in");
  });
  it("DELETE re-opens (an update) with the next step the caller supplies, or none; no press key", async () => {
    reopen.mockResolvedValue(done({ modifiedTime: MT }));
    const nx = { text: "Call back", at: "2026-10-08T10:00:00+05:30", channel: "call" };
    expect((await lost.DELETE(req("DELETE", { expectedModifiedTime: MT, next: nx }), ctx)).status).toBe(200);
    expect(reopen.mock.calls[0]!.slice(1, 4)).toEqual([LEAD, MT, nx]);
    await lost.DELETE(req("DELETE", { expectedModifiedTime: MT }), ctx);
    expect(reopen.mock.calls[1]![3]).toBeNull();
  });
  it("DELETE on a lead that is not lost is a 409 not-lost", async () => {
    reopen.mockResolvedValueOnce(refused("not-lost"));
    expect((await lost.DELETE(req("DELETE", { expectedModifiedTime: MT, next: null }), ctx)).status).toBe(409);
  });
});
