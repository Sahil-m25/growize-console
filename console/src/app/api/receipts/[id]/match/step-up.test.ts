/* M01-S10-NOTE-6 — POST /api/receipts/[id]/match on a refund without a live step-up "refund": 403 { code: "step-up",
 * start } (423 { code: "locked" } when locked), the same shape requireStepUp answers, so the page can start the
 * fresh sign-in. Through the real route module; the session, the match service and the guards are stubbed. */
import { describe, expect, it, vi } from "vitest";

const match = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "S".repeat(43) }) }) }));
vi.mock("@/server/access/guard", () => ({ guardApi: (_p: string, h: unknown) => h }));
vi.mock("@/server/ops/runtime", () => ({ withErrorCapture: (h: unknown) => h }));
vi.mock("@/server/oauth/request", () => ({ sessionCredential: async () => ({ ok: true, credential: { userId: "554023000000300004" } }) }));
vi.mock("../../compose", () => ({ NO_STORE: { "Cache-Control": "no-store" }, receiptsConfigured: () => true }));
vi.mock("@/server/money/runtime", async () => {
  const real = await vi.importActual<typeof import("@/server/money/runtime")>("@/server/money/runtime");
  return { moneyFailure: real.moneyFailure, receiptMatch: async () => ({ match }) };
});

const { POST } = await import("./route");
const call = () => POST(new Request("http://localhost/api/receipts/554023000000900001/match", { method: "POST", body: "{}" }),
  { params: Promise.resolve({ id: "554023000000900001" }) });
const refused = (reasonCode: string) => ({ ok: false, kind: "refused", reasonCode, message: "m", retryable: false });

describe("M01-S10-NOTE-6 refund approval behind step-up", () => {
  it("no live step-up → 403 code step-up with the start link for action refund", async () => {
    match.mockResolvedValueOnce(refused("step-up"));
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "step-up", start: "/api/auth/step-up?action=refund", saved: false });
  });
  it("locked → 423 code locked", async () => {
    match.mockResolvedValueOnce(refused("step-up-locked"));
    const res = await call();
    expect(res.status).toBe(423);
    expect((await res.json()).code).toBe("locked");
  });
  it("other refusals keep their mapping (not-approver 403 without a start link)", async () => {
    match.mockResolvedValueOnce(refused("not-approver"));
    const res = await call();
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.code).toBe("not-approver");
    expect(j.start).toBeUndefined();
  });
});
