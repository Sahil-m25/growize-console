/* M15-S05-NOTE-10 — the webhook stamps the time of the last HMAC-verified event in the shared state store; the System
   card reads it. Time only: no body, id or name is stored. Synthetic secret and body; no request leaves the process. */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createMemoryState } from "../state/memory";
import { handleZohoSignWebhook, SIGN_LAST_EVENT_KEY, signLastEventAt } from "./webhook";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { gatherFacts } from "../system/facts";
import { systemChecks } from "../system/checks";

const SECRET = "synthetic-webhook-secret-0123456789";
const BODY = JSON.stringify({ requests: { request_id: "12345678901234567" }, notifications: { operation_type: "RequestCompleted", performed_at: 1_790_000_000 } });
const sign = (b: string, s = SECRET) => createHmac("sha256", s).update(b, "utf8").digest("base64");
const T = Date.parse("2026-10-04T09:00:00Z");

function deps(state: ReturnType<typeof createMemoryState>, clock = () => T) {
  return {
    secrets: [SECRET], clock, state, log: createOpsLog(createMemorySink()),
    sign: { getRequest: async () => ({ ok: true, value: { status: "inprogress" } }) },
    crm: { search: async () => ({ ok: true, value: { records: [], moreRecords: false } }) },
    credential: async () => ({}), invalidateCredential: () => undefined,
  } as never;
}

describe("sign.lastEventAt", () => {
  it("is empty until a verified event arrives", async () => {
    const state = createMemoryState();
    expect(await signLastEventAt(state)).toBeNull();
  });

  it("a bad signature leaves no stamp", async () => {
    const state = createMemoryState();
    const r = await handleZohoSignWebhook({ body: BODY, signature: sign(BODY, "some-other-secret-0123456789") }, deps(state));
    expect(r.ok).toBe(false);
    expect(await signLastEventAt(state)).toBeNull();
  });

  it("a verified event stamps the time, and only the time", async () => {
    const state = createMemoryState();
    const r = await handleZohoSignWebhook({ body: BODY, signature: sign(BODY) }, deps(state));
    expect(r.ok).toBe(true);
    expect(await signLastEventAt(state)).toBe(T);
    expect(await state.get(SIGN_LAST_EVENT_KEY)).toBe(String(T));
    expect(state.size()).toBeLessThanOrEqual(2);   // the stamp (and the seen-claim, released)
  });

  it("a verified but unreadable payload is still a verified event; a later event moves the stamp", async () => {
    const state = createMemoryState();
    const junk = "not json at all";
    await handleZohoSignWebhook({ body: junk, signature: sign(junk) }, deps(state, () => T));
    expect(await signLastEventAt(state)).toBe(T);
    await handleZohoSignWebhook({ body: BODY, signature: sign(BODY) }, deps(state, () => T + 60_000));
    expect(await signLastEventAt(state)).toBe(T + 60_000);
  });

  it("a state store that cannot answer never fails the webhook, and reads as no event", async () => {
    const broken = { ...createMemoryState(), set: async () => { throw new Error("down"); }, get: async () => { throw new Error("down"); } } as never;
    const r = await handleZohoSignWebhook({ body: BODY, signature: sign(BODY) }, deps(broken));
    expect(r.ok).toBe(true);
    const f = await gatherFacts({ ops: [], archiveLastRun: async () => null, outbox: { stats: () => ({ lastDeliveredAt: null, failures24h: 0 }) }, signLastEventAt: () => signLastEventAt(broken), env: {} }, T);
    expect(f.sign.lastEventAt).toBeNull();
  });

  it("feeds the System card: 'last 2 h ago' and working, instead of 'no event yet'", async () => {
    const state = createMemoryState();
    await handleZohoSignWebhook({ body: BODY, signature: sign(BODY) }, deps(state, () => T - 2 * 3_600_000));
    const f = await gatherFacts({ ops: [], archiveLastRun: async () => null, outbox: { stats: () => ({ lastDeliveredAt: null, failures24h: 0 }) }, signLastEventAt: () => signLastEventAt(state), env: {} }, T);
    const sign_ = systemChecks(f, T).find((c) => c.key === "sign")!;
    expect(sign_.figure).toBe("last 2 h ago · 0 failed signatures");
    expect(sign_.state).toBe("working");
  });
});
