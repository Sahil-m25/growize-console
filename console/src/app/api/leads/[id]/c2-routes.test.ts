/* Cluster C2 routes (ir-write-map.md): /api/leads/[id]/{journey,notes,permission,details,forecast}. Through the real
 * route modules with the session, the guards and the C2 runtime stubbed: each route hands the service the person's
 * principal, the lead id, the page's Modified_Time and only the body fields it names, and maps the answer — a refusal to
 * its status with { error, code, field? }, a Zoho failure to 503/502. Everything is synthetic. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = {
  journey: { tick: vi.fn(), skip: vi.fn(), untick: vi.fn() },
  notes: { add: vi.fn() },
  details: { permission: vi.fn(), profile: vi.fn() },
  forecast: { set: vi.fn() },
};
const CRED = { userId: "554023000000300004" };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "S".repeat(43) }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (h: unknown) => h }));
vi.mock("@/server/oauth/request", () => ({ sessionCredential: async () => ({ ok: true, credential: CRED }) }));
vi.mock("@/server/leads/journey-runtime", () => ({ recordConfigured: () => true, recordRuntime: () => svc }));

const journey = await import("./journey/route");
const notes = await import("./notes/route");
const permission = await import("./permission/route");
const details = await import("./details/route");
const forecast = await import("./forecast/route");

const ID = "554023000000900001";
const MT = "2026-10-06T10:00:00+05:30";
const ctx = { params: Promise.resolve({ id: ID }) };
const req = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/leads/${ID}/x`, { method, body: typeof body === "string" ? body : JSON.stringify(body), headers });
const principal = { credential: CRED, sessionId: "S".repeat(43) };
const done = (value: unknown) => ({ ok: true, value });
const refused = (reasonCode: string, field?: string) => ({ ok: false, kind: "refused", reasonCode, reason: "words", ...(field ? { field } : {}) });

beforeEach(() => { for (const g of Object.values(svc)) for (const f of Object.values(g)) f.mockReset(); });

describe("POST /api/leads/[id]/journey", () => {
  it("tick, recordRung's scorecard, skip and untick reach the journey with the page's Modified_Time", async () => {
    svc.journey.tick.mockResolvedValue(done({ rung: 4, modifiedTime: "m" }));
    const res = await journey.POST(req("POST", { op: "tick", expectedModifiedTime: MT, scorecard: true }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rung: 4, modifiedTime: "m" });
    expect(svc.journey.tick).toHaveBeenCalledWith(principal, ID, MT, true, expect.anything());
    svc.journey.skip.mockResolvedValue(done({ rung: 4, modifiedTime: "m" }));
    await journey.POST(req("POST", { op: "skip", expectedModifiedTime: MT }), ctx);
    expect(svc.journey.skip).toHaveBeenCalledWith(principal, ID, MT, expect.anything());
    svc.journey.untick.mockResolvedValue(done({ rung: 3, modifiedTime: "m" }));
    await journey.POST(req("POST", { op: "untick", expectedModifiedTime: MT, reason: "Ticked the wrong rung" }), ctx);
    expect(svc.journey.untick).toHaveBeenCalledWith(principal, ID, MT, "Ticked the wrong rung", expect.anything());
  });
  it("a missing Zoho field is 422 code field-missing naming it; a stale page 409; a shut gate 409", async () => {
    svc.journey.untick.mockResolvedValue(refused("field-missing", "Rung_Undone_At"));
    let res = await journey.POST(req("POST", { op: "untick", expectedModifiedTime: MT, reason: "x" }), ctx);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "words", code: "field-missing", field: "Rung_Undone_At" });
    svc.journey.tick.mockResolvedValue(refused("lead-changed"));
    expect((await journey.POST(req("POST", { op: "tick", expectedModifiedTime: MT }), ctx)).status).toBe(409);
    svc.journey.tick.mockResolvedValue(refused("gate-shut"));
    res = await journey.POST(req("POST", { op: "tick", expectedModifiedTime: MT }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("gate-shut");
  });
  it("an unknown op, no Modified_Time or a broken body is 400 before the journey is asked", async () => {
    for (const b of [{ op: "jump", expectedModifiedTime: MT }, { op: "tick" }, "{not json"])
      expect((await journey.POST(req("POST", b), ctx)).status).toBe(400);
    expect(svc.journey.tick).not.toHaveBeenCalled();
  });
  it("Zoho not answering is 503 when retryable, 502 when not", async () => {
    svc.journey.tick.mockResolvedValue({ ok: false, kind: "source-error", source: "zoho", errorKind: "network", retryable: true });
    expect((await journey.POST(req("POST", { op: "tick", expectedModifiedTime: MT }), ctx)).status).toBe(503);
    svc.journey.tick.mockResolvedValue({ ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false });
    expect((await journey.POST(req("POST", { op: "tick", expectedModifiedTime: MT }), ctx)).status).toBe(502);
  });
});

describe("POST /api/leads/[id]/notes", () => {
  it("hands the text and the Idempotency-Key to the notes service", async () => {
    svc.notes.add.mockResolvedValue(done({ noteId: "n1", leadId: ID }));
    const res = await notes.POST(req("POST", { text: "A note" }, { "Idempotency-Key": "press-0001" }), ctx);
    expect(res.status).toBe(200);
    expect(svc.notes.add).toHaveBeenCalledWith(principal, ID, "A note", "press-0001", expect.anything());
    svc.notes.add.mockResolvedValue(refused("note-empty"));
    expect((await notes.POST(req("POST", { text: "" }), ctx)).status).toBe(422);
  });
});

describe("PUT /api/leads/[id]/permission and /details", () => {
  it("permission passes con/how/date/time and the Modified_Time; a body without con is 400", async () => {
    svc.details.permission.mockResolvedValue(done({ leadId: ID, modifiedTime: "m", fields: [] }));
    await permission.PUT(req("PUT", { expectedModifiedTime: MT, con: { msg: true }, how: "call", date: "2026-10-06", time: "09:00", extra: 1 }), ctx);
    expect(svc.details.permission).toHaveBeenCalledWith(principal, ID, MT, { con: { msg: true }, how: "call", date: "2026-10-06", time: "09:00" }, expect.anything());
    expect((await permission.PUT(req("PUT", { expectedModifiedTime: MT }), ctx)).status).toBe(400);
  });
  it("details passes only the named keys that were sent; a duplicate mobile is 409", async () => {
    svc.details.profile.mockResolvedValue(done({ leadId: ID, modifiedTime: "m", fields: ["City"] }));
    await details.PUT(req("PUT", { expectedModifiedTime: MT, city: "Pune", Owner: "someone-else" }), ctx);
    expect(svc.details.profile).toHaveBeenCalledWith(principal, ID, MT, { city: "Pune" }, expect.anything());
    svc.details.profile.mockResolvedValue(refused("duplicate-mobile"));
    expect((await details.PUT(req("PUT", { expectedModifiedTime: MT, mobile: "9876543210" }), ctx)).status).toBe(409);
  });
});

describe("PUT /api/leads/[id]/forecast", () => {
  it("passes category and paidBy; already paid is 409", async () => {
    svc.forecast.set.mockResolvedValue(done({ leadId: ID, modifiedTime: "m", forecast: "Commit", paidBy: null }));
    await forecast.PUT(req("PUT", { expectedModifiedTime: MT, category: "commit" }), ctx);
    expect(svc.forecast.set).toHaveBeenCalledWith(principal, ID, MT, { category: "commit", paidBy: undefined }, expect.anything());
    svc.forecast.set.mockResolvedValue(refused("already-paid"));
    expect((await forecast.PUT(req("PUT", { expectedModifiedTime: MT, paidBy: "2027-01-01" }), ctx)).status).toBe(409);
  });
});
