/* ── im/constants.ts — the Investors side's product rules and copy ─────────────────────────
   Prototype identifiers and exact strings (imx.js lines 26–81, 94, 131–165, 179–187, 346–361,
   585–594, 703–704, 721, 773–775, 812–815, 903, 996–997, 1285–1297). Nothing here is demo data.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import type { ImCan, ImChan, ImDrafts, ImKind, ImMood, ImRole, ImRoleKey, ImTeamKey, ImTpl, ImView } from "./types";

export const TEAM: Record<ImTeamKey, string> = {
  fin: "Finance, Legal & Compliance", am: "Account Management", di: "Digital Infrastructure",
  sys: "Administration",
};
export const ROLE: Record<ImRoleKey, ImRole> = {
  head: { tm: "fin", t: "Head of Finance", can: ["view", "bank", "pii", "pay", "doc", "tkt", "refund", "team", "farm", "assign", "upd", "details"] },
  ops: { tm: "fin", t: "Finance Operations", can: ["view", "bank", "pay", "doc", "tkt", "upd"] },
  comp: { tm: "fin", t: "Compliance & KYC", can: ["view", "pii", "doc", "kyc", "tkt", "upd"] },
  audit: { tm: "fin", t: "Auditor — read only", can: ["view"] },
  amlead: { tm: "am", t: "Head of Account Management", can: ["view", "tkt", "care", "assign", "team", "details", "upd", "field"] },
  kam: { tm: "am", t: "Key Account Manager", can: ["view", "tkt", "care", "details", "upd", "field"] },
  di: { tm: "di", t: "Super user — Digital Infrastructure", can: ["view", "bank", "pii", "pay", "doc", "tkt", "care", "assign", "details", "upd", "field", "refund", "kyc", "team", "log", "sys", "root", "farm"] },
  admin: { tm: "sys", t: "Administrator", can: ["view", "team", "log"] },
  root: { tm: "sys", t: "Super administrator", can: ["view", "team", "log", "sys", "root"] },
};
export const CAN: Record<ImCan, string> = {
  view: "Open the Investors pages", bank: "See bank details", pii: "Reveal PAN and Aadhaar",
  pay: "Record money", doc: "Send and verify documents", tkt: "Work tickets",
  care: "Work an account — log contact, set the next one", assign: "Assign a key account manager",
  details: "Change an investor's own details", upd: "Publish an update to investors",
  field: "Record what is happening on the farm",
  refund: "Approve a refund", kyc: "Pass or fail KYC", team: "Change who is on the team",
  log: "Read the whole activity log", sys: "See both systems and the link between them",
  root: "Run both apps — every log, every seat, no investor data",
  farm: "Release land",
};
/** who the primary doer of each step is — shown to the super user (superNote). A team step names
 *  the team and the seat whose holder is its primary doer; the person's name is read from the record
 *  (`primaryDoer`), never written here. A plain string is the prototype's copy as is. */
export const PRIMARY: Record<string, string | [team: string, seat: ImRoleKey][]> = {
  claim: [["Finance", "head"]], pay: [["Finance", "head"]], send: [["Finance", "head"]],
  verify: [["Finance", "head"], ["Compliance", "comp"]], kyc: [["Compliance", "comp"]], kam: [["Account Management", "amlead"]],
  talk: "the investor's key account manager", tkt: "whoever owns the ticket", upd: "Finance or Account Management", field: "Account Management",
  details: "the investor's key account manager",
};

/* ---- dates and money ---- */
export const DAY = 864e5;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONI: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
export const UNIT = 2500000;
export const FORFEIT = 50000;
/** the BU plan's programme size, read by Numbers (vIns: `target=208*UNIT`) */
export const PROGRAMME_UNITS = 208;

/* ---- identity ---- */
export const SECRETS: RegExp[] = [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, /\bUIDAI-\d{4}-\d{4,}\b/gi, /\b[A-Z]{2,6}\d{6,18}\b/gi, /\b\d{9,18}\b/g];
export const REVWHY: Record<"pan" | "acct", string[]> = {
  pan: ["A filing or a TDS check", "An identity check against a document",
    "An investor query about their own record"],
  acct: ["A payout or a refund", "A name match against a cancelled cheque",
    "An investor query about their own record"],
};

/* ---- account management ---- */
export type ImTier = { k: "A" | "B" | "C"; t: string; min: number; every: number; t2: string; pool: boolean };
export const TIERS: ImTier[] = [
  { k: "A", t: "Tier A", min: 4, every: 30, t2: "a named manager, monthly", pool: false },
  { k: "B", t: "Tier B", min: 2, every: 90, t2: "a named manager, quarterly", pool: false },
  { k: "C", t: "Tier C", min: 1, every: 180, t2: "the shared pool, half-yearly", pool: true },
];
export const MOODS: Record<ImMood, string> = { good: "Warm", ok: "Fine", concern: "A concern" };
export const CHANS: Record<ImChan, string> = { call: "Call", visit: "Farm visit", email: "Email", msg: "WhatsApp" };

/* ---- paper ---- */
export const TPL: ImTpl[] = [
  { t: "Non-disclosure agreement", cls: "Confidentiality" },
  { t: "Supplementary agreement", cls: "Commercial" },
  { t: "Allocation letter", cls: "Commercial" },
  { t: "FEMA declaration", cls: "Regulatory" },
  { t: "Advance receipt", cls: "Financial", noSign: true },
  { t: "Final receipt", cls: "Financial", noSign: true },
  { t: "Power of attorney", cls: "Constitutional", wet: true },
];
export const SIGS = ["Aadhaar OTP", "Class 3 DSC", "Wet signature"];
export const ROUNDS = [
  { k: "nda", t: "NDA", tpl: "Non-disclosure agreement" },
  { k: "supp", t: "Supplementary agreement", tpl: "Supplementary agreement" },
];

/* ---- the land ---- */
export const FSTATE = ["Prepared, not planted", "Year 1 — establishment", "Year 2 — growth",
  "Year 3 — bearing", "Flowering", "Harvest", "Survey pending"];

/* ---- the investor's own details ---- */
export const DETF = { n: "name", ph: "phone", em: "email", city: "city", addr: "address", nominee: "nominee" } as const;

/* ---- the log ---- */
export const KINDS: Record<ImKind, string> = {
  money: "Money", doc: "Documents", pii: "Identity", kyc: "KYC", tkt: "Tickets",
  upd: "Updates", farm: "Land", care: "Account care", admin: "Admin",
};
export const GLYPH: Record<ImKind, string> = { money: "₹", doc: "§", pii: "◉", kyc: "✓", tkt: "◑", upd: "◆", farm: "▲", care: "◈", admin: "⚙" };

/* ---- the app account ---- */
/** days a permanent mark can still be taken back */
export const APPLOCK = 7;

/* ---- reading an IR's claim ---- */
export const CMODE = /\b(RTGS|NEFT|IMPS|SWIFT|UPI|Cheque)\b/i;
export const CREF = /\b([A-Z]{2,6}\d{6,18})\b/;

/* ---- the rail ---- */
export type ImNavItem = { k: ImView; t: string; grp?: string; not?: "sys"; needs?: ImCan[] };
export const NAV: ImNavItem[] = [
  { k: "dash", t: "Dashboard", grp: "Today", not: "sys" },
  { k: "inv", t: "Investors", grp: "The book", not: "sys" },
  { k: "farms", t: "Farms", needs: ["farm", "pay", "doc", "field"] },
  { k: "txn", t: "Transactions", needs: ["pay", "bank"] },
  { k: "docs", t: "Documents", needs: ["doc"], grp: "Paper and people" },
  { k: "tkt", t: "Tickets", needs: ["tkt"] },
  { k: "upd", t: "Updates", not: "sys" },
  { k: "ins", t: "Insights", grp: "Oversight", not: "sys" },
  { k: "sys", t: "System", needs: ["sys"] },
  { k: "act", t: "Activity log" },
  { k: "team", t: "Team" },
];
/** IMX.hot — the pages whose badge is a call to act */
export const HOT: ImView[] = ["dash", "tkt"];

/* ---- the drafts' blank shape (resetDrawerDraft) ---- */
export const BLANK_DRAFTS: ImDrafts = {
  PUTR: "", DREF: "", DTPL: null, DSIG: "Aadhaar OTP", DTID: "", PKIND: "advance", PMODE: "RTGS", DET: {}, KSEL: null,
  TK: { inv: null, cat: "Query", t: "", d: "", pri: "normal" },
  CT: { ch: "call", mood: "good", note: "", next: "" },
  UP: { t: "", cat: "Produce", d: "", to: "all" },
  FD: { blk: "A", st: "", head: "", d: "" },
};
/** the receipt modes the pay drawer offers */
export const PMODES = ["RTGS", "NEFT", "IMPS", "SWIFT", "Cheque"];
/** ticket kinds and priorities the ticket drawer offers */
export const TKCATS = ["Bank", "Compliance", "Records", "Query", "Access"];
export const TKPRI: [ "high" | "normal", string][] = [["high", "High — 2 working days"], ["normal", "Normal — 5 working days"]];
/** update kinds and audiences the update drawer offers */
export const UPCATS = ["Produce", "Statement", "Compliance", "Notice"];
export const UPTO: ["all" | "allocated" | "nri", string][] = [["all", "Everyone on the book"], ["allocated", "Allotted only"], ["nri", "NRI investors"]];
