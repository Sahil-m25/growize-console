"use client";

/* C3 — the Add page's three calls.
     leadAdd         POST /api/leads            (server/leads/intake → capture) one lead, one Idempotency-Key per press
     leadImport      POST /api/leads/import     (server/leads/intake)          a CSV in chunks of ≤200 rows, one capture per row
     duplicateLookup POST /api/leads/duplicate  (server/leads/duplicate)       "is this number already in my book?" while typing
   Live: the routes on the person's own token. Fixture: the reducer's `addLead` / `csvImport`, and the book's own duplicate
   match — the same answers projected from the demo book. The duplicate question is a POST (the number goes in the body,
   never the URL) but it is a read: it must not re-read every live screen on each keystroke, so it is not a WriteEndpoint. */

import { useEffect, useState } from "react";
import { addDraft } from "@/features/add/state";
import { csvGood, dupeOf, phoneOK } from "@/features/add/csv";
import type { DuplicateAnswer } from "@/server/leads/duplicate";
import type { RowVerdict } from "@/server/leads/intake";
import type { CaptureCommand } from "@/server/leads/capture";
import type { ConsoleState } from "@/lib/state";
import { apiFetch, fail, ok, useApiMode, type ApiErr, type ApiResult, type Fetch, type WriteEndpoint } from "../api";
import { consoleFixtureWrite, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* ---- one lead ----------------------------------------------------------------------------------------- */
export type AddArgs = Pick<CaptureCommand, "name" | "mobile" | "email" | "city" | "source" | "eventId" | "introducedById" | "ownerId" | "units" | "consent" | "consentHow">;
export type Added = { leadId: string; ownerId: string | null; replayed: boolean };

export const leadAdd: WriteEndpoint<ConsoleBook, AddArgs, Added, ConsoleDispatch> = {
  method: "POST",
  path: () => "/api/leads",
  body: a => a,
  idempotent: true,
  pick: j => j as Added,
  fixture(state, dispatch) {
    return consoleFixtureWrite(state, dispatch, { type: "addLead" },
      next => (next.ui.ADDDONE && next.ui.ADDDONE !== state.ui.ADDDONE ? null
        : fail(422, "refused", "Not added — the form is incomplete, or this number is already on the book.")),
      next => ({ leadId: String(next.ui.ADDDONE?.id ?? ""), ownerId: (next.ui.ADDDONE?.own as string | null | undefined) ?? null, replayed: false }));
  },
};

/** The draft of the Add form as the route's body. The route re-decides owner, source and attribution from the seat; these
 *  are what the person chose. An introducer outside ARL ("ext") and an unchosen one send none. */
export function addArgsOf(d: ReturnType<typeof addDraft>, units: number, own: string | null): AddArgs {
  const how = d.ADDHOW ?? null;
  const consent = { msg: !!d.ADDCON.msg, call: !!d.ADDCON.call, email: !!d.ADDCON.email, visit: !!d.ADDCON.visit };
  const given = consent.msg || consent.call || consent.email || consent.visit;
  const city = d.ADDCITY.trim(), email = d.ADDEM.trim();
  return {
    name: d.ADDN.trim(), mobile: d.ADDPH.trim(), ...(email ? { email } : {}), ...(city ? { city } : {}),
    source: d.ADDSRC!, eventId: d.ADDSRC === "Events" ? d.ADDEV : null,
    introducedById: d.ADDBY && d.ADDBY !== "ext" ? d.ADDBY : null,
    ownerId: own, units: units || null, consent, consentHow: given ? how : null,
  };
}

/* ---- a file --------------------------------------------------------------------------------------------- */
export const IMPORT_CHUNK = 100;
export type ImportArgs = { eventId: string; ownerId: string | null; rows: { name: string; mobile: string; email?: string; city?: string; units?: number | null }[] };
export type Imported = { added: number; refused: number; rows: RowVerdict[] };

export const leadImport: WriteEndpoint<ConsoleBook, ImportArgs, Imported, ConsoleDispatch> = {
  method: "POST",
  path: () => "/api/leads/import",
  body: a => ({ eventId: a.eventId, ownerId: a.ownerId, rows: a.rows }),
  idempotent: true,
  pick: j => j as Imported,
  fixture(state, dispatch) {
    const n = csvGood(state.ui.CSV).length;
    return consoleFixtureWrite(state, dispatch, { type: "csvImport" },
      next => (next.ui.CSVDONE && next.ui.CSVDONE !== state.ui.CSVDONE ? null : fail(422, "refused", "Not loaded — choose the event and a file with rows that can be written.")),
      () => ({ added: n, refused: 0, rows: [] }));
  },
};

/** The rows of the file as the route takes them: only the rows the preview called good, in order. */
export const importRowsOf = (csv: ConsoleState["ui"]["CSV"]): ImportArgs["rows"] =>
  csvGood(csv).map(r => ({ name: r.n, mobile: r.ph, ...(r.em ? { email: r.em } : {}), ...(r.city ? { city: r.city } : {}), units: r.units || null }));

/** Words for a refused row's code, for the result table (the route's `message` is the fragment after the dash). */
export const ROW_WHY: Readonly<Record<string, string>> = Object.freeze({
  "duplicate-mobile": "the book already has this number", "duplicate-in-file": "the same number is earlier in this file",
  "not-attempted": "not tried — the load stopped before this row", zoho: "Zoho did not answer for this row",
});

/* ---- the duplicate hint while typing -------------------------------------------------------------------- */
export type DupeHint =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; answer: DuplicateAnswer }
  | { state: "error"; err: ApiErr };

/** One lookup in either mode. Fixture: the book's own match on the ten digits (the lead is the person's own when they carry it). */
export async function duplicateLookup(mode: "live" | "fixture", book: ConsoleState, mobile: string, opts: { signal?: AbortSignal; fetch?: Fetch } = {}): Promise<ApiResult<DuplicateAnswer>> {
  if (mode === "fixture") {
    const l = dupeOf(book.LEADS, mobile);
    return ok<DuplicateAnswer>(!l ? { status: "none" } : { status: l.own === book.WHO ? "own" : "visible", leadId: l.id, firstName: l.n.split(" ")[0] || null });
  }
  const r = await apiFetch("POST", "/api/leads/duplicate", { body: { mobile }, signal: opts.signal, fetch: opts.fetch });
  return r.ok ? ok(r.data as DuplicateAnswer) : r;
}

/** Asks as the number is typed: nothing until it is a number, then once the typing settles (400 ms). Live only calls the
 *  route; the fixture answers on the spot. A failed ask is `error`, never "none" (D45: say so rather than guess). */
export function useDuplicateHint(book: ConsoleState, mobile: string, fetcher?: Fetch): DupeHint {
  const mode = useApiMode();
  const valid = phoneOK(mobile);
  const [got, setGot] = useState<{ mobile: string; r: ApiResult<DuplicateAnswer> } | null>(null);
  useEffect(() => {
    if (mode !== "live" || !valid) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      void duplicateLookup("live", book, mobile, { signal: ac.signal, fetch: fetcher }).then(r => { if (!ac.signal.aborted) setGot({ mobile, r }); });
    }, 400);
    return () => { clearTimeout(t); ac.abort(); };
  }, [mode, valid, mobile]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!valid) return { state: "idle" };
  if (mode === "fixture") {
    const l = dupeOf(book.LEADS, mobile);
    return { state: "ok", answer: !l ? { status: "none" } : { status: l.own === book.WHO ? "own" : "visible", leadId: l.id, firstName: l.n.split(" ")[0] || null } };
  }
  if (!got || got.mobile !== mobile) return { state: "loading" };
  return got.r.ok ? { state: "ok", answer: got.r.data } : { state: "error", err: got.r };
}
