/* ── features/goals/state.ts — Plan's page-local edit-mode toggle ────────────────────────────
   Ports `ref/03-app.js` (redesigned) `UXPLANEDIT` — a plain module-level `let` in the prototype,
   toggled by the "Edit periods" / "Finish editing" button. It is not domain data (it never affects
   what is saved, only whether the period table shows inputs or plain text), so it lives in the
   ui bag under the prototype's own name, exactly as `ADDF` and the rest do in features/add/state.ts.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { Grain, PlanScalar } from "@/domain";

export {}; /* forces this file to be a module, so the block below augments UiState instead of
              declaring a stray global module of the same name. */

/* the write waiting for a yes — the port's stand-in for the prototype's shared, single-slot `ASK`
   (03-app.js(redesigned):4197), scoped to this feature's three callers (`setGrain`, `dropPeriod`,
   `bump`) rather than the shell-wide `askFirst`/`DRAWERS.ask` the prototype has (see
   crossOwnerRequests). Held declaratively — which write, and its raw arguments — rather than as a
   closure, so the drawer body can price it fresh off current state instead of a snapshot taken at
   click time, exactly as `askFirst`'s own callers price before they ask. */
export type GoalsAsk =
  | { kind: "grain"; g: Grain }
  | { kind: "drop"; pk: string }
  | { kind: "bump"; k: PlanScalar; d: number; lo: number; hi: number };

declare module "@/lib/store" {
  interface UiState {
    /** whether the Plan page is showing editable controls. 03-app.js(redesigned):11189 */
    UXPLANEDIT?: boolean;
    /** the pending write `p:goals.ask` (./drawers.tsx) is confirming, or none. */
    GOALSASK?: GoalsAsk | null;
    /** the period table's own inline validation, keyed by period key — mirrors the prototype's
     *  module-level `PLAN_DATE_ERRORS` (03-app.js(redesigned):11332), reproduced in `ui` because
     *  the store's `setPeriodDate` (features/people/reducer.ts, not owned here) silently no-ops on
     *  a bad date instead of reporting why — see crossOwnerRequests. Held here rather than
     *  dispatched, so the failed value is never written to PLAN at all. */
    PLANDATEERR?: Record<string, { field: "from" | "to"; message: string }>;
    /** bumped whenever "Keep saved dates" clears an error, so the (uncontrolled) date inputs
     *  remount and show the still-saved value instead of the rejected text left in the box. */
    PLANDATERESETGEN?: number;
  }
}
