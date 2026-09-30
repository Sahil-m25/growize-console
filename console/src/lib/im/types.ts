/* ── im/types.ts — the Investors side's records, UI globals and actions ─────────────────────
   Ported from the prototype's IMX module (console/prototype/growize-console-merged.html, the IIFE
   named IMX; /home/claude/ref/imx.js sections 1–8). Every field keeps its prototype name.

   The prototype held all of this as module-level `let`/`const` and mutated it in place. Here the
   records are `ImData` (what a server would hold) and the per-person screen state is `ImUi` (what
   the prototype kept as globals: SEL, SEC, the filters, the drawer, the drafts, SHOWN, REVASK).
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type {
  ImAccess, ImAllot, ImArlTxn, ImHolding, ImLlp, ImMoneyAction, ImMoneyDrawerKey, ImPayout, ImTestLink,
} from "./money-types";
export type * from "./money-types";
import type { ImUpload, ImSign, RecEmail, Paper2Action } from "./paper2-types";
export type * from "./paper2-types";

/* ---- people ---- */
export type ImRoleKey = "head" | "ops" | "comp" | "audit" | "amlead" | "kam" | "di" | "admin" | "root";
export type ImTeamKey = "fin" | "am" | "di" | "sys";
export type ImCan =
  | "view" | "bank" | "pii" | "pay" | "doc" | "tkt" | "care" | "assign" | "details" | "upd"
  | "field" | "refund" | "kyc" | "team" | "log" | "sys" | "root" | "farm";
export type ImRole = { tm: ImTeamKey; t: string; can: ImCan[] };
/** A person with a seat on the Investors side (prototype `P[k]`). `mgr` is read by activityActors. */
export type ImPerson = { n: string; i: string; r: ImRoleKey; c: number; em: string; mgr?: string };
/** A lead-side person named on this side (prototype `IRN[k]`); no seat, ever. */
export type ImIrName = { n: string; i: string; x: true };
/** What `who(k)` returns — a seated person, an IR name, or the "—" stand-in. */
export type ImWho = { n: string; i: string; r: ImRoleKey; c: number; em?: string; x?: true; mgr?: string };

/* ---- the book ---- */
export type ImFarm = {
  k: string; n: string; acres: number; units: number; released: number; soil: string;
  crop: string; by: string | null; at: string | null;
};
export type ImKyc = "passed" | "pending" | "failed";
export type ImSt = "reserved" | "paid" | "allocated" | "lapsed";
export type ImBank = { acct: string; ifsc: string; name: string; drop: string };
export type ImInvestor = {
  id: string; n: string; ph: string; em: string; city: string; addr: string; nri: boolean;
  pan: string | null; aadh: string | null; aref: string | null;
  kyc: ImKyc; kycOn: string | null; kycWhy?: string;
  bank: ImBank;
  units: number; blocks: Record<string, number>; st: ImSt;
  ir: string; src: string; since: string; nominee: string;
  kam?: string | null; kamOn?: string | null; intro?: string | null;
  hold?: string; lead?: string; fema?: "outstanding"; nextOn?: string | null;
};
export type ImMood = "good" | "ok" | "concern";
export type ImChan = "call" | "visit" | "email" | "msg";
export type ImContact = { inv: string; at: string; by: string; ch: ImChan; mood: ImMood; note: string };

export type ImTxnKind = "full" | "advance" | "balance" | "refund" | "forfeit";
export type ImTxn = {
  id: string; inv: string; kind: ImTxnKind; amt: number; mode: string; utr: string;
  on: string; by: string; rec: "matched" | "pending"; note?: string;
  /** who matched a pending receipt (matchReceipt — not in IMX, see reducer) */
  mby?: string; mat?: string;
  /** Receipts.Allotment — the allotment (investor × farm LLP) this receipt belongs to (D70, M10-S07).
   *  Absent on the prototype's receipts: they belong to the investor's only allotment. */
  Allotment?: string;
  /** Receipts.Modified_Time as the row was read (live rows only; the demo book has none) — sent back as
   *  expectedModifiedTime by Match it (M10-S02-W1) */
  version?: string | null;
};
export type ImDocState = "signed" | "awaiting" | "issued" | "blocked";
export type ImDoc = {
  id: string; inv: string; t: string; cls: string; state: ImDocState; sent: string; by: string;
  sig: string | null; ref: string | null; on?: string; exp?: string | null; vby?: string; why?: string;
};
export type ImTpl = { t: string; cls: string; noSign?: true; wet?: true };

/* ---- the link ---- */
export type ImInboxKind = "claim" | "chase" | "told" | "signed" | "note";
export type ImInbox = {
  id: string; inv: string; kind: ImInboxKind; at: string; ir: string; state: string;
  t: string; d: string; doc?: string;
};
export type ImAns = { state: "confirmed" | "notfound"; by: string; at: string; why?: string };
export type ImOutbox = { at: string; inv: string; t: string; by: string };

/* ---- after the money ---- */
export type ImTktState = "open" | "waiting" | "closed";
export type ImTicket = {
  id: string; inv: string; t: string; cat: string; opened: string; by: string; own: string;
  pri: "high" | "normal"; state: ImTktState; d: string; sla: string; closed?: string;
  handed?: { by: string; at: string };
};
export type ImField = { id: string; blk: string; at: string; by: string; st: string; head: string; d: string };
export type ImUpdTo = "all" | "allocated" | "nri";
export type ImUpdate = { id: string; t: string; cat: string; on: string; by: string; to: ImUpdTo; n: number; d: string };

/* ---- the log ---- */
export type ImKind = "money" | "doc" | "pii" | "kyc" | "tkt" | "upd" | "farm" | "care" | "admin";
export type ImLogEntry = { at: string; who: string; what: string; inv: string | null; note: string; kind: ImKind };

/* ---- the app account ---- */
export type ImMark = "tentative" | "permanent";
export type ImAppHist = { to: ImMark; from: string; until: string; by: string | null };
export type ImApp = {
  at: string; welcome: { at: string; ch: string }; mark: ImMark; markAt: string;
  markBy: string | null; hist: ImAppHist[];
};

/** Everything the Investors side holds. `NOW` is the frozen clock as a naive local ISO string
 *  ("2026-09-02T00:00"); every date and stamp is computed from it, never from the wall clock. */
export type ImData = {
  NOW: string;
  P: Record<string, ImPerson>;
  /** who signs in here, in the order the sign-in list and the Teams page show them (prototype SIGNINS) */
  SIGNINS: string[];
  IRN: Record<string, ImIrName>;
  FARMS: ImFarm[];
  INV: ImInvestor[];
  CONTACT: ImContact[];
  TXN: ImTxn[];
  DOCS: ImDoc[];
  INBOX: ImInbox[];
  ANS: Record<string, ImAns>;
  OUTBOX: ImOutbox[];
  TKT: ImTicket[];
  FIELD: ImField[];
  UPD: ImUpdate[];
  LOG: ImLogEntry[];
  APP: Record<string, ImApp>;
  /* ---- later owner decisions (D70, D82, D93 — M10-S07…S23, M11-S01/S02, M09-S09): see ./money-types ---- */
  LLP?: ImLlp[];
  ALLOT?: ImAllot[];
  PAYOUT?: ImPayout[];
  HOLDING?: ImHolding[];
  ARLTXN?: ImArlTxn[];
  ACCESS?: Record<string, ImAccess>;
  TESTLINK?: ImTestLink[];
  /* ---- D70–D72 (M12-S02, M12-S05, M12-S09): see ./paper2-types ---- */
  UPLOADS?: ImUpload[];
  SIGN?: Record<string, ImSign>;
  EMAILS?: RecEmail[];
  TSEQ: number; DSEQ: number; KSEQ: number; FSEQ: number; USEQ: number;
};

/* ---- UI ---- */
export type ImView = "dash" | "inv" | "farms" | "txn" | "docs" | "tkt" | "upd" | "ins" | "sys" | "act" | "team";
export type ImDrawerKey = "kam" | "talk" | "claim" | "pay" | "send" | "verify" | "kyc" | "tkt" | "upd" | "field" | "details"
  | ImMoneyDrawerKey;
export type ImDrafts = {
  PUTR: string; DREF: string; DTPL: string | null; DSIG: string; PKIND: "advance" | "balance";
  PMODE: string; DET: Partial<Record<"n" | "ph" | "em" | "city" | "addr" | "nominee", string>>;
  KSEL: string | null;
  TK: { inv: string | null; cat: string; t: string; d: string; pri: "high" | "normal" };
  CT: { ch: ImChan; mood: ImMood; note: string; next: string };
  UP: { t: string; cat: string; d: string; to: ImUpdTo };
  FD: { blk: string; st: string; head: string; d: string };
};
export type ImNote = { kind: "refuse" | "ask"; msg: string };
export type ImUi = {
  VIEW: ImView;
  SEL: string | null;
  SEC: Record<string, string>;
  IQ: string; IFILT: string | null; TFILT: string | null; KFILT: string;
  LOGWHO: string | null; LOGKIND: ImKind | null;
  DRW: { k: ImDrawerKey; id: string | null } | null;
  drafts: ImDrafts;
  DRAWERDRAFTS: Record<string, ImDrafts>;
  DRAFTCTX: string | null;
  /** reveals this session: key `${WHO}|${invId}:${f}` */
  SHOWN: Record<string, true>;
  REVASK: { id: string; f: "pan" | "acct" } | null;
  /** the prototype's alert()/confirm(), said on the page */
  NOTE: ImNote | null;
  /** the write a NOTE of kind "ask" is waiting on; replayed by {type:"confirmYes"} */
  PENDING: ImAction | null;
  /** the money screens' small form and tab state (M10-S20…S23, M09-S09), key → value */
  MX?: Record<string, string>;
};
export type ImState = { data: ImData; ui: ImUi };
/** What a selector reads. `ImState` satisfies it. */
export type ImCtx = { data: ImData; ui?: ImUi };

/* ---- queue rows (finQueue / careQueue) ---- */
export type ImRound = {
  R: { k: string; t: string; tpl: string } | undefined;
  state: "none" | "done" | "blocked" | "said" | "out"; t: string; who: string | null; d: ImDoc | null;
};
export type ImUrg = "now" | "soon" | "ok";
export type ImQ =
  | { inv: ImInvestor; kind: "send" | "verify"; r: ImRound; t: string; urg: ImUrg }
  | { inv: ImInvestor; kind: "kyc" | "fema" | "nokam" | "intro"; t: string; urg: ImUrg }
  | { inv: ImInvestor; kind: "hold" | "due"; days: number; t: string; urg: ImUrg }
  | { inv: ImInvestor; kind: "claim"; n: ImInbox; t: string; urg: ImUrg }
  /* M12-S05: the investor declined a Zoho Sign request */
  | { inv: ImInvestor; kind: "declined"; d: ImDoc; t: string; urg: ImUrg };

/* ---- actions: named after the prototype's mutators ---- */
export type ImAction =
  /* writes (section 7, plus reveal from section 2 and logField/saveDetails from section 3) */
  | { type: "reveal"; id: string; f: "pan" | "acct"; why?: string }
  | { type: "hideAll" }
  | { type: "revCancel" }
  | { type: "logField"; blk: string; st: string; head: string; d: string }
  | { type: "saveDetails"; id: string }
  | { type: "setMark"; id: string; to: ImMark }
  | { type: "recordPay"; id: string; kind: "advance" | "balance"; mode?: string; utr?: string; claimId?: string; allot?: string }
  | { type: "confirmClaim"; nid: string }
  | { type: "rejectClaim"; nid: string; why?: string }
  | { type: "matchReceipt"; tid: string }
  | { type: "sendDocNow"; id: string; tpl: string; sig: string }
  | { type: "verifyDoc"; did: string; ref?: string }
  | { type: "blockDoc"; did: string; why?: string }
  | { type: "passKyc"; id: string }
  | { type: "failKyc"; id: string; why?: string }
  | { type: "releaseBlock"; k: string }
  | { type: "holdBlock"; k: string }
  | { type: "handToFinance"; id: string }
  | { type: "moveTicket"; id: string; state: ImTktState }
  | { type: "newTicket"; inv: string; cat?: string; t: string; d?: string; own?: string; pri?: "high" | "normal" }
  | { type: "publish"; t: string; cat?: string; d?: string; to?: ImUpdTo }
  | { type: "assignKam"; id: string; k: string | null }
  | { type: "logContact"; id: string; ch: ImChan; mood: ImMood; note?: string; nextDays?: string | number }
  | { type: "setSeat"; k: string; r: ImRoleKey }
  | { type: "lapseHold"; id: string }
  /* state and navigation (section 8) */
  | { type: "go"; v: ImView; id?: string | null }
  | { type: "setSec"; v: string; k: string }
  | { type: "openDrawer"; k: ImDrawerKey; id?: string | null; seed?: Partial<ImDrafts> }
  | { type: "closeDrawer" }
  | { type: "setPerson"; k: string }
  | { type: "setSel"; id: string | null }
  | { type: "setDraft"; patch: Partial<ImDrafts> }
  | { type: "setFilter"; patch: Partial<Pick<ImUi, "IQ" | "IFILT" | "TFILT" | "KFILT" | "LOGWHO" | "LOGKIND">> }
  /* later owner decisions (money-types.ts) */
  | ImMoneyAction
  /* the page note (the prototype's alert/confirm) */
  | { type: "confirmYes" }
  | { type: "noteClose" }
  /* a live /api refusal shown in the same in-page note (lib/data/endpoints/im imLiveError) — UI only, writes no record */
  | { type: "note"; msg: string }
  /* uploads, signature reminders and recalls (M12-S02, M12-S05) — paper2-types.ts */
  | Paper2Action;
