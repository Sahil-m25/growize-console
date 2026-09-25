/* ── features/activity/state.ts — the redesigned toolbar's extra draft fields ────────────────
   `ref/03-app.js` (redesigned) 11367: `let ACTKIND=null, ACTVIEW="log", ACTLIMIT=40`. ACTWHO,
   ACTDAY, ACTM and ACTTAB are already declared (features/add/state.ts, for reasons that belong to
   that file and not this one); the three fields the compact toolbar added are this feature's own.
   ────────────────────────────────────────────────────────────────────────────────────────── */

export {}; /* forces this file to be a module, so the block below augments UiState instead of
              declaring a stray global module of the same name. */

declare module "@/lib/store" {
  interface UiState {
    /** the action-kind filter — a key of `KINDS`, or none. */
    ACTKIND?: string | null;
    /** which of the three views is showing: the log, by person, or by day. */
    ACTVIEW?: "log" | "person" | "day";
    /** how many log rows "Show more" has revealed. */
    ACTLIMIT?: number;
  }
}
