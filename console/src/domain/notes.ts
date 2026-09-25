/**
 * What was said, what was sent, and how the last call went.
 * Ports `ref/03-app.js` lines 739-753, 768-774, 787-789 and 1447.
 */

import type {
  CallOutcome,
  CallRec,
  InteractionRec,
  LeadId,
  Note,
  Objection,
  Sendable,
  Stamp,
} from "./types";
import { NOW } from "./clock";
import { when } from "@/lib/format";

/** Manual contact history kept off-ladder: failed call/visit attempts and other follow-up-drawer
 *  recordings. The prototype starts this empty and then, once `CALLS` exists, folds each recorded
 *  call into it as a `"fixture"` interaction — the same pass ir-console-redesigned.html:12916-12920
 *  runs at load — so "Previously raised" and Conversation history are not empty for a lead whose
 *  only contact so far is the call already on the fixture (L3, L5, L8, L11). */
function seedInteractions(): Record<LeadId, InteractionRec[]> {
  const out: Record<LeadId, InteractionRec[]> = {};
  for (const [id, c] of Object.entries(CALLS)) {
    const at = when(c.at, NOW);
    (out[id as LeadId] = out[id as LeadId] || []).push({
      id: "fixture-call-" + id, channel: "call", outcome: c.o || "", obj: (c.obj || []).slice(),
      at: c.at || "", date: at ? at.getFullYear() + "-" + String(at.getMonth() + 1).padStart(2, "0")
        + "-" + String(at.getDate()).padStart(2, "0") : "",
      tm: (c.at || "").slice(-5), who: c.who, fixture: true,
    });
  }
  return out;
}

/** What an IR may record: sent or not, and when. No sending, no contents. */
export const SENDABLE = ["Pitch deck","Farm profile","Yield note","Webinar invite"] as const satisfies readonly Sendable[];

/** Weeks of the produce pack sent, of 4. */
export const PACK: Record<LeadId, number> = {L3:2, L4:1, L5:4, L6:4, L8:3, L9:2, L10:1, L11:2, L12:0, L13:4};

/** When each produce-pack week was last moved. */
export const PACKAT: Record<string, Stamp> = {};

/** Which pieces of material have gone to which lead, and on what day. */
export const SENT: Record<LeadId, Partial<Record<Sendable, string>>> = {L3:{"Pitch deck":"26 Aug","Webinar invite":"23 Aug"}, L5:{"Pitch deck":"14 Aug","Farm profile":"20 Aug","Yield note":"21 Aug"},
  L6:{"Pitch deck":"03 Aug","Farm profile":"05 Aug"}, L7:{"Pitch deck":"06 Aug","Farm profile":"08 Aug","Yield note":"09 Aug"},
  L8:{"Pitch deck":"19 Aug"}, L11:{"Pitch deck":"22 Aug"}, L13:{"Pitch deck":"10 Jul","Farm profile":"12 Jul"}};

/**
 * How the last call went. Recorded by hand, like every touch: an outcome and the objections heard,
 * so "why we lose" is built from records rather than remembered at the review.
 */
export const CALLOUT = ["Interested","Not now","Not interested","No answer","Wrong number","Call back"] as const satisfies readonly CallOutcome[];

export const OBJS = ["Price","Lock-in","Yield","Site visit first","Timing","Spouse decides"] as const satisfies readonly Objection[];

export const CALLS: Record<LeadId, CallRec> = {
  L3:{o:"Interested", obj:["Site visit first"], at:"25 Aug 16:14", who:"kavya"},
  L5:{o:"Interested", obj:["Lock-in"],          at:"13 Aug 15:38", who:"kavya"},
  L8:{o:"Call back",  obj:["Price","Timing"],   at:"26 Aug 15:41", who:"nikhil"},
  L11:{o:"Interested",obj:["Yield"],            at:"22 Aug 16:24", who:"nikhil"}
};

/**
 * Notes. Nothing computes from them, which is exactly why they are allowed to be free text — and
 * why every one of them carries who wrote it, when, and against which lead.
 */
export const NOTES: Record<LeadId, Note[]> = {
  L3 :[{who:"kavya", at:"26 Aug 11:20", d:"2026-08-26", t:"Wants to see the Chikkaballapur block before he commits. Free the first weekend of September."},
       {who:"tasneem", at:"22 Aug 16:05", d:"2026-08-22", t:"Coached Kavya on the lock-in objection — he is comparing against a 3-year FD, not against land."}],
  L6 :[{who:"rohit", at:"24 Aug 09:15", d:"2026-08-24", t:"Advance came from his HUF account, not personal. Flagged to Finance before the agreement goes out."}],
  L7 :[{who:"kavya", at:"25 Aug 12:40", d:"2026-08-25", t:"Dubai number. Aadhaar is linked to an old Indian SIM he no longer has — e-sign will fail, needs DSC or wet signature."}],
  L2 :[{who:"rohit", at:"27 Aug 10:05", d:"2026-08-27", t:"Asked us not to call before 6pm. Evenings only."}]
};

export const INTERACTIONS: Record<LeadId, InteractionRec[]> = seedInteractions();
