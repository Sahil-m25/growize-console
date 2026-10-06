/* C4 — what the save queue may call a save. Local-only UI actions never queue; live, a reducer action never reaches Zoho so it is
   applied and never queued (the top bar has nothing waiting or "last local update" to show); in the demo the queue is the demo's save. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { createConsoleWriter, BUSINESS_WRITES, LOCAL_ONLY } from "@/lib/console-save";
import { LEAD_WRITES, initialState, reducer } from "@/lib/state";
import { accountAllowed, openable } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import type { PersonKey } from "@/domain";

function rig(fixtures: boolean) {
  let state: ConsoleState = { ...reducer(initialState(demoBook()), { type: "signIn", k: "rohit" as PersonKey }), FIXTURES: fixtures };
  const changes: string[] = [];
  const writer = createConsoleWriter({
    clock: () => 0, setTimer: () => 0, clearTimer: () => {}, isOnline: () => true,
    currentSession: () => (accountAllowed(state) ? { actor: state.WHO, session: 1 } : null),
    read: () => state, write: next => { state = next; }, reduce: reducer, leadWrites: LEAD_WRITES,
    onChange: c => changes.push(c.kind),
  });
  return { writer, get: () => state, changes };
}

describe("local-only actions are not saves", () => {
  it("startPaymentReport, setOutWhy, useTemp and dropTemp are out of BUSINESS_WRITES, in every mode", () => {
    expect([...LOCAL_ONLY].sort()).toEqual(["dropTemp", "setOutWhy", "startPaymentReport", "useTemp"]);
    for (const a of LOCAL_ONLY) expect(BUSINESS_WRITES.has(a), a).toBe(false);
  });
  it("one dispatched in the demo applies without a queue entry or a change event", () => {
    const r = rig(true);
    expect(r.writer.apply({ type: "dropTemp" })).toBeUndefined();
    expect(r.writer.snapshot()).toEqual([]);
    expect(r.changes).toEqual([]);
  });
});

describe("live: a reducer action is never labelled a save", () => {
  const lead = (s: ConsoleState) => openable(s)[0]!.id;
  it("a business action applies locally and the queue holds nothing, so no 'waiting' and no 'completed' reach the top bar", () => {
    const r = rig(false);
    const id = lead(r.get());
    const before = r.get().NOTES;
    expect(r.writer.apply({ type: "setUi", patch: { NDRAFT: "x", NDRAFTID: id } })).toBeUndefined();
    expect(r.writer.apply({ type: "addNote", id })).toBeUndefined();
    expect(r.writer.snapshot()).toEqual([]);
    expect(r.changes).toEqual([]);
    expect(r.get().NOTES).not.toEqual(before);   /* it was applied to this browser's copy */
  });
  it("the demo keeps its queue: the same action is a pending-then-completed local change", () => {
    const r = rig(true);
    const id = lead(r.get());
    r.writer.apply({ type: "setUi", patch: { NDRAFT: "x", NDRAFTID: id } });
    const out = r.writer.apply({ type: "addNote", id });
    expect(out?.status).toBe("completed");
    expect(r.changes).toContain("completed");
  });
});
