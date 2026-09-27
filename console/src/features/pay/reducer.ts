"use client";

/* ── pages-d's reducer — money, paper, the shelf and the transfer ───────────────────────────
   Ports `ref/03-app.js` 668–737 (setReleased, askExt, decideExt, lapse), 1476–1477 (setPay),
   1486–1540 (record), 1568–1631 (the claim relay), 1921–1937 (recordDoc), 1967–2001 (acctAuto,
   acctLapsed, xferAuto), 3868–3895 (sendDoc) and 4135–4146 (setRecov, clearRecov).

   One function, `pagesDReducer(state, action)`, returning new state for the actions this agent
   owns and `null` for everything else. Every case copies; nothing here mutates the state it was
   handed. The prototype's `log(...)` becomes `addLog`, which prepends exactly the line the
   prototype prepended and carries the borrowed grant on it the same way.

   WHAT IS NOT IN HERE, AND WHY. `record`, `lapse` and `sendDoc` each refuse with an `alert()` or
   ask with a `confirm()` in the prototype. A reducer that talked to the user would fire twice
   under React's StrictMode and would not be a function of its arguments, so the words live in
   `recordRefusal`, `lapseRefusal`, `lapseAsk` and `sendDocRefusal` below — byte-identical, called
   by the control before it dispatches — and every check is made AGAIN here, so a dispatch that
   skipped the question still cannot half-write.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import {
  DCLS_EXTRA, DTPLS, FORFEIT, LADDER, RECOVACTS, ROUNDS, ST, UNIT,
} from "@/domain";
import type {
  Account, ActKind, Claim, ClaimKind, DocClass, DocRec, ExtRec, Lead, LeadId, PayRec, PayReceipt,
  PersonKey, RecovAction, Source, Stamp, XferRow,
} from "@/domain";
import { DAY, MON, iso, maskRef, money, nowT, plusDays, stamp, when } from "@/lib/format";
import {
  canAskExt, canClaim, canDecideExt, canInv, canRecov, canReopenClaim, claimFieldsError, claimOf,
  claimReceiptMatch, claimReportLabel, invAlloc, invFree, invRes, inReservation, isFin, kpis, lost, may, openable, P,
  suppOK, tempOn, titleOf,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";

/* ---- the half-typed forms the prototype kept as module-level `let`s ---------------------------
   PSEL2/PMODE/PUTR (03-app.js:1476), CKIND/CMODE/CREF/CNOTE (1568), DSEL/DTPL/DSIG (3867),
   NTAB (4074) and RCACT/RCWHO (4835). Declared optional because the store's initial `ui` does not
   carry them; every reader below supplies the prototype's own default. */
declare module "@/lib/store" {
  interface UiState {
    /** Numbers: which of the three tabs. 03-app.js:4074 */
    NTAB?: string;
    /** Payments: who the receipt is for, how it came, and its reference. 03-app.js:1476 */
    PSEL2?: string | null;
    PMODE?: string;
    PUTR?: string;
    /** The claim being drafted. 03-app.js:1568 */
    CKIND?: ClaimKind;
    CMODE?: string;
    CREF?: string;
    CNOTE?: string;
    /** Documents: the send panel. 03-app.js:3867 */
    DSEL?: string | null;
    DTPL?: string;
    DSIG?: string;
    /** The payment-report draft's amount/date — set only via the "amount"/"said_on" branches of
     *  `setClaim` below; unset for every drawer that still seeds only kind/ref/note. */
    CAMOUNT?: string;
    CSAIDON?: string;
    /** The recovery-action drawer. 03-app.js:4835 */
    RCACT?: string | null;
    RCWHO?: PersonKey | null;
  }
}

/* the prototype's defaults, read through one function each so a screen and this file cannot
   disagree about what "nothing chosen yet" means */
export const NTAB = (s: ConsoleState): string => s.ui.NTAB ?? "book";
export const PSEL2 = (s: ConsoleState): string | null => s.ui.PSEL2 ?? null;
export const PMODE = (s: ConsoleState): string => s.ui.PMODE ?? "RTGS";
export const PUTR = (s: ConsoleState): string => s.ui.PUTR ?? "";
export const CKIND = (s: ConsoleState): ClaimKind => s.ui.CKIND ?? "advance";
export const CMODE = (s: ConsoleState): string => s.ui.CMODE ?? "RTGS";
export const CREF = (s: ConsoleState): string => s.ui.CREF ?? "";
export const CNOTE = (s: ConsoleState): string => s.ui.CNOTE ?? "";
/* CAMOUNT/CSAIDON — the payment-report redesign's amount/said_on draft fields (Claim now carries
   them, ir-console-redesigned.html:5396-5459). No drawer in this port collects them yet — the
   "claim" drawer (src/features/lead/drawers/finance.tsx, cross-owner) is read-only — so these sit
   unused until that form exists; see crossOwnerRequests. */
export const CAMOUNT = (s: ConsoleState): string => s.ui.CAMOUNT ?? "";
export const CSAIDON = (s: ConsoleState): string => s.ui.CSAIDON ?? "";
export const DSEL = (s: ConsoleState): string | null => s.ui.DSEL ?? null;
export const DTPL = (s: ConsoleState): string => s.ui.DTPL ?? "LLP agreement";
export const DSIG = (s: ConsoleState): string => s.ui.DSIG ?? "Aadhaar OTP";
export const RCACT = (s: ConsoleState): string | null => s.ui.RCACT ?? null;
export const RCWHO = (s: ConsoleState): PersonKey | null => s.ui.RCWHO ?? null;

/* ---- documents: the class of a document is read off the one list that owns it. 03-app.js:1914 */
export const dClsOf = (t: string): DocClass | null =>
  (DTPLS.find(x => x.t === t) || ({} as { cls?: DocClass })).cls || DCLS_EXTRA[t] || null;
export const dTypes = (): string[] => DTPLS.map(x => x.t).concat(Object.keys(DCLS_EXTRA));
export const docsFor = (s: ConsoleState, id: LeadId): DocRec[] => s.DOCS.filter(d => d.lead === id);
/* canDoc — 03-app.js:1920 */
export const canDoc = (s: ConsoleState, l: Lead | null | undefined): boolean =>
  !!l && l.done >= ST.RESERVED && isFin(s.ROLE) && may(s, "docs", "send");

/* the account's own two reads. 03-app.js:1964–1965 */
export const acctOf = (s: ConsoleState, id: LeadId): Account | null => s.ACCT[id] || null;
export const acctUnits = (l: Lead | null | undefined): string =>
  !l ? "" : l.done >= ST.ALLOCATED ? "allocated" : "reserved";

/* the transfer row's four readers. 03-app.js:810–813 */
export const xName = (s: ConsoleState, x: XferRow): string => {
  const l = s.LEADS.find(y => y.id === x.lead);
  return l ? l.n : (x.n || x.lead);
};
export const xUnits = (s: ConsoleState, x: XferRow): number => {
  const l = s.LEADS.find(y => y.id === x.lead);
  return l ? l.units : (x.units || 0);
};
export const xIR = (s: ConsoleState, x: XferRow): PersonKey | null => {
  const l = s.LEADS.find(y => y.id === x.lead);
  return l ? l.own : (x.ir ?? null);
};
export const xSrc = (s: ConsoleState, x: XferRow): Source | null => {
  const l = s.LEADS.find(y => y.id === x.lead);
  return l ? l.src : (x.src ?? null);
};

/* ---- the trail --------------------------------------------------------------------------------
   log(what, lead, note, kind) — 03-app.js:1228. Everything written while a grant is switched on
   carries the grant, not only the writes that happen to be on the borrowed page. */
function addLog(
  s: ConsoleState, at: Stamp, what: string, lead: LeadId | null, note: string, kind: ActKind,
): ConsoleState {
  const g = tempOn(s);
  return {
    ...s,
    LOG: [{ d: iso(s.TODAY), at, who: s.WHO, what, lead, note: note || "", kind,
            temp: g ? g.id : null }, ...s.LOG],
    TEMP: g ? s.TEMP.map(x => (x.id === g.id ? { ...x, acts: (x.acts || 0) + 1 } : x)) : s.TEMP,
  };
}

const at0 = (s: ConsoleState): Stamp => stamp(nowT(s.NOW));

/* every report ever minted, live or archived — a single counter, same as the prototype's own
   module-level `CLAIMSEQ` (ir-console-redesigned.html:5405). */
function allClaims(s: ConsoleState): Claim[] {
  return [...Object.values(s.CLAIM || {}), ...Object.values(s.CLAIMARCHIVE || {}).flat()];
}

/* ARLSEQ — "the last ARL ID minted; the next one is this plus one" (03-app.js:1938). The prototype
   kept it as a mutable module global that its own seed advanced; here it is read back off the
   codes the record already holds, so the same book always mints the same next number. */
function nextArl(s: ConsoleState): string {
  const num = (c: string | undefined): number => {
    const m = /^ARL-INV-(\d+)$/.exec(c || "");
    return m ? +m[1] : 0;
  };
  const seen = Object.keys(s.ACCT).map(k => num(s.ACCT[k].code))
    .concat(s.XFER.map(x => num(x.code)));
  return "ARL-INV-" + String(Math.max(s.ARLSEQ, ...seen) + 1).padStart(4, "0");
}

/* ===== THE GROWIZE ACCOUNT — 03-app.js:1967 ==================================================
   What the portal's confirmation does on this side, in one place so it cannot be done by halves. */
function acctAuto(s: ConsoleState, id: LeadId, at: Stamp): ConsoleState {
  const l = s.LEADS.find(x => x.id === id);
  if (!l || s.ACCT[id] || !s.PAY[id]) return s;
  const code = nextArl(s);
  const acct: Account = { code, at, state: "open", invite: { at, ch: "email", auto: true } };
  const next: ConsoleState = {
    ...s,
    ACCT: { ...s.ACCT, [id]: acct },
    DOCS: s.DOCS.map(d => (d.lead === id ? { ...d, ref: d.ref || code } : d)),
  };
  return addLog(next, at, "Growize account created", id,
    code + " · automatic on the confirmed receipt · welcome sent", "admin");
}

/* acctLapsed — 03-app.js:1980. Not a control of its own: the account follows the reservation. */
function acctLapsed(s: ConsoleState, id: LeadId, at: Stamp): ConsoleState {
  const a = s.ACCT[id];
  if (!a || a.state !== "open") return s;
  return { ...s, ACCT: { ...s.ACCT, [id]: { ...a, state: "lapsed", on: at, by2: s.WHO } } };
}

/* xferAuto — 03-app.js:1990. The other half of the confirmation: one fact, two consequences. */
function xferAuto(s0: ConsoleState, id: LeadId, at: Stamp): ConsoleState {
  const l = s0.LEADS.find(y => y.id === id);
  if (!l || !s0.PAY[id]) return s0;
  const s = s0.ACCT[id] ? s0 : acctAuto(s0, id, at);
  const a = s.ACCT[id];
  if (!a) return s;
  const p = s.PAY[id];
  const prev = s.XFER.find(y => y.lead === id);
  const row: XferRow = {
    ...(prev ?? { lead: id, state: "done" as const, auto: true }),
    state: "done", auto: true, on: a.at, asked: a.at, code: a.code,
    n: l.n, ir: l.own ?? undefined, src: l.src, ev: l.ev, units: l.units,
    got: (p ? p.got : 0) || l.units * UNIT,
    mode: p ? p.mode : undefined, utr: p ? p.utr : undefined,
  };
  return {
    ...s,
    XFER: prev ? s.XFER.map(y => (y.lead === id ? row : y)) : [...s.XFER, row],
    DOCS: s.DOCS.map(d => (d.lead === id ? { ...d, ref: d.ref || a.code } : d)),
  };
}

/* ===== WHAT ARRIVES OVER THE LINK — 03-app.js:1486 ===========================================
   A receipt is written once, by Finance, in the Investor Management portal. This is the handler for
   its arrival on this side — not a control, and reachable from no button in this console. The
   checks in it are the ones that make the two books agree. */

/** the words `record()` refuses with, or null when it will not refuse. 03-app.js:1489–1516 */
export function recordRefusal(s: ConsoleState, id: LeadId, kind: string): string | null {
  const l = s.LEADS.find(x => x.id === id);
  if (!l) return null;
  if (lost(l))
    return "This lead is closed as lost. Re-open it before recording any money against "
      + "it — a receipt on a closed lead is how a book stops adding up.";
  const pay = s.PAY[id];
  if (!suppOK(s, l))
    return "The supplementary agreement is not signed and verified yet.\n\nNothing is recorded "
      + "against this investor until it is — the agreement is what the money is for. Paperwork on "
      + "the lead shows whose move it is.";
  if (l.done < ST.CONVERTED)
    return "This lead is at \"" + LADDER[Math.max(0, l.done - 1)].t + "\".\n\nThe investor has to say yes "
      + "and a commercial path has to be approved before any money is recorded against it.";
  if (kind === "balance" && !(pay && pay.state === "part"))
    return "There is no advance held against this one, so there is no balance to receive. Record the "
      + "full payment instead.";
  if (kind === "advance" && (l.done >= ST.PAID || (pay && pay.state === "full")))
    return "This one is already recorded as fully paid. Recording an advance over it would overwrite "
      + "the receipt.\n\nUn-tick the stage first if the full payment was entered in error.";
  if (l.done < ST.RESERVED && l.units > invFree(s))
    return "Only " + Math.max(0, invFree(s)) + " unit" + (invFree(s) === 1 ? " is" : "s are")
      + " free to sell — this reservation needs " + l.units + ".\n\nFinance or Digital has to "
      + "release more sellable inventory with the farm interface before this payment can be recorded.";
  return null;
}

/** true when `recordRefusal` refused because there is not enough on the shelf — the one refusal
 *  that also moves the screen (`DRW=null; VIEW="goals"`, 03-app.js:1516) */
export const recordShort = (s: ConsoleState, id: LeadId, kind: string): boolean => {
  const l = s.LEADS.find(x => x.id === id);
  return !!l && !!recordRefusal(s, id, kind) && !lost(l) && suppOK(s, l)
    && l.done >= ST.CONVERTED && l.done < ST.RESERVED && l.units > invFree(s);
};

function doRecord(
  s0: ConsoleState, id: LeadId, kind: string,
): ConsoleState {
  if (!isFin(s0.ROLE) || !may(s0, "pay", "record")) return s0;
  const l = s0.LEADS.find(x => x.id === id);
  if (!l) return s0;
  if (recordRefusal(s0, id, kind)) return s0;
  const tot = l.units * UNIT;
  /* Three receipts, three amounts, and the label on the button is the amount that lands. */
  const got = kind === "advance" ? Math.round(tot * 0.1) : tot;
  const raw = PUTR(s0) || "";
  const utr = /^[A-Za-z0-9]{6,22}$/.test(raw.trim()) ? raw.trim().toUpperCase() : "—";
  const at = at0(s0);
  const mode = PMODE(s0);
  const rec: PayRec = {
    state: kind === "advance" ? "part" : "full", got, mode, utr, on: at.slice(0, 6),
    hold: kind === "advance" ? plusDays(30, s0.NOW) : null,
  };
  let s: ConsoleState = { ...s0, PAY: { ...s0.PAY, [id]: rec } };
  /* THE RECEIPT DOES NOT TICK THE RUNG. Confirming the money OPENS the gate; the IR ticks it. */
  if (kind === "full" || kind === "balance") {
    const E = { ...s.EXT };
    delete E[id];                       /* the balance is in; the clock and its request are done */
    s = { ...s, EXT: E };
  }
  /* rule 7 again, at the point of writing: the note is read by everyone with "See other
     people's" on Activity, and it is exported. It carries the last four and never more. */
  s = addLog(s, at, "Recorded payment", id,
    (kind === "advance" ? "10% advance" : kind === "balance" ? "Balance" : "Full")
    + " · " + money(got) + " · " + mode + " " + maskRef(utr), "money");
  s = xferAuto(s, id, at);              /* one confirmation, every consequence, in one place */
  return { ...s, ui: { ...s.ui, PUTR: "" } };
}

/* ===== A RESERVATION THAT RAN OUT — 03-app.js:718 ============================================ */

/** the refusal `lapse()` makes before it asks anything. 03-app.js:723 */
export function lapseRefusal(s: ConsoleState, id: LeadId): string | null {
  const l = s.LEADS.find(x => x.id === id);
  if (!l || !isFin(s.ROLE) || !may(s, "pay", "record") || !inReservation(s, l)) return null;
  const p = s.PAY[id];
  const hd = p ? when(p.hold, s.NOW) : null;
  if (!hd || hd >= s.NOW) return null;               /* only a hold that has actually passed */
  const x = s.EXT[id];
  return x && x.state === "waiting"
    ? "There is an extension request waiting on the BU Owner. It has to be decided before the "
      + "reservation can be released."
    : null;
}

/** what `lapse()` asks before it does it. 03-app.js:727 */
export function lapseAsk(s: ConsoleState, id: LeadId): string | null {
  const l = s.LEADS.find(x => x.id === id);
  const p = s.PAY[id];
  if (!l || !p) return null;
  const forfeit = FORFEIT * l.units, back = Math.max(0, (p.got || 0) - forfeit);
  return "Release " + l.units + " unit" + (l.units > 1 ? "s" : "") + "?\n\n₹"
    + forfeit.toLocaleString("en-IN") + " is forfeit (₹" + FORFEIT.toLocaleString("en-IN")
    + " per unit) and ₹" + back.toLocaleString("en-IN")
    + " goes back to the investor under the standard refund rule, which the BU Owner has already "
    + "approved.\n\nThis is logged and cannot be undone here.";
}

/* ===== DOCUMENTS — 03-app.js:3868 ============================================================ */

/** the words `sendDoc()` refuses with, or null. 03-app.js:3874–3889 */
export function sendDocRefusal(s: ConsoleState): string | null {
  const l = s.LEADS.find(x => x.id === DSEL(s));
  const tpl = DTPLS.find(t => t.t === DTPL(s));
  if (!l || !tpl || l.done < ST.CONVERTED) return null;
  const owned = ROUNDS.find(R => R.tpl === tpl.t);
  if (owned)
    return tpl.t + " is sent from the lead's Paperwork, not from here.\n\nIt is one beat of a "
      + "round: " + (owned.k === "supp"
        ? "the IR has to agree a final draft with the investor first, and then"
        : "once it goes")
      + " somebody has to tell the investor, chase it, and verify the signed copy. "
      + "Sending it from this panel would skip those.";
  if (tpl.wet && DSIG(s) !== "Wet signature")
    return tpl.t + " is wet-sign only — it cannot go out for an electronic signature.";
  if (l.nri && DSIG(s) === "Aadhaar OTP")
    return l.n + " is an NRI. Aadhaar OTP needs an Aadhaar linked to a live Indian mobile — use a "
      + "Class 3 DSC or a wet signature.";
  const dup = s.DOCS.find(d => d.lead === l.id && d.t === tpl.t && d.state !== "blocked");
  if (dup)
    return tpl.t + " is already out to " + l.n + " (" + dup.state + ", " + (dup.on || "—") + ").\n\n"
      + "Chase the one that went rather than sending a second copy — two live copies of one agreement "
      + "is how a signature ends up on the wrong version.";
  return null;
}

/* ===== THE REDUCER =========================================================================== */

export function pagesDReducer(state: ConsoleState, action: Action): ConsoleState | null {
  if ("id" in action && action.id && !openable(state).some(l => l.id === action.id)) return state;
  switch (action.type) {

    /* ---- the receipt, and everything that follows from it ------------------------------------ */

    /* record(id, kind) — 03-app.js:1486 */
    case "record":
      return doRecord(state, action.id, action.kind);

    /* setPay(f, v) — 03-app.js:1477 */
    case "setPay":
      return {
        ...state,
        ui: {
          ...state.ui,
          ...(action.f === "who" ? { PSEL2: action.v }
            : action.f === "mode" ? { PMODE: action.v }
            : { PUTR: action.v }),
        },
      };

    /* Internal confirmation consequences are not public console source writers. */
    case "acctAuto":
    case "acctLapsed":
    case "xferAuto":
      return state;

    /* ---- THE INVESTOR SAYS THEY HAVE PAID — 03-app.js:1547 ---------------------------------- */

    /* setClaim(f, v) — 03-app.js:1569, extended by the payment-report redesign's amount/said_on
       (ir-console-redesigned.html:5433-5434) */
    case "setClaim":
      return {
        ...state,
        ui: {
          ...state.ui,
          ...(action.f === "kind" ? { CKIND: action.v as ClaimKind }
            : action.f === "mode" ? { CMODE: action.v }
            : action.f === "amount" ? { CAMOUNT: action.v }
            : action.f === "said_on" ? { CSAIDON: action.v }
            : action.f === "ref" ? { CREF: action.v }
            : { CNOTE: action.v }),
        },
      };

    /* claimPaid(id) — 03-app.js:1571. `Claim` now carries the redesign's id/amount/said_on/
       heldBefore/history (ir-console-redesigned.html:5396-5434). `@/features/lead/drawers/finance`
       (ClaimForm/ClaimFoot) already validates its own draft with `claimFieldsError` before
       dispatching this, but that is a UI convenience, not the gate — re-checked here too, against
       the exact fields about to be written, so a direct dispatch (a future caller, a test, a stray
       action) can never write a Claim with a zero/blank amount, a future or missing payment date,
       or a malformed reference. When no amount has been drafted yet this falls back to the same
       amount guess `claimBlock` already forgives — the 10% or the whole ticket — and today's date;
       that computed fallback is itself run through the same check before it may be written. */
    case "claimPaid": {
      const l = state.LEADS.find(x => x.id === action.id);
      if (!l || !canClaim(state, l)) return state;
      const ref = CREF(state).trim().toUpperCase();
      const at = at0(state);
      const advance = CKIND(state) === "advance";
      const amount = Number(CAMOUNT(state)) || Math.round(l.units * UNIT * (advance ? 0.1 : 1));
      const said_on = CSAIDON(state) || iso(state.TODAY);
      const fieldsErr = claimFieldsError(state, { kind: CKIND(state), mode: CMODE(state), amount, said_on, ref, note: CNOTE(state) });
      if (fieldsErr) return state;
      const id = "PR-" + action.id + "-" + (allClaims(state).length + 1);
      const c: Claim = {
        id, by: state.WHO, at, kind: CKIND(state), mode: CMODE(state), ref: ref || "—",
        amount, said_on, heldBefore: state.PAY[action.id]?.got || 0,
        note: CNOTE(state).trim(), state: "waiting",
        history: [{ type: "reported", by: state.WHO, at, note: "Payment report sent to Finance" }],
      };
      const s = addLog({ ...state, CLAIM: { ...state.CLAIM, [action.id]: c } },
        at, "Said the investor has paid", action.id,
        c.id + " · " + claimReportLabel(state, c) + " · " + c.mode
        + " " + (ref ? maskRef(ref) : "no reference"), "money");
      return { ...s, DRW: null, ui: { ...s.ui, CREF: "", CNOTE: "", CAMOUNT: "", CSAIDON: "" } };
    }

    /* confirmClaim(id) — ir-console-redesigned.html:5459-5468. Matching a report to a receipt Finance
       already confirmed never records money a second time — `claimReceiptMatch` answers the one
       question ("does exactly one confirmed receipt already describe this?") and this case only
       ever attaches that answer to the report. A report with no match, or more than one, stays
       waiting and carries `matchError` for the block to show, exactly as `confirmClaim` leaves
       `c.matchError` set without touching `c.state` in the prototype. */
    case "confirmClaim": {
      if (!isFin(state.ROLE) || !may(state, "pay", "record")) return state;
      const c = claimOf(state, action.id);
      if (!c || c.state !== "waiting") return state;
      const match = claimReceiptMatch(state, action.id);
      if (!match.ok) {
        return { ...state, CLAIM: { ...state.CLAIM, [action.id]: { ...c, matchError: match.why } } };
      }
      const at = at0(state);
      const { ok: _ok, why: _why, ...receipt } = match;
      const { matchError: _matchError, ...cRest } = c;
      const done: Claim = {
        ...cRest, state: "confirmed", did: state.WHO, on: at, receipt: receipt as PayReceipt,
        history: [...(c.history || []),
          { type: "matched", by: state.WHO, at, note: "Matched to an existing confirmed receipt" }],
      };
      return addLog({ ...state, CLAIM: { ...state.CLAIM, [action.id]: done } },
        at, "Matched the payment report", action.id,
        c.id + " · existing receipt · " + money(receipt.amount ?? 0), "money");
    }

    /* rejectClaim(id, why) — 03-app.js:1594 */
    case "rejectClaim": {
      if (!isFin(state.ROLE) || !may(state, "pay", "record")) return state;
      const c = claimOf(state, action.id);
      if (!c || c.state !== "waiting") return state;
      const at = at0(state);
      const why = action.why || "Not in the account yet";
      const done: Claim = { ...c, state: "notfound", did: state.WHO, on: at, why };
      return addLog({ ...state, CLAIM: { ...state.CLAIM, [action.id]: done } },
        at, "Could not find the payment", action.id,
        why + " · claimed by " + P(state.PEOPLE, c.by).n, "money");
    }

    /* reopenClaim(id) — 03-app.js:1626 */
    case "reopenClaim": {
      const c = claimOf(state, action.id);
      if (!c || c.state !== "notfound") return state;
      const l = state.LEADS.find(x => x.id === action.id);
      if (!l || !canReopenClaim(state, l)) return state;
      const at = at0(state);
      const back: Claim = { ...c, state: "waiting", did: undefined, on: undefined, why: undefined,
        history: [...(c.history || []), { type: "reopened", by: state.WHO, at,
          note: "Asked Finance to look again" }] };
      return addLog({ ...state, CLAIM: { ...state.CLAIM, [action.id]: back } },
        at, "Said the investor has paid", action.id, "asked Finance to look again", "money");
    }

    /* ---- THE SHELF, AND THE RESERVATION CLOCK ---------------------------------------------- */

    /* setReleased(d) — 03-app.js:680 */
    case "setReleased": {
      if (!canInv(state.ROLE)) return state;
      const was = state.INV.released;
      const rel = Math.max(invRes(state) + invAlloc(state),
        Math.min(state.INV.total, was + action.d));
      if (rel === was) return state;
      const at = at0(state);
      return addLog({ ...state, INV: { ...state.INV, released: rel, by: state.WHO, at } },
        at, "Changed sellable inventory", null, was + " → " + rel + " units released", "money");
    }

    /* askExt(id, days) — 03-app.js:699 */
    case "askExt": {
      const l = state.LEADS.find(x => x.id === action.id);
      if (!l || !canAskExt(state, l) || !inReservation(state, l)) return state;
      const at = at0(state);
      const x: ExtRec = { by: state.WHO, asked: at, days: action.days, why: "", state: "waiting" };
      return addLog({ ...state, EXT: { ...state.EXT, [action.id]: x } },
        at, "Asked for a reservation extension", action.id, action.days + " days", "money");
    }

    /* decideExt(id, ok) — 03-app.js:704. The BU Owner, and nobody else. */
    case "decideExt": {
      const x = state.EXT[action.id];
      const l = state.LEADS.find(y => y.id === action.id);
      if (!x || !l || !canDecideExt(state.ROLE) || !inReservation(state, l)
        || x.state !== "waiting") return state;
      const at = at0(state);
      const done: ExtRec = { ...x, state: action.ok ? "approved" : "declined", did: state.WHO, on: at };
      let s: ConsoleState = { ...state, EXT: { ...state.EXT, [action.id]: done } };
      /* an extension extends the deadline it was granted against — never resets it to today + n */
      const p = s.PAY[action.id];
      if (action.ok && p) {
        const from = when(p.hold, s.NOW) || s.NOW;
        const to = new Date(Math.max(from.getTime(), s.NOW.getTime()) + x.days * DAY);
        s = { ...s, PAY: { ...s.PAY, [action.id]: { ...p,
          hold: String(to.getDate()).padStart(2, "0") + " " + MON[to.getMonth()] } } };
      }
      return addLog(s, at,
        action.ok ? "Approved a reservation extension" : "Declined a reservation extension",
        action.id, x.days + " days · asked by " + P(state.PEOPLE, x.by).n, "money");
    }

    /* lapse(id) — 03-app.js:718 */
    case "lapse": {
      const l = state.LEADS.find(x => x.id === action.id);
      if (!l || !isFin(state.ROLE) || !may(state, "pay", "record") || !inReservation(state, l))
        return state;
      const p = state.PAY[action.id];
      const hd = p ? when(p.hold, state.NOW) : null;
      if (!hd || hd >= state.NOW) return state;      /* only a hold that has actually passed */
      if (lapseRefusal(state, action.id)) return state;
      const forfeit = FORFEIT * l.units, back = Math.max(0, (p ? p.got : 0) - forfeit);
      /* the ladder walks back to before the reservation, and the units go on the shelf */
      const at2 = l.at.slice();
      let done = l.done;
      while (done >= ST.RESERVED) { at2.pop(); done--; }
      const PAY = { ...state.PAY }; delete PAY[action.id];
      const EXT = { ...state.EXT }; delete EXT[action.id];
      const at = at0(state);
      let s: ConsoleState = {
        ...state,
        LEADS: state.LEADS.map(x => (x.id === action.id ? { ...x, at: at2, done } : x)),
        PAY, EXT,
      };
      s = acctLapsed(s, action.id, at);   /* the account follows the reservation, never leads it */
      return addLog(s, at, "Reservation lapsed", action.id,
        l.units + " unit" + (l.units > 1 ? "s" : "") + " released · ₹"
        + forfeit.toLocaleString("en-IN") + " forfeit, ₹" + back.toLocaleString("en-IN")
        + " refunded", "money");
    }

    /* ---- DOCUMENTS ------------------------------------------------------------------------- */

    /* sendDoc() — 03-app.js:3868 */
    case "sendDoc": {
      if (!isFin(state.ROLE) || !may(state, "docs", "send")) return state;
      const l = state.LEADS.find(x => x.id === DSEL(state));
      const tpl = DTPLS.find(t => t.t === DTPL(state));
      if (!l || !openable(state).some(x => x.id === l.id) || !tpl || l.done < ST.CONVERTED) return state;
      if (sendDocRefusal(state)) return state;
      const at = at0(state);
      const a = acctOf(state, l.id);
      const row: DocRec = {
        t: tpl.t, cls: tpl.cls, lead: l.id, on: at.slice(0, 6),
        state: DSIG(state) === "Wet signature" ? "sent" : "awaiting",
        ref: a ? a.code : null, how: DSIG(state), by: state.WHO,
      };
      return addLog({ ...state, DOCS: [row, ...state.DOCS] },
        at, "Sent document", l.id, tpl.t + " · " + DSIG(state), "doc");
    }

    /* recordDoc(id, t) — 03-app.js:1921. Receipts only: the NDA and the supplementary agreement
       have a round of their own. Reachable from no button — this is the link's handler. */
    case "recordDoc": {
      const l = state.LEADS.find(x => x.id === action.id);
      if (!l || !canDoc(state, l)) return state;
      if (!DCLS_EXTRA[action.t]) return state;
      const at = at0(state);
      const i = state.DOCS.findIndex(d => d.lead === action.id && d.t === action.t);
      if (i >= 0) {
        /* a document already out is not recorded twice; one that came back BLOCKED is updated in
           place and never duplicated */
        if (state.DOCS[i].state !== "blocked") return state;
        const DOCS = state.DOCS.slice();
        DOCS[i] = { ...DOCS[i], state: "sent", on: at, by: state.WHO };
        return addLog({ ...state, DOCS }, at, "Recorded that it went", action.id,
          action.t + " · was blocked · recorded by " + titleOf(state.PEOPLE, state.WHO), "doc");
      }
      const a = acctOf(state, action.id);
      const row: DocRec = {
        lead: action.id, t: action.t, cls: dClsOf(action.t) as DocClass, state: "sent", on: at,
        how: null, ref: a ? a.code : null, by: state.WHO,
      };
      return addLog({ ...state, DOCS: [...state.DOCS, row] }, at, "Recorded that it went", action.id,
        action.t + " · recorded by " + titleOf(state.PEOPLE, state.WHO), "doc");
    }

    /* ---- RECOVERY ACTIONS — 03-app.js:4135. Manual Table 22: BU Owner / Operations. ---------
       Declared TODO(pages-c) in the store and named in this agent's own region table; implemented
       here because the only screen that reaches them is Numbers. Both implementations write the
       same line, so whichever reducer is asked first is the right answer. */
    case "setRecov": {
      if (!canRecov(state)) return state;
      if (!kpis(state).some(m => m.k === action.k)) return state;
      if (!(RECOVACTS as readonly string[]).includes(action.act)) return state;
      const w = state.PEOPLE[action.who];
      if (!w || !w.on) return state;
      const at = at0(state);
      const by = plusDays(action.days, state.NOW);
      return addLog({ ...state, RECOV: { ...state.RECOV,
        [action.k]: { who: action.who, act: action.act as RecovAction, by, at, set: state.WHO } } },
        at, "Set a recovery action", null,
        action.k + ": " + action.act + " · " + P(state.PEOPLE, action.who).n + " by " + by, "admin");
    }

    case "clearRecov": {
      if (!canRecov(state) || !state.RECOV[action.k]) return state;
      const a = state.RECOV[action.k].act;
      const R = { ...state.RECOV }; delete R[action.k];
      return addLog({ ...state, RECOV: R }, at0(state), "Cleared a recovery action", null,
        action.k + ": " + a, "admin");
    }

    default:
      return null;
  }
}
