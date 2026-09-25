/**
 * The console's frozen clock. Ports `ref/03-app.js` lines 1150-1152.
 *
 * Every date in the product is measured from here, so a due date somebody sets and the clock that
 * reads it can never be on two different calendars — and the seeded timeline is deterministic.
 */

/** 28 Aug 2026. */
export const TODAY = new Date(2026, 7, 28);

/** The console's today. `NOW` and {@link TODAY} are the same instant; the prototype keeps both
 *  names because one reads as a day and the other as a moment. */
export const NOW = TODAY;
