/* M01-S08-NOTE-6 — sign-out reaches the receipt-replay service: composing /api/receipts registers the process's one
 * replay service's discardSession with the session-end registry (server/oauth/session-end), which user-session.ts calls
 * before it destroys a session (sign-out, change of person, expiry, revocation — user-session.test.cjs proves that half).
 * Only the replay service and the composition's other parts are stubbed; the registry and compose.ts are real. */
import { describe, expect, it, vi } from "vitest";

const discardSession = vi.fn();

vi.mock("@/server/money/receipt-replay", () => ({
  createReceiptReplayService: () => ({ discardSession, prepare: vi.fn(), replay: vi.fn() }),
}));
vi.mock("@/server/money/allotment-receipts", () => ({ createAllotmentReceiptWrites: () => ({ record: vi.fn() }) }));
vi.mock("@/server/money/record-receipt", () => ({ createRecordReceipt: () => ({ commit: vi.fn(), prepare: vi.fn() }) }));
vi.mock("@/server/data/zoho-source", () => ({ dataRuntime: () => ({ gate: {}, log: {} }) }));
vi.mock("@/server/oauth/runtime", () => ({ userSessions: () => ({}) }));
vi.mock("@/server/data/live", () => ({ zohoSeatOf: () => null }));
vi.mock("@/server/access/policy", () => ({ seatAccess: () => ({ imCan: () => false }) }));
vi.mock("@/lib/zoho/client", () => ({ createZohoClient: () => ({}) }));

const { recordReceipt } = await import("./compose");
const { notifySessionEnd } = await import("@/server/oauth/session-end");

const ENV = {
  ZOHO_CRM_RECORD_ID_PREFIX: "554023",
  RECEIPT_IDEMPOTENCY_SECRET: "i".repeat(32),
  RECEIPT_CONTEXT_SIGNING_SECRET: "c".repeat(32),
} as unknown as NodeJS.ProcessEnv;

describe("M01-S08-NOTE-6 sign-out discards queued receipt replays", () => {
  it("a session ending calls discardSession(actorId, sessionId) on the process's replay service", async () => {
    await recordReceipt(ENV);
    const sid = "A".repeat(43);
    notifySessionEnd("554023000000300004", sid);
    expect(discardSession).toHaveBeenCalledTimes(1);
    expect(discardSession).toHaveBeenCalledWith("554023000000300004", sid);
  });

  it("the service is composed once per process, so a second composition does not register twice", async () => {
    discardSession.mockClear();
    await recordReceipt(ENV);
    notifySessionEnd("554023000000300004", "B".repeat(43));
    expect(discardSession).toHaveBeenCalledTimes(1);
  });
});
