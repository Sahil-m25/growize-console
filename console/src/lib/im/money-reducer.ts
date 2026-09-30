/* ── im/money-reducer.ts — the writes the later owner decisions added ───────────────────────
   Called from imReducer's run() for the ImMoneyAction types, with the same working copy and the
   same alert/confirm/log the prototype's writes use, so a refusal is an in-page NOTE, a question
   parks the write in PENDING until {type:"confirmYes"}, and every write lands in the Activity log.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { plusDays } from "./dates";
import {
  addInvestorGate, allotOf, fmtDate, llpOf, lockAppGate, markPaidGate, newTestLink, nextInvId, openHeld,
  payoutNet, payoutOf, payoutSchedule, sendWelcomeGate, testLinkGate,
} from "./money";
import { I, may } from "./selectors";
import type { ImAction, ImKind, ImMoneyAction, ImState } from "./types";
import { inr } from "./dates";

export const MONEY_ACTIONS = new Set<ImAction["type"]>([
  "mset", "markPayoutPaid", "schedulePayouts", "sendWelcome", "welcomeDelivered", "lockApp", "createTestLink", "addInvestor",
]);
export const isMoneyAction = (a: ImAction): a is ImMoneyAction => MONEY_ACTIONS.has(a.type);

export type MoneyCtx = {
  T: () => string;
  alert: (msg: string) => void;
  confirm: (msg: string) => boolean;
  log: (what: string, inv: string | null, note: string, kind: ImKind) => void;
};

/** Mutates W (already a working copy) for one money action. */
export function moneyRun(W: ImState, WHO: string, a: ImMoneyAction, c: MoneyCtx): void {
  const d = W.data, u = W.ui;
  const refuse = (g: { ok: boolean; msg?: string | null }) => { if (!g.ok && g.msg) c.alert(g.msg); return !g.ok; };
  const mx = (patch: Record<string, string | null>) => {
    const next = { ...(u.MX || {}) };
    Object.entries(patch).forEach(([k, v]) => { if (v == null) delete next[k]; else next[k] = v; });
    u.MX = next;
  };
  switch (a.type) {
    case "mset": mx({ [a.k]: a.v }); break;

    /* ---- M10-S20: Finance marks a monthly payout paid ---- */
    case "markPayoutPaid": {
      if (refuse(markPaidGate(W, WHO, a.id, a.utr, a.tds, a.paidOn))) break;
      const p = payoutOf(W, a.id)!, al = allotOf(W, p.Allotment)!;
      p.Payout_State = "Paid"; p.Paid_On = a.paidOn; p.Payout_Mode = a.mode; p.Payout_UTR = a.utr.trim().toUpperCase();
      p.Paid_By = WHO; p.TDS_Amount = a.tds || 0; p.Net_Amount = payoutNet(p.Gross_Amount, p.TDS_Amount);
      c.log("Marked a payout paid", al.Customer, p.id + " · " + fmtDate(p.Period_Month) + " · " + inr(p.Net_Amount)
        + (p.TDS_Amount ? " net of " + inr(p.TDS_Amount) + " TDS" : "") + " · " + a.mode + " " + p.Payout_UTR, "money");
      d.OUTBOX.unshift({ at: c.T(), inv: al.Customer, t: "Payout paid · " + fmtDate(p.Period_Month) + " · " + inr(p.Net_Amount), by: WHO });
      mx({ "po:utr": null, "po:tds": null, "po:on": null, "po:mode": null });
      u.DRW = null;
      break;
    }

    /* ---- M10-S20-W1: the schedule job — an Issued allotment's missing monthly payouts, never a duplicate (D82) ---- */
    case "schedulePayouts": {
      if (!may(W, WHO, "pay")) break;
      for (const id of a.ids) {
        const al = allotOf(W, id); if (!al || !I(W, WHO, al.Customer)) continue;
        const have = new Set((d.PAYOUT || []).filter(p => p.Allotment === id).map(p => p.Instalment_No));
        const add = payoutSchedule(al).filter(p => !have.has(p.Instalment_No));
        if (!add.length) continue;
        d.PAYOUT = (d.PAYOUT || []).concat(add);
        c.log("Created the payout schedule", al.Customer, id + " · " + add.length + " monthly payouts", "money");
      }
      break;
    }

    /* ---- M10-S21: Send welcome and unlock / Lock app access ---- */
    case "sendWelcome": {
      const g = sendWelcomeGate(W, WHO, a.id);
      if (refuse(g) || !g.ok) break;
      if (g.ask && !c.confirm(g.ask)) break;
      const acc = d.ACCESS![a.id];
      acc.App_Access = "Invite"; acc.App_Welcome_At = null; acc.App_Welcome_Channel = null;
      acc.Locked_Reason = null; acc.Locked_By = null; acc.Locked_At = null;
      c.log("Sent the welcome and unlocked the app", a.id, "App access: On hold → Invite · one welcome email", "admin");
      d.OUTBOX.unshift({ at: c.T(), inv: a.id, t: "App unlocked — welcome on its way", by: WHO });
      break;
    }
    case "welcomeDelivered": {                     /* the investor app's write-back (stub receiver, D73) */
      const acc = (d.ACCESS || {})[a.id];
      if (!acc || !I(W, WHO, a.id) || acc.App_Access !== "Invite" || acc.App_Welcome_At) break;
      acc.App_Welcome_At = c.T(); acc.App_Welcome_Channel = "Email";
      c.log("The welcome was delivered", a.id, "Email · written back by the investor app", "admin");
      break;
    }
    case "lockApp": {
      const g = lockAppGate(W, WHO, a.id, a.why);
      if (refuse(g) || !g.ok) break;
      if (g.ask && !c.confirm(g.ask)) break;
      const acc = d.ACCESS![a.id];
      acc.App_Access = "Hold"; acc.Locked_Reason = a.why.trim(); acc.Locked_By = WHO; acc.Locked_At = c.T();
      c.log("Locked the investor app", a.id, "App access: Invite → On hold · " + a.why.trim(), "admin");
      mx({ ["lock:" + a.id]: null });
      u.DRW = null;
      break;
    }

    /* ---- M10-S23: a one-time test sign-in link (super user) ---- */
    case "createTestLink": {
      const g = testLinkGate(W, WHO, a.id, a.why);
      if (refuse(g) || !g.ok) break;
      if (g.ask && !c.confirm(g.ask)) break;
      const l = newTestLink(W, WHO, a.id, a.why);
      d.TESTLINK = [l].concat(d.TESTLINK || []);
      c.log("Made a test sign-in link", a.id, l.id + " · " + l.why + " · one use, 10 minutes · nothing emailed", "admin");
      mx({ ["tl:" + a.id]: l.id, ["tlwhy:" + a.id]: null });
      break;
    }

    /* ---- M09-S09: add an investor who already paid ---- */
    case "addInvestor": {
      const f = { n: a.n.trim(), em: a.em.trim(), ph: a.ph.trim(), llp: a.llp, units: a.units, paid: a.paid, on: a.on };
      if (refuse(addInvestorGate(W, WHO, f))) break;
      const l = llpOf(W, f.llp)!, id = nextInvId(W), total = f.units * l.Unit_Price, full = f.paid >= total;
      const on = fmtDate(f.on).slice(0, 6);
      d.INV.push({
        id, n: f.n, ph: f.ph, em: f.em, city: "", addr: "", nri: false, pan: null, aadh: null, aref: null,
        kyc: "pending", kycOn: null, bank: { acct: "", ifsc: "", name: "", drop: "pending" },
        units: f.units, blocks: { [l.Block_Code]: f.units }, st: full ? "paid" : "reserved",
        ir: "", src: "Added by Finance — paid before the console", since: on, nominee: "—", kam: null, kamOn: null, intro: null,
        ...(full ? {} : { hold: plusDays(d.NOW, 30) }),
      });
      const alId = "AL-" + id.slice(-4);
      d.ALLOT = (d.ALLOT || []).concat([{
        id: alId, Customer: id, LLP_Lookup: l.id, Committed_Units: f.units, Issued_Units: 0, Unit_Price: l.Unit_Price,
        Ticket_Snapshot: total, Allocation_Status: "Reserved", Issued_On: null, Annual_Rental_Yield: l.Annual_Rental_Yield,
      }]);
      d.TXN.unshift({ id: "T-" + String(++d.TSEQ).padStart(4, "0"), inv: id, kind: full ? "full" : "advance", amt: f.paid,
        mode: "—", utr: "—", on: on + " 00:00", by: WHO, rec: "pending", Allotment: alId,
        note: "paid before the console — added with the investor" });
      d.APP[id] = { at: c.T(), welcome: { at: "", ch: "email" }, mark: "tentative", markAt: c.T(), markBy: null, hist: [] };
      openHeld(d, id);
      c.log("Added an investor who already paid", id, l.Name + " · " + f.units + " unit" + (f.units === 1 ? "" : "s") + " · "
        + inr(f.paid) + " paid · app on hold, no email", "admin");
      mx({ "ai:n": null, "ai:em": null, "ai:ph": null, "ai:llp": null, "ai:units": null, "ai:paid": null, "ai:on": null });
      u.DRW = null; u.VIEW = "inv"; u.SEL = id;
      break;
    }
  }
}
