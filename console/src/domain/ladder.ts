/**
 * The ladder, the first-touch service levels, and the closed lists a lead's life is written in.
 * Ports `ref/03-app.js` lines 88-145, 497-512, 600-607, 1025, 1060-1061.
 */

import type {
  Band,
  Channel,
  Custodian,
  FcCat,
  FcCatDef,
  LadderRung,
  LostWhy,
  RagColour,
  TouchSla,
} from "./types";

/**
 * The ladder — strictly sequential, nothing skipped.
 *
 * The manual's eight-stage investor journey (Table 6). Commercial Close covers two money events,
 * so it takes two rungs; every other rung is one stage. `cust` is who may change the record while
 * the lead sits on it; `who` is the seat that ticks that particular rung.
 */
export const LADDER: readonly LadderRung[] = [
  {t:"Lead captured",      stage:1, cust:"IR",      who:"IR",
   ev:"Lead record, source and owner"},
  {t:"First touch made",   stage:2, cust:"IR",      who:"IR",   ch:"msg",
   ev:"An outbound touch logged"},
  {t:"Qualified",          stage:3, cust:"IR",      who:"IR",   needs:"scorecard",
   ev:"Qualification captured, plus a dated next step"},
  {t:"Engagement done",    stage:4, cust:"IR",      who:"IR",   skip:true,
   ev:"Webinar, farm, office or VR interaction completed, plus a dated next step",
   sla:"follow up within 1 working day"},
  {t:"Investor said yes",  stage:5, cust:"IR",      who:"IR&G",
   ev:"Investor intent and an approved commercial path"},
  {t:"Reserved — 10% in",  stage:6, cust:"IR", who:"IR", gate:"advance",
   ev:"Finance-confirmed 10% receipt and reservation evidence", sla:"30-day balance clock starts"},
  {t:"Fully paid",         stage:6, cust:"IR", who:"IR", gate:"balance",
   ev:"Finance-confirmed balance receipt", sla:"inside 30 days — ₹50,000 per unit forfeit"},
  {t:"Allocated",          stage:7, cust:"IR", who:"IR", gate:"alloc",
   ev:"Full payment, documents complete and a final unit number assigned"},
  {t:"Onboarded",          stage:8, cust:"IR",      who:"IR",
   ev:"App access, documents visible, allocation shown, communication started"}
];

/** Named stages, so no screen ever compares against a bare number again. */
export const ST = {CAPTURE:1, TOUCH:2, QUALIFIED:3, ENGAGED:4, CONVERTED:5,
            RESERVED:6, PAID:7, ALLOCATED:8, ONBOARDED:9} as const;

/** The three first-touch service levels are SLAs inside stage 2, never stages of their own. */
export const TOUCHSLA: readonly TouchSla[] = [
  {k:"msg",   t:"Personal WhatsApp", due:"same day",  days:0},
  {k:"email", t:"Intro email",       due:"day 1",     days:1},
  {k:"call",  t:"Call connected",    due:"by day 3",  days:3}
];

/** Every channel a touch can be logged on. Visits are manual contact, but have no mandatory
 *  first-touch deadline, so they sit outside {@link TOUCHSLA}. */
export const TOUCHCHANNELS: readonly Channel[] = ["msg", "email", "call", "visit"];

/** The manual's own "keep working no-reply leads" threshold: reached out this many times since
 *  they last came back to us, and the lead is cold. */
export const COLDAT = 4;

/**
 * The console cannot send a WhatsApp — the IR does, on their phone. So the control records that
 * it happened, and its label says so in the past tense. Recording the first one also ticks the
 * rung, because "First touch made" is exactly what it means.
 */
export const TOUCHDONE: Record<Channel, string> = {msg:"WhatsApp sent", email:"Intro email sent", call:"Call connected", visit:"Visit completed"};

/**
 * Consent was asked for one channel at a time, so it is checked one channel at a time. A lead who
 * ticked Email only is not a lead you may WhatsApp, and the console will not record that you did.
 * These are the words the refusal is written in.
 */
export const CHNAME: Record<Channel, string> = {msg:"WhatsApp", call:"a call", email:"email", visit:"an in-person visit"};

/**
 * THE NEXT ACTION. Manual Table 11: "No active lead without stage + next action/date", and the
 * operating flow: every active lead has one owner, one next action and one due date. It is a
 * control, not a note — so it is a closed list plus a date, and its absence is an exception.
 */
export const NEXTS = ["Call back","Send the deck","Send the yield note","Book a webinar","Book a farm visit","Farm visit",
  "Office meeting","Chase the paperwork","Chase the balance","Onboarding call","Nurture — check back"] as const;

/**
 * HOW A LEAD ENDS.
 *
 * The ladder only ever went forward, so nothing could be lost — the book only grew, every rate was
 * computed against a denominator that never settled, and an IR's queue filled with names they could
 * not clear. A queue you cannot empty is a queue people stop opening.
 *
 * Closing a lead is one of two things and never a third: it is WON when it reaches the top of the
 * ladder, or it is LOST with a reason from a closed list. A reason is mandatory because the whole
 * point of recording a loss is the pattern it makes afterwards.
 */
export const LOSTWHY = ["Price too high","Went cold — no reply","Lock-in too long","Timing — not now",
                 "Yield not convincing","KYC / FEMA blocked","Bought somewhere else",
                 "Never a real prospect"] as const satisfies readonly LostWhy[];

/**
 * FORECAST. Manual §3.1 and Table 22. Commit and Probable need investor-specific evidence; a
 * reservation only counts toward the FY forecast when full payment is expected on or before
 * 31 March 2027. Pipeline is coverage, never achievement.
 */
export const FCAT: Record<FcCat, FcCatDef> = {
  commit  :{t:"Commit",   d:"Investor-specific evidence supports the expected full-payment date.", c:"go"},
  probable:{t:"Probable", d:"Credible, with a defined next step and timing — not yet Commit.",     c:"due"},
  pipeline:{t:"Pipeline", d:"Earlier stage. Counts for coverage, never for achievement.",          c:""}
};

/** Red / amber / green, in words. */
export const RAGT: Record<RagColour, string> = {green:"On track",amber:"Slipping",red:"Breached"};

/**
 * THE GATE, NOT A HANDOVER. The lead never leaves the IR: three rungs rest on a fact only Finance
 * can establish, and the IR cannot tick past one until Finance has confirmed it in the Investor
 * Management portal. Ownership does not move; the truth gets checked.
 */
export const CUSTODY: Record<Custodian, string> = {IR:"the IR", Closed:"nobody — every rung is done"};

/** Which channel the next action needs — this is what My day filters on. */
export const CHAN: Record<Channel | "other", string> = {msg:"WhatsApp", email:"Email", call:"Call", visit:"Visit", other:"Internal task"};

/** The four phases of the manual's eight stages, mapped onto the nine rungs. */
export const BANDS: readonly Band[] = [{t:"Prospecting",to:2,c:"var(--brand-line)"},{t:"Qualifying",to:5,c:"var(--brand)"},
               {t:"Commercial",to:8,c:"var(--due)"},{t:"Onboarded",to:9,c:"var(--go)"}];

/**
 * A rung can be undone for this many hours, and only one back. Past that a correction is a NEW
 * record rather than an edit, because an audit trail that can be rewritten is not an audit trail.
 */
export const EDIT_H = 8;
