/* Cluster C1 — contact and next step (docs/architecture/ir-write-map.md).
     followupSave  POST   /api/leads/[id]/followup        saveFollowup (the follow-up drawer)
     leadFinish    POST   /api/leads/[id]/followup        lpFinish (the lead page's finish flow)
     leadLose      POST   /api/leads/[id]/followup        lpLose (the same, "they're out": the contact and the loss in one write)
     touchRecord   POST   /api/leads/[id]/touches         logTouch (quick log), saveTouch (a past attempt or a reply)
     nextSave      PUT    /api/leads/[id]/next            saveNext
     nextMove      POST   /api/leads/[id]/next/move       pullIn, moveNextTo (a whole-day shift, negative to pull earlier)
     lostClose     POST   /api/leads/[id]/lost            closeLost
     lostReopen    DELETE /api/leads/[id]/lost            reopenLost (the caller supplies the next step that comes back)
   Not here, and why: dropTouch (Touches.Voided_At does not exist), clearNext (waits on an owner ruling), lpRestore (undo-by-delete
   is out of scope: a human token holds no Delete).
   Live: the routes, each carrying the lead's `Modified_Time` the page loaded (`l.mt`) as expectedModifiedTime (409 lead-changed);
   the ones that insert carry an Idempotency-Key. Fixture (FIXTURE_MODE=local): the same answer from the reducer action the write
   replaces, which runs as before. The book carries no activity id yet (PROVISIONAL, M07-S05-W1), so `scheduled` / `activity`
   go as null: the Lead's Next_Step* is what moves, and an open Zoho activity is left as it is. */

import type { Channel, Lead } from "@/domain";
import { lost } from "@/lib/selectors";
import type { Action, ConsoleState, FollowupDraft } from "@/lib/state";
import { fail, type ApiErr, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* ---- the words the commands are built from -------------------------------------------------- */
const IST = "+05:30";
const HHMM = /^\d{2}:\d{2}$/;
/** An ISO day and `HH:MM` as the Zoho datetime the services take (rule 9: every clock is Asia/Kolkata). */
export const istAt = (day: string, tm: string | undefined, dflt: string): string => `${day}T${tm && HHMM.test(tm) ? tm : dflt}:00${IST}`;
/** A call answered / a visit held is a reached contact; a message or an email counts as made. Only a reached contact
 *  counts toward First touch (server/leads/followup save). */
export const reachedOf = (channel: string, outcome: string): boolean =>
  channel === "call" ? !["No answer", "Wrong number"].includes(outcome) : channel === "visit" ? outcome !== "Investor unavailable" : true;

const lead = (state: ConsoleState, id: string): Lead | undefined => state.LEADS.find(x => x.id === id);
const REFUSED = (what: string): ApiErr => fail(422, "refused", `Not saved — ${what}.`);
/** The route's 409 for a page that never read the lead's Modified_Time (live only). */
export const NO_MT = (): ApiErr => fail(409, "lead-changed", "Changed by someone else — reload.");

/* ---- the follow-up save --------------------------------------------------------------------- */
export type FollowupArgs = {
  id: string;
  /** Leads.Modified_Time as the page loaded it (`l.mt`). */
  mt: string | null | undefined;
  d: FollowupDraft;
  /** The ISO day it is today, for a finish flow that picked no date (the reducer's own default). */
  today: string;
  /** Close as lost in the same save (one of the eight reasons): lpLose. */
  lostWhy?: string | null;
};
export type Saved = { touchId: string | null; nextId: string | null; undoToken: string | null; undoUntil: number | null };

/** The route's body for a draft. Objections ride in the touch's note (Touches has no Objections field yet). */
export function followupBody(a: FollowupArgs): Record<string, unknown> {
  const { d } = a;
  const losing = !!a.lostWhy;
  const note = [(d.note || "").trim(), d.obj && d.obj.length ? "Objections: " + d.obj.join(", ") : ""].filter(Boolean).join(" · ");
  const hasNext = !d.keep && !d.noNext && !losing && !!(d.t && d.t.trim());
  return {
    expectedModifiedTime: a.mt ?? null,
    contact: { channel: d.channel, outcome: d.outcome, occurredAt: istAt(d.d, d.tm, "00:00"), reached: reachedOf(d.channel, d.outcome), ...(note ? { note } : {}) },
    scheduled: null,
    complete: !!d.complete && !d.keep && !losing,
    keep: !!d.keep && !losing,
    next: hasNext ? { text: d.t!.trim(), at: istAt(d.nd || a.today, d.ntm, "23:59"), channel: d.nch || "other" } : null,
    ...(losing ? { lost: { reason: a.lostWhy } } : {}),
  };
}

const wrote = (before: ConsoleState, after: ConsoleState): boolean => after.LEADS !== before.LEADS || after.INTERACTIONS !== before.INTERACTIONS;
const savedFixture = (): Saved => ({ touchId: null, nextId: null, undoToken: null, undoUntil: null });

export const followupSave: WriteEndpoint<ConsoleBook, FollowupArgs, Saved, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/followup`,
  body: followupBody,
  idempotent: true,
  pick: j => j as Saved,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "saveFollowup", id: a.id },
      next => (wrote(state, next) ? null : REFUSED("the follow-up is incomplete")), savedFixture);
  },
};

export const leadFinish: WriteEndpoint<ConsoleBook, FollowupArgs, Saved, ConsoleDispatch> = {
  ...followupSave,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "lpFinish", id: a.id, d: a.d } as Action,
      next => (wrote(state, next) ? null : REFUSED("the follow-up is incomplete")), savedFixture);
  },
};

export const leadLose: WriteEndpoint<ConsoleBook, FollowupArgs, Saved, ConsoleDispatch> = {
  ...followupSave,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "lpLose", id: a.id, d: a.d, why: a.lostWhy || "" } as Action,
      next => { const l = lead(next, a.id); return l && lost(l) ? null : REFUSED("this lead cannot be closed as lost"); }, savedFixture);
  },
};

/* ---- a touch -------------------------------------------------------------------------------- */
export type TouchArgs = {
  id: string;
  mt: string | null | undefined;
  /** A Channel, or "reply" (inbound). */
  k: Channel | "reply" | string;
  /** When it happened, as a Zoho datetime; omitted = now on the server (the quick log). */
  at?: string;
  /** A call answered / a visit held (counts toward First touch). */
  reached?: boolean;
  /** The reducer action this replaces: logTouch (quick log) or saveTouch (the drawer's draft). */
  action: Extract<Action, { type: "logTouch" | "saveTouch" }>;
};
export type TouchSaved = { touchId: string | null; modifiedTime: string | null; firstTouch: boolean };

export const touchRecord: WriteEndpoint<ConsoleBook, TouchArgs, TouchSaved, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/touches`,
  body: a => ({ expectedModifiedTime: a.mt ?? null, channel: a.k, ...(a.at ? { occurredAt: a.at } : {}), ...(a.k === "call" || a.k === "visit" ? { reached: !!a.reached } : {}) }),
  idempotent: true,
  pick: j => j as TouchSaved,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, a.action,
      next => (next.LEADS !== state.LEADS ? null : REFUSED("that contact was refused")),
      () => ({ touchId: null, modifiedTime: null, firstTouch: false }));
  },
};

/* ---- the next step -------------------------------------------------------------------------- */
export type NextArgs = {
  id: string; mt: string | null | undefined;
  text: string;
  /** ISO day, and `HH:MM` when an hour was agreed (end of day when not). */
  d: string; tm: string;
  /** A touch channel, or "other" (an internal task). */
  ch: Channel | "other" | string;
};
export type NextSaved = { nextId: string; modifiedTime: string | null };

export const nextSave: WriteEndpoint<ConsoleBook, NextArgs, NextSaved, ConsoleDispatch> = {
  method: "PUT",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/next`,
  body: a => ({ expectedModifiedTime: a.mt ?? null, next: { text: a.text.trim(), at: istAt(a.d, a.tm, "23:59"), channel: a.ch }, scheduled: null }),
  idempotent: true,
  pick: j => j as NextSaved,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "saveNext", id: a.id },
      next => (next.LEADS !== state.LEADS ? null : REFUSED("the next step is incomplete")),
      () => ({ nextId: "", modifiedTime: null }));
  },
};

export type MoveArgs = {
  id: string; mt: string | null | undefined;
  /** Whole days to shift the step by, from where it is now (negative = earlier). Live only. */
  days: number;
  /** The reducer action this replaces: pullIn, or moveNextTo with its own days-from-today. */
  action: Extract<Action, { type: "pullIn" | "moveNextTo" }>;
};
export type Moved = { nextStepAt: string; undoToken: string | null; undoUntil: number | null };

export const nextMove: WriteEndpoint<ConsoleBook, MoveArgs, Moved, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/next/move`,
  body: a => ({ expectedModifiedTime: a.mt ?? null, days: a.days, activity: null }),
  pick: j => j as Moved,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, a.action,
      next => (next.LEADS !== state.LEADS ? null : REFUSED("there is no dated next step to move")),
      () => ({ nextStepAt: "", undoToken: null, undoUntil: null }));
  },
};

/* ---- lost, and re-opened -------------------------------------------------------------------- */
export type CloseArgs = { id: string; mt: string | null | undefined; why: string; note: string };
export type Closed = { noteId: string | null; modifiedTime: string | null };

export const lostClose: WriteEndpoint<ConsoleBook, CloseArgs, Closed, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/lost`,
  body: a => ({ expectedModifiedTime: a.mt ?? null, reason: a.why, ...(a.note.trim() ? { note: a.note.trim() } : {}) }),
  idempotent: true,
  pick: j => j as Closed,
  fixture(state, dispatch, a) {
    if (!lead(state, a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "closeLost", id: a.id, why: a.why, note: a.note },
      next => { const l = lead(next, a.id); return l && lost(l) ? null : REFUSED("this lead cannot be closed as lost"); },
      () => ({ noteId: null, modifiedTime: null }));
  },
};

export type ReopenArgs = {
  id: string; mt: string | null | undefined;
  /** The next step that comes back with the lead, or none. */
  next: { text: string; at: string; channel: string } | null;
};
export type Reopened = { modifiedTime: string | null };

export const lostReopen: WriteEndpoint<ConsoleBook, ReopenArgs, Reopened, ConsoleDispatch> = {
  method: "DELETE",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/lost`,
  body: a => ({ expectedModifiedTime: a.mt ?? null, next: a.next }),
  pick: j => j as Reopened,
  fixture(state, dispatch, a) {
    const was = lead(state, a.id);
    if (!was) return NOT_YOURS();
    if (!lost(was)) return fail(409, "not-lost", "Not saved — this lead is not closed as lost.");
    return consoleFixtureWrite(state, dispatch, { type: "reopenLost", id: a.id },
      next => { const l = lead(next, a.id); return l && !lost(l) ? null : REFUSED("this lead cannot be re-opened"); },
      () => ({ modifiedTime: null }));
  },
};
