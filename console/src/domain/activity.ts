/**
 * The audit trail. Every write lands here, for every user.
 * Ports `ref/03-app.js` lines 1130-1149 and 1157-1221.
 */

import type { ActFamily, ActKind } from "./types";

export const KINDS: Record<ActKind, string> = {msg:"WhatsApp", call:"Calls", email:"Emails", visit:"Visits", stage:"Stages", mat:"Material", pack:"Pack",
               money:"Payments", doc:"Documents", admin:"Admin", roster:"Roster", note:"Notes"};

export const VERB: Record<ActKind, string>  = {msg:"WhatsApp sent", call:"Call logged", email:"Email sent", visit:"Visit recorded", stage:"Marked done",
               mat:"Ticked material sent", pack:"Produce pack", money:"Recorded payment",
               doc:"Sent document", admin:"Admin action", roster:"Roster change", note:"Note added"};

/**
 * WHAT KIND OF THING HAPPENED, in one glyph. Colour is already spoken for twice over — whose it is,
 * and whether the lead is in trouble — so the kind of action gets the channel that is left. Four
 * families, told apart by the chip's border: a touch that went out, the record moving, money and
 * paper, and housekeeping.
 */
export const ACTG: Record<ActKind, string> = {msg:"◆", call:"◉", email:"✉", visit:"◎", stage:"✓", mat:"▤", pack:"▲", money:"₹",
              doc:"§", admin:"⚙", roster:"◑", note:"✎"};

export const ACTFAM: Record<ActKind, ActFamily> = {msg:"touch", call:"touch", email:"touch", visit:"touch", stage:"move", mat:"move", pack:"move",
                money:"money", doc:"money", admin:"admin", roster:"admin", note:"admin"};

export const FAMT: Record<ActFamily, string> = {touch:"a touch that went out", move:"the record moving", money:"money and paper",
              admin:"housekeeping"};

