/* M12-S11-W1 / S13-W1 — the lead page's Paperwork row, the IR's word on a paper, and the NDA that gates the deck:
     GET  /api/leads/[id]/paperwork          { rounds[{next, told, reminders, said, draft, agreed, sent, verified}], offers[{round, beat, channels, rowToken}] }
     POST /api/leads/[id]/paperwork          one beat: { round, beat, channel?, rowToken, attachmentId? | link? } → { undoToken, undoUntil }
     POST /api/leads/[id]/paperwork          { undoToken } within 10 s
     GET  /api/leads/[id]/hints?paper=       what the IR said about that paper (never a signature)
     GET  /api/documents/queue               Finance's papers out for signature, the IR's word first, then age (M12-S11-NOTE-3)
   Live: the routes. Fixture (lead side, the book is ConsoleState; Investors side, ImBook): the same answers projected from
   the same selectors the row already used (prNext, prChases, conFor, canWork) and the reducer's `lpPaper` / `lpRestore`.
   Finance's beats are never here: the route refuses them, and the fixture offers none. */

import type { Hint } from "@/server/leads/hints";
import type { PaperworkQueue } from "@/server/documents/queue";
import { rankForFinance } from "@/lib/selectors/finance-rank";
import { documentsList } from "./documents";
import type { Offer, PaperworkRow, RoundView, RoundKey } from "@/server/leads/paperwork";
import { ROUNDS } from "@/domain";
import type { Action } from "@/lib/state";
import type { ConsoleState } from "@/lib/store";
import { canReadFinance, canWork, conFor, pr, prChases, prNext } from "@/lib/selectors";
import type { LpSnap } from "@/features/lead/reducer";
import { I, who } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import type { ImBook } from "./im";

export type LeadDispatch = (a: Action) => void;
export type { PaperworkRow, RoundView, Offer, RoundKey };
export type IrBeat = "told" | "chase" | "said" | "draft" | "redraft" | "agreed";
export type PwChannel = "call" | "msg" | "email";
const CHANNELS: readonly PwChannel[] = ["call", "msg", "email"];

/* ---- the row (M12-S11-W1) ---------------------------------------------------------------------------- */
/** The IR beats that answer a prNext step (server/leads/paperwork beatsFor: chasing and "they say it's signed" both answer "said"). */
function beatsOf(next: { k: string; who?: string | null }, hasDraft: boolean): IrBeat[] {
  if (next.who !== "IR") return [];
  switch (next.k) {
    case "told": return ["told"];
    case "said": return ["chase", "said"];
    case "draft": return ["draft"];
    case "agreed": return hasDraft ? ["redraft", "agreed"] : [];
    default: return [];
  }
}

export const paperworkRow: ReadEndpoint<ConsoleState, string | null, PaperworkRow> = {
  path: id => (id ? `/api/leads/${encodeURIComponent(id)}/paperwork` : null),
  pick: j => j as PaperworkRow,
  fixture(state, id) {
    const l = state.LEADS.find(x => x.id === id);
    if (!l) return fail(404, "not-visible", "Not saved — the lead is unavailable.");
    if (!(canReadFinance(state, l, "docs") || canWork(state, l))) return fail(403, "not-in-book", "Not saved — this lead is not in your book.");
    const work = canWork(state, l);
    const channels = CHANNELS.filter(ch => conFor(l, ch));
    const offers: Offer[] = [];
    const rounds = ROUNDS.map((R): RoundView => {
      const p = pr(state, l.id, R.k) || {};
      const next = prNext(state, l, R.k);
      if (work) for (const beat of beatsOf(next, !!p.draft))
        offers.push({ round: R.k, beat, channels: beat === "told" || beat === "chase" ? channels : [], rowToken: `${l.id}.${R.k}.${beat}` });
      return {
        round: R.k, title: R.k === "nda" ? "NDA" : "Supplementary agreement", next,
        told: p.told ? { channel: p.told.ch as PwChannel, at: p.told.at as string } : null,
        reminders: prChases(state, l.id, R.k, "sign").length,
        said: p.said ? { by: p.said.by as string, at: p.said.at as string } : null,
        draft: p.draft ? { version: p.draft.v, ref: p.draft.link, at: p.draft.at as string } : null,
        agreed: p.agreed ? { version: p.draft ? p.draft.v : null, ref: p.agreed.link, at: p.agreed.at as string } : null,
        back: p.back ? { by: p.back.by as string, at: p.back.at as string, why: p.back.why } : null,
        sent: !!p.sent, verified: !!p.ok,
      };
    });
    return ok({ leadId: l.id, modifiedTime: "", rounds, offers, suppUnread: false });
  },
};

/** The round the row is about: the first one with an IR or Finance beat still to come (paperNow). */
export const currentRound = (row: PaperworkRow): RoundView | null =>
  row.rounds.find(r => !["done", "wait", "none"].includes(r.next.k)) || null;
/** Has the NDA come back signed and been verified? The gate on the deck and the webinar (D60). */
export const ndaSigned = (row: PaperworkRow): boolean => !!row.rounds.find(r => r.round === "nda")?.verified;

/* ---- a beat and its Undo ------------------------------------------------------------------------------ */
export type StepArgs = { leadId: string; round: RoundKey; beat: IrBeat; channel?: PwChannel; rowToken: string; link?: string; attachmentId?: string };
export type StepDone = { round: string; beat: string; undoToken: string | null; undoUntil: number | null; draftVersion: number | null };

export const paperworkStep: WriteEndpoint<ConsoleState, StepArgs, StepDone, LeadDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.leadId)}/paperwork`,
  body: a => ({ round: a.round, beat: a.beat, rowToken: a.rowToken,
    ...(a.channel ? { channel: a.channel } : {}), ...(a.link ? { link: a.link } : {}), ...(a.attachmentId ? { attachmentId: a.attachmentId } : {}) }),
  pick: j => j as StepDone,
  fixture(state, dispatch, a): ApiResult<StepDone> {
    const l = state.LEADS.find(x => x.id === a.leadId);
    if (!l || !canWork(state, l)) return fail(403, "capability-missing", "Not saved — this seat does not work leads.");
    const R = ROUNDS.find(x => x.k === a.round);
    const next = R ? prNext(state, l, R.k) : null;
    if (!next || !beatsOf(next, !!(pr(state, l.id, R!.k) || {}).draft).includes(a.beat))
      return fail(409, "out-of-order", "Not saved — that is not the next step on this paperwork.");
    if ((a.beat === "told" || a.beat === "chase") && !(a.channel && conFor(l, a.channel)))
      return fail(403, "no-consent", "Not saved — the investor has not given permission for that channel.");
    dispatch({ type: "lpPaper", id: a.leadId, beat: a.beat, rk: a.round, a: a.channel, link: a.link });
    return ok({ round: a.round, beat: a.beat, undoToken: null, undoUntil: null, draftVersion: null });
  },
};

export type UndoArgs = { leadId: string; undoToken: string | null; snap: LpSnap | null; label: string };
export const paperworkUndo: WriteEndpoint<ConsoleState, UndoArgs, { undone: true }, LeadDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.leadId)}/paperwork`,
  body: a => ({ undoToken: a.undoToken }),
  pick: () => ({ undone: true }),
  fixture(_state, dispatch, a) {
    if (!a.snap) return fail(410, "undo-expired", "Undo is no longer offered.");
    dispatch({ type: "lpRestore", id: a.leadId, snap: a.snap, label: a.label });
    return ok({ undone: true });
  },
};

/* ---- the IR's word on one paper, for Finance's verify panel (M12-S11-W1) ---------------------------------- */
export type HintsArgs = { leadId: string | null; paper: "nda" | "fema" | "supplementary" | "allocation-letter" };
export type HintsAnswer = { hints: Hint[]; note: string };
const ROUND_OF_PAPER: Record<string, string | undefined> = { nda: "nda", supplementary: "supp" };
export const NOT_A_SIGNATURE = "That is what they were told, not a signature.";
export const NO_WORD = "No word from the IR yet.";

export const leadHints: ReadEndpoint<ImBook, HintsArgs, HintsAnswer> = {
  path: a => (a.leadId ? `/api/leads/${encodeURIComponent(a.leadId)}/hints?paper=${a.paper}` : null),
  pick: j => j as HintsAnswer,
  fixture({ s, me }, a) {
    /* a hint is about one paper only: an IR's word on the supplementary is never shown on the allocation letter */
    const round = ROUND_OF_PAPER[a.paper];
    const x = s.data.INV.find(i => i.lead === a.leadId && I(s, me, i.id));
    const n = round && x ? s.data.INBOX.find(m => m.inv === x.id && m.kind === "signed" && m.doc === round) : null;
    const hints: Hint[] = n ? [{ leadId: a.leadId!, round: round as RoundKey, paper: a.paper, by: { id: n.ir, name: who(s, n.ir).n || n.ir }, at: n.at,
      words: round === "nda" ? "They say the NDA is signed and sent" : "They say the supplementary is signed and sent" }] : [];
    return ok({ hints, note: hints.length ? NOT_A_SIGNATURE : NO_WORD });
  },
};

/** the toast a saved beat gives (the reducer's own words for it, lead/reducer.ts lpPaper) */
export const stepSaved = (beat: string, round: string, channel: string | undefined, draftVersion: number): string => {
  const nm = round === "nda" ? "NDA" : "Supplementary agreement";
  const by = channel === "call" ? "call" : channel === "msg" ? "WhatsApp" : "email";
  const M: Record<string, string> = {
    told: nm + " — told them by " + by, chase: nm + " reminder by " + by + " · on the contact history too",
    said: "They say the " + nm + " is signed — Finance checks it in the IM portal", draft: "Supplementary draft sent",
    agreed: "Final draft agreed — Finance sends it for signature", redraft: "Draft " + (draftVersion + 1) + " sent",
  };
  return "Saved · " + (M[beat] || nm);
};

/* ---- Finance's queue in the order to work it (M12-S11-NOTE-3) ----------------------------------------- */
/** The route's answer. Fixture: the Documents "out" rows of the book, each with the IR's word from the book's inbox
 *  (the same match leadHints makes), ranked by the very function the route runs (lib/selectors/finance-rank). */
export const paperworkQueue: ReadEndpoint<ImBook, boolean, PaperworkQueue> = {
  path: on => (on ? "/api/documents/queue" : null),
  pick: j => (j as { queue: PaperworkQueue }).queue,
  fixture(b, on) {
    if (!on) return fail(400, "invalid-request", "Nothing to read.");
    const list = documentsList.fixture(b, "out");
    if (!list.ok) return list;
    if (!list.data.actions.verify) return fail(403, "seat-denied", "Finance works the paperwork queue.");
    const hints = new Map<string, Hint[]>();
    const items = list.data.rows.map(r => {
      const x = r.contactId ? I(b.s, b.me, r.contactId) : null;
      const round = ROUND_OF_PAPER[r.paper];
      const n = round && x ? b.s.data.INBOX.find(m => m.inv === x.id && m.kind === "signed" && m.doc === round) : null;
      const leadId = x && x.lead && r.paper === "supplementary" ? x.lead : null;
      if (n && leadId) hints.set(leadId, [{ leadId, round: round as RoundKey, paper: r.paper, by: { id: n.ir, name: who(b.s, n.ir).n || n.ir }, at: n.at,
        words: "They say the supplementary is signed and sent" }]);
      return { ...r, leadId, sentAt: r.sign ? r.sign.sentAt : null };
    });
    const ranked = rankForFinance(items, { ok: true, hints });
    return ok({
      rows: ranked.items.map(({ sentAt: _s, ...row }) => row), outCount: list.data.outCount, irSideRead: ranked.irSideRead, note: ranked.note,
    });
  },
};
