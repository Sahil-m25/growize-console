import { describe, expect, it } from "vitest";
import {
  I, UNIT, allotGate, appOf, blockOver, careQueue, dueBy, finQueue, freeUnits, holdDays, holdExpired,
  imCount, imHas, imReach, imReadOnly, imReducer, imTitle, kamLoad, markLeft, markLocked, matchGate, PAPER_FIRST,
  may, maySeat, mineQueue, navFor, oversold, piiView, readBook, recordPayGate, roundOf, safeNote, shown,
  tierOf, txOf, docOf, overdue, when, stamp, plusDays, aged, activityBase, drawerReadable,
} from "./index";
import { act, invOf, kit, NOW } from "./test-kit";

describe("the clock", () => {
  it("stamps from data.NOW, never the wall clock", () => {
    expect(stamp(NOW)).toBe("02 Sep 14:20");
    expect(plusDays(NOW, 30)).toBe("02 Oct");
  });
  it("reads a bare date as the nearest one (a January in September is next year)", () => {
    expect(new Date(when(NOW, "04 Jan")!).getUTCFullYear()).toBe(2027);
    expect(new Date(when(NOW, "04 Aug")!).getUTCFullYear()).toBe(2026);
  });
  it("floors an age at zero — a stamp from this afternoon is today", () => {
    expect(aged(NOW, "02 Sep 16:00")).toBe(0);
    expect(aged(NOW, "30 Aug 09:00")).toBe(3);
  });
});

describe("seat permissions (ROLE / CAN / may)", () => {
  const s = kit();
  it("keeps seeing a bank account and revealing a PAN apart", () => {
    expect(may(s, "ops1", "bank")).toBe(true);
    expect(may(s, "ops1", "pii")).toBe(false);
    expect(may(s, "comp", "pii")).toBe(true);
    expect(may(s, "comp", "bank")).toBe(false);
    expect(may(s, "aud", "pay")).toBe(false);
    expect(may(s, "kam1", "pay")).toBe(false);
    expect(may(s, "su", "pii") && may(s, "su", "bank") && may(s, "su", "pay")).toBe(true);
  });
  it("gives each seat its rail (navFor)", () => {
    expect(navFor(s, "kam1").map(n => n.k)).toEqual(["dash", "inv", "farms", "tkt", "upd", "ins", "act", "team"]);
    expect(navFor(s, "adm").map(n => n.k)).toEqual(["act", "team"]);
    expect(navFor(s, "aud").map(n => n.k)).not.toContain("sys");
    expect(navFor(s, "su").map(n => n.k)).toContain("sys");
  });
  it("walls the book by team (readBook)", () => {
    expect(readBook(s, "fin").length).toBe(5);
    expect(readBook(s, "aml").map(x => x.id)).toEqual(["A1", "B1"]);
    expect(readBook(s, "kam1").map(x => x.id)).toEqual(["A1"]);
    expect(readBook(s, "adm")).toEqual([]);
  });
  it("lets nobody move themselves, and AM only inside AM (maySeat)", () => {
    expect(maySeat(s, "fin", "ops1", "comp")).toBe(true);
    expect(maySeat(s, "fin", "fin", "ops")).toBe(false);
    expect(maySeat(s, "aml", "kam1", "amlead")).toBe(true);
    expect(maySeat(s, "aml", "kam1", "head")).toBe(false);
    expect(maySeat(s, "kam1", "kam2", "amlead")).toBe(false);
  });
  it("exposes the IMX console API", () => {
    expect(imHas(s.data, "aud")).toBe(true);
    expect(imHas(s.data, "irv")).toBe(false);          /* a lead-side name holds no seat */
    expect(imTitle(s.data, "fin")).toBe("Head of Finance");
    expect(imReadOnly(s, "aud")).toBe(true);
    expect(imReadOnly(s, "ops1")).toBe(false);
    expect(imReach(s, "nobody")).toEqual([]);
    expect(imReadOnly(s, "nobody")).toBe(false);
    expect(imCount(s, "dash", "nobody")).toBe(0);
  });
});

describe("PII masking and reveals", () => {
  it("masks PAN and account by default and hides them from other teams", () => {
    const s = kit(), x = invOf(s, "A1");
    expect(piiView(s, "fin", x, "pan")!.value).toBe("ABC•••••F");
    expect(piiView(s, "fin", x, "acct")!.value).toBe("•••• •••• 9012");
    expect(piiView(s, "ops1", x, "pan")!.right).toBe(false);
    expect(piiView(s, "ops1", x, "pan")!.hint).toBe("Compliance and the Head of Finance may reveal a PAN — not this seat");
    expect(txOf(s, "kam1", "A1")[0].utr).toBe("Finance only");
    expect(docOf(s, "kam1", "A1")[0].ref).toBeNull();
    expect(safeNote(s, "kam1", "his PAN is ABCDE1234F")).toBe("his PAN is ••••••");
  });
  it("asks for a reason before revealing, then logs the reveal against the name", () => {
    let s = act(kit(), "fin", { type: "reveal", id: "A1", f: "pan" });
    expect(s.ui.REVASK).toEqual({ id: "A1", f: "pan" });
    expect(shown(s, "fin", "A1", "pan")).toBe(false);
    s = act(s, "fin", { type: "reveal", id: "A1", f: "pan", why: "A filing or a TDS check" });
    expect(shown(s, "fin", "A1", "pan")).toBe(true);
    expect(shown(s, "comp", "A1", "pan")).toBe(false);                 /* per person */
    expect(piiView(s, "fin", invOf(s, "A1"), "pan")!.value).toBe("ABCDE1234F");
    expect(s.data.LOG[0]).toMatchObject({ who: "fin", what: "Revealed a PAN", inv: "A1", note: "A filing or a TDS check", kind: "pii", at: "02 Sep 14:20" });
  });
  it("refuses a reveal to a seat without the right, silently", () => {
    const s0 = kit();
    const s = act(s0, "ops1", { type: "reveal", id: "A1", f: "pan", why: "x" });
    expect(s.data.LOG.length).toBe(s0.data.LOG.length);
    expect(act(s0, "comp", { type: "reveal", id: "A1", f: "acct", why: "x" }).ui.SHOWN).toEqual({});
  });
  it("never writes an identity number into the log (CLAUDE.md rule 7)", () => {
    const s = act(kit(), "kam1", { type: "logContact", id: "A1", ch: "call", mood: "ok", note: "read me ABCDE1234F and 123456789012" });
    expect(s.data.LOG[0].note).not.toMatch(/ABCDE1234F|123456789012/);
  });
});

describe("money gates", () => {
  it("records a receipt before the supplementary agreement is verified (D21, M08-S03, rule 3)", () => {
    const s = kit();
    expect(roundOf(s, "fin", "N1", "supp").state).toBe("none");
    expect(recordPayGate(s, "fin", "N1", "advance").ok).toBe(true);
  });
  it("takes 10% as the advance, refuses a second advance and anything on a settled account", () => {
    const s = kit();
    expect(recordPayGate(s, "fin", "R1", "balance")).toEqual({ ok: true, amt: UNIT - 250000 });
    expect(recordPayGate(s, "fin", "R1", "advance")).toEqual({ ok: false, msg: "An advance is already held against Investor R1. Record the balance instead." });
    expect(recordPayGate(s, "fin", "A1", "balance")).toEqual({ ok: false, msg: "Investor A1 is paid in full. There is nothing outstanding to record." });
    expect(recordPayGate(s, "comp", "R1", "balance")).toEqual({ ok: false, msg: null });
  });
  it("a balance settles the holding and turns the app account permanent by itself", () => {
    const s = act(kit(), "ops1", { type: "recordPay", id: "R1", kind: "balance", mode: "NEFT", utr: "hdfc1" });
    const x = invOf(s, "R1");
    expect(x.st).toBe("paid"); expect(x.hold).toBeUndefined();
    expect(s.data.TXN[0]).toMatchObject({ id: "T-0005", amt: UNIT - 250000, utr: "HDFC1", by: "ops1", rec: "matched" });
    expect(appOf(s, "ops1", "R1")!.mark).toBe("permanent");
    expect(s.data.OUTBOX[0].t).toBe("Balance received · ₹22.5 L");
    expect(dueBy(s, "ops1", "R1")).toBe(0);
  });
  it("a first receipt opens the account, tentative, and starts a 30-day hold", () => {
    let s = kit();
    s = { ...s, data: { ...s.data, DOCS: s.data.DOCS.concat([{ id: "D-99", inv: "N1", t: "Supplementary agreement", cls: "Commercial", state: "signed", sent: "01 Sep 09:00", by: "fin", sig: "Class 3 DSC", ref: "EMU-9", on: "01 Sep 10:00" }]) } };
    s = act(s, "fin", { type: "recordPay", id: "N1", kind: "advance" });
    expect(invOf(s, "N1").hold).toBe("02 Oct");
    expect(appOf(s, "fin", "N1")).toMatchObject({ mark: "tentative", at: "02 Sep 14:20" });
    expect(s.data.LOG.map(e => e.what)).toContain("Growize account created");
  });
  it("confirms an IR's claim by reading their words, and records the answer beside it", () => {
    const s = act(kit(), "ops1", { type: "confirmClaim", nid: "N-1" });
    expect(s.data.TXN[0]).toMatchObject({ kind: "balance", mode: "RTGS", utr: "HDFC2709999" });
    expect(s.data.ANS["N-1"]).toMatchObject({ state: "confirmed", by: "ops1" });
    expect(s.data.INBOX[0].state).toBe("open");                         /* the IR's message is untouched */
    const r = act(kit(), "ops1", { type: "rejectClaim", nid: "N-1" });
    expect(r.data.ANS["N-1"]).toMatchObject({ state: "notfound", why: "Not in the account yet" });
  });
});

describe("the app account mark", () => {
  it("asks before marking permanent with money outstanding, and does it on Yes", () => {
    let s = act(kit(), "fin", { type: "setMark", id: "R1", to: "permanent" });
    expect(s.ui.NOTE!.kind).toBe("ask");
    expect(s.ui.NOTE!.msg).toMatch(/^There is ₹22,50,000 still outstanding on Investor R1\./);
    expect(appOf(s, "fin", "R1")!.mark).toBe("tentative");
    s = imReducer(s, "fin", { type: "confirmYes" });
    expect(s.ui.NOTE).toBeNull();
    expect(appOf(s, "fin", "R1")).toMatchObject({ mark: "permanent", markBy: "fin" });
    expect(act(s, "fin", { type: "noteClose" }).ui.NOTE).toBeNull();
  });
  it("locks a permanent mark after APPLOCK days", () => {
    const s = kit();
    expect(markLocked(s, "fin", "A1")).toBe(true);                       /* permanent since 01 Aug */
    expect(markLocked(s, "fin", "B1")).toBe(false);                      /* since 29 Aug */
    expect(markLeft(s, "fin", "B1")).toBe(3);
    const r = act(s, "fin", { type: "setMark", id: "A1", to: "tentative" });
    expect(r.ui.NOTE).toMatchObject({ kind: "refuse" });
    expect(r.ui.NOTE!.msg).toMatch(/^Investor A1 has been permanent for 32 days\. It cannot be taken back after 7\./);
  });
});

describe("holds", () => {
  it("counts days left and raises the queue row", () => {
    const s = kit();
    expect(holdDays(s, invOf(s, "R1"))).toBe(3);
    expect(holdExpired(s, invOf(s, "R2"))).toBe(true);
    const q = finQueue(s, "fin").filter(q => q.kind === "hold").map(q => [q.inv.id, q.t, q.urg]);
    expect(q).toContainEqual(["R1", "Balance due — hold ends in 3 days", "now"]);
    expect(q).toContainEqual(["R2", "The hold ran out 3 days ago — release it or extend it", "now"]);
  });
  it("refuses a lapse before the hold runs out; after it, asks, then forfeits and refunds", () => {
    const early = act(kit(), "fin", { type: "lapseHold", id: "R1" });
    expect(early.ui.NOTE).toEqual({ kind: "refuse", msg: "The hold has not run out yet — it ends 05 Sep." });
    let s = act(kit(), "fin", { type: "lapseHold", id: "R2" });
    expect(s.ui.NOTE!.msg).toBe("Release 2 units?\n\n₹1,00,000 is forfeit and ₹4,00,000 is refunded. The account stays open — they paid money and part of it was kept.");
    s = imReducer(s, "fin", { type: "confirmYes" });
    const x = invOf(s, "R2");
    expect(x.st).toBe("lapsed"); expect(x.blocks).toEqual({});
    expect(s.data.TXN.slice(0, 2).map(t => [t.kind, t.amt, t.rec])).toEqual([["refund", 400000, "pending"], ["forfeit", 0, "matched"]]);
    expect(act(kit(), "ops1", { type: "lapseHold", id: "R2" }).ui.NOTE).toBeNull();   /* no refund right */
  });
});

describe("oversell guard", () => {
  it("counts the shelf off the investor records", () => {
    const s = kit();
    expect(freeUnits(s)).toBe(10 - 6 - 4);
    expect(oversold(s)).toBe(false);
    const over = { ...s, data: { ...s.data, FARMS: s.data.FARMS.map(f => ({ ...f, released: f.k === "X" ? 8 : 0 })) } };
    expect(oversold(over)).toBe(true);
    expect(blockOver(over, "X")).toBe(true);
  });
  it("will not take land off the shelf while anybody stands on it", () => {
    const s = act(kit(), "fin", { type: "holdBlock", k: "X" });
    expect(s.ui.NOTE!.msg).toBe("Block X has 10 units already held by investors. Land cannot be taken back off the shelf while somebody is standing on it.");
    expect(s.data.FARMS[0].released).toBe(10);
    const y = act(kit(), "fin", { type: "releaseBlock", k: "Y" });
    expect(y.data.FARMS[1].released).toBe(5);
    expect(act(y, "fin", { type: "holdBlock", k: "Y" }).data.FARMS[1].released).toBe(0);
  });
});

describe("receipt match (D113 ruling 1)", () => {
  it("a refund keeps D22's second hand: never its recorder, never an ops seat; the Head of Finance matches it", () => {
    let s = imReducer(act(kit(), "su", { type: "lapseHold", id: "R2" }), "su", { type: "confirmYes" });
    const t = s.data.TXN[0];
    expect(t).toMatchObject({ kind: "refund", rec: "pending" });
    expect(matchGate(s, "su", t)).toMatchObject({ ok: false });
    expect(act(s, "su", { type: "matchReceipt", tid: t.id }).ui.NOTE!.kind).toBe("refuse");
    expect(matchGate(s, "aud", t)).toEqual({ ok: false, msg: null });
    expect(act(s, "ops2", { type: "matchReceipt", tid: t.id }).data.TXN[0].rec).toBe("pending");
    s = act(s, "fin", { type: "matchReceipt", tid: t.id });
    expect(s.data.TXN[0]).toMatchObject({ rec: "matched", mby: "fin" });
  });
  it("a receipt a Finance seat records is matched by the recorder — no second person; the account opens On hold", () => {
    const s0 = kit();
    delete s0.data.APP.R1; if (s0.data.ACCESS) delete s0.data.ACCESS.R1;
    const s = act(s0, "ops1", { type: "recordPay", id: "R1", kind: "balance", mode: "RTGS", utr: "HDFC2709001" });
    expect(s.data.TXN[0]).toMatchObject({ inv: "R1", kind: "balance", by: "ops1", rec: "matched", mby: "ops1" });
    expect(invOf(s, "R1").st).toBe("paid");
    expect(s.data.ACCESS!.R1).toMatchObject({ App_Access: "Hold", App_Welcome_At: null });
    expect(s.data.LOG.some(e => e.what === "Growize account created" && e.inv === "R1")).toBe(true);
  });
  it("rule 3: unverified paper — recorded, never refused, left pending; nothing settles until it is matched", () => {
    const s = act(kit(), "ops1", { type: "recordPay", id: "N1", kind: "advance", mode: "NEFT", utr: "HDFC2709002" });
    const t = s.data.TXN[0];
    expect(t).toMatchObject({ inv: "N1", kind: "advance", by: "ops1", rec: "pending" });
    expect(t.mby).toBeUndefined();
    expect(s.data.APP.N1).toBeUndefined();
    expect(matchGate(s, "ops1", t)).toEqual({ ok: false, msg: PAPER_FIRST });
    expect(matchGate(s, "fin", t)).toEqual({ ok: false, msg: PAPER_FIRST });
  });
  it("a pending ordinary receipt (legacy, paper verified since) is matched by any Finance seat, the recorder included", () => {
    const s0 = kit();
    s0.data.TXN.unshift({ id: "T-0050", inv: "R1", kind: "balance", amt: 2250000, mode: "RTGS", utr: "U50", on: "02 Sep 10:00", by: "ops1", rec: "pending" });
    expect(matchGate(s0, "ops1", s0.data.TXN[0])).toEqual({ ok: true });
    const s = act(s0, "ops1", { type: "matchReceipt", tid: "T-0050" });
    expect(s.data.TXN[0]).toMatchObject({ rec: "matched", mby: "ops1" });
    expect(invOf(s, "R1").st).toBe("paid");
  });
  it("an IR's payment report stays pending until Finance confirms it; confirming records it matched", () => {
    const s0 = kit();
    const n0 = s0.data.TXN.length;
    expect(s0.data.ANS["N-1"]).toBeUndefined();
    expect(s0.data.TXN.filter(t => t.inv === "R1")).toHaveLength(1);
    const s = act(s0, "ops1", { type: "confirmClaim", nid: "N-1" });
    expect(s.data.TXN).toHaveLength(n0 + 1);
    expect(s.data.TXN[0]).toMatchObject({ inv: "R1", kind: "balance", rec: "matched", mby: "ops1" });
    expect(s.data.ANS["N-1"]).toMatchObject({ state: "confirmed", by: "ops1" });
  });
});

describe("paper", () => {
  it("refuses Aadhaar OTP to an NRI, a wet-sign template by OTP, and a second copy", () => {
    const s = kit();
    expect(act(s, "fin", { type: "sendDocNow", id: "N1", tpl: "FEMA declaration", sig: "Aadhaar OTP" }).ui.NOTE!.msg)
      .toMatch(/^Investor N1 is an NRI\./);
    expect(act(s, "fin", { type: "sendDocNow", id: "A1", tpl: "Power of attorney", sig: "Aadhaar OTP" }).ui.NOTE!.msg)
      .toBe("Power of attorney is wet-sign only.");
    expect(act(s, "fin", { type: "sendDocNow", id: "A1", tpl: "Non-disclosure agreement", sig: "Aadhaar OTP" }).ui.NOTE!.msg)
      .toBe("Non-disclosure agreement is already out to Investor A1 (signed, 01 Aug).\n\nChase the one that went rather than sending a second copy.");
    const ok = act(s, "fin", { type: "sendDocNow", id: "N1", tpl: "Non-disclosure agreement", sig: "Class 3 DSC" });
    expect(ok.data.DOCS[0]).toMatchObject({ id: "D-009", state: "awaiting", exp: "16 Sep", sent: "02 Sep 14:20" });
    expect(roundOf(ok, "fin", "N1", "nda").state).toBe("out");
  });
  it("verifying an allocation letter allots only when money, KYC and FEMA are clear", () => {
    const s = act(kit(), "fin", { type: "recordPay", id: "R1", kind: "balance" },
      { type: "sendDocNow", id: "R1", tpl: "Allocation letter", sig: "Aadhaar OTP" });
    const did = s.data.DOCS[0].id;
    const v = act(s, "fin", { type: "verifyDoc", did });
    expect(invOf(v, "R1").st).toBe("allocated");
    expect(v.data.LOG.map(e => e.what)).toContain("Under account management");
    expect(allotGate(kit(), "fin", invOf(kit(), "R1"))).toMatchObject({ ok: false,
      msg: "The allocation letter is signed, but Investor R1 cannot be allotted yet — the balance is still outstanding.\n\nThe letter stays on file and the allotment follows the moment that clears." });
  });
});

describe("account management", () => {
  it("tiers by size and costs a book in conversations a month (the only periodic schedule in IMX)", () => {
    const s = kit();
    expect(tierOf(invOf(s, "A1"))!.k).toBe("A");
    expect(tierOf(invOf(s, "B1"))!.k).toBe("B");
    expect(kamLoad([invOf(s, "A1"), invOf(s, "B1")])).toBe(1.3);         /* 30/30 + 30/90 */
    expect(overdue(s, "fin", invOf(s, "A1"))).toBe(-17);                  /* 20 Aug + 30 days = 19 Sep */
  });
  it("queues a Tier B with nobody on it, and a KAM sees only their own", () => {
    const s = kit();
    expect(careQueue(s, "aml").map(q => [q.inv.id, q.kind, q.t])).toEqual([["B1", "nokam", "Tier B and nobody is looking after them"]]);
    expect(mineQueue(s, "kam1")).toEqual([]);
  });
  it("refuses a KAM logging on somebody else's account, and a move voids the introduction", () => {
    const s = act(kit(), "kam2", { type: "logContact", id: "A1", ch: "call", mood: "good" });
    expect(s.data.CONTACT.length).toBe(1);                              /* not even readable to kam2 */
    const m = act(kit(), "aml", { type: "assignKam", id: "A1", k: "kam2" });
    expect(invOf(m, "A1")).toMatchObject({ kam: "kam2", kamOn: "02 Sep", intro: null });
    expect(m.data.LOG[0].what).toBe("Moved the account");
  });
  it("returns a manager's book to the pool when they leave the seat", () => {
    const s = act(kit(), "fin", { type: "setSeat", k: "kam1", r: "ops" });
    expect(invOf(s, "A1").kam).toBeNull();
    expect(s.data.LOG[1].note).toBe("Kam One: Key Account Manager → Finance Operations · 1 account returned to the pool");
  });
});

describe("the rest of the wiring", () => {
  it("routes a bank ticket from the KAM to Finance Operations", () => {
    const s = act(kit(), "kam1", { type: "moveTicket", id: "TK-0001", state: "closed" });
    expect(s.ui.NOTE!.msg).toMatch(/^A bank ticket needs a fresh name match/);
    const h = act(kit(), "kam1", { type: "handToFinance", id: "TK-0001" });
    expect(h.data.TKT[0]).toMatchObject({ own: "ops1", handed: { by: "kam1", at: "02 Sep 14:20" } });
  });
  it("gates the drawer and the page the way the button does", () => {
    const s = kit();
    expect(drawerReadable(s, "kam1", "pay", "A1")).toBe(false);
    expect(drawerReadable(s, "fin", "pay", "R1")).toBe(true);
    const o = act(s, "fin", { type: "openDrawer", k: "pay", id: "R1", seed: { PKIND: "balance" } });
    expect(o.ui.DRW).toEqual({ k: "pay", id: "R1" });
    expect(o.ui.drafts.PKIND).toBe("balance");
    expect(act(o, "fin", { type: "openDrawer", k: "pay", id: "R1" }).ui.DRW).toBeNull();   /* toggles */
    expect(act(s, "kam1", { type: "go", v: "txn" }).ui.VIEW).toBe("dash");               /* not reachable */
  });
  it("gives an administrator the log with investor details withheld", () => {
    const s = act(kit(), "fin", { type: "reveal", id: "A1", f: "pan", why: "A filing or a TDS check" });
    expect(activityBase(s, "adm")[0]).toMatchObject({ inv: null, what: "Identity event", note: "Investor details withheld" });
  });
  it("never lets I() hand out a record the seat cannot read", () => {
    expect(I(kit(), "kam2", "A1")).toBeNull();
  });
});
