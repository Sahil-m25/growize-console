/* Cluster C2 (ir-write-map.md) — the ladder, wired to Zoho:
     journeyTick    POST /api/leads/[id]/journey {op:"tick"}     tick / tickCommit / recordRung (scorecard stated)
     journeySkip    POST /api/leads/[id]/journey {op:"skip"}     skipStage
     journeyUntick  POST /api/leads/[id]/journey {op:"untick"}   untick / undoRung (with one of the five reasons)
   Live: server/leads/journey on the person's own token, guarded by the Modified_Time the page read (`l.mt`).
   Fixture: the reducer action each replaces, peeked first so the answer is the reducer's own verdict.
   The shared pages (LeadPage, TodayPage, leads/actions, TopBar, WorkAction, lpdrawers) call `useJourneyWrites()`. */

import type { Lead } from "@/domain";
import { useConsole } from "@/lib/store";
import { fail, useApiMode, useApiWrite, type ApiResult, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";
import { openable } from "@/lib/selectors";

export type JourneyDone = { rung: number; modifiedTime: string | null };
export type TickVia = "tick" | "tickCommit" | "recordRung";
export type TickArgs = { id: string; expectedModifiedTime: string | null; via: TickVia };
export type SkipArgs = { id: string; expectedModifiedTime: string | null };
export type UntickArgs = { id: string; expectedModifiedTime: string | null; reason: string; note?: string; via: "untick" | "undoRung" };

const PATH = (id: string) => `/api/leads/${encodeURIComponent(id)}/journey`;
const doneOf = (s: ConsoleBook, id: string) => s.LEADS.find(x => x.id === id)?.done ?? 0;

export const journeyTick: WriteEndpoint<ConsoleBook, TickArgs, JourneyDone, ConsoleDispatch> = {
  method: "POST",
  path: a => PATH(a.id),
  body: a => ({ op: "tick", expectedModifiedTime: a.expectedModifiedTime, ...(a.via === "recordRung" ? { scorecard: true } : {}) }),
  pick: j => j as JourneyDone,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    const was = doneOf(state, a.id);
    return consoleFixtureWrite(state, dispatch, { type: a.via, id: a.id },
      next => (doneOf(next, a.id) === was + 1 ? null : fail(409, "not-ticked", "Not marked done.")),
      next => ({ rung: doneOf(next, a.id), modifiedTime: null }));
  },
};

export const journeySkip: WriteEndpoint<ConsoleBook, SkipArgs, JourneyDone, ConsoleDispatch> = {
  method: "POST",
  path: a => PATH(a.id),
  body: a => ({ op: "skip", expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as JourneyDone,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    const was = doneOf(state, a.id);
    return consoleFixtureWrite(state, dispatch, { type: "skipStage", id: a.id },
      next => (doneOf(next, a.id) === was + 1 ? null : fail(409, "not-skippable", "Only the Engagement rung can be skipped, and only when it is next.")),
      next => ({ rung: doneOf(next, a.id), modifiedTime: null }));
  },
};

export const journeyUntick: WriteEndpoint<ConsoleBook, UntickArgs, JourneyDone, ConsoleDispatch> = {
  method: "POST",
  path: a => PATH(a.id),
  body: a => ({ op: "untick", expectedModifiedTime: a.expectedModifiedTime, reason: a.reason }),
  pick: j => j as JourneyDone,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    const was = doneOf(state, a.id);
    const action = a.via === "undoRung" ? { type: "undoRung" as const, id: a.id, why: a.reason, note: a.note ?? "" } : { type: "untick" as const, id: a.id };
    return consoleFixtureWrite(state, dispatch, action,
      next => (doneOf(next, a.id) === was - 1 ? null : fail(409, "not-undone", "That rung cannot be taken back now.")),
      next => ({ rung: doneOf(next, a.id), modifiedTime: null }));
  },
};

/** The three ladder writes for any page. Live: a success re-reads the book (reloadData); a refusal is the route's
 *  answer, with `r.error` to show. Fixture: the reducer ran (its own notes stay as before). */
export function useJourneyWrites() {
  const { state, dispatch, reloadData } = useConsole();
  const live = useApiMode() === "live";
  const tickW = useApiWrite(journeyTick, state, dispatch);
  const skipW = useApiWrite(journeySkip, state, dispatch);
  const untickW = useApiWrite(journeyUntick, state, dispatch);
  const after = (r: ApiResult<JourneyDone>) => { if (r.ok && live) reloadData(); return r; };
  return {
    /** Mark the next rung done. `via` picks the fixture's reducer action; "recordRung" states the scorecard. */
    tick: (l: Lead, via: TickVia = "tick") => tickW({ id: l.id, expectedModifiedTime: l.mt ?? null, via }).then(after),
    /** Skip Engagement. */
    skip: (l: Lead) => skipW({ id: l.id, expectedModifiedTime: l.mt ?? null }).then(after),
    /** Take the last rung back with one of the five reasons (live requires it); `note` is the fixture log's only. */
    untick: (l: Lead, reason: string, note = "", via: "untick" | "undoRung" = "undoRung") =>
      untickW({ id: l.id, expectedModifiedTime: l.mt ?? null, reason, note, via }).then(after),
  };
}
