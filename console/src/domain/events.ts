/**
 * The field events. Ports `ref/03-app.js` lines 911-919.
 *
 * `off` is what the event's own sheet claims it captured on the day. Everything else about an
 * event — qualified, reserved, paid — comes from the leads themselves, so nothing is typed twice.
 */

import type { SheetCol } from "./types";

/* ---- the event sheet. One tab per event, loaded in a single pass. ---- */
export const SHEETCOLS: readonly SheetCol[] = [
  {k:"name",  t:"Full name",  req:true,  note:"as they said it"},
  {k:"mobile",t:"Mobile",     req:true,  note:"10 digits, we add +91"},
  {k:"email", t:"Email",      req:false, note:"blank is allowed"},
  {k:"units", t:"Units",      req:false, note:"1–10, blank means not said"},
  {k:"consent",t:"Consent",   req:true,  note:"WhatsApp / Call / Email, comma separated"},
  {k:"note",  t:"Note",       req:false, note:"anything the IR wrote on the tablet"}
];
/** How a loaded sheet hands its rows out. */
export const ASSIGNRULE: Record<string, string> = {roster:"Round-robin across who staffed it", self:"All to me",
                    one:"All to one person", none:"Leave unassigned"};