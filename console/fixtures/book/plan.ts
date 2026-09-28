/** The demo plan. Ports `ref/03-app.js` lines 376-448. Fixture mode only. */

import type { Plan } from "../../src/domain/types";

/**
 * Every derived plan figure comes from here, so Goals is the only place any of them change.
 *
 * Periods are editable; the master target, the planning baseline and the Finance-verified actual
 * are three separate things and the manual is explicit that they must never be merged.
 */
export const PLAN: Plan = {
  masterUnits: 208, acres: 8, byWhen: "31 March 2027",
  baseline: {units: 15, src: "Addendum B planning baseline", warn: true},
  /* a period is a DURATION, not a label — from/to are what every figure below is scoped by.
     target = units the BU Owner commits to. actual = fully-paid units Finance has verified.
     coll = ₹ Finance has actually banked in the window, which is never target × ₹25L, because a
     reservation banks 10% in one period and the balance in another. */
  grain: "month",
  periods: [
    /* actual and coll are what Finance has VERIFIED inside the window. Today is 28 August, so the
       first window has not opened: both are zero, and saying otherwise would be the one kind of lie
       this console exists to prevent. */
    {k:"sep", t:"September", from:"2026-09-01", to:"2026-09-30", target:50, actual:0, coll:0,
     emph:"Front-load demand; event and digital engine live"},
    {k:"oct", t:"October",   from:"2026-10-01", to:"2026-10-31", target:50, actual:0, coll:0,
     emph:"Maintain lead volume; improve qualification"},
    {k:"nov", t:"November",  from:"2026-11-01", to:"2026-11-30", target:50, actual:0, coll:0,
     emph:"Convert Sep–Oct pipeline; protect the payment cycle"},
    {k:"dec", t:"December",  from:"2026-12-01", to:"2026-12-31", target:43, actual:0, coll:0,
     emph:"Close the remaining FY target"}
  ],
  rates: {lead2qual:40, qual2res:18, res2paid:85},
  eventDays: 22, eventLen: 2, eventShare: 30,
  sla: {firstTouch:"same day", day3:100, packWeeks:4}
};
