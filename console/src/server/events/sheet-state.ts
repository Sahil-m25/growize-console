/**
 * M14-S03-W2 — THE LOADED SHEET'S STATE: what Lead_Events says about one event's tablet sheet (D45, D53, D59, D84).
 *
 * Read on the person's own token, so Zoho's sharing decides who may open the event at all; the leads scope must also
 * hold the page (a seat with no leads book is refused). Nothing is stored here and no lead is read — the counts are the
 * ones the loader wrote back (Rows_In_File / Rows_Loaded / Rows_Duplicate / Rows_Refused), who loaded it and when
 * (Loaded_By / Loaded_At), and the event's staff in the order they are named (the round-robin order).
 *
 *   state   "none"   Load_State is empty — no sheet was started for this event
 *           "ready"  Load_State Ready — the sheet waits to be loaded (once; ./loader)
 *           "loaded" Load_State Loaded
 *   mayLoad the seat's `events · load` re-read from the live session (the same authority the loader checks)
 *   log     the event's load log: one "Loaded the event sheet" line once it is loaded, worded as the card words it
 *
 * PROVISIONAL (named, not invented): Zoho holds no row counts for a sheet that is still Ready and no rule once it is
 * loaded, so `willLoad`, `filledBy` and `rule` are null until Lead_Events carries Sheet_Rows, Sheet_Filled_By/At and
 * Load_Rule. `inFile` before the load is Rows_In_File when somebody set it, else null. No sheet reader exists
 * (M14-S03-NOTE-1): the page posts the rows it holds and the loader re-checks every one.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { scopesFor } from "../data/scope";
import { idOf, istStamp, nameOf, num, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { EVENTS_MODULE, STAFF_EVENT, STAFF_MODULE, STAFF_USER } from "./events";
import type { EventsWriteAuthority } from "./writes";

export const SHEET_FIELDS = Object.freeze(["id", "Name", "Event_State", "Load_State", "Loaded_By", "Loaded_At", "Rows_In_File", "Rows_Loaded", "Rows_Duplicate", "Rows_Refused"]);
export type SheetPhase = "none" | "ready" | "loaded";
export interface Person { readonly id: string; readonly name: string | null }
export interface SheetLogLine { readonly at: string; readonly what: string; readonly by: Person | null; readonly note: string }

export interface SheetState {
  readonly eventId: string;
  readonly eventName: string;
  readonly state: SheetPhase;
  /** Rows_In_File (written by the load; before it, only if somebody set it) */
  readonly inFile: number | null;
  /** PROVISIONAL: rows that will load / are already here / lack a required field — null, no sheet reader (needs Lead_Events.Sheet_Rows) */
  readonly willLoad: number | null;
  readonly duplicates: number | null;
  readonly refused: number | null;
  readonly loaded: number | null;
  /** PROVISIONAL: who filled the sheet and when — null (needs Lead_Events.Sheet_Filled_By / Sheet_Filled_At) */
  readonly filledBy: Person | null;
  readonly filledAt: string | null;
  readonly loadedBy: Person | null;
  /** naive IST "YYYY-MM-DDTHH:mm" (rule 9) */
  readonly loadedAt: string | null;
  /** PROVISIONAL: the rule the load dealt by — null (needs Lead_Events.Load_Rule) */
  readonly rule: string | null;
  /** the event's staff in named order: who a round-robin deals to, and who "all to one person" may name */
  readonly staff: readonly Person[];
  readonly mayLoad: boolean;
  readonly log: readonly SheetLogLine[];
}

export interface SheetStateDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly authority: EventsWriteAuthority;
  readonly events: InvestorEvents;
  readonly maxPages?: number;
}
export type SheetStateResult =
  | { readonly ok: true; readonly sheet: SheetState }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "invalid-request" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const PHASE: Readonly<Record<string, SheetPhase>> = Object.freeze({ Ready: "ready", Loaded: "loaded" });

export function createSheetState(deps: SheetStateDeps) {
  return Object.freeze({
    async forEvent(p: { readonly credential: UserCredential; readonly seat: string }, id: unknown, signal?: AbortSignal): Promise<SheetStateResult> {
      const me = p.credential.userId;
      if (scopesFor(p.seat, me).leads.kind === "none") { deps.events.refusal(me, "event-sheet", "seat-denied"); return { ok: false, kind: "refused", reason: "no-book" }; }
      if (typeof id !== "string" || !RECORD_ID.test(id)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const ev = await pagedSelect(deps.crm, p.credential, SHEET_FIELDS, EVENTS_MODULE, `id = '${id}'`, "id asc", signal, 1);
      if (!ev.ok) return ev.kind === "refused" ? { ok: false, kind: "refused", reason: ev.reason } : { ok: false, kind: "source-error", errorKind: ev.errorKind, retryable: ev.retryable };
      const rec = ev.rows.find((x) => x.id === id);
      if (!rec) { deps.events.refusal(me, "event-sheet", "not-visible", [id]); return { ok: false, kind: "refused", reason: "not-found" }; }
      const st = await pagedSelect(deps.crm, p.credential, ["id", STAFF_EVENT, STAFF_USER], STAFF_MODULE, `${STAFF_EVENT} = '${id}'`, "id asc", signal, deps.maxPages);
      if (!st.ok) return st.kind === "refused" ? { ok: false, kind: "refused", reason: st.reason } : { ok: false, kind: "source-error", errorKind: st.errorKind, retryable: st.retryable };
      const staff: Person[] = [];
      for (const x of st.rows) {
        const u = idOf(x[STAFF_USER]);
        if (u && idOf(x[STAFF_EVENT]) === id && !staff.some((s) => s.id === u)) staff.push(Object.freeze({ id: u, name: nameOf(x[STAFF_USER]) }));
      }
      let access;
      try { access = await deps.authority.recheck(p.credential, signal); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true }; }

      const state = PHASE[str(rec, "Load_State", 20) ?? ""] ?? "none";
      const by = idOf(rec.Loaded_By);
      const loadedBy: Person | null = state === "loaded" && by ? Object.freeze({ id: by, name: nameOf(rec.Loaded_By) }) : null;
      const loadedAt = state === "loaded" ? istStamp(str(rec, "Loaded_At", 40)) : null;
      const inFile = num(rec, "Rows_In_File"), loaded = state === "loaded" ? num(rec, "Rows_Loaded") : null;
      const duplicates = state === "loaded" ? num(rec, "Rows_Duplicate") : null, refused = state === "loaded" ? num(rec, "Rows_Refused") : null;
      const name = str(rec, "Name", 120) ?? "";
      const log: SheetLogLine[] = state === "loaded" && loadedAt && loaded !== null
        ? [Object.freeze({ at: loadedAt, what: "Loaded the event sheet", by: loadedBy,
          note: `${name} — ${loaded} leads${duplicates ? `, ${duplicates} refused as duplicates` : ""}` })]
        : [];
      return {
        ok: true,
        sheet: Object.freeze({
          eventId: id, eventName: name, state, inFile, willLoad: null, duplicates, refused, loaded, filledBy: null, filledAt: null,
          loadedBy, loadedAt, rule: null, staff: Object.freeze(staff), mayLoad: !!access && access.userId === me && access.mayLoad, log: Object.freeze(log),
        }),
      };
    },
  });
}
export type SheetStateReader = ReturnType<typeof createSheetState>;
