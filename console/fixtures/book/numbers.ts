/** Demo recovery actions. Ports `ref/03-app.js` lines 4122-4133. Fixture mode only. */

import type { RecovRec } from "../../src/domain/types";

export const RECOV: Record<string, RecovRec> = {
  nonev:{who:"gokul",  act:"Stand up the paid-search and referral engine; weekly lead target agreed",
         by:"05 Sep", at:"25 Aug 10:00", set:"arvind"},
  l2q  :{who:"tasneem",act:"Qualification scorecard made mandatory before stage 3",
         by:"08 Sep", at:"25 Aug 10:04", set:"arvind"}
};
