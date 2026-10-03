"use client";

/* ── the writes that can be refused, and where the refusal goes ─────────────────────────────
   The prototype said no with `alert()`. Four of its refusals are worth keeping word for word —
   consent per channel (03-app.js:153), the ladder's gate and its consent rule (1256–1266), the
   un-tick window and the payment that outranks it (1434–1442). None of them survives as an alert:
   each screen already has somewhere honest to put a sentence, so these helpers hand the caller the
   prototype's own text and write nothing, and the screen renders it in the treatment the CSS
   already has — `.note.bad` on My day, the `.hd1` band on the lead page.

   The DECISION is a selector in every case (`conFor`/`conWhy`, `tickStage`, `undoStage`); this is
   only the pairing of that decision with the dispatch, so the button and the reducer can never
   disagree about what happened.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useCallback } from "react";
import { EDIT_H, LADDER, ST } from "@/domain";
import type { Channel, Lead } from "@/domain";
import { money } from "@/lib/format";
import { canWork, conFor, conWhy, payOf, tickStage, undoStage } from "@/lib/selectors";
import { useConsole } from "@/lib/store";

/** the refusal, in the prototype's own words, or `null` when it went through */
export type Refusal = string | null;

/* logTouch(id,k) — 03-app.js:150. A lead who consented to email only cannot be recorded as
   WhatsApped, and the console says which channels they did agree to. */
export function useLogTouch(): (l: Lead, k: string) => Refusal {
  const { state, dispatch } = useConsole();
  return useCallback(
    (l: Lead, k: string) => {
      if (!canWork(state, l)) return null;
      if (!conFor(l, k as Channel)) return conWhy(l, k as Channel);
      dispatch({ type: "logTouch", id: l.id, k });
      return null;
    },
    [state, dispatch],
  );
}

/* tick(id) — 03-app.js:1253. `tickStage` answers `{ok, why}`; a `why` of null is the prototype's
   silent refusal, there being nothing to say to somebody who was never offered the control.
   The dispatch happens either way, because a refused tick still re-asks the dated next step. */
export function useTick(): (l: Lead) => Refusal {
  const { state, dispatch } = useConsole();
  return useCallback(
    (l: Lead) => {
      const v = tickStage(state, l);
      dispatch({ type: "tick", id: l.id });
      return v.ok ? null : v.why;
    },
    [state, dispatch],
  );
}

/* untick(id) — 03-app.js:1432. Two refusals and one confirmation, in that order. The confirmation is
   asked in the page (M01-S07-T04, no native dialog): the first call returns the question as text, the
   screen shows it, and calls again with `confirmed` true. */
export function useUntick(): (l: Lead, confirmed?: boolean) => Refusal {
  const { state, dispatch } = useConsole();
  return useCallback(
    (l: Lead, confirmed = false) => {
      if (!l || l.done <= 1) return null;
      const u = undoStage(state, l);
      if (!u.ok)
        return (
          u.why +
          "\n\nA correction after that is a new record, not an edit — which is what keeps the history worth reading."
        );
      const p = payOf(state, l.id);
      if (p && l.done <= ST.PAID)
        return (
          "There is a payment recorded against this lead. Undoing the stage would leave " +
          money(p.got) +
          " held against a lead that is not reserved.\n\nThe payment has to be reversed or the reservation lapsed first."
        );
      if (!confirmed)
        return 'Un-tick "' + LADDER[l.done - 1].t + '"? This is logged with your name and needs a reason.';
      dispatch({ type: "untick", id: l.id });
      return null;
    },
    [state, dispatch],
  );
}

/* the two take-back windows the drawers police — the material tick and the produce-pack week.
   Both are `fresh()`, both say how long the window was. 03-app.js:1459, 1470 */
export const editWindow = EDIT_H;
