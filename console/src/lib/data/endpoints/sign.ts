/* M12-S04-W1 / S05-W1 / S06-W1 / S07-W1 — Zoho Sign on the Investors side:
     GET  /api/documents/sign/prefill?paper=&id=      the send panel's facts (recipient, NRI, what is already out)
     POST /api/documents/sign/send                     one paper through Zoho Sign — an Idempotency-Key per press
     POST /api/documents/sign/remind | /recall         a request that is out (recall needs a reason)
     POST /api/documents/sign/verify                   paper signed outside Zoho Sign: method + reference
     POST /api/documents/sign/block                    "Nothing has come back" / "Block it" (a reason, signed ones too)
   Live: the routes on the person's own token. Fixture: the reducer action each one replaces (sendDocNow, remindSign,
   recallSign, verifyDoc, blockDoc) — the reducer's own refusals still show in the page note. */

import type { Prefill, SendDone } from "@/server/zoho-sign/send";
import type { Paper } from "@/server/documents/list";
import { I, allotsOf, may, signChip, type ImDoc, type ImInvestor } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";
import { paperOfDoc } from "./documents";

/** What Send offers, in the prototype's words → the route's method (Zoho Sign only signs by Aadhaar or email OTP; a
 *  Class 3 DSC or wet signature is verified by hand — sign/verify). */
export const METHOD_OF: Readonly<Record<string, "aadhaar" | "email-otp">> = { "Aadhaar OTP": "aadhaar", "Class 3 DSC": "email-otp", "Wet signature": "email-otp" };
/** The template name → paper (the four the route knows). */
export const PAPER_OF_TEMPLATE: Readonly<Record<string, Paper>> = {
  "Non-disclosure agreement": "nda", "FEMA declaration": "fema", "Supplementary agreement": "supplementary", "Allocation letter": "allocation-letter",
};
export const NOTHING_CAME_BACK = "Nothing has come back signed";

/* ---- prefill (M12-S04-W1) ---------------------------------------------------------------------------- */
export type PrefillArgs = { paper: Paper; id: string | null };
/** The investor a record id stands for in the demo book: the investor's own id, one of their allotments, or their lead. */
function investorOf({ s, me }: ImBook, id: string): ImInvestor | null {
  const x = I(s, me, id);
  if (x) return x;
  const a = (s.data.ALLOT || []).find(y => y.id === id);
  if (a) return I(s, me, a.Customer);
  return s.data.INV.find(y => y.lead === id && I(s, me, y.id)) || null;
}
const docOfPaper = ({ s }: ImBook, inv: string, paper: Paper): ImDoc | null =>
  s.data.DOCS.find(d => d.inv === inv && paperOfDoc(d) === paper && d.state !== "blocked") || null;

export const signPrefill: ReadEndpoint<ImBook, PrefillArgs, Prefill> = {
  path: a => (a.id ? `/api/documents/sign/prefill?paper=${encodeURIComponent(a.paper)}&id=${encodeURIComponent(a.id)}` : null),
  pick: j => (j as { prefill: Prefill }).prefill,
  fixture(b, a) {
    if (!may(b.s, b.me, "doc")) return fail(403, "seat-denied", "Sending belongs to Finance Operations, Compliance and the Head of Finance.");
    const x = a.id ? investorOf(b, a.id) : null;
    if (!x) return fail(403, "not-visible", "You cannot open this record in Zoho.");
    const d = docOfPaper(b, x.id, a.paper);
    const ch = d ? signChip(b.s, d) : null;
    const current = d ? { requestId: d.id, state: (d.state === "signed" ? "verified" : ch && ch.st !== "signed" ? ch.st : "sent") as "verified" | "sent", label: d.state === "signed" ? "Signed" : ch ? ch.t : "Sent" } : null;
    return ok({
      paper: a.paper, recordId: a.id!, recipient: { name: x.n, email: x.em }, nri: x.nri,
      methods: x.nri ? ["email-otp" as const] : ["aadhaar" as const, "email-otp" as const],
      methodNote: x.nri ? "Aadhaar eSign is not available: this investor is an NRI. Send with email OTP." : null,
      modifiedTime: null, current, maySend: true, note: null,
    });
  },
};

/* ---- send (M12-S04-W1) ------------------------------------------------------------------------------- */
export type SendArgs = {
  /** "other": a template that is not one of the four papers (a receipt, a power of attorney) — the route refuses it */
  paper: Paper | "other"; recordId: string; method: "aadhaar" | "email-otp";
  /** the Zoho Sign template (live) — the panel does not pick one yet, so the route answers "the send is incomplete" until it does */
  templateId: string; expectedModifiedTime: string;
  /** the book's own words for the reducer action the fixture runs */
  book: { inv: string; tpl: string; sig: string };
};
export type Sent = Pick<SendDone, "recordId" | "requestId" | "state" | "label"> & { paper: Paper | "other" };

export const signSend: WriteEndpoint<ImBook, SendArgs, Sent, ImDispatch> = {
  method: "POST",
  path: () => "/api/documents/sign/send",
  body: a => ({ paper: a.paper, recordId: a.recordId, method: a.method, templateId: a.templateId, expectedModifiedTime: a.expectedModifiedTime }),
  idempotent: true,
  pick: j => (j as { sent: Sent }).sent,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "sendDocNow", id: a.book.inv, tpl: a.book.tpl, sig: a.book.sig },
    { paper: a.paper, recordId: a.recordId, requestId: "", state: "sent" as const, label: "Sent" }),
  onLiveError: imLiveError,
};

/* ---- remind / recall (M12-S05-W1) -------------------------------------------------------------------- */
export type ActDone = { state: string; label: string; at: number };
export type RemindArgs = { paper: Paper; recordId: string; did: string };
export type RecallArgs = RemindArgs & { reason: string };
const pickDone = (j: unknown): ActDone => (j as { done: ActDone }).done;

export const signRemind: WriteEndpoint<ImBook, RemindArgs, ActDone, ImDispatch> = {
  method: "POST",
  path: () => "/api/documents/sign/remind",
  body: a => ({ paper: a.paper, recordId: a.recordId }),
  pick: pickDone,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "remindSign", did: a.did }, { state: "sent", label: "Reminder sent", at: 0 }),
  onLiveError: imLiveError,
};
export const signRecall: WriteEndpoint<ImBook, RecallArgs, ActDone, ImDispatch> = {
  method: "POST",
  path: () => "/api/documents/sign/recall",
  body: a => ({ paper: a.paper, recordId: a.recordId, reason: a.reason }),
  pick: pickDone,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "recallSign", did: a.did, why: a.reason }, { state: "recalled", label: "Recalled", at: 0 }),
  onLiveError: imLiveError,
};

/* ---- verify by hand (M12-S06-W1) --------------------------------------------------------------------- */
export const HAND_METHODS = ["Class 3 DSC", "Wet signature", "Uploaded"] as const;
export type HandMethod = (typeof HAND_METHODS)[number];
export type VerifyArgs = { paper: Paper; recordId: string; method: HandMethod; reference: string; expectedModifiedTime: string; did: string };
export type Verified = { paper: Paper; recordId: string; verifiedAt: string };
export const signVerify: WriteEndpoint<ImBook, VerifyArgs, Verified, ImDispatch> = {
  method: "POST",
  path: () => "/api/documents/sign/verify",
  body: a => ({ paper: a.paper, recordId: a.recordId, method: a.method, reference: a.reference || undefined, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => (j as { verified: Verified }).verified,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "verifyDoc", did: a.did, ref: a.reference }, { paper: a.paper, recordId: a.recordId, verifiedAt: "" }),
  onLiveError: imLiveError,
};

/* ---- block (M12-S07-W1) ------------------------------------------------------------------------------ */
export type BlockArgs = { paper: Paper; recordId: string; reason: string; expectedModifiedTime: string; did: string };
export type Blocked = { paper: Paper; recordId: string; recalled: boolean; wasVerified: boolean; reason: string };
export const signBlock: WriteEndpoint<ImBook, BlockArgs, Blocked, ImDispatch> = {
  method: "POST",
  path: () => "/api/documents/sign/block",
  body: a => ({ paper: a.paper, recordId: a.recordId, reason: a.reason, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => (j as { blocked: Blocked }).blocked,
  fixture(b, d, a) {
    const dc = b.s.data.DOCS.find(x => x.id === a.did);
    return imFixtureWrite(b, d, { type: "blockDoc", did: a.did, why: a.reason },
      { paper: a.paper, recordId: a.recordId, recalled: !!dc && dc.state === "awaiting", wasVerified: !!dc && dc.state === "signed", reason: a.reason });
  },
  onLiveError: imLiveError,
};

/** the allotment a paper of this investor is filed on (supplementary, allocation letter): the record id the routes take */
export const allotmentOf = ({ s, me }: ImBook, inv: string): string | null => (allotsOf(s, me, inv)[0] || { id: null }).id;
