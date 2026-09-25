/**
 * Money: what Finance has confirmed, what an IR says an investor has paid, the reservation clock,
 * and the transfer into the investor database.
 * Ports `ref/03-app.js` lines 652-657, 689-696, 796-808, 1275, 1557-1561, 1938 and 1963.
 */

import type {
  Account,
  Claim,
  ClaimKind,
  ExtRec,
  LeadId,
  MoveReq,
  PayRec,
  XferRow,
} from "./types";

/** Finance only. */
export const PAY: Record<LeadId, PayRec> = {
  L6 :{state:"part", got:250000,  mode:"NEFT", utr:"HDFC2608551", on:"24 Aug", hold:"2 Sep"},
  L7 :{state:"part", got:1000000, mode:"SWIFT",utr:"EMIR2608119", on:"22 Aug", hold:"18 Sep"},
  L13:{state:"full", got:2500000, mode:"RTGS", utr:"ICIC2508430", on:"20 Aug", hold:null}
};

/**
 * RESERVATION EXTENSION. Balance is due in 30 days; the BU Owner approves an extension, and a
 * lapse forfeits ₹50,000 per unit and puts the units back on the shelf.
 */
export const EXTDAYS = [7,15,30] as const;

export const EXT: Record<LeadId, ExtRec> = {L7:{by:"kavya", asked:"26 Aug 16:30", days:15, why:"FEMA pack with his bank in Dubai",
                 state:"waiting"}};

/** ₹50,000 per unit, forfeit when a reservation lapses. */
export const FORFEIT = 50000;

/**
 * A PAYMENT REPORT: the IR says what the investor told them, with the amount, date and reference
 * if they have it. Finance sees it on their day and matches it to one confirmed receipt exactly —
 * a report is a record of its own, never a payment (ir-console-redesigned.html:5396-5403).
 */
export const CLAIM: Record<LeadId, Claim> = {
  /* the balance, not the advance: the commoner claim, and the one with a clock on it */
  L6:{id:"PR-L6-1", by:"rohit", at:"27 Aug 17:35", kind:"balance", mode:"RTGS", ref:"HDFC2708994",
      amount:2250000, said_on:"2026-08-27", heldBefore:250000,
      note:"Says he sent the balance on Friday evening, before the hold runs out", state:"waiting",
      history:[{type:"reported", by:"rohit", at:"27 Aug 17:35", note:"Payment report sent to Finance"}]}
};

/** Payment reports Finance could not find are archived off the live `CLAIM` slot when a new
 *  report is started against a lead that already has one confirmed. */
export const CLAIMARCHIVE: Record<LeadId, Claim[]> = {};

/** What a payment report is FOR — `CLAIMKINDS`. */
export const CLAIMKINDS: Record<ClaimKind, string> = {
  advance:"Advance", balance:"Balance", full:"Full payment", other:"Other payment",
};

/** How the investor said they paid. */
export const CLAIMMODES = ["RTGS", "NEFT", "IMPS", "SWIFT", "Cheque"] as const;

/**
 * TRANSFER means one thing only: a fully-paid lead becomes an investor record in the investor
 * database. A lead's owner changing is a REASSIGNMENT; someone working another person's lead is
 * COVER. The three words never overlap anywhere in this product.
 *
 * A done row carries the investor's own details, because a transferred lead leaves the leads book —
 * this section is the only place that history stays readable.
 */
export const XFER: XferRow[] = [
  {lead:"L13", by:"harsha", asked:"20 Aug 14:30", state:"done", auto:true, on:"20 Aug 14:30",
   code:"ARL-INV-0210", units:1, got:2500000, mode:"RTGS", utr:"ICIC2508430"},
  {lead:"L09", n:"Meenakshi Sundaram", ir:"kavya", src:"Referral — investor", ev:null,
   by:"harsha", asked:"20 Aug 14:55", state:"done", auto:true, on:"20 Aug 14:55",
   code:"ARL-INV-0207", units:2, got:5000000, mode:"NEFT", utr:"HDFC0092271145"},
  {lead:"L08", n:"Abhijit Sen", ir:"rohit", src:"Events", ev:"E-01",
   by:"harsha", asked:"08 Aug 10:12", state:"done", auto:true, on:"08 Aug 10:12",
   code:"ARL-INV-0206", units:1, got:2500000, mode:"RTGS", utr:"ICIC0088140233"},
  {lead:"L05", n:"Radhika Menon", ir:"ananya", src:"Founder network", ev:null,
   by:"harsha", asked:"24 Jul 15:31", state:"done", auto:true, on:"24 Jul 15:31",
   code:"ARL-INV-0205", units:4, got:10000000, mode:"NEFT", utr:"HDFC0088012477"}
];

/** The last ARL ID minted; the next one is this plus one. */
export const ARLSEQ = 207;

/**
 * THE GROWIZE ACCOUNT. `leadId -> {code, at, invite:{at,ch,auto}, state}`.
 *
 * The file moves ONCE, and it moves early: the moment Finance confirms the first money, an ARL ID
 * is minted and everything about that person — documents, receipts, the agreement — is filed under
 * it. Nobody opens it; it is a consequence of one fact, not a decision. The prototype starts this
 * empty and `acctAuto()` fills it on the confirmed receipt.
 */
export const ACCT: Record<LeadId, Account> = {};

/**
 * ASKING FOR A REASSIGNMENT. `leadId -> {by, at, to, why, state, did, on}`.
 *
 * An IR cannot move a lead off their own book — that is the whole point of one lead, one owner. But
 * they can ask, with a reason and a name, and their manager or anyone above decides. The request is
 * the audit trail; the reassignment it produces is the same reason-coded one a manager would have
 * made by hand.
 */
export const REQ: Record<LeadId, MoveReq> = {};
