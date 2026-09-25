/**
 * Documents. Ports `ref/03-app.js` lines 658-664, 1907-1919 and 3860-3864.
 */

import type { DocClass, DocRec, DocTemplate } from "./types";

export const DOCS: DocRec[] = [
 {lead:"L6", t:"Supplementary agreement", cls:"Agreement", state:"signed",  on:"24 Aug 11:06", how:"Aadhaar OTP", ref:"EMU-2608-77120"},
 {lead:"L6", t:"Advance receipt",         cls:"Financial", state:"sent",    on:"25 Aug 09:02", how:null, ref:null},
 {lead:"L7", t:"Supplementary agreement", cls:"Agreement", state:"blocked", on:null,          how:null, ref:null},
 {lead:"L7", t:"FEMA declaration",        cls:"Agreement", state:"awaiting",on:"26 Aug 16:20", how:null, ref:null},
 {lead:"L13",t:"Allocation letter",       cls:"Agreement", state:"signed",  on:"21 Aug 10:12", how:"Aadhaar OTP", ref:"EMU-2508-71004"}
];

/**
 * The templates Finance sends from.
 *
 * The default on the Documents panel is a template it will actually send — the two round documents
 * go out from the lead's Paperwork, in their turn, and are not offered there.
 */
export const DTPLS: readonly DocTemplate[] = [{t:"Non-disclosure agreement", cls:"Confidentiality"},
  {t:"Supplementary agreement", cls:"Commercial"}, {t:"LLP agreement", cls:"Constitutional"},
  {t:"Allocation letter", cls:"Commercial"}, {t:"FEMA declaration", cls:"Regulatory"},
  {t:"Power of attorney", cls:"Constitutional", wet:true}];

/**
 * The receipts, which are not part of either round: Finance files them, nobody chases them.
 *
 * The class of a document is a property of the document, so it is read off the one list that owns
 * it. It used to be spelt out twice, and the two spellings disagreed — a Supplementary agreement
 * read "Commercial" when Finance sent it and "Agreement" when the IR recorded it landing.
 */
export const DCLS_EXTRA: Record<string, DocClass> = {"Advance receipt":"Financial", "Final receipt":"Financial"};

/**
 * Receipts only. The NDA and the supplementary agreement have a round of their own, and recording
 * one of those by hand from the Documents panel would let somebody skip a beat of it.
 */
export const RCPT = (): string[] => Object.keys(DCLS_EXTRA);
