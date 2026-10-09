/* B-27 — the activity log and the audit archive on the Catalyst NoSQL state store (LOG_SINK=state), no Stratus.
   Uses the in-memory SharedState as the stand-in for NoSQL; the real adapter has the same interface. */
import { describe, expect, it } from "vitest";
import { cleanRow, type ArchivedAuditRow } from "../activity/archive";
import { queryActivity } from "../activity/query";
import { createMemoryState } from "../state/memory";
import { createChainLinker, verifyChain } from "./chain";
import { createLogSinks, logStoreKind } from "./factory";
import { createStateAuditArchive, createStatePlaneStore } from "./state-store";
import { withChain } from "./sink";
import { planeCBetween } from "../activity/sources";

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);
const USER = "554023000000100001";
const REC = "554023000000527003";

describe("LOG_SINK=state selection", () => {
  it("needs STATE_STORE=catalyst and no LOG_STORE; fails closed otherwise", () => {
    expect(logStoreKind({ LOG_SINK: "state", STATE_STORE: "catalyst" } as unknown as NodeJS.ProcessEnv)).toBe("state");
    expect(() => logStoreKind({ LOG_SINK: "state" } as unknown as NodeJS.ProcessEnv)).toThrow(/STATE_STORE=catalyst/);
    expect(() => logStoreKind({ LOG_SINK: "state", STATE_STORE: "memory" } as unknown as NodeJS.ProcessEnv)).toThrow(/STATE_STORE=catalyst/);
    expect(() => logStoreKind({ LOG_SINK: "state", STATE_STORE: "catalyst", LOG_STORE: "jsonl" } as unknown as NodeJS.ProcessEnv)).toThrow(/LOG_STORE/);
    expect(logStoreKind({} as unknown as NodeJS.ProcessEnv)).toBe("memory");
  });
});

describe("plane store on shared state", () => {
  it("keeps lines across two instances and a recycle, by UTC day, and includes unflushed lines", async () => {
    const state = createMemoryState();
    const a = createStatePlaneStore({ state, plane: "identity", clock: () => NOW, timer: false });
    const b = createStatePlaneStore({ state, plane: "identity", clock: () => NOW, timer: false });
    a.append({ n: 1 });
    b.append({ n: 2 });
    await a.flush();
    a.append({ n: 3 }); // unflushed: only this instance sees it
    expect((await b.read("2026-10-09")).map((x) => (x as { n: number }).n)).toEqual([1, 2]); // a's flushed line + b's own unflushed one
    await b.flush();
    const fresh = createStatePlaneStore({ state, plane: "identity", clock: () => NOW, timer: false });
    expect(new Set((await fresh.read("2026-10-09")).map((x) => (x as { n: number }).n))).toEqual(new Set([1, 2]));
    expect(await fresh.days()).toEqual(["2026-10-09"]);
    expect((await a.read("2026-10-09")).length).toBe(3);
    for (const s of [a, b, fresh]) s.close();
  });

  it("packs many lines into chunks under the 4,096-character value cap", async () => {
    const state = createMemoryState();
    const s = createStatePlaneStore({ state, plane: "push", clock: () => NOW, timer: false, flushLines: 100_000 });
    for (let i = 0; i < 200; i++) s.append({ i, pad: "x".repeat(100) });
    await s.flush();
    expect((await s.read("2026-10-09")).length).toBe(200);
    expect(s.pending()).toBe(0);
    s.close();
  });

  it("keeps lines and reports when a write fails, and retries on the next flush", async () => {
    const mem = createMemoryState();
    let fail = true;
    const state = { ...mem, set: async (k: string, v: string, t?: number) => { if (fail) throw new Error("down"); return mem.set(k, v, t); } };
    const errs: string[] = [];
    const s = createStatePlaneStore({ state, plane: "identity", clock: () => NOW, timer: false, onError: (c) => errs.push(c) });
    s.append({ n: 1 });
    await s.flush();
    expect(errs).toEqual(["state-write-failed"]);
    expect(s.pending()).toBe(1);
    fail = false;
    await s.flush();
    expect(s.pending()).toBe(0);
    const other = createStatePlaneStore({ state: mem, plane: "identity", clock: () => NOW, timer: false });
    expect((await other.read("2026-10-09")).length).toBe(1);
    s.close(); other.close();
  });

  it("chains Plane C and the chain verifies from the stored lines", async () => {
    const state = createMemoryState();
    const raw = createStatePlaneStore({ state, plane: "identity", clock: () => NOW, timer: false });
    const s = withChain(raw, createChainLinker("i-1"), () => NOW);
    for (let i = 0; i < 5; i++) s.append({ at: NOW, action: "reveal", i });
    await s.flush();
    const v = verifyChain(await s.segments("2026-10-09"), { day: "2026-10-09" });
    expect(v.ok).toBe(true);
    expect(v.lines).toBe(5);
    raw.close();
  });
});

describe("audit archive on shared state", () => {
  const row = (i: number): ArchivedAuditRow => ({ at: `2026-10-08T10:${String(i % 60).padStart(2, "0")}:00+05:30`, day: "2026-10-08", byId: USER, action: "added", module: "Notes", recordId: REC });

  it("seals a day once, reads it back with its hash, lists it and refuses a rewrite", async () => {
    const state = createMemoryState();
    const arch = createStateAuditArchive({ state, clean: cleanRow, clock: () => NOW });
    expect(arch.kind).toBe("state");
    expect(await arch.days()).toEqual([]);
    expect(await arch.lastRun()).toBeNull();
    const rows = Array.from({ length: 800 }, (_, i) => row(i));
    expect((await arch.write("2026-10-08", rows)).rows).toBe(800);
    expect(await arch.has("2026-10-08")).toBe(true);
    expect(await arch.days()).toEqual(["2026-10-08"]);
    expect(await arch.lastRun()).toBe(NOW);
    expect((await arch.read("2026-10-08")).length).toBe(800);
    await expect(arch.write("2026-10-08", rows)).rejects.toThrow(/never rewritten/);
    expect(await arch.read("2026-10-07")).toEqual([]);
    // a second process sees the same archive
    expect((await createStateAuditArchive({ state, clean: cleanRow }).read("2026-10-08"))[0]).toMatchObject({ module: "Notes", recordId: REC });
  });

  it("holds codes and ids only: a row's extra fields never reach the store", async () => {
    const state = createMemoryState();
    const arch = createStateAuditArchive({ state, clean: cleanRow, clock: () => NOW });
    await arch.write("2026-10-08", [{ ...row(1), email: "someone@example.com", pan: "ABCDE1234F", name: "Asha" } as unknown as ArchivedAuditRow]);
    const stored = JSON.stringify(await arch.read("2026-10-08"));
    expect(stored).not.toMatch(/example\.com|ABCDE1234F|Asha/);
  });

  it("reads a tampered chunk as 'tampered', never as data", async () => {
    const state = createMemoryState();
    const arch = createStateAuditArchive({ state, clean: cleanRow, clock: () => NOW });
    await arch.write("2026-10-08", [row(1), row(2)]);
    const seal = JSON.parse((await state.get("audit|2026-10-08|seal"))!) as { id: string };
    await state.set(`audit|2026-10-08|${seal.id}|0`, "H4sIAAAAAAAAA6vmAgBw0ikPBQAAAA==");
    await expect(arch.read("2026-10-08")).rejects.toThrow("tampered");
  });

  it("is one lock per day: a concurrent write is refused", async () => {
    const state = createMemoryState();
    const arch = createStateAuditArchive({ state, clean: cleanRow });
    await state.claim("audit|2026-10-08|lock", 600);
    await expect(arch.write("2026-10-08", [row(1)])).rejects.toThrow(/already writing/);
  });
});

describe("the whole path: Plane C event and an archived lead action reach the Activity query (B-27)", () => {
  it("shows both on a state-backed log, with no Stratus setting", async () => {
    const state = createMemoryState();
    const sinks = createLogSinks({ LOG_SINK: "state", STATE_STORE: "catalyst" } as unknown as NodeJS.ProcessEnv, { state, clock: () => NOW, timer: false });
    expect(sinks.kind).toBe("state");
    expect(sinks.objects).toBeNull();
    expect(sinks.stores?.ops).toBeNull();
    sinks.identity.write({ at: NOW, who: USER, action: "reveal", outcome: "ok", recordIds: [REC] } as never);
    await sinks.flush();
    const arch = createStateAuditArchive({ state, clean: cleanRow, clock: () => NOW });
    await arch.write("2026-10-08", [row0()]);
    const r = await queryActivity({ seat: "ops", userId: USER }, { side: "lead", month: "2026-10" }, {
      archive: arch,
      planeC: (a, b) => planeCBetween({ store: sinks.stores!.identity, ring: () => sinks.identity.events() }, a, b),
      visible: async () => new Set([REC]),
      clock: () => NOW,
    });
    expect(r.ok && r.rows.map((x) => x.kind)).toEqual(["note"]);
    const inv = await queryActivity({ seat: "ops", userId: USER }, { side: "investors", month: "2026-10" }, {
      archive: arch, planeC: (a, b) => planeCBetween({ store: sinks.stores!.identity, ring: () => sinks.identity.events() }, a, b),
      visible: async () => new Set([REC]), clock: () => NOW,
    });
    expect(inv.ok && inv.rows.some((x) => x.source === "plane-c" && x.kind === "pii")).toBe(true);
  });
});

function row0(): ArchivedAuditRow {
  return { at: "2026-10-08T10:00:00+05:30", day: "2026-10-08", byId: USER, action: "added", module: "Notes", recordId: REC };
}
