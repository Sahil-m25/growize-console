/* D132 routes: POST /api/investors/[id]/contact, PUT /api/investors/[id]/details, POST /api/investors/[id]/kyc. Through the real
 * route modules, the real answer mapping (server/investors/care-http) and the real double-press guard; the live context, the
 * session's right and the care service are stubbed. Proved: the id comes from the path and the body is handed on as sent; a
 * seat without the right is a 403 before a press key is asked for; a refusal / conflict / Zoho failure carries the route's
 * status and code (never a Zoho body); a contact log needs a press key and a replay runs once. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONTACT = "554023000000400001";
const USER = "554023000000300013";
const MT = "2026-10-06T09:00:00+05:30";
const logContact = vi.fn(), saveDetails = vi.fn(), decideKyc = vi.fn();
let grant: unknown = { seat: "kam", ownBook: true };
let configured = true;

vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (h: unknown) => h }));
vi.mock("@/server/investors/http", async () => {
  const real = await vi.importActual<typeof import("@/server/investors/http")>("@/server/investors/http");
  return { ...real, investorsContext: async () => configured
    ? { ok: true, ctx: { principal: { credential: { userId: USER }, sessionId: "S".repeat(43) }, crm: {}, rt: { events: {} } } }
    : { ok: false, response: Response.json({ code: "not-configured" }, { status: 503 }) } };
});
vi.mock("@/server/investors/care-runtime", () => ({
  mayCare: async () => grant,
  careService: async () => ({ logContact, saveDetails, decideKyc }),
}));

const ctx = { params: Promise.resolve({ id: CONTACT }) };
const req = (method: string, body: unknown, key?: string) => new Request(`http://localhost/api/investors/${CONTACT}/x`, {
  method, body: typeof body === "string" ? body : JSON.stringify(body), headers: key ? { "Idempotency-Key": key } : {},
});
const done = (value: unknown) => ({ ok: true, value });
const refused = (reason: string) => ({ ok: false, kind: "refused", reason });
let n = 0;
const fresh = () => `care-key-${++n}-abcdefgh`;

const contact = await import("./[id]/contact/route");
const details = await import("./[id]/details/route");
const kyc = await import("./[id]/kyc/route");

beforeEach(() => { grant = { seat: "kam", ownBook: true }; configured = true; vi.clearAllMocks(); });

describe("POST /api/investors/[id]/contact", () => {
  const body = { expectedModifiedTime: MT, channel: "call", mood: "good", note: "Fine" };
  it("hands the path id and the body to logContact and answers its value", async () => {
    logContact.mockResolvedValueOnce(done({ contactId: CONTACT, touchId: "1", introduced: true, modifiedTime: MT }));
    const r = await contact.POST(req("POST", body, fresh()), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ contactId: CONTACT, touchId: "1", introduced: true, modifiedTime: MT });
    expect(logContact.mock.calls[0]![0]).toMatchObject({ credential: { userId: USER } });
    expect(logContact.mock.calls[0]!.slice(1, 3)).toEqual([CONTACT, body]);
  });
  it("a seat without care is 403 seat-denied before any key is asked for; nothing reaches the service", async () => {
    grant = null;
    const r = await contact.POST(req("POST", body), ctx);
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("seat-denied");
    expect(logContact).not.toHaveBeenCalled();
  });
  it("needs a press key (400) and a replay of the same press runs once", async () => {
    expect((await contact.POST(req("POST", body), ctx)).status).toBe(400);
    expect(logContact).not.toHaveBeenCalled();
    logContact.mockResolvedValue(done({ contactId: CONTACT, touchId: "7", introduced: false, modifiedTime: MT }));
    const key = fresh();
    const a = await contact.POST(req("POST", body, key), ctx), b = await contact.POST(req("POST", body, key), ctx);
    expect(await a.json()).toEqual(await b.json());
    expect(logContact).toHaveBeenCalledOnce();
  });
  it("maps a validation refusal to 400, not-allotted to 422, a conflict to 409 and a Zoho failure to 503 without its body", async () => {
    for (const [res, status, code] of [[refused("invalid-request"), 400, "invalid-request"], [refused("not-allotted"), 422, "not-allotted"],
      [{ ok: false, kind: "conflict", recordId: CONTACT, message: "x" }, 409, "conflict"], [{ ok: false, kind: "source-error", errorKind: "server" }, 503, "server"]] as const) {
      logContact.mockResolvedValueOnce(res);
      const r = await contact.POST(req("POST", body, fresh()), ctx);
      expect(r.status).toBe(status);
      const j = await r.json();
      expect(j.code).toBe(code);
      expect(typeof j.error).toBe("string");
    }
  });
  it("W3-KAM-1: a hidden origin lead is 403 origin-lead-hidden, and Zoho refusing (invalid-data) is never 'not answering'", async () => {
    logContact.mockResolvedValueOnce(refused("origin-lead-hidden")).mockResolvedValueOnce({ ok: false, kind: "source-error", errorKind: "invalid-data" });
    const a = await contact.POST(req("POST", body, fresh()), ctx);
    expect(a.status).toBe(403);
    const ja = await a.json();
    expect(ja.code).toBe("origin-lead-hidden");
    expect(ja.error).toMatch(/origin lead/);
    const b = await contact.POST(req("POST", body, fresh()), ctx);
    expect(b.status).toBe(422);
    const jb = await b.json();
    expect(jb.code).toBe("invalid-data");
    expect(jb.error).not.toMatch(/not answering/);
  });
  it("a body over 4 KB is 413; not configured is 503", async () => {
    expect((await contact.POST(req("POST", { ...body, note: "x".repeat(5000) }, fresh()), ctx)).status).toBe(413);
    configured = false;
    expect((await contact.POST(req("POST", body, fresh()), ctx)).status).toBe(503);
  });
});

describe("PUT /api/investors/[id]/details", () => {
  const body = { expectedModifiedTime: MT, changes: { city: "Mysuru" } };
  it("hands the body to saveDetails and answers its value", async () => {
    saveDetails.mockResolvedValueOnce(done({ contactId: CONTACT, fields: ["Mailing_City"], modifiedTime: MT }));
    const r = await details.PUT(req("PUT", body), ctx);
    expect(r.status).toBe(200);
    expect(saveDetails.mock.calls[0]!.slice(1, 3)).toEqual([CONTACT, body]);
  });
  it("wrong seat 403, another manager's account 403, validation 400, not JSON 400", async () => {
    saveDetails.mockResolvedValueOnce(refused("seat-denied")).mockResolvedValueOnce(refused("not-yours")).mockResolvedValueOnce(refused("invalid-request"));
    expect((await details.PUT(req("PUT", body), ctx)).status).toBe(403);
    expect((await details.PUT(req("PUT", body), ctx)).status).toBe(403);
    expect((await details.PUT(req("PUT", body), ctx)).status).toBe(400);
    saveDetails.mockImplementationOnce(async (_p: unknown, _id: unknown, b: unknown) => (b === null ? refused("invalid-request") : done({})));
    expect((await details.PUT(req("PUT", "{not json"), ctx)).status).toBe(400);
  });
});

describe("POST /api/investors/[id]/kyc", () => {
  it("hands the body to decideKyc; no PAN is 422; a KAM is 403; a Zoho error is 503", async () => {
    decideKyc.mockResolvedValueOnce(done({ contactId: CONTACT, kyc: "passed", on: "2026-10-06", noteId: null, modifiedTime: MT }))
      .mockResolvedValueOnce(refused("no-pan")).mockResolvedValueOnce(refused("seat-denied")).mockResolvedValueOnce({ ok: false, kind: "source-error", errorKind: "unavailable" });
    const body = { expectedModifiedTime: MT, result: "passed" };
    const r = await kyc.POST(req("POST", body), ctx);
    expect(r.status).toBe(200);
    expect(decideKyc.mock.calls[0]!.slice(1, 3)).toEqual([CONTACT, body]);
    expect((await kyc.POST(req("POST", body), ctx)).status).toBe(422);
    expect((await kyc.POST(req("POST", body), ctx)).status).toBe(403);
    expect((await kyc.POST(req("POST", body), ctx)).status).toBe(503);
  });
});
