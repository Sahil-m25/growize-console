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
import { payOf, tickStage, undoStage } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useApiMode } from "@/lib/data/api";
import { useJourneyWrites } from "@/lib/data/endpoints/journey";
import { useLogTouchWrite } from "@/features/lead/followupWrites";
import { UNDOWHY } from "@/features/lead/lp";

/** the refusal, in the prototype's own words, or `null` when it went through */
export type Refusal = string | null;

/* logTouch(id,k) — 03-app.js:150. A lead who consented to email only cannot be recorded as
   WhatsApped, and the console says which channels they did agree to. Wired (C1, ir-write-map.md): the
   consent refusals are the same; fixture runs the reducer's logTouch, live POSTs /api/leads/[id]/touches
   and re-reads the book. Resolves to the refusal (the route's words, live) or null. */
export function useLogTouch(): (l: Lead, k: string) => Promise<Refusal> {
  const write = useLogTouchWrite();
  return useCallback((l: Lead, k: string) => write(l, k), [write]);
}

/* tick(id) — 03-app.js:1253. `tickStage` answers `{ok, why}`; a `why` of null is the prototype's
   silent refusal, there being nothing to say to somebody who was never offered the control.
   Fixture: the dispatch happens either way, because a refused tick still re-asks the dated next step.
   Live (C2 journey): a tick the selector already refuses is not sent; otherwise the route answers. */
export function useTick(): (l: Lead) => Promise<Refusal> {
  const { state } = useConsole();
  const live = useApiMode() === "live";
  const { tick } = useJourneyWrites();
  return useCallback(
    async (l: Lead) => {
      const v = tickStage(state, l);
      if (live && !v.ok) return v.why;
      const r = await tick(l);
      if (live) return r.ok ? null : r.error;
      return v.ok ? null : v.why;
    },
    [state, live, tick],
  );
}

/* untick(id) — 03-app.js:1432. Two refusals and one confirmation, in that order. The confirmation is
   asked in the page (M01-S07-T04, no native dialog): the first call returns the question as text, the
   screen shows it, and calls again with `confirmed` true and one of the five reasons (UNDOWHY). Live,
   the reason is required (POST /api/leads/[id]/journey {op:"untick", reason}); fixture runs the
   reducer's untick as before. */
export function useUntick(): (l: Lead, confirmed?: boolean, reason?: string) => Promise<Refusal> {
  const { state } = useConsole();
  const live = useApiMode() === "live";
  const { untick } = useJourneyWrites();
  return useCallback(
    async (l: Lead, confirmed = false, reason = "") => {
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
      if (live && !(UNDOWHY as readonly string[]).includes(reason)) return "Pick the reason for the correction first.";
      const r = await untick(l, reason, "", "untick");
      return live && !r.ok ? r.error : null;
    },
    [state, live, untick],
  );
}

/* the two take-back windows the drawers police — the material tick and the produce-pack week.
   Both are `fresh()`, both say how long the window was. 03-app.js:1459, 1470 */
export const editWindow = EDIT_H;
