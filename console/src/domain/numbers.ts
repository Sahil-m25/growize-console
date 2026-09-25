/**
 * RECOVERY ACTIONS. Ports `ref/03-app.js` lines 4122-4133 and 4171-4174.
 *
 * Manual operating rule 5 and the Table 24 scorecard: every Amber or Red line carries one owner,
 * one recovery action and one date. Nothing here is optional — an amber line without a recovery
 * action is itself an exception.
 */

import type { RecovAction, RecovRec } from "./types";

export const RECOV: Record<string, RecovRec> = {
  nonev:{who:"gokul",  act:"Stand up the paid-search and referral engine; weekly lead target agreed",
         by:"05 Sep", at:"25 Aug 10:00", set:"arvind"},
  l2q  :{who:"tasneem",act:"Qualification scorecard made mandatory before stage 3",
         by:"08 Sep", at:"25 Aug 10:04", set:"arvind"}
};
export const RECOVACTS = ["Coach the owner and re-run next week","Change the process step",
  "Add the missing field to the console","Re-forecast the period","Escalate to the BU review",
  "Reassign the work","Bring in Corporate Operations"] as const satisfies readonly RecovAction[];

/* THE STEP THAT IS THIS EVENT'S FAULT. A leak every event shares is not an event's problem — it is
   the process, and repeating it on four cards teaches nobody anything. So a step only counts as an
   event's break when it is materially worse than the same step everywhere else. */
/** Points worse than everyone else to be yours. */
export const SPREAD = 12;                                  /* points worse than everyone else to be yours */
