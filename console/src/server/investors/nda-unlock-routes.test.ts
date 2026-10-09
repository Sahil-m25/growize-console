/* G1 / G2 / GC-1526 (D136 proposed) — the three routes through their real route modules; only the sign-in context and the
 * services behind them are stubbed (the services are proved in onboarding.test.cjs, paperwork.test.cjs and queues.test.cjs).
 *   POST /api/investors/[id]/unlock   plain → unlock(); { override: { reason, confirmed } } → overrideUnlock(); the gate's
 *                                     refusals keep their statuses; the override right is Finance Operations / Head of Finance only
 *   POST /api/leads/[id]/paperwork    beat "request" passes through; `already` answers 200; already-sent is 409
 *   GET  /api/queues/investors        carries the "send it" rows and the requests note
 * Run: npx vitest run src/server/investors/nda-unlock-routes.test.ts */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "9007199254740995001";
const CONTACT = "9007199254740994001", LEAD = "9007199254740996101";
const unlock = vi.fn(), overrideUnlock = vi.fn(), step = vi.fn(), today = vi.fn();
let deps: { authority: { mayChange: (c: unknown, s: string) => Promise<boolean>; mayOverride?: (c: unknown, s: string) => Promise<boolean> } } | null = null;
let liveSeat = "fin-ops";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "session_fixture_1234567" }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_route: string, handler: unknown) => handler }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (handler: unknown) => handler }));
vi.mock("@/server/oauth/user-session", () => ({ SID_COOKIE: "sid" }));
vi.mock("@/server/http/error-capture", () => ({ noteZohoFailure: () => {} }));
vi.mock("@/server/oauth/request", () => ({
  sessionCredential: async () => ({ ok: true, credential: { kind: "user", userId: ME }, session: { seat: "ir" } }),
}));
vi.mock("@/server/investors/http", () => ({
  NO_STORE: { "Cache-Control": "no-store" },
  investorsContext: async () => ({ ok: true, ctx: { rt: { log: {}, events: {} }, crm: {},
    principal: { credential: { kind: "user", userId: ME }, sessionId: "session_fixture_1234567", session: { seat: liveSeat } } } }),
}));
vi.mock("@/server/investors/unlock", () => ({
  createAppAccess: (d: typeof deps) => { deps = d; return { unlock, overrideUnlock, card: vi.fn(), lock: vi.fn() }; },
}));
/* the live session's seat, re-read by the authority: the token → Zoho seat map is the policy's own */
vi.mock("@/server/oauth/runtime", () => ({
  userSessions: () => ({ credential: async () => ({ ok: true, credential: { userId: ME }, session: { seat: liveSeat, who: ME } }) }),
}));
vi.mock("@/server/data/live", () => ({
  zohoSeatOf: (t: string) => ({ "fin-ops": "finance-operations", "fin-head": "head-of-finance", kam: "key-account-manager", di: "digital-infrastructure", comp: "compliance-audit" } as Record<string, string>)[t] ?? null,
}));
vi.mock("@/server/access/policy", () => ({
  /* the pay right as the Investors ROLE table has it: Finance and the super user */
  seatAccess: (seat: string) => ({ imCan: (c: string) => c === "pay" && ["finance-operations", "head-of-finance", "digital-infrastructure"].includes(seat) }),
}));
vi.mock("@/server/leads/email-runtime", () => ({ emailConfigured: () => true, paperworkService: () => ({ step, undo: vi.fn(), read: vi.fn() }) }));
vi.mock("@/server/queues/runtime", () => ({
  NO_STORE: { "Cache-Control": "no-store" },
  queuesContext: async () => ({ ok: true, queues: { today }, principal: {} }),
  queueFailure: () => Response.json({}, { status: 503 }),
}));

const unlockRoute = await import("@/app/api/investors/[id]/unlock/route");
const paperRoute = await import("@/app/api/leads/[id]/paperwork/route");
const queueRoute = await import("@/app/api/queues/investors/route");

const post = (body: unknown) => new Request("http://localhost:3001/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const card = { contactId: CONTACT, access: "Invite", state: "sending", tenPercent: null, mayOverride: false };
const refused = (reasonCode: string, message = "m") => ({ ok: false, kind: "refused", reasonCode, message, retryable: false });

beforeEach(() => { unlock.mockReset(); overrideUnlock.mockReset(); step.mockReset(); today.mockReset(); deps = null; liveSeat = "fin-ops"; });

describe("POST /api/investors/[id]/unlock — G2 gate and GC-1526 override", () => {
  it("a plain press is the gated unlock; the gate's refusal is 422 with its words", async () => {
    unlock.mockResolvedValue(refused("ten-percent-not-verified", "Not unlocked — the 10% advance is not verified yet"));
    const res = await unlockRoute.POST(post({ expectedModifiedTime: "2026-09-28T09:00:00+05:30" }), params(CONTACT));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Not unlocked — the 10% advance is not verified yet", code: "ten-percent-not-verified" });
    expect(unlock.mock.calls[0]!.slice(1, 3)).toEqual([CONTACT, "2026-09-28T09:00:00+05:30"]);
    expect(overrideUnlock).not.toHaveBeenCalled();
  });
  it("{ override } goes to overrideUnlock with the reason and the confirmation, never to the plain unlock", async () => {
    overrideUnlock.mockResolvedValue({ ok: true, value: card, already: false, noteSaved: true });
    const res = await unlockRoute.POST(post({ expectedModifiedTime: null, override: { reason: "Paid by cheque, clearing Monday", confirmed: true } }), params(CONTACT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card, already: false, noteSaved: true });
    expect(overrideUnlock.mock.calls[0]!.slice(1, 5)).toEqual([CONTACT, "Paid by cheque, clearing Monday", true, null]);
    expect(unlock).not.toHaveBeenCalled();
  });
  it("the override's refusals keep their statuses", async () => {
    for (const [code, status] of [["not-override", 403], ["confirm-needed", 409], ["override-reason-short", 422], ["note-failed", 502], ["ten-percent-unknown", 503]] as const) {
      overrideUnlock.mockResolvedValueOnce(refused(code));
      const res = await unlockRoute.POST(post({ override: { reason: "x", confirmed: true } }), params(CONTACT));
      expect([code, res.status]).toEqual([code, status]);
    }
  });
  it("the override right is Finance Operations and the Head of Finance only — not the super user, not a KAM, not Compliance", async () => {
    unlock.mockResolvedValue({ ok: true, value: card, already: false });
    await unlockRoute.POST(post({}), params(CONTACT));
    const a = deps!.authority;
    const verdict = async (seat: string) => { liveSeat = seat; return [await a.mayChange({ userId: ME }, "s"), await a.mayOverride!({ userId: ME }, "s")]; };
    expect(await verdict("fin-ops")).toEqual([true, true]);
    expect(await verdict("fin-head")).toEqual([true, true]);
    expect(await verdict("di")).toEqual([true, false]);
    expect(await verdict("kam")).toEqual([false, false]);
    expect(await verdict("comp")).toEqual([false, false]);
  });
});

describe("POST /api/leads/[id]/paperwork — G1 request beat", () => {
  it("passes the request beat through on the person's own session; an earlier request answers 200 already", async () => {
    step.mockResolvedValue({ ok: true, value: { round: "nda", beat: "request", modifiedTime: "t", touchId: null, noteId: null, draftVersion: null, undoToken: null, undoUntil: 0, already: true } });
    const res = await paperRoute.POST(post({ round: "nda", beat: "request", rowToken: "tok" }), params(LEAD));
    expect(res.status).toBe(200);
    expect((await res.json()).already).toBe(true);
    const [principal, cmd] = step.mock.calls[0]!;
    expect(principal.credential.userId).toBe(ME);
    expect(cmd).toEqual({ leadId: LEAD, round: "nda", beat: "request", rowToken: "tok" });
  });
  it("a paper Finance has already sent is 409 already-sent", async () => {
    step.mockResolvedValue({ ok: false, kind: "refused", reasonCode: "already-sent", reason: "Not saved — Finance has already sent it for signature." });
    const res = await paperRoute.POST(post({ round: "nda", beat: "request", rowToken: "tok" }), params(LEAD));
    expect([res.status, (await res.json()).code]).toEqual([409, "already-sent"]);
  });
});

describe("GET /api/queues/investors — G1 rows and note", () => {
  it("carries the send rows and the requests note as the service built them", async () => {
    const row = { key: `send:nda:${LEAD}`, kind: "send", investor: { id: LEAD, name: "Kiran Synthetic" }, text: "Send the NDA — requested by Rohit Iyer 2 days ago",
      urg: "now", days: 2, action: "Send it", ref: { leadId: LEAD, paper: "nda" } };
    today.mockResolvedValue({ ok: true, queue: { side: "money", readOnly: false, rows: [row], waiting: 1, today: 1, problems: [], asOf: 0, requestsNote: "partial" } });
    const res = await queueRoute.GET(new Request("http://localhost:3001/api/queues/investors"), {} as never);
    const b = await res.json();
    expect(b.queue.rows).toEqual([row]);
    expect(b.queue.requestsNote).toBe("partial");
  });
});
