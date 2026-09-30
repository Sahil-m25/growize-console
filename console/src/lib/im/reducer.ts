/* ── im/reducer.ts — THE WRITES (imx.js section 7, lines 705–1271) and section 8's state ─────
   `imReducer(s, WHO, a)` is the prototype's mutators, one case each. Every write checks the same two
   things the prototype checks — does this seat hold the right, and does the ledger allow it — via
   the gates in rules.ts, then mutates a structured clone of the state exactly as the prototype
   mutated its globals. Nothing reads the wall clock: stamps and dates come from `data.NOW`.

   alert(msg)   → ui.NOTE = {kind:"refuse", msg}
   confirm(msg) → ui.NOTE = {kind:"ask", msg}, ui.PENDING = the action; the write stops.
                  {type:"confirmYes"} replays PENDING with the confirmation granted.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { APPLOCK, BLANK_DRAFTS, CHANS, CMODE, CREF, DETF, MOODS, ROLE, SECRETS, TPL, UNIT } from "./constants";
import { day6, inr, money, plusDays, stamp, when } from "./dates";
import {
  I, bookOf, cared, dueBy, drawerReadable, finSeats, gotBy, isAM, isSuper, may, mayDetails, maySeat,
  mayTkt, nOpen, pageReadable, role, tierOf, who, withholdKnown,
} from "./selectors";
import {
  allotGate, holdBlockGate, lapseGate, logContactGate, matchGate, recordPayGate, sendDocGate, setMarkGate,
} from "./rules";
import type { ImAction, ImApp, ImData, ImDrafts, ImInvestor, ImKind, ImState, ImUi } from "./types";
import { allotPickGate, allotReceiptAmt, openHeld } from "./money";
import { isMoneyAction, moneyRun } from "./money-reducer";
import { isPaper2, paper2Run } from "./paper2-reducer";

/* ---- the blank UI (the prototype's `let` initialisers) ---- */
export function initialImUi(): ImUi {
  return {
    VIEW: "dash", SEL: null, SEC: {}, IQ: "", IFILT: null, TFILT: null, KFILT: "open",
    LOGWHO: null, LOGKIND: null, DRW: null, drafts: structuredClone(BLANK_DRAFTS), DRAWERDRAFTS: {},
    DRAFTCTX: null, SHOWN: {}, REVASK: null, NOTE: null, PENDING: null,
  };
}
export function emptyImData(nowIso: string): ImData {
  return {
    NOW: nowIso, P: {}, SIGNINS: [], IRN: {}, FARMS: [], INV: [], CONTACT: [], TXN: [], DOCS: [], INBOX: [], ANS: {},
    OUTBOX: [], TKT: [], FIELD: [], UPD: [], LOG: [], APP: {}, TSEQ: 0, DSEQ: 0, KSEQ: 0, FSEQ: 0, USEQ: 0,
  };
}

/* ---- the app account (appOpen, seedApp: imx.js 914–933) ---- */
function appOpen(d: ImData, id: string, at: string): ImApp {
  if (d.APP[id]) return d.APP[id];
  d.APP[id] = { at, welcome: { at, ch: "email" }, mark: "tentative", markAt: at, markBy: null, hist: [] };
  return d.APP[id];
}
/** Derive every app account from the receipts on file: open on the first, permanent on the last
 *  when nothing is outstanding. Exactly what recordPay does live. Returns new data. */
export function seedApp(data: ImData): ImData {
  const d = structuredClone(data);
  d.INV.forEach(x => {
    const t = d.TXN.filter(y => y.inv === x.id && y.kind !== "refund" && y.kind !== "forfeit")
      .slice().sort((a, b) => (whenMs(d, a.on) || 0) - (whenMs(d, b.on) || 0));
    if (!t.length) return;
    const a = appOpen(d, x.id, t[0].on);
    const got = t.reduce((s, y) => s + y.amt, 0);
    const due = x.st !== "lapsed" ? Math.max(0, x.units * UNIT - got) : 0;
    if (due <= 0) {
      const last = t[t.length - 1];
      a.hist.unshift({ to: "tentative", from: a.markAt, until: last.on, by: null });
      a.mark = "permanent"; a.markAt = last.on; a.markBy = last.by;
    }
  });
  return d;
}
const whenMs = (d: ImData, t: string) => when(d.NOW, t);

/** IMX.align — name the lead side's people so a raw key never reaches a sentence. Returns new data. */
export function imAlign(data: ImData, people: Record<string, { n: string; i: string }>): ImData {
  const d = structuredClone(data);
  Object.keys(people).forEach(k => { if (!d.P[k]) d.IRN[k] = { n: people[k].n, i: people[k].i, x: true }; });
  return d;
}

/* ---- the reducer ---- */
export function imReducer(s: ImState, WHO: string, a: ImAction): ImState {
  if (a.type === "noteClose") return s.ui.NOTE ? { ...s, ui: { ...s.ui, NOTE: null, PENDING: null } } : s;
  if (a.type === "note") return { ...s, ui: { ...s.ui, NOTE: { kind: "refuse", msg: a.msg }, PENDING: null } };
  if (a.type === "confirmYes") {
    const p = s.ui.NOTE && s.ui.NOTE.kind === "ask" ? s.ui.PENDING : null;
    if (!p) return s;
    return run({ ...s, ui: { ...s.ui, NOTE: null, PENDING: null } }, WHO, p, true);
  }
  return run(s, WHO, a, false);
}

function run(s0: ImState, WHO: string, a: ImAction, confirmed: boolean): ImState {
  const W: ImState = { data: structuredClone(s0.data), ui: structuredClone(s0.ui) };
  const d = W.data, u = W.ui;
  const T = () => stamp(d.NOW);
  const alert = (msg: string) => { u.NOTE = { kind: "refuse", msg }; u.PENDING = null; };
  const confirm = (msg: string) => { if (confirmed) return true; u.NOTE = { kind: "ask", msg }; u.PENDING = a; return false; };
  const refuse = (g: { ok: boolean; msg?: string | null }) => { if (!g.ok && g.msg) alert(g.msg); return !g.ok; };
  /* CLAUDE.md rule 7: identity never reaches the log. The prototype masked at read (safeNote);
     here a note is also scrubbed of every PAN, Aadhaar reference and account number on the book,
     and of the PAN / UIDAI shapes, before it is written. */
  const scrub = (t: string) => {
    let out = withholdKnown(t, d.INV.flatMap(x => [x.pan, x.aref, (x.bank || { acct: "" }).acct]), "••••••");
    SECRETS.slice(0, 2).forEach(re => { out = out.replace(re, "••••••"); });
    return out;
  };
  const log = (what: string, inv: string | null, note: string, kind: ImKind) =>
    d.LOG.unshift({ at: T(), who: WHO, what, inv: inv || null, note: scrub(note || ""), kind: kind || "admin" });
  const Ix = (id: string | null | undefined): ImInvestor | null => I(W, WHO, id);

  /* ---- drafts (stashDrawerDraft / resetDrawerDraft / activateDrawerDraft: imx.js 2879–2892) ---- */
  const stash = () => { if (u.DRAFTCTX) u.DRAWERDRAFTS[u.DRAFTCTX] = structuredClone(u.drafts); };
  const reset = () => { u.drafts = structuredClone(BLANK_DRAFTS); };
  const activate = (k: string, id: string | null | undefined) => {
    const key = WHO + "|" + k + "|" + (id || ""); if (key === u.DRAFTCTX) return;
    stash(); reset(); u.DRAFTCTX = key;
    const dd = u.DRAWERDRAFTS[key]; if (dd) u.drafts = structuredClone(dd);
  };
  const setDraft = (p: Partial<ImDrafts>) => { u.drafts = { ...u.drafts, ...structuredClone(p) }; };

  /* ---- writes that other writes call ---- */
  function recordPay(id: string, kind: "advance" | "balance", mode?: string, utr?: string, claimId?: string, allot?: string) {
    const g = recordPayGate(W, WHO, id, kind);
    if (refuse(g) || !g.ok) return;
    if (refuse(allotPickGate(W, WHO, id, allot, kind))) return;     /* M10-S07: one allotment per receipt */
    const x = Ix(id)!, amt = allotReceiptAmt(W, WHO, id, allot, kind) ?? g.amt!;   /* several farms: this farm's share */
    const ref = (utr || "").trim().toUpperCase() || "—";
    d.TXN.unshift({ id: "T-" + String(++d.TSEQ).padStart(4, "0"), inv: id, kind, amt, mode: mode || "RTGS",
      utr: ref, on: T(), by: WHO, rec: "matched", ...(allot ? { Allotment: allot } : {}) });
    if (kind === "advance") { x.st = "reserved"; x.hold = plusDays(d.NOW, 30); }
    else if (dueBy(W, WHO, id) > 0) { /* another farm still owes — stays reserved (M10-S08) */ }
    else { x.st = "paid"; delete x.hold; }
    const fresh = !d.APP[id];
    const ap = appOpen(d, id, T());
    if (fresh) openHeld(d, id);                                    /* D93: it opens On hold, no email */
    if (fresh) log("Growize account created", id, "automatic on the confirmed receipt · on hold — data synced, "
      + "sign-in locked, no email sent · tentative until the balance lands", "money");
    if (dueBy(W, WHO, id) <= 0 && ap.mark !== "permanent") {
      ap.hist.unshift({ to: ap.mark, from: ap.markAt, until: T(), by: ap.markBy });
      ap.mark = "permanent"; ap.markAt = T(); ap.markBy = WHO;
      log("Marked the account permanent", id, "paid in full — " + APPLOCK + " days to take it back", "money");
    }
    if (claimId) d.ANS[claimId] = { state: "confirmed", by: WHO, at: T() };
    d.OUTBOX.unshift({ at: T(), inv: id, t: (kind === "advance" ? "Advance received"
      : gotBy(W, WHO, id) > amt ? "Balance received" : "Paid in full") + " · " + money(amt), by: WHO });
    log("Recorded a receipt", id, (kind === "advance" ? "10% advance" : "Balance") + " · " + inr(amt)
      + " · " + (mode || "RTGS") + " " + ref, "money");
    u.drafts.PUTR = ""; u.DRW = null;
  }
  function allot(x: ImInvestor) {
    if (refuse(allotGate(W, WHO, x))) return;
    x.st = "allocated";
    log("Allotted the units", x.id, x.units + " unit" + (x.units > 1 ? "s" : "") + " · "
      + Object.entries(x.blocks).map(([k, n]) => "Block " + k + " ×" + n).join(", "), "farm");
    d.OUTBOX.unshift({ at: T(), inv: x.id, t: "Allotted — " + x.units + " unit" + (x.units > 1 ? "s" : ""), by: WHO });
    const Tr = tierOf(x)!;
    log("Under account management", x.id, Tr.t + " — " + Tr.t2, "care");
  }

  if (isPaper2(a)) return paper2Run(W, WHO, a, { T, log, alert, confirm });   /* M12-S02, M12-S05 */
  if (isMoneyAction(a)) { moneyRun(W, WHO, a, { T, alert, confirm, log }); return W; }

  switch (a.type) {
    /* ---------------- identity ---------------- */
    case "reveal": {
      if (!Ix(a.id) || !["pan", "acct"].includes(a.f)) break;
      if (a.f === "pan" && !may(W, WHO, "pii")) break;
      if (a.f === "acct" && !may(W, WHO, "bank")) break;
      if (!a.why) { u.REVASK = { id: a.id, f: a.f }; break; }
      u.SHOWN[WHO + "|" + a.id + ":" + a.f] = true; u.REVASK = null;
      log("Revealed " + (a.f === "pan" ? "a PAN" : "a bank account"), a.id, a.why, "pii");
      break;
    }
    case "hideAll": u.SHOWN = {}; u.REVASK = null; break;
    case "revCancel": u.REVASK = null; break;

    /* ---------------- the land ---------------- */
    case "logField": {
      if (!may(W, WHO, "field")) break;
      const f = d.FARMS.find(x => x.k === a.blk); if (!f) break;
      if (!a.head || !a.head.trim()) break;
      d.FIELD.unshift({ id: "F-" + String(++d.FSEQ).padStart(2, "0"), blk: a.blk, at: T(), by: WHO,
        st: a.st || f.crop, head: a.head.trim(), d: (a.d || "").trim() });
      if (a.st && a.st !== f.crop) {
        const was = f.crop; f.crop = a.st;
        log("Changed what a block is doing", null, f.n + " · " + was + " → " + a.st, "farm");
      }
      log("Recorded farm progress", null, f.n + " · " + a.head.trim(), "farm");
      u.drafts.FD = { blk: a.blk, st: "", head: "", d: "" }; u.DRW = null;
      break;
    }
    case "releaseBlock": {
      if (!may(W, WHO, "farm")) break;
      const f = d.FARMS.find(x => x.k === a.k); if (!f || f.released >= f.units) break;
      f.released = f.units; f.by = WHO; f.at = T();
      log("Released land", null, f.n + " · " + f.units + " units sellable", "farm");
      break;
    }
    case "holdBlock": {
      if (refuse(holdBlockGate(W, WHO, a.k))) break;
      const f = d.FARMS.find(x => x.k === a.k)!;
      f.released = 0; f.by = WHO; f.at = T();
      log("Took land off the shelf", null, f.n, "farm");
      break;
    }

    /* ---------------- the investor's own details ---------------- */
    case "saveDetails": {
      const x = Ix(a.id); if (!x) break;
      if (!mayDetails(W, WHO, x)) {
        if (may(W, WHO, "details") && who(W, WHO).r === "kam")
          alert(x.n + (x.kam ? " is " + who(W, x.kam).n + "'s account" : " has no manager") + ". Details are changed by "
            + "whoever holds the account, because they are the person the investor told.");
        break;
      }
      const DET = u.drafts.DET;
      const ch: { k: keyof typeof DETF; was: string; now: string }[] = [];
      (Object.keys(DETF) as (keyof typeof DETF)[]).forEach(k => {
        const v = DET[k] == null ? null : String(DET[k]).trim();
        if (v == null || v === String(x[k] || "")) return;
        if (!v && k !== "nominee") return;
        ch.push({ k, was: x[k] || "—", now: v });
      });
      if (!ch.length) { u.drafts.DET = {}; u.DRW = null; break; }
      const nameChanged = ch.some(c => c.k === "n");
      ch.forEach(c => { x[c.k] = c.now; });
      log("Changed the investor's details", a.id, ch.map(c => DETF[c.k] + ": " + c.was + " → " + c.now).join(" · "), "admin");
      if (nameChanged) {
        if ((x.bank || { drop: "" }).drop === "matched") x.bank.drop = "pending";
        const fs = finSeats(W);
        d.TKT.unshift({ id: "TK-" + String(++d.KSEQ).padStart(4, "0"), inv: a.id,
          t: "Re-run the bank name match after a name change", cat: "Compliance",
          opened: T(), by: "system", own: (fs.find(k => d.P[k].r === "ops") || fs[0] || WHO),
          pri: "high", state: "open", sla: "2 working days",
          d: "The name on the record changed to \"" + x.n + "\". Until the account name is matched again a "
            + "payout will bounce." });
        log("Opened a ticket", a.id, d.TKT[0].id + " · bank name match after a name change", "tkt");
      }
      u.drafts.DET = {}; u.DRW = null;
      break;
    }

    /* ---------------- money ---------------- */
    case "setMark": {
      const g = setMarkGate(W, WHO, a.id, a.to);
      if (refuse(g) || !g.ok) break;
      if (g.ask && !confirm(g.ask)) break;
      const ap = d.APP[a.id];
      ap.hist.unshift({ to: ap.mark, from: ap.markAt, until: T(), by: ap.markBy });
      ap.mark = a.to; ap.markAt = T(); ap.markBy = WHO;
      log(a.to === "permanent" ? "Marked the account permanent" : "Took the account back to tentative", a.id,
        a.to === "permanent" ? "the holding is settled" : "outstanding again — " + inr(dueBy(W, WHO, a.id)), "money");
      break;
    }
    case "recordPay": recordPay(a.id, a.kind, a.mode, a.utr, a.claimId, a.allot); break;
    case "confirmClaim": {
      if (!may(W, WHO, "pay")) break;
      const n = d.INBOX.find(x => x.id === a.nid); if (!n || !nOpen(W, n)) break;
      if (!Ix(n.inv)) break;
      const txt = (n.d || "") + " " + (n.t || "");
      const mode = (txt.match(CMODE) || [])[1];
      const ref = (txt.match(CREF) || [])[1];
      const full = /\bin full\b|\bbalance\b/i.test(txt) || gotBy(W, WHO, n.inv) > 0;
      recordPay(n.inv, full ? "balance" : "advance", mode ? mode.toUpperCase() : "RTGS", ref || "", a.nid);
      break;
    }
    case "rejectClaim": {
      if (!may(W, WHO, "pay")) break;
      const n = d.INBOX.find(x => x.id === a.nid); if (!n || !nOpen(W, n)) break;
      d.ANS[a.nid] = { state: "notfound", by: WHO, at: T(), why: a.why || "Not in the account yet" };
      const w = d.ANS[a.nid].why!;
      d.OUTBOX.unshift({ at: T(), inv: n.inv, t: "Could not find that payment — " + w, by: WHO });
      log("Could not find a payment", n.inv, w + " · claimed by " + who(W, n.ir).n, "money");
      break;
    }
    case "matchReceipt": {                        /* NOT IN IMX — see matchGate */
      const t = d.TXN.find(x => x.id === a.tid);
      if (refuse(matchGate(W, WHO, t)) || !t) break;
      t.rec = "matched"; t.mby = WHO; t.mat = T();
      log("Matched a receipt", t.inv, t.id + " · " + t.kind + " · " + inr(t.amt), "money");
      if (!d.APP[t.inv] && t.kind !== "refund" && t.kind !== "forfeit") {   /* the first confirmed money opens the account, On hold (D10, D93) */
        appOpen(d, t.inv, T()); openHeld(d, t.inv);
        log("Growize account created", t.inv, "on the first matched receipt · on hold — data synced, sign-in locked, no email sent", "money");
      }
      break;
    }
    case "lapseHold": {
      const g = lapseGate(W, WHO, a.id);
      if (refuse(g) || !g.ok) break;
      if (!confirm(g.ask!)) break;
      const x = Ix(a.id)!, fee = g.fee!, back = g.back!;
      d.TXN.unshift({ id: "T-" + String(++d.TSEQ).padStart(4, "0"), inv: a.id, kind: "forfeit", amt: 0, mode: "—",
        utr: "—", on: T(), by: WHO, rec: "matched", note: inr(fee) + " retained" });
      d.TXN.unshift({ id: "T-" + String(++d.TSEQ).padStart(4, "0"), inv: a.id, kind: "refund", amt: back, mode: "NEFT",
        utr: "—", on: T(), by: WHO, rec: "pending" });
      x.st = "lapsed"; delete x.hold; x.blocks = {};
      log("Reservation lapsed", a.id, x.units + " unit" + (x.units > 1 ? "s" : "") + " released · " + inr(fee)
        + " forfeit, " + inr(back) + " refunded", "money");
      d.OUTBOX.unshift({ at: T(), inv: a.id, t: "Reservation lapsed — units back on the shelf", by: WHO });
      break;
    }

    /* ---------------- paper ---------------- */
    case "sendDocNow": {
      const t = TPL.find(y => y.t === a.tpl);
      if (refuse(sendDocGate(W, WHO, a.id, a.tpl, a.sig, t)) || !t) break;
      const now = T();
      d.DOCS.unshift({ id: "D-" + String(++d.DSEQ).padStart(3, "0"), inv: a.id, t: a.tpl, cls: t.cls,
        state: t.noSign ? "issued" : "awaiting", sent: now, by: WHO, sig: t.noSign ? null : a.sig,
        ref: t.noSign ? "RCT-" + day6(now).replace(" ", "") + "-" + a.id.slice(-4) : null,
        exp: t.noSign ? null : plusDays(d.NOW, 14) });
      d.OUTBOX.unshift({ at: now, inv: a.id, t: a.tpl + " sent for signature", by: WHO });
      log("Sent document", a.id, a.tpl + (t.noSign ? "" : " · " + a.sig), "doc");
      u.drafts.DTPL = null; u.DRW = null;
      break;
    }
    case "verifyDoc": {
      if (!may(W, WHO, "doc")) break;
      const dc = d.DOCS.find(x => x.id === a.did); if (!dc || dc.state === "signed") break;
      const x = Ix(dc.inv); if (!x) break;
      dc.state = "signed"; dc.on = T(); dc.ref = (a.ref || "").trim() || dc.ref || "EMU-" + day6(T()).replace(" ", "");
      dc.vby = WHO; delete dc.why;
      if (dc.t === "FEMA declaration" && x.fema === "outstanding") {
        delete x.fema;
        log("Cleared the FEMA declaration", x.id, "signed copy on file", "kyc");
      }
      if (dc.t === "Allocation letter") allot(x);
      d.OUTBOX.unshift({ at: T(), inv: dc.inv, t: dc.t + " verified — signed copy on file", by: WHO });
      log("Verified the signed copy", dc.inv, dc.t + " · " + dc.ref, "doc");
      u.drafts.DREF = ""; u.DRW = null;
      break;
    }
    case "blockDoc": {
      if (!may(W, WHO, "doc")) break;
      const dc = d.DOCS.find(x => x.id === a.did);
      /* M12-S07: a verified paper can be blocked too (D77) — but only with a reason of its own */
      if (!dc || !Ix(dc.inv) || (dc.state === "signed" && !(a.why || "").trim()) || dc.state === "blocked") break;
      dc.state = "blocked"; dc.why = a.why || "Nothing has come back signed"; dc.on = T(); dc.vby = WHO;
      d.OUTBOX.unshift({ at: T(), inv: dc.inv, t: dc.t + " — nothing has come back signed", by: WHO });
      log("Marked a document blocked", dc.inv, dc.t + " · " + dc.why, "doc");
      u.DRW = null;
      break;
    }
    case "passKyc": {
      if (!may(W, WHO, "kyc")) break;
      u.DRW = null;
      const x = Ix(a.id); if (!x || x.kyc === "passed") break;
      if (!x.pan) { alert("There is no PAN on this record. KYC cannot pass without one."); break; }
      if (!x.nri && !x.aadh) { alert("No Aadhaar verification reference on this record."); break; }
      x.kyc = "passed"; x.kycOn = day6(T());
      log("Passed KYC", a.id, "PAN verified" + (x.aadh ? ", Aadhaar matched" : ", NRI — passport route"), "kyc");
      d.OUTBOX.unshift({ at: T(), inv: a.id, t: "KYC passed", by: WHO });
      break;
    }
    case "failKyc": {
      if (!may(W, WHO, "kyc")) break;
      const x = Ix(a.id); if (!x || x.kyc === "failed") break;
      if (x.kyc === "passed" && !confirm("KYC on " + x.n + " was passed on " + x.kycOn + ".\n\nFailing it now "
        + "blocks allotment and stays on the record. Only do this if something has actually changed.")) break;
      x.kyc = "failed"; x.kycWhy = a.why || "Documents do not match"; x.kycOn = day6(T());
      log("Failed KYC", a.id, x.kycWhy, "kyc");
      d.OUTBOX.unshift({ at: T(), inv: a.id, t: "KYC failed — " + x.kycWhy, by: WHO });
      u.DRW = null;
      break;
    }

    /* ---------------- tickets and updates ---------------- */
    case "handToFinance": {
      const t = d.TKT.find(x => x.id === a.id);
      if (!t || !Ix(t.inv) || !may(W, WHO, "tkt") || !((isAM(W, WHO) && t.own === WHO) || isSuper(W, WHO))) break;
      const fs = finSeats(W);
      const to = fs.find(k => d.P[k].r === "ops") || fs[0];
      if (!to) { alert("There is nobody on the Finance team to hand this to."); break; }
      const was = t.own; t.own = to; t.handed = { by: isSuper(W, WHO) ? WHO : was, at: T() };
      log("Handed a ticket to Finance", t.inv, t.id + " · " + t.t + " → " + who(W, to).n, "tkt");
      break;
    }
    case "moveTicket": {
      const t = d.TKT.find(x => x.id === a.id); if (!t || t.state === a.state) break;
      if (!mayTkt(W, WHO, t)) {
        if (may(W, WHO, "tkt") && isAM(W, WHO)) alert(t.id + " belongs to " + who(W, t.own).n + ". Account Management works "
          + "its own tickets — a compliance or money ticket is closed by the seat that can actually do "
          + "the work, not by whoever opened the screen.");
        break;
      }
      if (t.cat === "Bank" && !may(W, WHO, "bank")) {
        alert("A bank ticket needs a fresh name match before anything is done with it, so it belongs to "
          + "a seat that can see the account — Finance Operations or the Head of Finance."); break;
      }
      t.state = a.state; if (a.state === "closed") t.closed = T();
      log("Moved a ticket", t.inv, t.id + " · " + t.t + " → " + a.state, "tkt");
      break;
    }
    case "newTicket": {
      if (!may(W, WHO, "tkt")) break;
      const own = a.own;
      if (!Ix(a.inv) || !a.t || !a.t.trim() || (own && (!d.P[own] || (own !== WHO && !may(W, WHO, "assign"))))) break;
      d.TKT.unshift({ id: "TK-" + String(++d.KSEQ).padStart(4, "0"), inv: a.inv, t: a.t.trim(), cat: a.cat || "Query",
        opened: T(), by: WHO, own: own || WHO, pri: a.pri || "normal", state: "open",
        d: (a.d || "").trim(), sla: a.pri === "high" ? "2 working days" : "5 working days" });
      log("Opened a ticket", a.inv, d.TKT[0].id + " · " + d.TKT[0].t, "tkt");
      u.drafts.TK = { inv: null, cat: "Query", t: "", d: "", pri: "normal" }; u.DRW = null;
      break;
    }
    case "publish": {
      if (!may(W, WHO, "upd")) break;
      if (!a.t || !a.t.trim()) break;
      const n = a.to === "all" ? d.INV.length : a.to === "nri" ? d.INV.filter(x => x.nri).length
        : d.INV.filter(x => x.st === "allocated").length;
      d.UPD.unshift({ id: "U-" + String(++d.USEQ).padStart(2, "0"), t: a.t.trim(), cat: a.cat || "Produce",
        on: T(), by: WHO, to: a.to || "all", n, d: (a.d || "").trim() });
      log("Published an update", null, d.UPD[0].t + " · " + n + " investor" + (n === 1 ? "" : "s"), "upd");
      u.drafts.UP = { t: "", cat: "Produce", d: "", to: "all" }; u.DRW = null;
      break;
    }

    /* ---------------- account management ---------------- */
    case "assignKam": {
      if (!may(W, WHO, "assign")) break;
      const x = Ix(a.id); if (!x || !cared(x)) break;
      const k = a.k;
      if (k && (!d.P[k] || (ROLE[d.P[k].r] || {}).tm !== "am")) break;
      const was = x.kam;
      x.kam = k || null; x.kamOn = k ? day6(T()) : null;
      if (was !== x.kam) x.intro = null;
      log(k ? (was ? "Moved the account" : "Named a key account manager") : "Returned it to the pool", a.id,
        (was ? who(W, was).n + " → " : "") + (k ? who(W, k).n : "the shared pool") + " · " + (tierOf(x) || { t: "" }).t, "care");
      u.drafts.KSEL = null; u.DRW = null;
      break;
    }
    case "logContact": {
      if (!may(W, WHO, "care")) break;
      const x = Ix(a.id); if (!x || !cared(x)) break;
      if (!CHANS[a.ch] || !MOODS[a.mood]) break;
      if (refuse(logContactGate(W, WHO, x))) break;
      const note = (a.note || "").trim();
      d.CONTACT.unshift({ inv: a.id, at: T(), by: WHO, ch: a.ch, mood: a.mood, note });
      if (!x.intro && x.kam && x.kam === WHO) {
        x.intro = T();
        log("Recorded the introduction", a.id, "handed over from " + who(W, x.ir).n, "care");
      }
      x.nextOn = a.nextDays ? plusDays(d.NOW, +a.nextDays) : null;
      log("Logged a conversation", a.id, CHANS[a.ch] + " · " + MOODS[a.mood] + (note ? " · " + note.slice(0, 60) : ""), "care");
      u.drafts.CT = { ch: "call", mood: "good", note: "", next: "" }; u.DRW = null;
      break;
    }
    case "setSeat": {
      if (!maySeat(W, WHO, a.k, a.r)) break;
      const was = role(W, a.k).t, wasKam = who(W, a.k).r === "kam";
      const drop = (wasKam && a.r !== "kam") ? bookOf(W, WHO, a.k) : [];
      d.P[a.k].r = a.r;
      drop.forEach(x => { x.kam = null; x.kamOn = null; x.intro = null; });
      log("Changed a seat", null, who(W, a.k).n + ": " + was + " → " + ROLE[a.r].t
        + (drop.length ? " · " + drop.length + " account" + (drop.length === 1 ? "" : "s") + " returned to the pool" : ""), "admin");
      drop.forEach(x => log("Returned it to the pool", x.id, who(W, a.k).n + " left the seat · " + (tierOf(x) || { t: "" }).t, "care"));
      break;
    }

    /* ---------------- section 8: state and navigation ---------------- */
    case "go": {
      if (!pageReadable(W, WHO, a.v) || (a.v === "inv" && a.id && !Ix(a.id))) break;
      stash(); u.VIEW = a.v; if (a.id !== undefined) u.SEL = a.id; u.DRW = null;
      break;
    }
    case "setSec": u.SEC[a.v] = a.k; u.DRW = null; break;
    case "openDrawer": {
      if (!drawerReadable(W, WHO, a.k, a.id)) break;
      if (u.DRW && u.DRW.k === a.k && u.DRW.id === (a.id || null)) { u.DRW = null; break; }
      activate(a.k, a.id);
      if (a.seed) setDraft(a.seed);
      u.DRW = { k: a.k, id: a.id || null };
      break;
    }
    case "closeDrawer": stash(); u.DRW = null; break;
    case "setPerson": {
      if (!d.P[a.k] || !d.SIGNINS.includes(a.k)) break;
      stash();
      const blank = initialImUi();
      return { data: d, ui: { ...blank, DRAWERDRAFTS: u.DRAWERDRAFTS, VIEW: u.VIEW } };
    }
    case "setSel": u.SEL = a.id; break;          /* the send panel's picker: SEL=this.value;draw() (imx.js 2006) */
    case "setDraft": setDraft(a.patch); break;
    case "setFilter": Object.assign(u, a.patch); break;
  }
  return W;
}
