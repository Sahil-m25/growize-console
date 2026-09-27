/**
 * PAPERWORK: TWO ROUNDS, ONE BATON. Ports `ref/03-app.js` lines 1633-1657 and 1701-1728.
 *
 * Paper is not one event, it is a relay, and it changes hands four times. Finance sends it, because
 * Finance holds the mailbox and the signing account. The IR tells the investor it is there, because
 * the IR is the only person the investor actually answers. The IR chases — once, twice, by whatever
 * channel works — and each chase is kept, because "we have asked him four times" is a fact, not a
 * memory. The investor tells the IR they have signed. And Finance verifies that the signed copy
 * really arrived, because a claim is not a signature any more than a claim is a payment.
 *
 * It happens twice. The NDA goes first and gates the material: nothing is sent to somebody who has
 * not signed one. The supplementary agreement comes after the investor has said yes, and it starts
 * earlier than the others — the IR writes a draft, chases agreement on it, and records the link to
 * the final draft, which is what Finance sends for signature. Only when that is verified does any
 * money get recorded.
 *
 * The IR sees the draft, because they wrote it. They never see an executed original.
 */

import type { PaperRoundDef, SlaChannel } from "./types";

export const ROUNDS: readonly PaperRoundDef[] = [
  {k:"nda",  t:"NDA", sub:"before any material goes out", tpl:"Non-disclosure agreement",
   draft:false, from:2, why:"Nothing is sent to somebody who has not signed one."},
  {k:"supp", t:"Supplementary agreement", sub:"the units, the terms, the money",
   tpl:"Supplementary agreement", draft:true, from:5, needs:"nda",
   why:"The IR drafts it and negotiates it; Finance sends the agreed version for signature."}
];

/**
 * WHERE EACH BEAT IS PERFORMED. Finance does not work in this console. The document is uploaded,
 * sent and verified in the Investor Management portal, because that is where the file and the
 * signing account live. If Finance also had to come back here and record that they had done it,
 * that is two entries for one fact — the exact thing this product exists to stop.
 */
export const IMP = "Investors pages";

/** "told them by …" */
export const PCH: Record<SlaChannel, string>  = {msg:"WhatsApp", call:"a call",  email:"email"};

/** Recording one that happened. */
export const PCHD: Record<SlaChannel, string> = {msg:"WhatsApp sent", call:"Called", email:"Emailed"};

/** Counting them. */
export const PCHN: Record<SlaChannel, string> = {msg:"WhatsApp", call:"Calls",   email:"Emails"};
