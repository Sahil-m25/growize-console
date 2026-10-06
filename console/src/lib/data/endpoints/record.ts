/* Cluster C2 (ir-write-map.md) — the lead record, wired to Zoho:
     leadNoteAdd           POST /api/leads/[id]/notes        addNote (a Zoho Note on the Lead; Idempotency-Key per press)
     leadPermissionSave    PUT  /api/leads/[id]/permission   saveContactPermission (Consent_*; no visit — the org has none)
     leadDetailsSave       PUT  /api/leads/[id]/details      saveProfileDetails (only what changed; standard Lead fields,
                                                             the preference as Preferred_Communication)
     leadForecastSet       PUT  /api/leads/[id]/forecast     setFc / setFcDate / setFcBy (Forecast, Forecast_Paid_By)
   Live: the routes, on the person's own token, guarded by `l.mt` where they update the Lead. Fixture: the reducer action
   each replaces, peeked first. The shared pages (LeadPage's note box) call `useLeadNote()`. */

import type { Channel, Lead, Note } from "@/domain";
import { ST } from "@/domain";
import { iso } from "@/lib/format";
import { openable } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { fail, newIdempotencyKey, ok, useApiMode, useApiRead, useApiWrite, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";

const base = (id: string) => `/api/leads/${encodeURIComponent(id)}`;
const leadOf = (s: ConsoleBook, id: string) => s.LEADS.find(x => x.id === id);
const NOT_SAVED = (why = "Not saved.") => fail(422, "not-saved", why);

/* ---- a note --------------------------------------------------------------------------------------- */
export type NoteArgs = { id: string; text: string };
export type NoteAdded = { noteId: string | null; leadId: string };
export const leadNoteAdd: WriteEndpoint<ConsoleBook, NoteArgs, NoteAdded, ConsoleDispatch> = {
  method: "POST",
  path: a => `${base(a.id)}/notes`,
  body: a => ({ text: a.text }),
  idempotent: true,
  pick: j => j as NoteAdded,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    /* the reducer reads the draft from ui.NDRAFT: hand it the text this press carries */
    const s2 = { ...state, ui: { ...state.ui, NDRAFT: a.text } };
    if (state.ui.NDRAFT !== a.text) dispatch({ type: "setUi", patch: { NDRAFT: a.text } });
    const before = (state.NOTES[a.id] || []).length;
    return consoleFixtureWrite(s2, dispatch, { type: "addNote", id: a.id },
      next => ((next.NOTES[a.id] || []).length > before ? null : NOT_SAVED(a.text.trim() ? "Not saved." : "Nothing typed yet.")),
      () => ({ noteId: null, leadId: a.id }));
  },
};

/* ---- contact permission ---------------------------------------------------------------------------- */
export type PermissionArgs = { id: string; expectedModifiedTime: string | null; con: Record<Channel, boolean>; how: string; date: string; time: string };
export type RecordSaved = { leadId: string; modifiedTime: string | null; fields: string[] };
export const leadPermissionSave: WriteEndpoint<ConsoleBook, PermissionArgs, RecordSaved, ConsoleDispatch> = {
  method: "PUT",
  path: a => `${base(a.id)}/permission`,
  /* visit is never sent: Leads has no Consent_Visit (M12-S11-NOTE-5) */
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime, con: { msg: a.con.msg, email: a.con.email, call: a.con.call }, how: a.how, date: a.date, time: a.time }),
  pick: j => j as RecordSaved,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "saveContactPermission", id: a.id, con: a.con, how: a.how, date: a.date, time: a.time },
      next => (next.LEADS !== state.LEADS ? null : NOT_SAVED()),
      () => ({ leadId: a.id, modifiedTime: null, fields: [] }));
  },
};

/* ---- the investor's details -------------------------------------------------------------------------- */
export type ProfilePatch = { n: string; ph: string; em: string; city: string; units: string; introducedBy: string; contactPreference: string };
export type DetailsArgs = { id: string; expectedModifiedTime: string | null; patch: ProfilePatch; was: Lead };
/** Only the fields that changed from the lead as the page holds it (the route writes only what it is sent). */
export function detailsBody(a: DetailsArgs): Record<string, unknown> {
  const l = a.was, p = a.patch, out: Record<string, unknown> = { expectedModifiedTime: a.expectedModifiedTime };
  if (p.n.trim() !== (l.n || "")) out.name = p.n.trim();
  if (p.ph.trim() !== (l.ph || "")) out.mobile = p.ph.trim();
  if (p.em.trim() !== (l.em || "")) out.email = p.em.trim();
  if (p.city.trim() !== (l.city || "")) out.city = p.city.trim();
  if (l.done < ST.RESERVED && p.units.trim() !== (l.units ? String(l.units) : "")) out.units = p.units.trim();
  if (p.contactPreference.trim() !== (l.contactPreference || "")) out.contactPreference = p.contactPreference.trim();
  if (p.introducedBy.trim() !== (l.introducedBy || "")) out.introducedBy = p.introducedBy.trim();
  return out;
}
export const leadDetailsSave: WriteEndpoint<ConsoleBook, DetailsArgs, RecordSaved, ConsoleDispatch> = {
  method: "PUT",
  path: a => `${base(a.id)}/details`,
  body: detailsBody,
  pick: j => j as RecordSaved,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    return consoleFixtureWrite(state, dispatch, { type: "saveProfileDetails", id: a.id, patch: a.patch },
      next => (next.LEADS !== state.LEADS ? null : NOT_SAVED("No details changed.")),
      () => ({ leadId: a.id, modifiedTime: null, fields: [] }));
  },
};

/* ---- the forecast -------------------------------------------------------------------------------------- */
export type ForecastArgs =
  | { id: string; expectedModifiedTime: string | null; via: "setFc"; c: string }
  | { id: string; expectedModifiedTime: string | null; via: "setFcDate"; v: string }
  | { id: string; expectedModifiedTime: string | null; via: "setFcBy"; days: number; now: Date };
export type ForecastSaved = { leadId: string; modifiedTime: string | null; forecast: string | null; paidBy: string | null };
const paidByOf = (a: ForecastArgs): string | undefined => {
  if (a.via === "setFcDate") return a.v;
  if (a.via === "setFcBy") { const d = new Date(a.now); d.setDate(d.getDate() + a.days); return iso(d); }
  return undefined;
};
export const leadForecastSet: WriteEndpoint<ConsoleBook, ForecastArgs, ForecastSaved, ConsoleDispatch> = {
  method: "PUT",
  path: a => `${base(a.id)}/forecast`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime, ...(a.via === "setFc" ? { category: a.c } : { paidBy: paidByOf(a) }) }),
  pick: j => j as ForecastSaved,
  fixture(state, dispatch, a) {
    if (!openable(state).some(l => l.id === a.id)) return NOT_YOURS();
    const action = a.via === "setFc" ? { type: "setFc" as const, id: a.id, c: a.c }
      : a.via === "setFcDate" ? { type: "setFcDate" as const, id: a.id, v: a.v } : { type: "setFcBy" as const, id: a.id, days: a.days };
    return consoleFixtureWrite(state, dispatch, action,
      next => (next.LEADS !== state.LEADS ? null : NOT_SAVED()),
      next => { const f = leadOf(next, a.id)?.fc; return { leadId: a.id, modifiedTime: null, forecast: f ? f.c : null, paidBy: f && f.by ? f.by : null }; });
  },
};

/* ---- the notes, read back ------------------------------------------------------------------------- */
/** GET /api/leads/[id]/notes (server/leads/notes list): newest first. Fixture: the demo book's NOTES, as the page held them. */
export const leadNotesRead: ReadEndpoint<ConsoleBook, string | null, Note[]> = {
  path: id => (id ? `${base(id)}/notes` : null),
  pick: j => {
    const rows = (j && typeof j === "object" ? (j as { notes?: unknown }).notes : null);
    if (!Array.isArray(rows)) return [];
    return rows.map((n: { text?: unknown; at?: unknown; by?: unknown }) => {
      const at = typeof n.at === "string" ? n.at : "";
      return { t: typeof n.text === "string" ? n.text : "", who: (typeof n.by === "string" ? n.by : "") as Note["who"], at: stampOfZoho(at), d: at.slice(0, 10) as Note["d"] };
    }).filter(n => n.t);
  },
  fixture(state, id) {
    if (!id || !openable(state).some(l => l.id === id)) return NOT_YOURS();
    return ok(state.NOTES[id] || []);
  },
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A Zoho datetime printed as the console's stamp, in IST ("DD Mon HH:MM", as server/data/live stampOf). */
function stampOfZoho(z: string): string {
  const ms = Date.parse(z);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 5.5 * 3_600_000), p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** The notes a page shows for one lead: fixture, the book's own; live, the route's (empty while loading or refused). */
export function useLeadNotes(id: string | null): { notes: Note[]; error: string | null } {
  const { state } = useConsole();
  const live = useApiMode() === "live";
  const r = useApiRead(leadNotesRead, state, id);
  if (!live) return { notes: id ? state.NOTES[id] || [] : [], error: null };
  return { notes: r.state === "ok" ? r.data : [], error: r.state === "error" ? r.err.error : null };
}

/** A note on a lead, for any page (LeadPage's note box, the notes drawer). One Idempotency-Key per press; a retry of
 *  the same press passes `key` back. Live: a success clears the draft and re-reads the book. */
export function useLeadNote() {
  const { state, dispatch, reloadData } = useConsole();
  const live = useApiMode() === "live";
  const w = useApiWrite(leadNoteAdd, state, dispatch);
  return (id: string, text: string, key: string = newIdempotencyKey()): Promise<ApiResult<NoteAdded>> =>
    w({ id, text }, { idempotencyKey: key }).then(r => {
      if (r.ok && live) { dispatch({ type: "setUi", patch: { NDRAFT: "" } }); reloadData(); }
      return r;
    });
}
