/* M15-S05-NOTE-2 / M15-S03-NOTE-5 — the System checks' facts: who may read, and what is gathered from Plane B, the audit
   archive and the investor-app outbox. */
import { describe, expect, it } from "vitest";
import { gatherFacts, mayReadSystem } from "./facts";
import { systemChecks, systemView } from "./checks";

const NOW = Date.parse("2026-10-04T10:00:00Z"), H = 3_600_000, D = 24 * H;
const call = (at: number, over: object = {}) => ({ kind: "zoho-call", at, actor: { kind: "user", userId: "9007199254740995001" }, op: "coql", method: "POST", endpoint: "/coql",
  callClass: "simple", status: 200, durationMs: 100, gateWaitMs: 0, attempt: 1, creditsRemaining: null, errorClass: null, recordIds: [], ...over });
const outbox = (s: { lastDeliveredAt: number | null; failures24h: number }) => ({ stats: () => s });

describe("mayReadSystem — the `sys` capability", () => {
  it("Digital Infrastructure (lead token ops, Investors token di) and the super administrator only", () => {
    expect(mayReadSystem("ops")).toBe(true);
    expect(mayReadSystem("di")).toBe(true);
    expect(mayReadSystem("root")).toBe(true);
    for (const s of ["admin", "head", "fin", "comp", "kam", "ir", "conv", "exec", "nope", ""]) expect(mayReadSystem(s)).toBe(false);
  });
});

describe("gatherFacts", () => {
  it("headroom reads the stored credits header, the archive and the outbox feed their checks", async () => {
    const facts = await gatherFacts({
      ops: [call(NOW - H, { creditsRemaining: 4_200 }), call(NOW - 2 * H), { junk: 1 }, null],
      archiveLastRun: async () => NOW - 3 * D,
      outbox: outbox({ lastDeliveredAt: NOW - H, failures24h: 7 }),
      env: { ZOHO_LICENCE_EXPIRES_ON: "2027-03-31" },
    }, NOW);
    expect(facts.ops).toHaveLength(2);
    expect(facts.auditArchiveLastRun).toBe(NOW - 3 * D);
    expect(facts.push).toEqual({ lastDeliveredAt: NOW - H, failures24h: 7 });
    expect(facts.licenceExpiry).toBe(Date.parse("2027-03-31T23:59:59+05:30"));
    const st = Object.fromEntries(systemChecks(facts, NOW).map((c) => [c.key, [c.state, c.figure]]));
    expect(st.credits).toEqual(["attention", "4200"]);
    expect(st.archive[0]).toBe("attention");
    expect(st.push[0]).toBe("down");
  });

  it("counts only the last 24 hours of refused webhook signatures; a failing archive reads as never", async () => {
    const sig = (at: number) => ({ kind: "refusal", at, actor: { kind: "service", job: "provider-callback" }, action: "signWebhook", reason: "invalid-signature", recordIds: [] });
    const facts = await gatherFacts({
      ops: [sig(NOW - H), sig(NOW - 30 * H)], archiveLastRun: async () => { throw new Error("disk"); }, outbox: outbox({ lastDeliveredAt: null, failures24h: 0 }), env: {},
    }, NOW);
    expect(facts.sign.failedHmac24h).toBe(1);
    expect(facts.auditArchiveLastRun).toBeNull();
    expect(facts.licenceExpiry).toBeNull();
    const v = systemView(systemChecks(facts, NOW));
    expect(v.all.find((c) => c.key === "archive")?.state).toBe("down");
    expect(v.all.find((c) => c.key === "sign")?.state).toBe("down");
    expect(v.cards[0]!.state).toBe("down");
  });

  it("a bad licence date is ignored, not guessed", async () => {
    const f = await gatherFacts({ ops: [], archiveLastRun: async () => null, outbox: outbox({ lastDeliveredAt: null, failures24h: 0 }), env: { ZOHO_LICENCE_EXPIRES_ON: "next spring" } }, NOW);
    expect(f.licenceExpiry).toBeNull();
  });
});
