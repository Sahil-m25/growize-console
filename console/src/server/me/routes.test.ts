/* C4 / Me — the three routes through their real route modules; only the sign-in context and the services behind them are
 * stubbed. /api/me names no user (the id is the credential's), /api/me/style reads and writes my entry only, and
 * /api/activity/export carries a view code and a count, never a row. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "9007199254740995001";
const update = vi.fn();
const styleGet = vi.fn();
const styleSet = vi.fn();
const record = vi.fn();
let signedIn = true;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session_fixture_1234567" }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_route: string, handler: unknown) => handler }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (handler: unknown) => handler }));
vi.mock("@/server/oauth/user-session", () => ({ SID_COOKIE: "sid" }));
const noteOwnProfile = vi.fn(async () => {});
vi.mock("@/server/oauth/runtime", () => ({ userSessions: () => ({ noteOwnProfile }) }));
vi.mock("@/server/oauth/request", () => ({
  sessionCredential: async () => signedIn
    ? { ok: true, credential: { kind: "user", userId: ME }, session: { seat: "ir" } }
    : { ok: false, response: Response.json({ session: null }, { status: 401 }) },
}));
vi.mock("@/server/me/runtime", () => ({
  meConfigured: () => true,
  meRuntime: () => ({ profile: { update } }),
  styleStore: () => ({ get: styleGet, set: styleSet }),
  exportAudit: () => ({ record }),
}));

const { PATCH } = await import("@/app/api/me/route");
const style = await import("@/app/api/me/style/route");
const exp = await import("@/app/api/activity/export/route");

const json = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3001/x", { method, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ctx = {} as never;

beforeEach(() => { update.mockReset(); styleGet.mockReset(); styleSet.mockReset(); record.mockReset(); signedIn = true; });

describe("PATCH /api/me", () => {
  it("writes my name on my own credential and answers the saved name and mobile", async () => {
    update.mockResolvedValue({ ok: true, value: { name: "Asha Rao", mobile: "+919845033021" } });
    const res = await PATCH(json("PATCH", { name: "Asha Rao", mobile: "98450 33021" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Asha Rao", mobile: "+919845033021" });
    const [principal, change] = update.mock.calls[0]!;
    expect(principal.credential.userId).toBe(ME);
    expect(principal.sessionId).toBe("session_fixture_1234567");
    expect(change).toEqual({ name: "Asha Rao", mobile: "98450 33021" });
  });
  it("B-26: a mobile alone is passed on with no name", async () => {
    update.mockResolvedValue({ ok: true, value: { name: null, mobile: "+919000007781" } });
    const res = await PATCH(json("PATCH", { mobile: "+91 90000 07781" }), ctx);
    expect(res.status).toBe(200);
    expect(update.mock.calls[0]![1]).toEqual({ mobile: "+91 90000 07781" });
    /* B-26 reopened: the session remembers the mobile Zoho accepted, so /api/session carries it after save and reload */
    expect(noteOwnProfile).toHaveBeenLastCalledWith("session_fixture_1234567", { mobile: "+919000007781" });
  });
  it("B-26: a refused save never touches what the session remembers", async () => {
    noteOwnProfile.mockClear();
    update.mockResolvedValue({ ok: false, kind: "refused", reasonCode: "invalid-mobile", reason: "x" });
    await PATCH(json("PATCH", { mobile: "12" }), ctx);
    expect(noteOwnProfile).not.toHaveBeenCalled();
  });
  it("a body that names a user id or any field but name, mobile and email is never passed on", async () => {
    update.mockResolvedValue({ ok: true, value: { name: "Asha Rao", mobile: null } });
    await PATCH(json("PATCH", { name: "Asha Rao", userId: "9007199254740995999", id: "1", role: "x" }), ctx);
    expect(update.mock.calls[0]![1]).toEqual({ name: "Asha Rao" });
  });
  it("an omitted mobile leaves it alone; a refusal is its own status and nothing is saved", async () => {
    update.mockResolvedValue({ ok: false, kind: "refused", reasonCode: "name-too-short", reason: "a display name needs at least two characters" });
    const res = await PATCH(json("PATCH", { name: "A" }), ctx);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nothing changed — a display name needs at least two characters.", code: "name-too-short" });
    update.mockResolvedValue({ ok: false, kind: "refused", reasonCode: "email-read-only", reason: "your sign-in email is your Zoho account's and cannot be changed here" });
    expect((await PATCH(json("PATCH", { name: "Asha Rao", email: "x@example.invalid" }), ctx)).status).toBe(400);
    update.mockResolvedValue({ ok: false, kind: "refused", reasonCode: "session-changed", reason: "the sign-in session changed" });
    expect((await PATCH(json("PATCH", { name: "Asha Rao" }), ctx)).status).toBe(409);
  });
  it("Zoho refusing the change is a 502, never a save; a malformed body or a signed-out caller never reaches the service", async () => {
    update.mockResolvedValue({ ok: false, kind: "source-error", errorKind: "no-permission", retryable: false });
    const res = await PATCH(json("PATCH", { name: "Asha Rao" }), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("no-permission");
    update.mockClear();
    expect((await PATCH(new Request("http://localhost:3001/x", { method: "PATCH", body: "nope" }), ctx)).status).toBe(400);
    signedIn = false;
    expect((await PATCH(json("PATCH", { name: "Asha Rao" }), ctx)).status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("/api/me/style", () => {
  it("GET answers my own entry by the session's id", async () => {
    styleGet.mockResolvedValue({ c: 2, sq: false, i: "AR" });
    const res = await style.GET(new Request("http://localhost:3001/api/me/style?user=9007199254740995999"), ctx);
    expect(await res.json()).toEqual({ c: 2, sq: false, i: "AR" });
    expect(styleGet).toHaveBeenCalledWith(ME);
  });
  it("PUT merges only c, sq and i into my entry; a refusal is 422 and says why", async () => {
    styleSet.mockResolvedValue({ ok: true, value: { c: 4, sq: true } });
    const res = await style.PUT(json("PUT", { c: 4, sq: true, userId: "9007199254740995999" }), ctx);
    expect(await res.json()).toEqual({ c: 4, sq: true });
    expect(styleSet).toHaveBeenCalledWith(ME, { c: 4, sq: true, i: undefined });
    styleSet.mockResolvedValue({ ok: false, reasonCode: "invalid-colour", reason: "pick one of the eight badge colours" });
    const bad = await style.PUT(json("PUT", { c: 12 }), ctx);
    expect(bad.status).toBe(422);
    expect((await bad.json()).code).toBe("invalid-colour");
    expect((await style.PUT(new Request("http://localhost:3001/x", { method: "PUT", body: "[]" }), ctx)).status).toBe(400);
  });
});

describe("POST /api/activity/export", () => {
  it("logs the view and the count for the signed-in person, with the Idempotency-Key", async () => {
    record.mockResolvedValue({ ok: true, replayed: false });
    const res = await exp.POST(json("POST", { view: "day", rows: 12, filename: "activity.csv", rowsData: [["secret"]] }, { "idempotency-key": "press-0001-aaaa" }), ctx);
    expect(await res.json()).toEqual({ logged: true, replayed: false });
    expect(record).toHaveBeenCalledWith({ userId: ME, seat: "ir" }, { view: "day", rows: 12 }, "press-0001-aaaa");
  });
  it("a seat with no Activity page is 403, a bad request 400; a malformed body never reaches the log", async () => {
    record.mockResolvedValue({ ok: false, reasonCode: "no-activity", reason: "this seat has no Activity page" });
    expect((await exp.POST(json("POST", { view: "log", rows: 1 }), ctx)).status).toBe(403);
    record.mockResolvedValue({ ok: false, reasonCode: "invalid-request", reason: "the request is invalid" });
    expect((await exp.POST(json("POST", { view: "raw", rows: 1 }), ctx)).status).toBe(400);
    record.mockClear();
    expect((await exp.POST(new Request("http://localhost:3001/x", { method: "POST", body: "{" }), ctx)).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });
});
