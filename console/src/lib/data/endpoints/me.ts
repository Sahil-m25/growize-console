/* C4 / Me — my own details, my badge, and the activity export's log line:
     PATCH /api/me          { name, mobile? } → { name, mobile }   my display name and mobile on MY Zoho user (users.UPDATE, own token)
     PUT   /api/me/style    { c?, sq?, i? }   → { c?, sq?, i? }    my badge colour/shape and initials — the console's own state store, not Zoho (J15)
     POST  /api/activity/export { view, rows } → { logged, replayed } the export's server log line (J14); no values, no Zoho
   Live: the routes. Fixture: the reducer actions the Me page and the CSV export dispatched (setMe, setMyStyle, log), so the demo keeps working.
   The sign-in email is never sent: Zoho owns it. */

import { useCallback } from "react";
import type { Action } from "@/lib/state";
import { useConsole } from "@/lib/store";
import { fail, useApiWrite, type ApiErr, type ApiResult, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* the routes' refusals, restated for the demo half so both halves speak alike (server/people/profile.ts REASON) */
export const NAME_TOO_SHORT = "Nothing changed — a display name needs at least two characters.";
export const BAD_INITIALS = "Nothing changed — initials are letters and numbers, one or two of them.";
const refused = (message: string): ApiErr => fail(422, "refused", message);

/* ---- my name and mobile ---------------------------------------------------------------------------- */
/** `name` is always the display name the route needs (it takes name + mobile together); `f` is the field that changed. */
export type MyDetailsArgs = { f: "n" | "ph"; v: string; name: string };
export type MyDetailsWritten = { name: string; mobile: string | null };

export const myDetails: WriteEndpoint<ConsoleBook, MyDetailsArgs, MyDetailsWritten, ConsoleDispatch> = {
  method: "PATCH",
  path: () => "/api/me",
  body: (a) => (a.f === "n" ? { name: a.v.trim() } : { name: a.name.trim(), mobile: a.v.trim() }),
  pick: (j) => j as MyDetailsWritten,
  fixture(s, dispatch, a): ApiResult<MyDetailsWritten> {
    if (a.f === "n" && a.v.trim().length < 2) return refused(NAME_TOO_SHORT);
    const me = s.PEOPLE[s.WHO];
    if (!me) return refused("Nothing changed — you are not signed in.");
    return consoleFixtureWrite(s, dispatch, { type: "setMe", f: a.f, v: a.v }, () => null,
      (next) => ({ name: next.PEOPLE[next.WHO]?.n ?? me.n, mobile: next.PEOPLE[next.WHO]?.ph || null }));
  },
};

/* ---- my badge and initials ------------------------------------------------------------------------- */
export type MyStyleArgs = { kind: "initials"; v: string } | { kind: "badge"; c: number; sq: boolean };
export type MyStyleWritten = { c?: number; sq?: boolean; i?: string };

export const myStyle: WriteEndpoint<ConsoleBook, MyStyleArgs, MyStyleWritten, ConsoleDispatch> = {
  method: "PUT",
  path: () => "/api/me/style",
  body: (a) => (a.kind === "initials" ? { i: a.v.trim() } : { c: a.c, sq: a.sq }),
  pick: (j) => j as MyStyleWritten,
  fixture(s, dispatch, a): ApiResult<MyStyleWritten> {
    if (a.kind === "initials") {
      const t = a.v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2);
      if (!t) return refused(BAD_INITIALS);
      return consoleFixtureWrite(s, dispatch, { type: "setMe", f: "i", v: a.v }, () => null, () => ({ i: t }));
    }
    const c = Math.round(Number(a.c));
    if (!(c >= 1 && c <= 8)) return refused("Nothing changed — pick one of the eight badge colours.");
    return consoleFixtureWrite(s, dispatch, { type: "setMyStyle", c, sq: a.sq }, () => null, () => ({ c, sq: a.sq }));
  },
};

/* ---- the activity export's log line ---------------------------------------------------------------- */
/** What the export tells the log: the view, the rows on screen, the rows written, the file name (the demo's note only). */
export type ActivityExportInfo = { view: "log" | "person" | "day"; rows: number; exported: number; filename: string };

export const activityExportLog: WriteEndpoint<ConsoleBook, ActivityExportInfo, { logged: true; replayed: boolean }, ConsoleDispatch> = {
  method: "POST",
  path: () => "/api/activity/export",
  /* counts and a view code only: never a row, a name or the file name */
  body: (a) => ({ view: a.view, rows: a.rows }),
  idempotent: true,
  pick: (j) => j as { logged: true; replayed: boolean },
  fixture(s, dispatch, a): ApiResult<{ logged: true; replayed: boolean }> {
    const act: Action = { type: "log", what: "Exported the activity log", lead: null,
      note: `${a.rows} activity rows · ${a.exported} exported ${a.view} rows · ${a.filename}`, kind: "admin" };
    return consoleFixtureWrite(s, dispatch, act, () => null, () => ({ logged: true as const, replayed: false }));
  },
};

/** For the Activity page's CSV button: `downloadActivityCSV(..., undefined, useActivityExportLog())`. Never throws, never blocks
 *  the download (the file is already built from rows the person read); a refusal is not shown — the export happened. */
export function useActivityExportLog(): (info: ActivityExportInfo) => void {
  const { state, dispatch } = useConsole();
  const write = useApiWrite(activityExportLog, state, dispatch);
  return useCallback((info: ActivityExportInfo) => { void write(info); }, [write]);
}
