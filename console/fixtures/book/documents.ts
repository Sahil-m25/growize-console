/** The demo document register. Ports `ref/03-app.js` lines 658-664. Fixture mode only. */

import type { DocRec } from "../../src/domain/types";

export const DOCS: DocRec[] = [
 {lead:"L6", t:"Supplementary agreement", cls:"Agreement", state:"signed",  on:"24 Aug 11:06", how:"Aadhaar OTP", ref:"EMU-2608-77120"},
 {lead:"L6", t:"Advance receipt",         cls:"Financial", state:"sent",    on:"25 Aug 09:02", how:null, ref:null},
 {lead:"L7", t:"Supplementary agreement", cls:"Agreement", state:"blocked", on:null,          how:null, ref:null},
 {lead:"L7", t:"FEMA declaration",        cls:"Agreement", state:"awaiting",on:"26 Aug 16:20", how:null, ref:null},
 {lead:"L13",t:"Allocation letter",       cls:"Agreement", state:"signed",  on:"21 Aug 10:12", how:"Aadhaar OTP", ref:"EMU-2508-71004"}
];

