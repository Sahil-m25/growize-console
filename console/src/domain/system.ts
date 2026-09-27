/**
 * SYSTEM — what the machine is doing. Ports `ref/03-app.js` lines 5162-5258.
 *
 * The parts that work as well as the parts that do not, each with three weeks of history behind
 * it, drawn day by day so a change of state has a position you can point at. Deterministic, never
 * sampled and never random, and marked demo like every other figure the prototype has not earned.
 *
 * The checks themselves (owners, since-dates, day histories) are records, not rules: they arrive with
 * the dataset (`Dataset.CHECKS`) — the demo list lives in `console/fixtures/book/system.ts`.
 */

import type { CheckState } from "./types";

/** How many days of history each strip shows. */
export const CKDAYS = 21;
export const CKS: Record<CheckState, { t: string; c: string; g: string }> = {ok:{t:"working", c:"go", g:"✓"}, warn:{t:"needs attention", c:"due", g:"!"},
             fail:{t:"not working", c:"late", g:"✕"}};
