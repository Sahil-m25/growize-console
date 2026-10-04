/* M15-S05-NOTE-10 — the cache's rolling 24 h count of reads and failed loads (System card "Cache load errors"). */
import { describe, expect, it } from "vitest";
import { cacheKey, createLoadWindow, createMemoryStore, createScopedCache } from "./cache";

const H = 3_600_000;

describe("createLoadWindow", () => {
  it("counts the last 24 hours and drops what is older", () => {
    let now = Date.parse("2026-10-04T00:30:00Z");
    const w = createLoadWindow(() => now);
    w.record("read"); w.record("read"); w.record("error");
    expect(w.totals()).toEqual({ reads: 2, errors: 1 });
    now += 23 * H;
    w.record("read");
    expect(w.totals()).toEqual({ reads: 3, errors: 1 });
    now += 2 * H;   // the first hour's bucket is now past 24 h
    expect(w.totals()).toEqual({ reads: 1, errors: 0 });
    now += 30 * H;
    expect(w.totals()).toEqual({ reads: 0, errors: 0 });
  });
});

describe("the scoped cache feeds the window", () => {
  const key = (n: string) => cacheKey({ kind: "user", userId: "554023000000300005" }, n);

  it("every read() counts; a failed live load counts once; a held error replayed to a later read does not", async () => {
    let now = Date.parse("2026-10-04T10:00:00Z");
    const loads = createLoadWindow(() => now);
    const cache = createScopedCache({ store: createMemoryStore({ clock: () => now }), clock: () => now, loads, errorHoldMs: 5_000 });
    const ok = await cache.readSettled(key("a.count"), async () => 3);
    expect(ok.state).toBe("fresh");
    await cache.readSettled(key("a.count"), async () => 3);                       // served from cache: a read, no load
    expect(loads.totals()).toEqual({ reads: 2, errors: 0 });

    const bad = await cache.readSettled(key("b.count"), async () => { throw Object.assign(new Error("zoho"), { kind: "server" }); });
    expect(bad.state).toBe("error");
    expect(loads.totals()).toEqual({ reads: 3, errors: 1 });
    await cache.read(key("b.count"), async () => 1);                              // inside the hold: the error replays, no new load
    expect(loads.totals()).toEqual({ reads: 4, errors: 1 });
    now += 6_000;                                                                 // hold over: one retry, which fails again
    const again = await cache.readSettled(key("b.count"), async () => { throw new Error("still down"); });
    expect(again.state).toBe("error");
    expect(loads.totals().errors).toBe(2);
  });

  it("holds numbers only: no key, scope or value is kept", () => {
    const w = createLoadWindow(() => 0);
    w.record("read");
    expect(JSON.stringify(w.totals())).toBe('{"reads":1,"errors":0}');
  });
});
