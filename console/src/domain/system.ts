/**
 * SYSTEM — what the machine is doing. Ports `ref/03-app.js` lines 5162-5258.
 *
 * The parts that work as well as the parts that do not, each with three weeks of history behind
 * it, drawn day by day so a change of state has a position you can point at. Deterministic, never
 * sampled and never random, and marked demo like every other figure the prototype has not earned.
 */

import type { Check, CheckState } from "./types";

/** How many days of history each strip shows. */
export const CKDAYS = 21;
export const CKS: Record<CheckState, { t: string; c: string; g: string }> = {ok:{t:"working", c:"go", g:"✓"}, warn:{t:"needs attention", c:"due", g:"!"},
             fail:{t:"not working", c:"late", g:"✕"}};
export const CHECKS: readonly Check[] = [
 /* ---- the parts that work. Named, owned, and dated, because "it is fine" is not a status. ---- */
 {k:"signin", t:"Sign-in and seats", st:"ok", own:"sahil", every:"continuous", since:"01 Jun",
  w:"Every person reaches only the screens their seat and their manager allow",
  br:"Somebody sees a book, a price or a bank detail that is not theirs"},
 {k:"consent", t:"The consent gate", st:"ok", own:"sahil", every:"on every touch", since:"01 Jun",
  w:"No outbound touch can be recorded against a lead with no consent",
  br:"The company contacts people who never agreed to be contacted"},
 {k:"audit", t:"The audit log", st:"ok", own:"sahil", every:"on every write", since:"01 Jun",
  w:"Every write lands in the log with a person, a time and a record",
  br:"Nothing can be reconstructed after the fact, including who changed a payment"},
 {k:"sheet", t:"Event sheet load", st:"ok", own:"kavya", every:"after each event", since:"01 Jun",
  blip:["2026-08-24"],
  w:"A tablet's worth of intake rows becomes leads in one pass, duplicates refused",
  br:"An event's leads are typed in by hand, days late"},
 {k:"receipt", t:"Payment receipts", st:"ok", own:"harsha", every:"on every receipt", since:"01 Jun",
  w:"A receipt records mode, UTR and date, and starts the 30-day balance clock",
  br:"A reservation exists with no evidence behind it"},
 {k:"docs", t:"The document register", st:"ok", own:"harsha", every:"on every send", since:"01 Jun",
  w:"Every agreement and declaration sent is on the register with its state",
  br:"Nobody can say what a given investor has actually signed"},
 {k:"backup", t:"Nightly backup", st:"ok", own:"sahil", every:"02:00 daily", since:"01 Jun",
  blip:["2026-08-17"],
  w:"The whole CRM is copied off-site every night and the copy is opened to check it",
  br:"A bad day becomes a permanent loss"},
 {k:"inv", t:"Sellable inventory", st:"ok", own:"harsha", every:"on every reservation", since:"01 Jun",
  w:"No unit can be reserved or allocated twice; an advance is refused when nothing is free",
  br:"Two investors are sold the same acre"},
 {k:"app", t:"Investor app access", st:"ok", own:"sahil", every:"on onboarding", since:"01 Jun",
  w:"An allocated investor gets app access, documents and their unit number",
  br:"Onboarding is a phone call and a promise"},
 {k:"roster", t:"Roster and cover", st:"ok", own:"jhalak", every:"continuous", since:"01 Jun",
  w:"An absence hands the open leads to the named secondary, and clears itself on the return date",
  br:"Leads sit untouched for a week while their owner is on leave"},

 /* ---- the parts that do not. Same shape, same fields, so the page is one list and not two. ---- */
 {k:"licence", t:"Zoho licence", st:"warn", own:"pradeep", every:"annual", since:"2026-08-23",
  was:"ok", w:"The licence that everything else runs on", br:"Everything stops if it lapses",
  fix:"Renew before 13 September. Corporate Operations holds the contract.",
  note:"Expires 13 September. Nothing else on this page matters if this one does."},
 {k:"aadhaar", t:"Identity numbers in plain fields", st:"warn", own:"sahil", every:"continuous",
  since:"2026-06-01", w:"Aadhaar, PAN and bank numbers should be readable only by Finance",
  br:"They are in ordinary CRM fields, visible to every licensed user",
  fix:"Move them to a field-level-restricted section in Zoho, Finance profile only, and purge the "
     +"plain copies. Until that lands, this console holds none of them."},
 {k:"unitlab", t:"Units_Allotted is labelled “Units Reserved”", st:"warn", own:"sahil",
  every:"continuous", since:"2026-06-01", w:"A field whose name says what it holds",
  br:"Reserved units get counted and reported as sold",
  fix:"Rename the field label to Units_Reserved and add a separate Units_Allotted, then re-point "
     +"every report at the right one."},
 {k:"lostwhy", t:"No lost-reason field", st:"warn", own:"sahil", every:"continuous", since:"2026-06-01",
  w:"Every close records why", br:"Two thirds of losses are recorded as nothing at all",
  fix:"Add a mandatory Lost_Reason picklist on Leads, with the six buckets Numbers already reports."},
 {k:"stamps", t:"Stage times are never written", st:"warn", own:"sahil", every:"continuous",
  since:"2026-06-01", w:"Each rung stamps the minute it was ticked",
  br:"No ageing, no speed measure, and no way to backfill either",
  fix:"Add a datetime field per stage and write it on transition. Nothing before the day it ships "
     +"can be recovered, which is why it is the first thing to build."},
 {k:"imlink", t:"Investors pages link", st:"warn", own:"sahil", every:"continuous",
  since:"2026-06-01",
  w:"What Finance does in the IM portal — a document sent, a signature verified, a receipt banked — "
   +"is on the IR's lead within the minute, and what the IR raises here reaches Finance over there",
  br:"The IR cannot see whether the document went, so they telephone Finance to ask — and the double "
   +"entry this whole design removes comes back by hand, one phone call at a time",
  note:"This is the join that makes one-writer-per-fact possible. It is not built yet.",
  fix:"One event stream each way, keyed on the ARL ID. Nothing is written on both sides: this "
   +"console never writes a document or a receipt, and the portal never writes an owner or a chase."},
 {k:"wb", t:"Growize → Zoho export", st:"fail", own:"sahil", every:"every 15 minutes",
  since:"2026-08-13", was:"ok",
  w:"A lead is entered once, here, and the CRM receives the copy without anybody re-typing it",
  br:"Somebody is asked to enter the same lead twice — which is the one thing this console exists "
     +"to remove, and the fastest way to end up with two versions of the truth",
  note:"Dead since 13 August. It is one-way by design: this console is where a lead is entered and "
     +"worked, and the CRM is downstream of it. Nothing is ever keyed into both.",
  fix:"Rebind the integration to a service account rather than a person's licence, and alert on the "
     +"first failed write instead of the hundredth."},
 {k:"mirror", t:"The reporting mirror", st:"fail", own:"sahil", every:"nightly", since:"2026-07-16",
  was:"ok", w:"A read-only copy every report is built from",
  br:"Reports are built off the live CRM, or not at all", note:"A separate, earlier failure.",
  fix:"Restart the nightly export and alert on a missing run. It broke four weeks before the "
     +"write-back did, so one is not the cause of the other."},
 {k:"leadsdb", t:"leads-db", st:"fail", own:"sahil", every:"—", since:"2026-06-01",
  w:"The store every funnel figure would be computed from",
  br:"Every figure on the plan tab is demo until it exists",
  fix:"Stand up leads-db with the stage stamps and the source field, then point Numbers at it. "
     +"The arithmetic already exists — the From the book tab runs it on what the console holds."},
 {k:"transfer", t:"The write into the investor org", st:"warn", own:"sahil", every:"on every transfer",
  since:"2026-06-01",
  w:"The ARL ID minted on transfer should reach the investor org, not only this one",
  br:"The record exists on this side and is keyed in by hand on the other, so the two counts drift",
  fix:"Write the ARL ID and the transfer snapshot into the investor org in the same call, and "
     +"reconcile nightly. The minting and the audit trail already work — it is the second write "
     +"that does not exist."}
];
