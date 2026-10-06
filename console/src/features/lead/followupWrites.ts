"use client";

/* ── Cluster C1's hooks for the shared pages (docs/architecture/ir-write-map.md) ───────────────
   LeadPage, TodayPage, Horizon and leads/actions today dispatch these reducer actions, which change only the browser's
   copy. Each hook below is the wired twin of one dispatch, over the endpoints in lib/data/endpoints/followup:

     useFinishLead()    lpFinish   dispatch({type:"lpFinish", id, d})        → finish(l, d)
     useLoseLead()      lpLose     dispatch({type:"lpLose", id, d, why})     → lose(l, d, why)
     usePullIn()        pullIn     dispatch({type:"pullIn", id})             → pullIn(l)
     useMoveNextTo()    moveNextTo dispatch({type:"moveNextTo", id, days})   → moveTo(l, days)   (days from today, as before)
     useLogTouchWrite() logTouch   useLogTouch()'s (l, k) => Refusal         → (l, k, { reached }) => Promise<Refusal>
     useReopenLost()    reopenLost dispatch({type:"reopenLost", id})         → reopen(l)

   Fixture mode runs the very reducer action the page ran before; live mode is the route, then reloadData(). A refusal is
   returned as the route's own words (never a Zoho body); the finish and lose flows also put it in the open flow's `error`
   line. No Undo is offered on a live save: undo-by-delete is out of scope, a human token holds no Delete. */

import { useCallback } from "react";
import type { Channel, Lead } from "@/domain";
import { dISOtoDisp, iso, nowT } from "@/lib/format";
import { canWork, conFor, conWhy, nxDate } from "@/lib/selectors";
import { reducer, type Action, type ConsoleState } from "@/lib/state";
import { useConsole } from "@/lib/store";
import { fail, useApiMode, useApiWrite, type ApiResult } from "@/lib/data/api";
import {
  istAt, leadFinish, leadLose, lostReopen, nextMove, NO_MT, touchRecord,
  type Moved, type Reopened, type Saved, type TouchSaved,
} from "@/lib/data/endpoints/followup";
import { ZLABEL, zKind, type LpDraft, type LpFlow } from "./lp";
import type { LpNotice } from "./reducer";

const DAY_MS = 86_400_000;

/** The route's refusal, in the open finish flow's error line (the flow lives in `ui.LP`). */
function useFlowError() {
  const { state, dispatch } = useConsole();
  return useCallback((id: string, error: string) => {
    const lp = state.ui.LP as LpFlow | null | undefined;
    if (lp && lp.id === id) dispatch({ type: "setUi", patch: { LP: { ...lp, d: { ...lp.d, error } } } });
  }, [state.ui.LP, dispatch]);
}

/** A saved finish or loss, live: close the flow and say so (no Undo), then read the book again. */
function useFlowDone() {
  const { state, dispatch, reloadData } = useConsole();
  return useCallback((id: string, msg: string) => {
    dispatch({ type: "setUi", patch: { LP: null, FU: null, NXASK: null,
      LPNOTICE: { who: state.WHO, id, msg, snap: null, label: "", t: Date.now() } satisfies LpNotice } });
    reloadData();
  }, [state.WHO, dispatch, reloadData]);
}

/** The notice the reducer's own lpFinish gives, in the same words (features/lead/reducer.ts). */
const stepSaid = (d: LpDraft, NOW: Date): string => {
  if (d.keep || !d.t) return "Saved · appointment kept";
  const by = d.nd ? dISOtoDisp(d.nd, NOW) : "";
  return "Saved · " + (ZLABEL[zKind(d.t)] || "Next step") + ": " + d.t + (by ? " · " + by : "") + (d.ntm && zKind(d.t) !== "task" ? " " + d.ntm : "");
};

/** lpFinish: the last tap saves the contact and the next step, in one write. */
export function useFinishLead(): (l: Lead, d: LpDraft) => Promise<ApiResult<Saved>> {
  const { state, dispatch } = useConsole();
  const write = useApiWrite(leadFinish, state, dispatch);
  const live = useApiMode() === "live";
  const flowError = useFlowError();
  const done = useFlowDone();
  return useCallback(async (l, d) => {
    if (live && !l.mt) { const r = NO_MT(); flowError(l.id, r.error); return r; }
    const r = await write({ id: l.id, mt: l.mt, d, today: iso(nowT(state.NOW)) });
    if (live) { if (r.ok) done(l.id, stepSaid(d, state.NOW)); else flowError(l.id, r.error); }
    return r;
  }, [live, write, state.NOW, flowError, done]);
}

/** lpLose: the contact and the loss, in one write. */
export function useLoseLead(): (l: Lead, d: LpDraft, why: string) => Promise<ApiResult<Saved>> {
  const { state, dispatch } = useConsole();
  const write = useApiWrite(leadLose, state, dispatch);
  const live = useApiMode() === "live";
  const flowError = useFlowError();
  const done = useFlowDone();
  return useCallback(async (l, d, why) => {
    if (live && !l.mt) { const r = NO_MT(); flowError(l.id, r.error); return r; }
    const r = await write({ id: l.id, mt: l.mt, d, today: iso(nowT(state.NOW)), lostWhy: why });
    if (live) { if (r.ok) done(l.id, "Closed as lost — " + why); else flowError(l.id, r.error); }
    return r;
  }, [live, write, state.NOW, flowError, done]);
}

/** The whole days the reducer's own action would shift the dated step by (live sends this; the reducer decides the target:
 *  pullIn's day before the owner's leave, moveNextTo's n days from today). */
function shiftOf(state: ConsoleState, l: Lead, action: Action): number {
  const before = nxDate(l, state.NOW);
  const after = reducer(state, action).LEADS.find(x => x.id === l.id);
  const to = after ? nxDate(after, state.NOW) : null;
  return before && to ? Math.round((to.getTime() - before.getTime()) / DAY_MS) : 0;
}

function useMove() {
  const { state, dispatch, reloadData } = useConsole();
  const write = useApiWrite(nextMove, state, dispatch);
  const live = useApiMode() === "live";
  return useCallback(async (l: Lead, action: Extract<Action, { type: "pullIn" | "moveNextTo" }>): Promise<ApiResult<Moved>> => {
    if (!live) return write({ id: l.id, mt: l.mt, days: 0, action });
    if (!l.mt) return NO_MT();
    const days = shiftOf(state, l, action);
    if (days === 0) return fail(422, "refused", "Not saved — the next step is already on that day.");
    const r = await write({ id: l.id, mt: l.mt, days, action });
    if (r.ok) reloadData();
    return r;
  }, [live, write, state, reloadData]);
}

/** pullIn: bring the step forward to before the owner's leave (or two days earlier). */
export function usePullIn(): (l: Lead) => Promise<ApiResult<Moved>> {
  const move = useMove();
  return useCallback((l: Lead) => move(l, { type: "pullIn", id: l.id }), [move]);
}

/** moveNextTo: move the step to `days` from today, keeping its hour. */
export function useMoveNextTo(): (l: Lead, days: number) => Promise<ApiResult<Moved>> {
  const move = useMove();
  return useCallback((l: Lead, days: number) => move(l, { type: "moveNextTo", id: l.id, days }), [move]);
}

/** logTouch: "I messaged / called them now". The same refusals as useLogTouch, then the write. A call or visit counts toward
 *  First touch only when `reached` (default false: an unreached call is a touch, not a conversation). Resolves to the
 *  refusal text, or null when it went through. */
export function useLogTouchWrite(): (l: Lead, k: string, opts?: { reached?: boolean }) => Promise<string | null> {
  const { state, dispatch, reloadData } = useConsole();
  const write = useApiWrite(touchRecord, state, dispatch);
  const live = useApiMode() === "live";
  return useCallback(async (l, k, opts) => {
    if (!canWork(state, l)) return null;
    if (!conFor(l, k as Channel)) return conWhy(l, k as Channel);
    if (live && !l.mt) return NO_MT().error;
    const r = await write({ id: l.id, mt: l.mt, k, reached: opts?.reached ?? false, action: { type: "logTouch", id: l.id, k } });
    if (r.ok) { if (live) reloadData(); return null; }
    return r.error;
  }, [state, live, write, reloadData]);
}

/** reopenLost: the close stays in Zoho's field history; the next step comes back only if one was held and is still ahead. */
export function useReopenLost(): (l: Lead) => Promise<ApiResult<Reopened>> {
  const { state, dispatch, reloadData } = useConsole();
  const write = useApiWrite(lostReopen, state, dispatch);
  const live = useApiMode() === "live";
  return useCallback(async (l: Lead) => {
    if (!live) return write({ id: l.id, mt: l.mt, next: null });
    if (!l.mt) return NO_MT();
    /* the reducer decides whether the held step comes back (still ahead); the route takes it from the caller */
    const nx = reducer(state, { type: "reopenLost", id: l.id }).LEADS.find(x => x.id === l.id)?.nx ?? null;
    const at = nx && nx.d ? istAt(nx.d, nx.tm, "23:59") : null;
    const ch = nx && nx.ch && nx.ch !== "other" && conFor(l, nx.ch as Channel) ? nx.ch : "other";
    const next = nx && at && Date.parse(at) > nowT(state.NOW).getTime() ? { text: nx.t, at, channel: ch } : null;
    const r = await write({ id: l.id, mt: l.mt, next });
    if (r.ok) reloadData();
    return r;
  }, [state, live, write, reloadData]);
}
