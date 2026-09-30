/* M08-S05-W1 — hand the lead to its secondary for a set window: POST / DELETE /api/leads/[id]/cover (server/leads/cover, D44).
   Live: the route (owner, a manager, or the secondary who already holds it; 409 when the lead changed).
   Fixture: the reducer's handover / endCover, which apply the same who-may rule to the demo book. */

import type { CoverDuration, CoverResult } from "@/server/leads/cover";
import { covOf, openable } from "@/lib/selectors";
import { fail, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";

export type CoverArgs = { id: string; expectedModifiedTime: string | null };
export type CoverStartArgs = CoverArgs & { duration: CoverDuration };
/* `coverUntil` is the route's ISO date live and the book's printed day in the fixture; the drawer does not print it (it reads the lead's cover) */
export type Covered = Pick<Extract<CoverResult, { ok: true }>["value"], "leadId" | "coverById" | "coverUntil">;

export const coverStart: WriteEndpoint<ConsoleBook, CoverStartArgs, Covered, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/cover`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime, duration: a.duration }),
  pick: j => j as Covered,
  fixture(state, dispatch, a) {
    const l = state.LEADS.find(x => x.id === a.id);
    if (!l || !openable(state).some(x => x.id === a.id)) return NOT_YOURS();
    if (!l.sec) return fail(409, "no-secondary", "Nothing changed — this lead has no secondary to hand it to.");
    return consoleFixtureWrite(state, dispatch, { type: "handover", id: a.id, perm: false, why: a.duration },
      next => (next.LEADS === state.LEADS ? fail(403, "not-yours-to-cover", "Nothing changed — this lead is not yours to hand over.") : null),
      next => { const c = next.LEADS.find(x => x.id === a.id)?.cov; return { leadId: a.id, coverById: c?.by ?? null, coverUntil: c?.to ?? null }; });
  },
};

export const coverEnd: WriteEndpoint<ConsoleBook, CoverArgs, Covered, ConsoleDispatch> = {
  method: "DELETE",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/cover`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as Covered,
  fixture(state, dispatch, a) {
    const l = state.LEADS.find(x => x.id === a.id);
    if (!l || !openable(state).some(x => x.id === a.id)) return NOT_YOURS();
    if (!covOf(state, l)) return fail(409, "no-cover", "Nothing changed — there is no cover to end.");
    return consoleFixtureWrite(state, dispatch, { type: "endCover", id: a.id },
      next => (next.LEADS === state.LEADS && next.COVER === state.COVER ? fail(403, "not-yours-to-end", "Nothing changed — this cover is not yours to end.") : null),
      () => ({ leadId: a.id, coverById: null, coverUntil: null }));
  },
};
