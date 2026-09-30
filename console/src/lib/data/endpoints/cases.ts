/* M13-S02-W1..S05-W1 — the Tickets register and its writes (phase 2b, D104).
     GET  /api/cases                      the register, by the seat's scope (server/cases/register)
     POST /api/cases                      open a ticket
     PATCH /api/cases/[id] {to, expectedModifiedTime}   park it waiting on the investor, or close it
     POST /api/cases/[id]/handover        a KAM hands a Bank/Compliance ticket to Finance and keeps watching
     POST /api/cases/[id]/reply           answer the investor (a Note on the Case, pushed as case.replied)
     GET  /api/cases/[id]/deliveries      whether the replies reached the investor app
   Live: the routes, on the person's own token. Fixture: the same answers projected from the demo book, and each write
   runs the reducer action it replaces (newTicket, moveTicket, handToFinance). The reply has no reducer action — the
   demo book keeps no thread — so its fixture answers "Not delivered yet", the honest state of a push nobody acknowledged. */

import type { cacheView } from "@/server/cases/http";
import type { CaseCuts, CaseRow } from "@/server/cases/register";
import type { ReplyDelivery } from "@/server/cases/deliveries";
import { I, imReducer, may, mayTkt, pageReadable, ticketBook, watchedTkt, isAM, type ImAction, type ImTicket } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type CaseList = {
  rows: CaseRow[]; truncated: boolean; cuts: ReturnType<typeof cacheView<CaseCuts>>;
  /** the caller's own open tickets, counted (a Mine tab needs it; an AM seat has none) */
  mine: number; readOnly: boolean; offersMine: boolean;
};
export type CaseWrote = { row: CaseRow };
export type CaseMoved = { row: CaseRow; already: boolean; modifiedTime: string | null };
export type CaseHanded = { row: CaseRow; to: string; already: boolean };
export type CaseReplied = { caseId: string; noteId: string; delivery: { eventId: string; label: string } };
export type CaseDeliveries = { caseId: string; replies: ReplyDelivery[]; label: string | null };

const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");
const READ_ONLY = () => fail(403, "read-only", "This seat reads tickets; it does not work them.");
const NOT_FOUND = () => fail(404, "not-found", "Not found, or not yours to open.");

/** One demo ticket as the route's CaseRow (the ticket number is the demo id; watched = handed on by me). */
export function fixtureCaseRow(b: ImBook, t: ImTicket): CaseRow {
  return { ...t, number: t.id, ...(watchedTkt(b.s, b.me, t) ? { watched: true } : {}) };
}

export const caseList: ReadEndpoint<ImBook, void, CaseList> = {
  path: () => "/api/cases",
  pick: j => j as CaseList,
  fixture(b) {
    if (!pageReadable(b.s, b.me, "tkt")) return NO_PAGE();
    const book = ticketBook(b.s, b.me);
    const rows = book.map(t => fixtureCaseRow(b, t));
    const open = book.filter(t => t.state !== "closed");
    const value: CaseCuts = {
      open: open.length, high: open.filter(t => t.pri === "high").length, waiting: book.filter(t => t.state === "waiting").length,
      closed: book.filter(t => t.state === "closed").length, all: book.length,
    };
    return ok({
      rows, truncated: false, cuts: { state: "fresh", value, asOf: 0 },
      mine: open.filter(t => t.own === b.me).length, readOnly: !may(b.s, b.me, "tkt"), offersMine: !isAM(b.s, b.me),
    });
  },
};

/** What the reducer would leave of a ticket after `a` (a peek: nothing is dispatched). */
const after = ({ s, me }: ImBook, a: ImAction, id: string | null): ImTicket | undefined => {
  const n = imReducer({ ...s, ui: { ...s.ui, NOTE: null, PENDING: null } }, me, a).data.TKT;
  return id ? n.find(t => t.id === id) : n[0];
};

export type OpenArgs = { investorId: string; category: string; subject: string; description: string; priority: "high" | "normal"; ownerId: string };
export const caseOpen: WriteEndpoint<ImBook, OpenArgs, CaseWrote, ImDispatch> = {
  method: "POST",
  path: () => "/api/cases",
  body: a => ({ investorId: a.investorId, category: a.category, subject: a.subject, description: a.description, priority: a.priority, ownerId: a.ownerId }),
  pick: j => j as CaseWrote,
  fixture(b, d, a) {
    if (!may(b.s, b.me, "tkt")) return READ_ONLY();
    if (!I(b.s, b.me, a.investorId)) return fail(422, "not-in-book", "That investor is not in your book.");
    const act: ImAction = { type: "newTicket", inv: a.investorId, cat: a.category, t: a.subject, d: a.description, own: a.ownerId, pri: a.priority };
    const t = after(b, act, null);
    if (!t) return fail(400, "invalid-request", "That ticket is missing something: an investor, a category from the list and what they want.");
    return imFixtureWrite(b, d, act, { row: fixtureCaseRow(b, t) });
  },
  onLiveError: imLiveError,
};

export type MoveArgs = { id: string; to: "waiting" | "closed"; expectedModifiedTime: string | null };
export const caseMove: WriteEndpoint<ImBook, MoveArgs, CaseMoved, ImDispatch> = {
  method: "PATCH",
  path: a => `/api/cases/${encodeURIComponent(a.id)}`,
  body: a => ({ to: a.to, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as CaseMoved,
  fixture(b, d, a) {
    const t = b.s.data.TKT.find(x => x.id === a.id);
    if (!t || !I(b.s, b.me, t.inv)) return NOT_FOUND();
    if (!may(b.s, b.me, "tkt")) return READ_ONLY();
    const act: ImAction = { type: "moveTicket", id: a.id, state: a.to };
    const n = after(b, act, a.id) ?? t;
    return imFixtureWrite(b, d, act, { row: fixtureCaseRow(b, n), already: t.state === a.to, modifiedTime: null });
  },
  onLiveError: imLiveError,
};

export type HandArgs = { id: string; expectedModifiedTime: string | null };
export const caseHandover: WriteEndpoint<ImBook, HandArgs, CaseHanded, ImDispatch> = {
  method: "POST",
  path: a => `/api/cases/${encodeURIComponent(a.id)}/handover`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as CaseHanded,
  fixture(b, d, a) {
    const t = b.s.data.TKT.find(x => x.id === a.id);
    if (!t || !I(b.s, b.me, t.inv)) return NOT_FOUND();
    if (!may(b.s, b.me, "tkt")) return READ_ONLY();
    const act: ImAction = { type: "handToFinance", id: a.id };
    const n = after(b, act, a.id) ?? t;
    return imFixtureWrite(b, d, act, { row: fixtureCaseRow(b, n), to: n.own, already: n.own === t.own });
  },
  onLiveError: imLiveError,
};

export type ReplyArgs = { id: string; message: string };
export const caseReply: WriteEndpoint<ImBook, ReplyArgs, CaseReplied, ImDispatch> = {
  method: "POST",
  path: a => `/api/cases/${encodeURIComponent(a.id)}/reply`,
  body: a => ({ message: a.message }),
  pick: j => j as CaseReplied,
  fixture(b, _d, a): ApiResult<CaseReplied> {
    const t = b.s.data.TKT.find(x => x.id === a.id);
    if (!t || !I(b.s, b.me, t.inv)) return NOT_FOUND();
    if (!may(b.s, b.me, "tkt")) return READ_ONLY();
    if (!mayTkt(b.s, b.me, t)) return fail(403, "not-yours", "This ticket belongs to someone else. Account Management works its own tickets.");
    if (!a.message.trim()) return fail(400, "invalid-request", "Say what you want the investor to read.");
    return ok({ caseId: a.id, noteId: "fixture", delivery: { eventId: "fixture", label: "Not delivered yet" } });
  },
  onLiveError: imLiveError,
};

export const caseDeliveries: ReadEndpoint<ImBook, string | null, CaseDeliveries> = {
  path: id => (id ? `/api/cases/${encodeURIComponent(id)}/deliveries` : null),
  pick: j => j as CaseDeliveries,
  fixture(b, id) {
    if (!pageReadable(b.s, b.me, "tkt")) return NO_PAGE();
    const t = b.s.data.TKT.find(x => x.id === id);
    if (!t || !I(b.s, b.me, t.inv)) return NOT_FOUND();
    return ok({ caseId: t.id, replies: [], label: null });   /* the demo book keeps no thread */
  },
};

/** The ticket's one delivery line: "Delivered" only once the app said so, else the reply is not delivered yet. */
export const deliveryLine = (label: string | null): string | null =>
  label == null ? null : /^delivered$/i.test(label) ? "Delivered" : "Reply " + label.charAt(0).toLowerCase() + label.slice(1);
