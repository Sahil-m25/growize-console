/* ── im/rules.ts — the business rules as named, testable gates ──────────────────────────────
   Each gate is the exact check a prototype write makes before it mutates anything, lifted out so
   the button (may I show it?) and the reducer (may I do it?) ask the same question. A gate returns
   `{ok:true}` or `{ok:false, msg}`; `msg` is the prototype's alert() text, or null where the
   prototype returned silently. The reducer calls these and nothing else to decide.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { APPLOCK, FORFEIT, UNIT } from "./constants";
import { day6, inr, nowDay, when } from "./dates";
import {
  I, blockUse, dueBy, freeUnits, gotBy, holdDays, markAge, markLocked, may, maskAcct, maskPan,
  roundOf, shown, who,
} from "./selectors";
import type { ImCtx, ImInvestor, ImMark, ImState, ImTxn } from "./types";

export type Gate = { ok: true } | { ok: false; msg: string | null };
const OK: Gate = { ok: true };
const no = (msg: string | null = null): Gate => ({ ok: false, msg });

/* ============================ identity (imx.js 179–198, 1345–1365) ============================ */
/** Seeing a bank account and revealing a PAN are separate rights (bank / pii). */
export const mayReveal = (s: ImCtx, WHO: string, id: string, f: "pan" | "acct"): boolean =>
  !!I(s, WHO, id) && (f === "pan" ? may(s, WHO, "pii") : may(s, WHO, "bank"));
/** What the pii() control shows for a field: masked unless revealed this session by this person. */
export type PiiView = {
  /** nothing on file */
  none: boolean;
  /** the text to show: masked, or the raw value once revealed */
  value: string;
  revealed: boolean;
  /** this seat holds the right to reveal it */
  right: boolean;
  /** the reason prompt is open for this field */
  asking: boolean;
  /** shown under the field when the seat lacks the right */
  hint: string | null;
};
export function piiView(s: ImState, WHO: string, x: ImInvestor, f: "pan" | "acct"): PiiView | null {
  if (!x || !I(s, WHO, x.id)) return null;
  const isPan = f === "pan";
  const raw = isPan ? x.pan : (x.bank || { acct: "" }).acct;
  const right = isPan ? may(s, WHO, "pii") : may(s, WHO, "bank");
  const hint = right ? null : (isPan
    ? "Compliance and the Head of Finance may reveal a PAN"
    : "Finance Operations and above may see a bank account") + " — not this seat";
  if (!raw) return { none: true, value: "not on file", revealed: false, right, asking: false, hint: null };
  const rev = shown(s, WHO, x.id, f);
  return {
    none: false, value: rev ? raw : isPan ? maskPan(raw) : maskAcct(raw), revealed: rev, right,
    asking: !!s.ui.REVASK && s.ui.REVASK.id === x.id && s.ui.REVASK.f === f, hint,
  };
}

/* ============================ money gates (imx.js 934–1008, 1255–1271) ============================ */
/** recordPay's checks, in its order. On ok, `amt` is what the receipt will be for. */
export function recordPayGate(s: ImCtx, WHO: string, id: string, kind: "advance" | "balance"): Gate & { amt?: number } {
  if (!may(s, WHO, "pay")) return no();
  const x = I(s, WHO, id); if (!x) return no();
  if (x.st === "lapsed")
    return no(x.n + "'s reservation lapsed and the units went back on the shelf.\n\nMoney arriving now "
      + "is a fresh sale, not a receipt against this one — the land has to be reserved again first.");
  /* D21 / rule 3: recording money is always allowed — an unverified supplementary only holds the MATCH (matchGate) */
  const due = dueBy(s, WHO, id);
  if (due <= 0) return no(x.n + " is paid in full. There is nothing outstanding to record.");
  const amt = kind === "advance" ? Math.round(x.units * UNIT * 0.1) : due;
  if (kind === "advance" && gotBy(s, WHO, id) > 0)
    return no("An advance is already held against " + x.n + ". Record the balance instead.");
  return { ok: true, amt };
}
/** setMark's checks. `ask` is the confirm() text when the flip needs a second press. */
export function setMarkGate(s: ImCtx, WHO: string, id: string, to: ImMark): Gate & { ask?: string } {
  const x = I(s, WHO, id), a = s.data.APP[id];
  if (!x || !a || !may(s, WHO, "pay")) return no();
  if (to !== "tentative" && to !== "permanent") return no();
  if (a.mark === to) return no();
  if (markLocked(s, WHO, id))
    return no(x.n + " has been permanent for " + markAge(s, WHO, id) + " days. It cannot be taken back after "
      + APPLOCK + ".\n\nA record that can always be un-made is not a record. If this is wrong, it is "
      + "a correction with a reason and a refund behind it, not a toggle.");
  if (to === "permanent" && dueBy(s, WHO, id) > 0)
    return { ok: true, ask: "There is " + inr(dueBy(s, WHO, id)) + " still outstanding on " + x.n + ".\n\nMarking it "
      + "permanent now says the holding is settled when it is not. Do it only if you know why." };
  return OK;
}
/** TWO-PERSON MATCH. Not in IMX's writes — the prototype's recordPay writes every receipt as
 *  "matched" by the recorder. The rule comes from the merge notes' workflow 1 ("Finance records it;
 *  a second Finance person matches it") and applies to a receipt left "pending" (a lapse refund
 *  today). The refusal copy is new. */
export function matchGate(s: ImCtx, WHO: string, t: ImTxn | null | undefined): Gate {
  if (!t || !may(s, WHO, "pay") || !I(s, WHO, t.inv) || t.rec !== "pending") return no();
  if (t.by === WHO)
    return no("You recorded " + t.id + ". A receipt is matched by a second Finance person, never by the one who recorded it.");
  return OK;
}

/* ============================ holds (imx.js 845–850, 1255–1261, 1342) ============================ */
/** the hold has run out (holdDays < 0) */
export const holdExpired = (s: ImCtx, x: ImInvestor): boolean => { const d = holdDays(s, x); return d != null && d < 0; };
/** lapseHold's checks; `ask` is its confirm() text, `fee`/`back` its arithmetic */
export function lapseGate(s: ImCtx, WHO: string, id: string): Gate & { ask?: string; fee?: number; back?: number } {
  if (!may(s, WHO, "refund")) return no();
  const x = I(s, WHO, id); if (!x || x.st !== "reserved" || !x.hold) return no();
  const h = when(s.data.NOW, x.hold);
  if (!h || h >= nowDay(s.data.NOW)) return no("The hold has not run out yet — it ends " + x.hold + ".");
  const fee = FORFEIT * x.units, back = Math.max(0, gotBy(s, WHO, id) - fee);
  return { ok: true, fee, back,
    ask: "Release " + x.units + " unit" + (x.units > 1 ? "s" : "") + "?\n\n" + inr(fee) + " is forfeit and "
      + inr(back) + " is refunded. The account stays open — they paid money and part of it was kept." };
}

/* ============================ land (imx.js 438–443, 1106–1122) ============================ */
/** More units are spoken for than are released (the Farms "oversold" tag, System's first check). */
export const oversold = (s: ImCtx): boolean => freeUnits(s) < 0;
/** A block holds more investor units than it has released. */
export const blockOver = (s: ImCtx, k: string): boolean => {
  const f = s.data.FARMS.find(x => x.k === k); return !!f && blockUse(s, k) > f.released;
};
/** holdBlock's check: land cannot come off the shelf while somebody holds units on it. */
export function holdBlockGate(s: ImCtx, WHO: string, k: string): Gate {
  if (!may(s, WHO, "farm")) return no();
  const f = s.data.FARMS.find(x => x.k === k); if (!f || !f.released) return no();
  const used = blockUse(s, k);
  if (used) return no(f.n + " has " + used + " unit" + (used === 1 ? "" : "s") + " already held by investors. Land "
    + "cannot be taken back off the shelf while somebody is standing on it.");
  return OK;
}

/* ============================ paper (imx.js 1018–1027, 1057–1063) ============================ */
export function sendDocGate(s: ImCtx, WHO: string, id: string, tplT: string, sig: string, tpl: { t: string; wet?: true } | undefined): Gate {
  if (!may(s, WHO, "doc")) return no();
  const x = I(s, WHO, id); if (!x || !tpl) return no();
  if (tpl.wet && sig !== "Wet signature") return no(tpl.t + " is wet-sign only.");
  if (x.nri && sig === "Aadhaar OTP")
    return no(x.n + " is an NRI. Aadhaar OTP needs an Aadhaar linked to a live Indian mobile — use a "
      + "Class 3 DSC or a wet signature.");
  const dup = s.data.DOCS.find(d => d.inv === id && d.t === tplT && d.state !== "blocked");
  if (dup) return no(tpl.t + " is already out to " + x.n + " (" + dup.state + ", " + day6(dup.sent) + ").\n\nChase the "
    + "one that went rather than sending a second copy.");
  return OK;
}
/** Allotment needs all three: the money in, KYC passed, and (NRI) the FEMA declaration on file. */
export function allotGate(s: ImCtx, WHO: string, x: ImInvestor | null | undefined): Gate {
  if (!x || !I(s, WHO, x.id) || !may(s, WHO, "doc") || x.st === "allocated" || x.st === "lapsed") return no();
  const why = dueBy(s, WHO, x.id) > 0 ? "the balance is still outstanding"
    : x.kyc !== "passed" ? "KYC has not passed"
      : (x.nri && x.fema === "outstanding") ? "the FEMA declaration is not on file" : null;
  if (why) return no("The allocation letter is signed, but " + x.n + " cannot be allotted yet — " + why
    + ".\n\nThe letter stays on file and the allotment follows the moment that clears.");
  return OK;
}

/* ============================ care (imx.js 1198–1213) ============================ */
export function logContactGate(s: ImCtx, WHO: string, x: ImInvestor): Gate {
  if (who(s, WHO).r === "kam" && x.kam !== WHO)
    return no(x.kam
      ? x.n + " is " + who(s, x.kam).n + "'s account. Log the conversation on your own, or ask the Head of "
        + "Account Management to move it — a contact recorded by somebody who does not hold the "
        + "account makes the cadence read as met when nobody is actually looking after them."
      : x.n + " has no manager yet, so there is no cadence for this to count against. Ask the Head of "
        + "Account Management to name one — including yourself — and then log it.");
  return OK;
}
