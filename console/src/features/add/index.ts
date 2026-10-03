/* Add lead — the one place a lead enters the console. `pagesBReducer` is exported from here as
   well as from its own module because it is the single write half of all four of this agent's
   screens, and the store wires it in one line. */

export { AddPage } from "./AddPage";
export { AddBulk } from "./AddBulk";
import "./drawer"; /* registers p:add.quick — see crossOwnerRequests for who must import this
                       module so the registration exists before #capb (global, top bar) opens it */
export { pagesBReducer } from "./reducer";
export {
  ADD0, addDraft, addGaps, addIntroducers, addSrcOK, addUnits, addWho, CONHOW, conOK, customOK,
  dupeOf, emOK, last10, nextLeadId, phOK,
  type AddCon, type AddDraft, type AddFlag, type AddGap,
} from "./state";
export { capWhy, grantorOf } from "./cap";
export {
  csvGood, csvRead, csvRows, dealTo, dupeOf as csvDupeOf, emailOK, evIRs, phoneKey, phoneOK,
  splitLine, splitLineBy, splitNames, splitNamesBy,
  type CsvField, type CsvFieldKey, type CsvRow, type CsvState,
} from "./csv";
