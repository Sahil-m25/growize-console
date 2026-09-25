/* ── selectors/paper.ts — two rounds, one baton ─────────────────────────────────────────────
   Ports `ref/03-app.js` lines 1645–1726 (the round model and every read on it). The beats
   themselves — `prDraft`, `prRedraft`, `prAgreed`, `prSend`, `prTold`, `prChase`, `prSaid`,
   `prVerify`, `prBounce` — are writes and belong to the store; what they all read is here.

   ===== PAPERWORK: TWO ROUNDS, ONE BATON ====================================================
   Paper is not one event, it is a relay, and it changes hands four times. Finance sends it, because
   Finance holds the mailbox and the signing account. The IR tells the investor it is there, because
   the IR is the only person the investor actually answers. The IR chases — once, twice, by whatever
   channel works — and each chase is kept, because "we have asked him four times" is a fact, not a
   memory. The investor tells the IR they have signed. And Finance verifies that the signed copy
   really arrived, because a claim is not a signature any more than a claim is a payment.

   It happens twice. The NDA goes first and gates the material: nothing is sent to somebody who has
   not signed one. The supplementary agreement comes after the investor has said yes, and it starts
   earlier than the others — the IR writes a draft, chases agreement on it, and records the link to
   the final draft, which is what Finance sends for signature. Only when that is verified does any
   money get recorded.

   The IR sees the draft, because they wrote it. They never see an executed original.
   ========================================================================================= */

import { LADDER, ROUNDS } from "@/domain";
/* the copy that goes with a beat is @/domain's: IMP, PCH, PCHD, PCHN */
import type {
  Beat, ChaseBeat, Lead, LeadId, PaperBeat, PaperNext, PaperRound, PaperWho, RoundKey, Stamp,
} from "@/domain";
import type { Ctx } from "./ctx";
import { isFin, may } from "./access";
import { custodian, inBookOf, lost } from "./leads";

export type Round = (typeof ROUNDS)[number];

/* a round: {draft:{by,at,link,v}, agreed:{by,at,link}, sent:{by,at,via}, told:{by,at,ch},
             chase:[{by,at,ch,phase}], said:{by,at}, ok:{by,at}, back:{by,at,why}} — @/domain's
   PaperRound is that shape; these aliases keep the prototype's own words for it. */
export type RoundRow = PaperRound;
export type Chase = ChaseBeat;

export const RND = (k: string): Round | null => ROUNDS.find(x => x.k === k) || null;

/* ---- reading a round ------------------------------------------------------------------------ */
export const pr = (ctx: Ctx, id: LeadId, k: string): RoundRow | null =>
  ((ctx.PAPER[id] || {}) as Record<string, RoundRow>)[k] || null;

export const prDone = (ctx: Ctx, id: LeadId, k: string): boolean => !!(pr(ctx, id, k) || {}).ok;

export const prAt = (ctx: Ctx, id: LeadId, k: string, f: string): Stamp | null =>
  ((((pr(ctx, id, k) || {}) as Record<string, Beat | undefined>)[f]) || {}).at || null;

export const prChases = (ctx: Ctx, id: LeadId, k: string, phase?: string): Chase[] =>
  ((pr(ctx, id, k) || {}).chase || []).filter(x => !phase || x.phase === phase);

/* The prototype's `prRow(id,k)` CREATED the row as a side effect of reading it. Split: this is the
   read — the row as it stands, or an empty one that is not written anywhere. The store keeps the
   ensure-and-write half under the same name. */
export const prRow = (ctx: Ctx, id: LeadId, k: string): RoundRow =>
  pr(ctx, id, k) || { chase: [] };

/* the two gates the rounds put on the rest of the ladder */
export const ndaOK = (ctx: Ctx, l: Lead | null | undefined): boolean => !!l && prDone(ctx, l.id, "nda");
export const suppOK = (ctx: Ctx, l: Lead | null | undefined): boolean => !!l && prDone(ctx, l.id, "supp");

/* ---- WHOSE MOVE IT IS -----------------------------------------------------------------------
   Strictly in order — a beat cannot be recorded before the one in front of it, because a signature
   nobody was told about is not a thing that happens. */
export type BeatKey = PaperBeat;
export type Who = PaperWho | null;
export type PrNext = PaperNext;

export function prNext(ctx: Ctx, l: Lead | null | undefined, rk: string): PrNext {
  const R = RND(rk);
  if (!l || !R) return { k: "none" };
  if (lost(l)) return { k: "none", t: "Closed as lost", who: null };
  const p = pr(ctx, l.id, rk) || {};
  if (l.done < R.from) return { k: "wait", t: "Waits for “" + LADDER[R.from - 1].t + "”", who: null };
  /* the rounds are in order too: no commercial paper before the confidentiality paper is back */
  if (R.needs && !prDone(ctx, l.id, R.needs))
    return { k: "wait", t: "Waits for the " + RND(R.needs)!.t + " to come back signed", who: null };
  if (R.draft) {
    if (!p.draft) return { k: "draft", t: "Send the draft", who: "IR" };
    if (!p.agreed) return { k: "agreed", t: "Get the final draft agreed", who: "IR" };
  }
  if (!p.sent) return { k: "sent", t: "Send it for signature", who: "Finance" };
  if (!p.told) return { k: "told", t: "Tell them it is there", who: "IR" };
  if (!p.said) return { k: "said", t: "Chase the signature", who: "IR" };
  if (!p.ok) return { k: "ok", t: "Verify the signed copy", who: "Finance" };
  return { k: "done", t: "Signed and verified", who: null };
}

/* ---- WHERE EACH BEAT IS PERFORMED -----------------------------------------------------------
   Finance does not work in this console. The document is uploaded, sent and verified in the
   Investor Management portal, because that is where the file and the signing account live. If
   Finance also had to come back here and record that they had done it, that is two entries for one
   fact — the exact thing this product exists to stop. So the two Finance beats are not typed here
   by anyone in an IR seat. They ARRIVE over the link and are shown with their source on them.
   The words themselves — IMP, PCH, PCHD, PCHN — are @/domain's. */

/* The console reads Finance's round history. Source changes belong only to Investor Management;
   ordinary lead contacts and reported payment claims remain separate console operations. */
export const prIR = (_ctx: Ctx, _l: Lead | null | undefined): boolean => false;

export const prMine = (ctx: Ctx, l: Lead | null | undefined, who: Who): boolean =>
  who === "Finance" ? (isFin(ctx.ROLE) && may(ctx, "docs", "send"))
    : who === "IR" ? prIR(ctx, l)
    : false;

/* a round is only workable at all while the lead is open and has reached the rung it starts on —
   the two ungated writes (chasing, and re-drafting) have to check it for themselves */
export const prOpen = (ctx: Ctx, l: Lead | null | undefined, rk: string): boolean => {
  const R = RND(rk);
  return !!l && !!R && !lost(l) && custodian(l) !== "Closed" && l.done >= R.from
    && (!R.needs || prDone(ctx, l.id, R.needs));
};

export const prTurn = (ctx: Ctx, l: Lead | null | undefined, rk: string): boolean => {
  const n = prNext(ctx, l, rk);
  return !!n.who && prMine(ctx, l, n.who);
};

/* the decision half of the prototype's `prGate(id,rk,beat)`: is this exact beat the one that is
   next, and is it mine? The store's `prGate` writes; this only answers. */
export const prGate = (ctx: Ctx, l: Lead | null | undefined, rk: string, beat: BeatKey): boolean => {
  if (!l) return false;
  const n = prNext(ctx, l, rk);
  return n.k === beat && !!n.who && prMine(ctx, l, n.who);
};
