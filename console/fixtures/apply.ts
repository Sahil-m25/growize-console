/* THE FIXTURE REGISTRY (M19-S03). A fixture is a named change to the demo book the UI-case runner
   asks for after page load (`POST /api/test/fixture/<name>`). Each one ports the `prototype` JS of
   its entry in pm/merge-audit/ui-sahil/fixtures-merged.json:
   - a record edit edits the dataset in place;
   - a write the prototype makes as a person runs the console's own reducer as them (runAs);
   - a clock fixture pins the hour `nowT` reads (CLOCKPIN);
   - what cannot be data (the browser going offline, a session ending, a refused save, which side a
     page opens on) returns client actions the store dispatches once after hydrating;
   - staging / Zoho-only fixtures are explicit no-ops: they belong to ui-staging (phase 2). */

import type { Dataset } from "@/lib/data/types";
import type { Action } from "@/lib/state";
import { initialState } from "@/lib/state";
import { capsFor } from "@/lib/selectors";
import { reviveClock } from "@/lib/data/clock";
import { nowT, pinClock, clockPin, stamp as stampAt } from "@/lib/format";
import { ST } from "@/domain";
import type { Cap, DocRec, Lead, LeadId, LogEntry, MoveReq, NavKey, PaperRow, PersonKey } from "@/domain";
import type { ImDoc, ImInbox, ImInvestor, ImTxn } from "@/lib/im";
import { runAs } from "./run-as";
import { MONEY_FIXTURES } from "./im/money-fixtures";

export type FixtureFn = (ds: Dataset) => void | { actions: Action[] };
/** What `GET /api/data` carries per client action: `fx` names the applied fixture it came from, so the
 *  client runs it once however many times the data reloads. */
export type FixtureAction = { fx: string; a: Action };

/** The demo book already IS this (or the runner does it: NO_DIALER); applying it changes nothing. */
const noop: FixtureFn = () => {};
/** Staging / Zoho / production only — no demo-data meaning; its UI cases are ui-staging (phase 2). */
const staging: FixtureFn = () => {};

const lead = (ds: Dataset, id: string): Lead => {
  const l = ds.LEADS.find((x) => x.id === id);
  if (!l) throw new Error("fixture: no lead " + id);
  return l;
};
const inv = (ds: Dataset, id: string): ImInvestor => {
  const x = ds.im.INV.find((i) => i.id === id);
  if (!x) throw new Error("fixture: no investor " + id);
  return x;
};
/** iso(TODAY) */
const today = (ds: Dataset) => ds.TODAY.slice(0, 10);
/** stamp() — the console's day at the (fixture-pinned or real) hour */
const stamp = (ds: Dataset): string => {
  const was = clockPin();
  pinClock(ds.CLOCKPIN);
  try { return stampAt(nowT(reviveClock(ds.NOW))); } finally { pinClock(was); }
};
const logLine = (ds: Dataset, e: Omit<LogEntry, "d">) => { ds.LOG.unshift({ d: today(ds), ...e } as LogEntry); };

/* Kiran Joshi — the three KIRAN_* fixtures push the same investor and NDA (imx.js fixtures) */
const kiranJoshi = (): ImInvestor => ({
  id: "ARL-INV-0220", n: "Kiran Joshi", ph: "+91 98450 60220", em: "kiran.joshi@gmail.com", city: "Bengaluru",
  addr: "5, 7th Main, HSR Layout, Bengaluru 560102", nri: false, pan: "AKJPJ5520Q", aadh: "6620",
  aref: "UIDAI-2508-900220", kyc: "passed", kycOn: "29 Aug",
  bank: { acct: "50100299002200", ifsc: "HDFC0000240", name: "KIRAN JOSHI", drop: "matched" },
  units: 2, blocks: { A: 2 }, st: "said yes", ir: "rohit", src: "Events", since: "28 Aug",
  nominee: "—", lead: "L21", kam: null, kamOn: null, intro: null,
});
const kiranNda = (): ImDoc => ({
  id: "D-046", inv: "ARL-INV-0220", t: "Non-disclosure agreement", cls: "Confidentiality", state: "signed",
  sent: "20 Aug 10:00", by: "meena", sig: "Aadhaar OTP", ref: "EMU-2008-88010", on: "20 Aug 15:30",
});
const kiranSaidYes = (ds: Dataset) => { ds.im.INV.push(kiranJoshi()); ds.im.DOCS.unshift(kiranNda()); };
const prakashBalance = (rec: ImTxn["rec"]): ImTxn => ({
  id: "T-0049", inv: "ARL-INV-0208", kind: "balance", amt: 2250000, mode: "RTGS", utr: "HDFC2708994",
  on: "28 Aug 11:00", by: "meena", rec,
});

/* capSave('jhalak','leads','view') as Sahil — the real grant write, so the log lines ("Changed
   access", then "Console access granted") are the reducer's own */
const grantJhalakLeads = (ds: Dataset) => {
  if ((ds.GRANT.jhalak?.leads || []).includes("view")) return;   /* a grant, not a toggle: applying it twice leaves it on */
  runAs(ds, "sahil", [{ type: "toggleCap", k: "jhalak" as PersonKey, p: "leads" as NavKey, c: "view" as Cap }]);
};

/* the prototype's CLOCK fixtures replace Date with one whose hour is this, on the console's own day */
const clock = (hm: string): FixtureFn => (ds) => { ds.CLOCKPIN = hm; };
const offline: FixtureFn = () => ({ actions: [{ type: "fixture", k: "offline" }] });

export const FIXTURES: Record<string, FixtureFn> = {
  /* ---- already the demo book ---- */
  DEMO_STAFF: noop,
  DEMO_BOOK: noop,
  DEMO_BOOK__C: noop,
  DEMO_DATA: noop,
  DEMO_DATA__F: noop,
  E04_SHEET_READY: noop,
  L2_NOTE_EVENINGS_ONLY: noop,
  L1_NO_CONSENT: noop,
  L4_NO_NDA: noop,
  L6_RESERVED_BALANCE_REPORTED: noop,
  L7_RESERVED_NO_REPORT: noop,
  L5_SAID_YES_NO_ADVANCE: noop,
  L3_ENGAGED_5_DAYS_AGO: noop,
  L11_QUALIFIED: noop,
  L14_LOST_LOCK_IN: noop,
  ANANYA_ON_LEAVE_NIKHIL_COVERS: noop,
  LEGACY_COPY_ROWS: noop,
  "IM:DEMO_PORTAL": noop,
  "IM:DEMO_BOOK": noop,
  "IM:DEMO_BOOK__C": noop,
  /* the runner already blocks tel: links (a real phone would open the dialer) */
  NO_DIALER: noop,

  /* ---- staging, Zoho or production only (ui-staging, phase 2) ---- */
  ZOHO_TEST_USER: staging,             // a Zoho user and OAuth token
  ZOHO_CONTACT_WITH_IDENTITY: staging, // sandbox records owned by the super admin
  ZOHO_OTHER_OWNER_LEAD: staging,      // Zoho sharing, not demo data
  ZOHO_TEST_LEAD: staging,             // a sandbox lead with the tester's email
  ZOHO_DUP_CHECK_ON: staging,          // a Zoho org setting
  ZOHO_BACKUP_AVAILABLE: staging,      // a Zoho data backup
  STAGING_DEPLOYED: staging,           // a deployment
  STAGING_USERS: staging,              // Zoho seats
  L4_CALL_IN_ZOHO: staging,            // a Zoho Call record with a reminder
  CSV_SAMPLE_FILE: staging,            // a file on the tester's machine, not a record
  LEGACY_CONVERTED_LEADS: staging,     // Zoho-native conversions (Contacts, Deals)
  LOAD_TEST_TOKENS: staging,           // restricted-user tokens, cache and gate
  RESTRICTED_TEST_USER: staging,       // field-level security and Private sharing
  LEADS_FETCH_429: staging,            // a Zoho API response
  PRODUCTION_LIVE: staging,            // production go-live
  "IM:STAGING_SEATS": staging,         // staging seats and FLS
  "IM:ZOHO_UNREACHABLE": staging,      // the live Zoho API going away
  "IM:STEPUP_FAILED_HARSHA": staging,  // a real step-up challenge (no prototype change)
  "IM:KAM_TEST_USER": staging,         // a restricted Zoho user
  "IM:SAMPLE_STATEMENT": staging,      // a CSV file on the tester's machine
  "IM:SANDBOX_DOC_SENT": staging,      // an eMudhra sandbox request
  "IM:SANDBOX_APP_REQUEST": staging,   // a Zoho Portals login
  "IM:SANDBOX_SEAM_USERS": staging,    // restricted users per profile
  "IM:SANDBOX_SEED": staging,          // the sandbox seed

  /* ---- the clock ---- */
  CLOCK_28AUG_1000: clock("10:00"),
  CLOCK_28AUG_1000__E: clock("10:00"),
  CLOCK_28AUG_1536: clock("15:36"),

  /* ---- people and access ---- */
  GOKUL_ACTIVE: (ds) => { ds.PEOPLE.gokul!.on = true; },
  KAVYA_DEACTIVATED: (ds) => { ds.PEOPLE.kavya!.on = false; },
  /* signIn('sahil'); capSave('jhalak','leads','view'); endSession(). Written as the record capSave
     leaves (GRANT.jhalak.leads=['view'] and its two log lines), not through toggleCap: the port's
     SEATCAPS.exec still presets Leads 'view' (the merged prototype's exec preset is {me:['view']}),
     so the same tick run through the port's reducer would REMOVE the page. */
  JHALAK_GRANTED_LEADS: (ds) => grantJhalakLeads(ds),
  JHALAK_HAS_LEADS_VIEW: (ds) => grantJhalakLeads(ds),
  /* GRANT.rohit={...GRANT.rohit, leads:[...capsFor('rohit','leads'),'all']} */
  ROHIT_GRANTED_ALL_LEADS: (ds) => {
    const caps = capsFor(initialState(ds), "rohit", "leads");
    ds.GRANT.rohit = { ...(ds.GRANT.rohit || {}), leads: [...caps, "all" as Cap] };
  },

  /* ---- the lead book ---- */
  L6_HOLD_ENDS_30AUG: (ds) => { ds.PAY.L6!.hold = "30 Aug"; },
  L4_MOVE_REQUESTED_TO_NIKHIL: (ds) => {
    ds.REQ.L4 = { by: "rohit", at: "28 Aug 15:30", to: "nikhil", why: "Load rebalancing", state: "waiting" } as MoveReq;
  },
  L2_NDA_SENT_BY_FINANCE: (ds) => {
    ds.PAPER.L2 = { nda: { sent: { by: "harsha", at: "24 Sep 10:00", via: "Zoho Sign" }, chase: [] } } as PaperRow;
  },
  L2_NDA_TOLD_BY_WHATSAPP: (ds) => {
    ds.PAPER.L2 = { nda: { sent: { by: "harsha", at: "24 Sep 10:00", via: "Zoho Sign" },
      told: { by: "rohit", at: "24 Sep 10:30", ch: "msg" }, chase: [] } } as PaperRow;
  },
  L2_NO_EMAIL_CONSENT: (ds) => { lead(ds, "L2").con = { call: true, msg: true, email: false, visit: false } as Lead["con"]; },
  L5_SUPP_NOT_STARTED: (ds) => { if (ds.PAPER.L5) delete ds.PAPER.L5.supp; },
  L5_SUPP_DRAFT_V1: (ds) => {
    ds.PAPER.L5 = { ...(ds.PAPER.L5 || {}),
      supp: { draft: { by: "kavya", at: "24 Sep 11:00", link: "https://writer.zoho.in/SUPP-L5-v1", v: 1 }, chase: [] } } as PaperRow;
  },
  L11_DECK_NOT_SENT: (ds) => { if (ds.SENT.L11) delete ds.SENT.L11["Pitch deck"]; },
  L4_NO_NEXT_STEP: (ds) => { lead(ds, "L4").nx = null; },
  L4_NDA_DOC_WAITING: (ds) => {
    ds.DOCS.push({ lead: "L4" as LeadId, id: "D-099", t: "Non-disclosure agreement", cls: "Confidentiality",
      state: "sent", on: "23 Aug 20:12", by: "harsha", how: null, ref: null } as DocRec);
  },
  /* signIn('rohit'); go('event',null,'E-04'); loadSheet('E-04'); endSession() */
  E04_SHEET_LOADED_BY_ROHIT: (ds) => runAs(ds, "rohit", [{ type: "loadSheet", ev: "E-04" }]),
  UPDATES_TODAY_L4_L5: (ds) => {
    logLine(ds, { at: "28 Aug 18:01", who: "rohit", what: "Call logged", lead: "L4", note: "", kind: "call" } as Omit<LogEntry, "d">);
    logLine(ds, { at: "28 Aug 18:02", who: "kavya", what: "Call logged", lead: "L5", note: "", kind: "call" } as Omit<LogEntry, "d">);
    logLine(ds, { at: "28 Aug 18:03", who: "harsha", what: "NDA signed copy verified", lead: "L4", note: "", kind: "doc" } as unknown as Omit<LogEntry, "d">);
  },
  ROHIT_ACCESS_CHANGED_BY_SAHIL: (ds) => {
    logLine(ds, { at: "28 Aug 18:05", who: "sahil", what: "Changed access", lead: null,
      note: "Rohit Deshpande · Numbers · view granted", kind: "admin", about: ["rohit"] } as Omit<LogEntry, "d">);
  },
  ROHIT_CALL_ON_L5: (ds) => {
    logLine(ds, { at: "28 Aug 18:06", who: "rohit", what: "Call logged", lead: "L5", note: "cover", kind: "call" } as Omit<LogEntry, "d">);
  },
  /* after sign-in: assign(Ritu Anand,'kavya') — by the manager the case signs in as */
  RITU_ASSIGNED_TO_KAVYA_TODAY: (ds) => {
    const l = ds.LEADS.find((x) => x.n === "Ritu Anand");
    if (!l) throw new Error("fixture: no Ritu Anand");
    runAs(ds, "tasneem", [{ type: "assign", id: l.id, to: "kavya" as PersonKey }]);
  },
  /* l.done=ST.CONVERTED; l.at[4]=stamp() */
  GIRISH_SAID_YES_TODAY: (ds) => {
    const l = lead(ds, "L3");
    l.done = ST.CONVERTED;
    l.at[4] = stamp(ds) as Lead["at"][number];
  },
  /* closeLost('L5','Price too high','test') — by the manager the case signs in as */
  DEEPA_LOST_AFTER_YES: (ds) => runAs(ds, "tasneem", [{ type: "closeLost", id: "L5" as LeadId, why: "Price too high", note: "test" }]),
  NO_TRANSFERS: (ds) => { for (const l of ds.LEADS) if (l.done >= ST.CONVERTED) l.done = ST.ENGAGED; },

  /* ---- what cannot be data: client actions ---- */
  BROWSER_OFFLINE: offline,
  BROWSER_OFFLINE__F: offline,
  "IM:BROWSER_OFFLINE": offline,
  /* signIn('kavya'); signOut('expired') */
  KAVYA_SESSION_EXPIRED: () => ({ actions: [{ type: "signIn", k: "kavya" }, { type: "signOut", why: "expired" }] }),
  /* window.signIn = k => { signIn(k); FAILNEXT = true } */
  NEXT_SAVE_REFUSED: () => ({ actions: [{ type: "fixture", k: "failNextOnSignIn" }] }),
  /* Object.assign(MSIDE,{today:'im',activity:'im',numbers:'im',system:'im'}) */
  SIDE_INVESTORS: () => ({
    actions: (["today", "activity", "numbers", "system"] as const).map((k) => ({ type: "setSide", k, s: "im" }) as Action),
  }),

  /* ---- the Investors side (IMX.evalIn) ---- */
  "IM:HOLD_EXPIRED_PRAKASH": (ds) => { inv(ds, "ARL-INV-0208").hold = "30 Aug"; },
  "IM:REVEAL_BY_HARSHA": (ds) => {
    ds.im.LOG.unshift({ at: "01 Sep 16:10", who: "harsha", what: "Revealed a PAN", inv: "ARL-INV-0208",
      note: "A filing or a TDS check", kind: "pii" });
  },
  "IM:MEENA_RECORDED_PRAKASH_BALANCE": (ds) => { ds.im.TXN.unshift(prakashBalance("pending")); ds.im.TSEQ = 49; },
  "IM:PRAKASH_SUPP_UNSIGNED": (ds) => {
    const d = ds.im.DOCS.find((x) => x.id === "D-037");
    if (!d) throw new Error("fixture: no D-037");
    d.state = "awaiting"; d.ref = null; d.on = null as unknown as string; d.exp = "09 Sep";
  },
  "IM:PRAKASH_HOLD_RAN_OUT": (ds) => {
    inv(ds, "ARL-INV-0208").hold = "30 Aug";
    ds.im.ANS["N-08"] = { state: "notfound", by: "harsha", at: "31 Aug 10:00", why: "Not in the account yet" };
  },
  "IM:PRAKASH_PAID_LETTER_OUT": (ds) => {
    ds.im.TXN.unshift(prakashBalance("matched")); ds.im.TSEQ = 49;
    const x = inv(ds, "ARL-INV-0208");
    x.st = "paid"; delete x.hold;
    ds.im.ANS["N-08"] = { state: "confirmed", by: "harsha", at: "28 Aug 11:05" };
    const a = ds.im.APP["ARL-INV-0208"];
    if (!a) throw new Error("fixture: no app account for ARL-INV-0208");
    a.hist.unshift({ to: a.mark, from: a.markAt, until: "28 Aug 11:05", by: a.markBy });
    a.mark = "permanent"; a.markAt = "28 Aug 11:05"; a.markBy = "harsha";
    ds.im.DOCS.unshift({ id: "D-045", inv: "ARL-INV-0208", t: "Allocation letter", cls: "Commercial", state: "awaiting",
      sent: "28 Aug 12:00", by: "harsha", sig: "Aadhaar OTP", ref: null, exp: "11 Sep" });
    ds.im.DSEQ = 45;
  },
  "IM:JOSEPH_LETTER_OUT": (ds) => {
    ds.im.DOCS.unshift({ id: "D-045", inv: "ARL-INV-0209", t: "Allocation letter", cls: "Commercial", state: "awaiting",
      sent: "28 Aug 12:00", by: "harsha", sig: "Class 3 DSC", ref: null, exp: "11 Sep" });
    ds.im.DSEQ = 45;
  },
  "IM:KIRAN_ON_FULL_BLOCK_B": (ds) => {
    const b = ds.im.FARMS.find((f) => f.k === "B");
    if (!b) throw new Error("fixture: no block B");
    b.released = 11;
    ds.im.INV.push({ id: "ARL-INV-0220", n: "Kiran Rao", ph: "+91 90000 11220", em: "kiran.rao@gmail.com", city: "Bengaluru",
      addr: "1, MG Road, Bengaluru 560001", nri: false, pan: "AKRPR1234K", aadh: "1111", aref: "UIDAI-2508-100220",
      kyc: "passed", kycOn: "01 Sep",
      bank: { acct: "50100000220220", ifsc: "HDFC0000001", name: "KIRAN RAO", drop: "matched" },
      units: 2, blocks: { B: 2 }, st: "new" as ImInvestor["st"], ir: "rohit", src: "Events", since: "01 Sep", nominee: "—" });
    ds.im.DOCS.unshift({ id: "D-045", inv: "ARL-INV-0220", t: "Supplementary agreement", cls: "Commercial", state: "signed",
      sent: "01 Sep 10:00", by: "harsha", sig: "Aadhaar OTP", ref: "EMU-0109-80001", on: "01 Sep 12:00" });
    ds.im.DSEQ = 45;
  },
  "IM:KIRAN_SAID_YES": (ds) => kiranSaidYes(ds),
  "IM:KIRAN_SUPP_SAID_SIGNED": (ds) => {
    kiranSaidYes(ds);
    ds.im.DOCS.unshift({ id: "D-047", inv: "ARL-INV-0220", t: "Supplementary agreement", cls: "Commercial", state: "awaiting",
      sent: "27 Aug 11:00", by: "harsha", sig: "Aadhaar OTP", ref: null, exp: "10 Sep" });
    ds.im.INBOX.unshift({ id: "N-09", inv: "ARL-INV-0220", kind: "signed", doc: "supp", at: "01 Sep 18:10", ir: "rohit",
      state: "seen", t: "They say the supplementary is signed and sent", d: "Signed on his phone this evening." } as ImInbox);
  },
  "IM:KIRAN_SUPP_VERIFIED": (ds) => {
    kiranSaidYes(ds);
    ds.im.DOCS.unshift({ id: "D-047", inv: "ARL-INV-0220", t: "Supplementary agreement", cls: "Commercial", state: "signed",
      sent: "27 Aug 11:00", by: "harsha", sig: "Aadhaar OTP", ref: "EMU-0109-88990", on: "01 Sep 12:00", vby: "meena" });
  },
  "IM:PRAKASH_ALLOCATION_OUT": (ds) => {
    ds.im.DOCS.unshift({ id: "D-048", inv: "ARL-INV-0208", t: "Allocation letter", cls: "Commercial", state: "awaiting",
      sent: "01 Sep 10:00", by: "harsha", sig: "Aadhaar OTP", ref: null, exp: "15 Sep" });
  },
  ...MONEY_FIXTURES,                   // later decisions' demo states (fixtures/im/money-fixtures.ts)
  "IM:TK0114_HANDED": (ds) => {
    const t = ds.im.TKT.find((x) => x.id === "TK-0114");
    if (!t) throw new Error("fixture: no TK-0114");
    t.own = "meena"; t.handed = { by: "imran", at: "01 Sep 16:00" };
  },
};

/** Apply `names` in order to a copy of `ds`. An unregistered name is skipped (the registry test keeps
 *  every catalogue entry registered). Client actions come back tagged with the fixture they belong to. */
export function applyFixtures(ds: Dataset, names: string[]): { ds: Dataset; actions: FixtureAction[] } {
  const out = structuredClone(ds);
  const actions: FixtureAction[] = [];
  names.forEach((n, i) => {
    const r = FIXTURES[n]?.(out);
    if (r && Array.isArray(r.actions)) r.actions.forEach((a, j) => actions.push({ fx: `${i}:${n}:${j}`, a }));
  });
  return { ds: out, actions };
}
