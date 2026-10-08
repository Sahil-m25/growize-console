/* B-06b — GET/POST /api/leads/[id]/claim map Zoho REFUSING the Receipts read or insert (the IR profile has no Receipts
 * permission) to 403 forbidden with the service's own words, never a 502 "Not saved — Zoho is not answering". An outage
 * keeps 503/502. Through the real route module; the session, the guards and the claims service are stubbed. Synthetic. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const svc = { read: vi.fn(), report: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "S".repeat(43) }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (h: unknown) => h }));
vi.mock("@/server/http/error-capture", () => ({ noteZohoFailure: () => {} }));
vi.mock("@/server/oauth/request", () => ({ sessionCredential: async () => ({ ok: true, credential: { userId: "554023000000300004" } }) }));
vi.mock("@/server/leads/runtime", () => ({ leadsConfigured: () => true, leadsRuntime: () => ({ gates: {} }) }));
(globalThis as { __gzPaymentClaims?: unknown }).__gzPaymentClaims = svc;

const route = await import("./route");
const ID = "554023000000900001";
const ctx = { params: Promise.resolve({ id: ID }) };
const get = () => route.GET(new Request(`http://localhost/api/leads/${ID}/claim`), ctx);
const post = () => route.POST(new Request(`http://localhost/api/leads/${ID}/claim`, { method: "POST", body: "{}" }), ctx);
const failure = (errorKind: string, retryable: boolean, message: string) => ({ ok: false, kind: "source-error", errorKind, retryable, message });

beforeEach(() => { svc.read.mockReset(); svc.report.mockReset(); });

describe("GET /api/leads/[id]/claim", () => {
  it("a forbidden read is 403 with the read's words", async () => {
    svc.read.mockResolvedValue(failure("forbidden", false, "Payment reports can't be read for this lead yet."));
    const r = await get();
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "Payment reports can't be read for this lead yet.", code: "forbidden" });
  });
  it("an outage stays 503 when it may help to retry, 502 otherwise; a good read is 200", async () => {
    svc.read.mockResolvedValue(failure("server", true, "Zoho is not answering. Try again."));
    expect((await get()).status).toBe(503);
    svc.read.mockResolvedValue(failure("invalid-data", false, "Zoho is not answering. Try again."));
    expect((await get()).status).toBe(502);
    svc.read.mockResolvedValue({ ok: true, value: { state: "none" } });
    expect(await (await get()).json()).toEqual({ claim: { state: "none" } });
  });
});

describe("POST /api/leads/[id]/claim", () => {
  it("a forbidden insert is 403, not 502", async () => {
    svc.report.mockResolvedValue(failure("forbidden", false, "Not saved — your Zoho profile cannot save payment reports."));
    const r = await post();
    expect([r.status, (await r.json()).code]).toEqual([403, "forbidden"]);
  });
});
