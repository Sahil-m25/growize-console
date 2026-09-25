/* ── selectors/ladder.ts — the rungs, the gates, and the edit window ────────────────────────
   Ports `ref/03-app.js` lines 1047–1102 (the gate), 1242–1277 (stepOwner, skipStage, tick),
   2118–2150 (the edit window and undoStage), 2936–2939 (the four bands).

   Every function here is the DECISION half of something the prototype did in one breath. `tick`
   both decided and pushed a stamp; `skipStage` both decided and incremented `done`; `undoStage` was
   already only a decision. The store keeps the writes under the prototype's own names — `tick`,
   `untick`, `skipStage` — and asks these first.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { BANDS, EDIT_H, LADDER, ROUNDS, ST } from "@/domain";
import type { Lead } from "@/domain";
import { agoStr, ageH, money } from "@/lib/format";
import type { Ctx } from "./ctx";
import { canEdit, isIR, seeMoney } from "./access";
import { claimOpen } from "./claims";
import { payOf, whyLocked } from "./leads";
import { prDone } from "./paper";

export type Rung = (typeof LADDER)[number];

/* which rung a lead is STANDING ON — the next one to be ticked. Undefined once every rung is done. */
export const rungNow = (l: Lead): Rung | undefined => LADDER[l.done];
/* the rung it last ticked — what "Recorded 3 hours ago" is about */
export const rungDone = (l: Lead): Rung | undefined => LADDER[Math.max(0, l.done - 1)];
/* what a rung asks to see before it may be ticked, in the manual's words */
export const evidenceFor = (r: Rung | undefined): string | null => (r && r.ev) || null;

/* the four phases of the manual's eight stages, mapped onto the nine rungs (BANDS is @/domain's) */
export const bandOf = (d: number) => BANDS.find(b => d <= b.to) || BANDS[3];

/* ===== THE GATE, NOT A HANDOVER =============================================================
   The lead never leaves the IR. What used to happen at the ten per cent — custody passing to
   Finance, the person who has spoken to this investor forty times reduced to watching — is gone.
   It produced a lead nobody was working and an investor whose own contact could not answer a
   question about their own money.

   What replaces it is a GATE. Three rungs rest on a fact only Finance can establish: money in
   the bank, and a signed document in hand. The IR still owns the lead, still ticks the rung,
   still does every bit of the chasing — but cannot tick PAST a gate until Finance has confirmed
   that fact in the Investor Management portal. Ownership does not move; the truth gets checked.

   The gate is the whole of Finance's power here, and it is a veto rather than a possession.

   A closed gate has TWO very different meanings and the console must never confuse them, because
   one of them is the IR's own work and the other is somebody else's:

     the investor has not paid  — nothing has arrived, there is nothing for Finance to find, and
                                  the next move is the IR's. That is a chase, not a queue.
     Finance has not confirmed  — the IR has said the money has gone and is now waiting. This is
                                  the only state in which the word "waiting" is honest, and it is
                                  the one the investor feels, because their own contact has
                                  nothing to tell them.

   Saying "waiting on Finance" in the first case would blame a colleague for an investor's
   silence, and would teach everybody to ignore the words on the banner.
   ========================================================================================== */
export type GateKey = "advance" | "balance" | "alloc";
export type Gate = {
  t: string; chase: string; wait: string;
  /* `met` reads the receipts and the paper, so it takes Ctx — the prototype's closed over globals */
  met: (ctx: Ctx, l: Lead) => boolean;
};

export const GATES: Record<GateKey, Gate> = {
  advance: {
    t: "the ten per cent in the bank",
    chase: "Nothing has arrived yet. Ask for it, and when they tell you it has gone, record "
      + "what they said — Finance sees it on their day with one button on it.",
    wait: "Finance has to find the advance in the account and confirm it.",
    met: (ctx, l) => !!payOf(ctx, l.id),
  },
  balance: {
    t: "the balance in the bank",
    chase: "The hold is running and the balance is not in. That is your chase — record what "
      + "the investor tells you and Finance picks it up.",
    wait: "Finance has to find the balance and confirm it. The hold is still running.",
    met: (ctx, l) => { const p = payOf(ctx, l.id); return !!p && p.state === "full"; },
  },
  alloc: {
    t: "the money in and every document verified",
    chase: "The paperwork is not finished. Whatever is outstanding on it is on the Paperwork "
      + "card, and most of it is a signature you are chasing.",
    wait: "Finance has the money and has still to verify a signed agreement.",
    met: (ctx, l) => {
      const p = payOf(ctx, l.id);
      return !!p && p.state === "full" && ROUNDS.every(R => prDone(ctx, l.id, R.k));
    },
  },
};

export const gateOf = (l: Lead | null | undefined): GateKey | null =>
  !l || l.done >= LADDER.length ? null : ((rungNow(l) as { gate?: GateKey } | undefined)?.gate || null);

export const gateMet = (ctx: Ctx, l: Lead): boolean => {
  const g = gateOf(l);
  return !g || GATES[g].met(ctx, l);
};

/* who it is actually waiting on. "fin" only when the IR has handed something over and is stuck. */
export const gateWho = (ctx: Ctx, l: Lead): "fin" | "ir" | null => {
  const g = gateOf(l);
  if (!g || GATES[g].met(ctx, l)) return null;
  if (claimOpen(ctx, l.id)) return "fin";
  const p = payOf(ctx, l.id);
  if (g === "alloc" && !!p && p.state === "full") return "fin";   /* money in, paper not verified */
  return "ir";
};

export type GateWait = Gate & { who: "fin" | "ir"; d: string };

export const gateWait = (ctx: Ctx, l: Lead): GateWait | null => {
  const g = gateOf(l), w = gateWho(ctx, l);
  return g && w ? { ...GATES[g], who: w, d: w === "fin" ? GATES[g].wait : GATES[g].chase } : null;
};

/* ===== WHO MAY MOVE THE RECORD ==============================================================
   one answer for the ladder, and it is the same one canEdit gives.
   Every rung on the ladder belongs to the IR now, so this asks one question rather than three.
   It is kept as a function because the ladder is data and a later rung could belong elsewhere.
   ========================================================================================== */
export function stepOwner(ctx: Ctx, i: number, l: Lead | null | undefined): boolean {
  void i;
  if (l && !canEdit(ctx, l)) return false;          /* the UI and the handler cannot disagree */
  return ["ir", "cp", "conv"].includes(ctx.PEOPLE[ctx.WHO]?.seat || "");
}

/* one answer, and the sentence that goes with a no. `why: null` is the prototype's silent refusal —
   there is nothing to say to somebody who was never offered the control. */
export type Verdict = { ok: boolean; why: string | null };

/* the decision half of `tick(id)`. The store's `tick` asks this, then stamps and increments. */
export function tickStage(ctx: Ctx, l: Lead | null | undefined): Verdict {
  if (!l || l.done >= LADDER.length) return { ok: false, why: null };
  if (!stepOwner(ctx, l.done, l)) return { ok: false, why: null };
  if (l.done < ST.TOUCH && !l.consent)               /* nothing outbound without consent */
    return { ok: false, why: "Consent has to be recorded before any outbound step." };
  /* the gate. The lead is still yours; this rung just is not true yet. */
  const g = gateWait(ctx, l);
  if (g) return {
    ok: false,
    why: "“" + LADDER[l.done].t + "” needs " + g.t + ".\n\n" + g.d
      + (g.who === "fin"
        ? "\n\nThe lead stays with you either way — you are not handing it over. One rung is "
          + "waiting on a fact somebody else has to check."
        : "\n\nNothing is queued anywhere and nobody else is holding this up. It is your move."),
  };
  return { ok: true, why: null };
}

/* the decision half of `skipStage(id)`. Engagement is the one rung that is not a mandatory gate. */
export const canSkipStage = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && l.done === ST.ENGAGED - 1 && canEdit(ctx, l) && stepOwner(ctx, l.done, l);

/* ===== THE EDIT WINDOW ======================================================================
   A correction is normal; a rewrite is not. Anything recorded can be taken back for EIGHT HOURS
   and only ONE rung back — long enough to fix the tap you fat-fingered on the way out of a
   clubhouse, short enough that yesterday's history is history. Past that the record stands.
   Every refusal says which rule stopped you, in words. EDIT_H is @/domain's.
   ========================================================================================== */
export const fresh = (t: string | null | undefined, NOW: Date): boolean => {
  const h = ageH(t, NOW);
  return h != null && h >= -0.05 && h <= EDIT_H;
};

/* one answer for "may I take this back", and the sentence that goes with a no */
export function undoStage(ctx: Ctx, l: Lead | null | undefined): Verdict {
  if (!l || l.done <= 1) return { ok: false, why: "There is nothing before this one." };
  const at = l.at[l.done - 1], rung = LADDER[l.done - 1];
  if (!canEdit(ctx, l)) return { ok: false, why: whyLocked(ctx, l) };
  if (!stepOwner(ctx, l.done - 1, l))
    return { ok: false, why: "“" + rung.t + "” belongs to " + rung.who + ", so only they can undo it." };
  if (!fresh(at, ctx.NOW))
    return {
      ok: false,
      why: "Recorded " + agoStr(at, ctx.NOW) + ". A rung can be undone for " + EDIT_H
        + " hours, and only one back.",
    };
  /* ONE back, and one means one. Without this the eight-hour window walks a lead all the way down
     the ladder a click at a time, which is not what "one rung back" says. */
  if (fresh(l.undoAt || "", ctx.NOW))
    return {
      ok: false,
      why: "“" + (l.undoWhat || "A rung") + "” was already taken back " + agoStr(l.undoAt, ctx.NOW)
        + ". One rung back is one — a second correction is a new record.",
    };
  return { ok: true, why: "Undo “" + rung.t + "” · recorded " + agoStr(at, ctx.NOW) };
}

/* the two things that outrank a correction, in one place, because the drawer can sit open while
   either of them becomes true (ir-console-redesigned.html:5236-5244). `undoStage`'s own refusal
   comes first; a lead with money recorded against it, still at or before PAID, is refused a
   second way even when the edit window would otherwise allow it — the payment has to be reversed
   or the reservation lapsed before the stage under it can move. */
export function undoBlock(ctx: Ctx, l: Lead | null | undefined): string | null {
  const u = undoStage(ctx, l);
  if (!u.ok) return u.why + " A correction after that is a new record, not an edit — which is "
    + "what keeps the history worth reading.";
  if (!l) return null;
  const p = payOf(ctx, l.id);
  if (p && l.done <= ST.PAID)
    return "There is a payment recorded against this lead. Undoing the stage would leave "
      + (seeMoney(ctx, l) ? money(p.got) : "a payment") + " held against a lead that is not "
      + "reserved. The payment has to be reversed or the reservation lapsed first.";
  return null;
}
