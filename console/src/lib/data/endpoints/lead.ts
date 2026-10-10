/* M07-S05-W1 / M08-S02-W1 — the lead page's composer and gate.
     leadEmailSend  POST /api/leads/[id]/email  (server/leads/email) — the composer's Send
     leadGate       GET  /api/leads/[id]/gate   (server/leads/gates) — the finance gate on the next rung
   Lead side: the book is the store's ConsoleState (`useConsole().state`). This file also holds the lead side's
   half of the wiring kit (what im.ts is for the Investors side): how a fixture write peeks the reducer action it
   replaces and answers as the route would. */

import type { EmailResult } from "@/server/leads/email";
import type { GateState } from "@/server/leads/gates";
import { reducer, type Action, type ConsoleState } from "@/lib/state";
import { claimOf, claimOpen, gateMet, gateOf, gateWait, gateWho, inReservation, openable, payOf } from "@/lib/selectors";
import { iso, when } from "@/lib/format";
import { UNIT } from "@/domain";
import { fail, ok, type ApiErr, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";

export type ConsoleBook = ConsoleState;
export type ConsoleDispatch = (a: Action) => unknown;

/** Run the reducer action a wired write replaces (fixture mode) and answer as the route would. `judge` reads the
 *  reducer's own verdict off the peeked next state (a refusal → the route's 4xx); the reducer's in-page note stays. */
export function consoleFixtureWrite<T>(state: ConsoleState, dispatch: ConsoleDispatch, a: Action,
  judge: (next: ConsoleState) => ApiErr | null, data: (next: ConsoleState) => T): ApiResult<T> {
  const next = reducer({ ...state, ui: { ...state.ui, LPNOTICE: null } }, a);
  const bad = judge(next);
  dispatch(a);
  return bad ?? ok(data(next));
}

/** The route's answer for a lead this seat cannot open (404), so the fixture half refuses the same way. */
export const NOT_YOURS = () => fail(404, "not-visible", "The lead is unavailable.");

/* ---- the composer's Send ------------------------------------------------------------------------ */
export type EmailArgs = { id: string; expectedModifiedTime: string | null; to: string; tpl: string; s: string; b: string };
export type EmailSent = Pick<Extract<EmailResult, { ok: true }>["value"], "sent" | "notice">;

export const leadEmailSend: WriteEndpoint<ConsoleBook, EmailArgs, EmailSent, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/email`,
  /* `scheduled` (the open next-step activity) is not sent: the book carries no activity id yet (PROVISIONAL, M07-S05-W1) */
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime, template: a.tpl, subject: a.s, message: a.b, to: a.to }),
  pick: j => j as EmailSent,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "emSend", id: a.id, tpl: a.tpl, s: a.s, b: a.b },
      next => {
        const err = (next.ui.EM as Record<string, { err?: string }> | undefined)?.[a.id]?.err;
        if (err) return fail(422, "refused", err);
        return (next.ui.LPNOTICE as { msg?: string } | null | undefined)?.msg ? null : fail(422, "not-sent", "Not sent.");
      },
      next => ({ sent: true as const, notice: String((next.ui.LPNOTICE as { msg: string }).msg) }));
  },
};

/* ---- the finance gate on the next rung ----------------------------------------------------------- */
export type GateRead = Pick<GateState, "leadId" | "gate" | "met" | "who" | "says" | "holdUntil" | "payment"> & Partial<Pick<GateState, "heldFor">>;

export const leadGate: ReadEndpoint<ConsoleBook, string | null, GateRead> = {
  path: id => (id ? `/api/leads/${encodeURIComponent(id)}/gate` : null),
  pick: j => j as GateRead,
  fixture(state, id) {
    const l = state.LEADS.find(x => x.id === id);
    if (!l || !openable(state).some(x => x.id === l.id)) return NOT_YOURS();
    const w = gateWait(state, l);
    /* holdUntil: the earliest hold on a Reserved allotment — the lead page's reservation alert and drawer read it here (M08-S04-W1) */
    const hold = inReservation(state, l) ? payOf(state, l.id)?.hold : null, hd = hold ? when(hold, state.NOW) : null;
    const p = payOf(state, l.id), c = claimOf(state, l.id);
    const payment = { status: (p ? (p.state === "full" ? "Full" : "Partial") : "Yet to initiate") as "Full" | "Partial" | "Yet to initiate",
      reported: claimOpen(state, l.id), notFound: !!c && c.state === "notfound", matchedRupees: p ? p.got : 0, dueRupees: Math.max(0, l.units * UNIT - (p ? p.got : 0)) };
    return ok({ leadId: l.id, gate: gateOf(l), met: gateMet(state, l), who: gateWho(state, l), says: w ? w.d : null, holdUntil: hd ? iso(hd) : null, payment });
  },
};

/** The hold's last day as the lead page prints it: "2 Sep". */
export const holdDay = (isoDay: string): string => {
  const d = new Date(isoDay + "T00:00:00");
  return isNaN(d.getTime()) ? isoDay : d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
};
