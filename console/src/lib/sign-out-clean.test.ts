/* TC-E15-008 (M18-S02) — sign-out leaves nothing for the next person. Rohit signed in with a note draft on a lead and a queued offline
   save; he signs out; Kavya signs in on the same browser. She lands on her Today, not Rohit's lead, and no draft, unsaved write or
   queued save of Rohit's remains. Run through the real reducer and the real save queue (createConsoleWriter), the way store.tsx wires them. */
import { describe, expect, it } from "vitest";
import { demoBook } from "@fixtures/book";
import { createConsoleWriter } from "@/lib/console-save";
import { LEAD_WRITES, initialState, reducer } from "@/lib/state";
import { accountAllowed, openable } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import type { PersonKey } from "@/domain";

function rig() {
  let state: ConsoleState = reducer(initialState(demoBook()), { type: "signIn", k: "rohit" as PersonKey });
  let session = 1, online = true;
  const writer = createConsoleWriter({
    clock: () => 0, setTimer: () => 0, clearTimer: () => {}, isOnline: () => online,
    currentSession: () => (accountAllowed(state) ? { actor: state.WHO, session } : null),
    read: () => state,
    write: next => { if (next.WHO !== state.WHO) session++; state = next; },
    reduce: reducer, leadWrites: LEAD_WRITES,
  });
  return { writer, get: () => state, offline: () => { online = false; }, online: () => { online = true; writer.reconnect(); } };
}

describe("TC-E15-008: sign-out leaves nothing for the next person", () => {
  it("Rohit's draft and queued offline note are gone when Kavya signs in, and she lands on Today", () => {
    const r = rig();
    const lead = openable(r.get())[0]!.id;
    r.writer.apply({ type: "go", v: "leads" as never, id: lead });
    expect(r.get().LEAD).toBe(lead);
    r.writer.apply({ type: "setUi", patch: { NDRAFT: "private draft", NDRAFTID: lead } });
    expect(r.get().ui.NDRAFT).toBe("private draft");
    r.offline();
    const notesBefore = JSON.stringify(r.get().NOTES);
    const queued = r.writer.apply({ type: "addNote", id: lead });
    expect(queued?.status).toBe("pending");
    expect(r.writer.snapshot()).toHaveLength(1);
    expect(JSON.stringify(r.get().NOTES), "queued, not applied").toBe(notesBefore);

    r.writer.apply({ type: "signOut" });
    expect(r.get().authed).toBe(false);
    expect(r.writer.snapshot(), "the queue is emptied at sign-out").toEqual([]);
    r.writer.apply({ type: "signIn", k: "kavya" as PersonKey });

    const s = r.get();
    expect(s.WHO).toBe("kavya");
    expect(s.VIEW, "kavya lands on her Today").toBe("today");
    expect(s.LEAD, "not rohit's lead").toBe("");
    expect(s.ui.NDRAFT ?? "").toBe("");
    expect(s.ui.NDRAFTID ?? "").toBe("");
    expect(s.DRW).toBeNull();
    expect(r.writer.snapshot(), "no queued save of rohit's").toEqual([]);
    expect(JSON.stringify(s)).not.toContain("private draft");
    r.online();                                              /* the browser comes back online: nothing of Rohit's is replayed */
    expect(JSON.stringify(r.get().NOTES), "no unsaved write lands under her").toBe(notesBefore);
    expect(r.get().LOG.some(l => l.what === "Added a note")).toBe(false);
  });
});
