"use client";

/* C3 — taking an unowned lead, and marking updates read.
     leadAssign       POST /api/leads/[id]/assign     (server/leads/assign)  "Assign to me": self only (an IR takes a lead nobody carries)
     leadUpdatesRead  POST /api/leads/updates/read    (server/leads/updates) mark groups seen — the person's own bookmark (Plane C, D47)
   Live: the routes on the person's own token. Fixture: the reducer's `assign` / `markRead`.

   HOOKS FOR THE CALL SITES the integration pass swaps (TodayPage, WorkAction, LeadPage, leads/actions): `useAssignToMe()`.
     const { assign, error, pending } = useAssignToMe();
     <button onClick={() => void assign(l.id)}>Assign to me</button> {error ? <p role="alert">{error}</p> : null}
   `assign(id)` answers the ApiResult; on a live success it re-reads the book, on a refusal `error` holds the route's sentence
   (already owned, lead changed, not in this seat). */

import { useCallback, useState } from "react";
import type { UpdateKind } from "@/server/leads/updates";
import { canAssign, assignees, custodian, isIR, openable } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { fail, useApiMode, useApiWrite, type ApiResult, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* ---- assign to me ------------------------------------------------------------------------------------- */
export type AssignArgs = { id: string };
export type Assigned = { leadId: string; ownerId: string; modifiedTime: string | null };

export const leadAssign: WriteEndpoint<ConsoleBook, AssignArgs, Assigned, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/assign`,
  body: () => ({}),
  pick: j => j as Assigned,
  fixture(state, dispatch, a) {
    const l = state.LEADS.find(x => x.id === a.id);
    if (!l || !openable(state).some(x => x.id === a.id)) return NOT_YOURS();
    if (l.own) return fail(409, "already-owned", "Not assigned — somebody already carries this lead.");
    if (!(isIR(state.ROLE) || canAssign(state)) || !assignees(state).includes(state.WHO) || custodian(l) === "Closed") {
      return fail(403, "capability-missing", "Not assigned — an IR picks up a lead with no owner; moving one that has an owner is a manager's act.");
    }
    return consoleFixtureWrite(state, dispatch, { type: "assign", id: a.id, to: state.WHO },
      next => (next.LEADS === state.LEADS ? fail(403, "capability-missing", "Not assigned — this seat cannot take that lead.") : null),
      () => ({ leadId: a.id, ownerId: state.WHO, modifiedTime: null }));
  },
};

export type AssignToMe = { assign: (leadId: string) => Promise<ApiResult<Assigned>>; error: string | null; pending: boolean };

/** "Assign to me" as the one press every call site uses. Live: POST the route, then re-read the book; fixture: the reducer. */
export function useAssignToMe(): AssignToMe {
  const { state, dispatch, reloadData } = useConsole();
  const write = useApiWrite(leadAssign, state, dispatch);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const assign = useCallback(async (leadId: string) => {
    setPending(true);
    setError(null);
    const r = await write({ id: leadId });
    setPending(false);
    if (r.ok) { reloadData(); return r; }
    setError(r.error);
    return r;
  }, [write, reloadData]);
  return { assign, error, pending };
}

/* ---- mark updates read -------------------------------------------------------------------------------- */
/** The kinds the route stores a bookmark for (server/leads/updates UpdateKind). */
export const UPDATE_KINDS: readonly UpdateKind[] = ["added", "owner", "stage", "next-step", "lost", "consent", "details"];

/** Which stored bookmarks a page group maps to: the group named, or every kind when none is (Mark all as read). A page
 *  group the route does not keep (move, team, access…) maps to none: it is read in the page's own memory only. */
export const kindsOfGroup = (k?: string): UpdateKind[] =>
  k === undefined ? [...UPDATE_KINDS] : (UPDATE_KINDS as readonly string[]).includes(k) ? [k as UpdateKind] : [];

export type ReadArgs = { kinds: UpdateKind[]; k?: string };
export const leadUpdatesRead: WriteEndpoint<ConsoleBook, ReadArgs, { ok: true }, ConsoleDispatch> = {
  method: "POST",
  path: () => "/api/leads/updates/read",
  body: a => ({ kinds: a.kinds }),
  pick: () => ({ ok: true }),
  fixture(state, dispatch, a) {
    return consoleFixtureWrite(state, dispatch, a.k === undefined ? { type: "markRead" } : { type: "markRead", k: a.k }, () => null, () => ({ ok: true as const }));
  },
};

/** The one press for Updates (the page's groups, "Mark all as read", the bell's rows). Fixture: the reducer's markRead.
 *  Live: the bookmark is saved by the route; the page's own copy is marked at once so the dots clear, and a refusal is said
 *  in the page's live region (NOTICE) rather than lost. Omit `k` to mark every group. */
export function useMarkRead(): (k?: string) => void {
  const { state, dispatch } = useConsole();
  const live = useApiMode() === "live";
  const write = useApiWrite(leadUpdatesRead, state, dispatch);
  return useCallback((k?: string) => {
    if (!live) { void write({ kinds: kindsOfGroup(k), k }); return; }
    dispatch(k === undefined ? { type: "markRead" } : { type: "markRead", k });
    const kinds = kindsOfGroup(k);
    if (!kinds.length) return;
    void write({ kinds, k }).then(r => {
      if (!r.ok) dispatch({ type: "setUi", patch: { NOTICE: r.error } });
    });
  }, [live, write, dispatch]);
}
