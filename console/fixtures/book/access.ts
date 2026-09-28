/** Demo temporary-access grants. Ports `ref/03-app.js` lines 256-283. Fixture mode only. */

import type { TempGrant } from "../../src/domain/types";

/** The last grant id minted; the next one is this plus one. */
export const TSEQ = 2;

export const TEMP: TempGrant[] = [
  {id:"T-01", to:"kavya", by:"tasneem", page:"docs", caps:["view"], from:"27 Aug 09:40",
   until:"02 Sep", why:"Chasing Joseph Mathew's FEMA pack while Harsha is out",
   state:"live", acts:3},
  {id:"T-00", to:"ananya", by:"tasneem", page:"goals", caps:["view"], from:"04 Aug 11:00",
   until:"11 Aug", why:"Building the September event plan", state:"live", acts:2},
  {id:"T-02", to:"nikhil", by:"tasneem", page:"activity", caps:["view","others"], from:"12 Aug 10:05",
   until:"15 Aug", why:"Covering the weekly review", state:"revoked", by2:"tasneem",
   on:"14 Aug 17:20", acts:6}
];
