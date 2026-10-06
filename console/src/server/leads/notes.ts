/**
 * Cluster C2 addNote (ir-write-map.md) — a free note on the investor: one Zoho Note under the Lead, written on the
 * person's own token (D53). Notes are never edited or deleted here; a correction is a new note (the drawer's rule).
 *
 *   Notes { Note_Title: "Note", Note_Content, Parent_Id: { module: { api_name: "Leads" }, id } }
 *
 * An insert under the lead changes nothing on it, so there is no Modified_Time guard; a double press is one note:
 * the Idempotency-Key runs through state/idempotent (shared across instances). The note's text never reaches a log.
 */

import type { ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { SharedState } from "../state/shared-state";
import { createIdempotency } from "../state/idempotent";
import type { FollowupAccessAuthority } from "./followup";
import { LEADS_MODULE } from "./capture";
import { createAdmit, RECORD_PREFIX, zohoError, type AdmitRefusal, type Principal, type Refused, type SourceError } from "./record-access";

export const NOTE_TITLE = "Note";
export const NOTE_MAX = 5_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export type NoteRefusal = AdmitRefusal | "note-empty" | "note-too-long" | "idempotency-key-invalid" | "key-reused" | "busy" | "unavailable";
export type NoteResult =
  | { readonly ok: true; readonly value: { readonly noteId: string; readonly leadId: string } }
  | Refused<NoteRefusal>
  | SourceError;

export interface NotesDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "insert">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  /** For the Idempotency-Key; without it a keyed press is refused ("unavailable"), an unkeyed one runs. */
  readonly state?: SharedState;
  readonly clock?: () => number;
}

export function createLeadNotes(deps: NotesDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.insert !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Notes need crm.getRecord/insert, the access authority, the ops log and the CRM record-id prefix.");
  }
  const clock = deps.clock ?? Date.now;
  const { admit, refuse } = createAdmit({ crm: deps.crm, access: deps.access, log: deps.log, recordIdPrefix: deps.recordIdPrefix, clock, action: "lead-note" });
  const presses = deps.state ? createIdempotency<NoteResult>({
    state: deps.state, ns: "lead-note", ttlSeconds: 600,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r.ok ? r.value : null),
    load: (s) => { try { const v = JSON.parse(s) as { noteId?: unknown; leadId?: unknown } | null;
      return v && typeof v.noteId === "string" && typeof v.leadId === "string" ? { ok: true, value: { noteId: v.noteId, leadId: v.leadId } } : null; } catch { return null; } },
  }) : null;

  async function run(principal: Principal, leadId: string, text: string, signal?: AbortSignal): Promise<NoteResult> {
    const o = await admit(principal, leadId, null, [], signal);
    if (!("L" in o)) return o;
    let r: Awaited<ReturnType<typeof deps.crm.insert>>;
    try {
      r = await deps.crm.insert(principal.credential, "Notes", [{
        Note_Title: NOTE_TITLE, Note_Content: text, Parent_Id: { module: { api_name: LEADS_MODULE }, id: leadId },
      }], { signal });
    } catch { return zohoError("unexpected"); }
    if (!r.ok) return zohoError(r.error.kind);
    const first = r.value[0];
    if (!first || !first.ok || !first.id) return zohoError("unexpected");
    return { ok: true, value: { noteId: first.id, leadId } };
  }

  return Object.freeze({
    async add(principal: Principal, leadId: unknown, note: unknown, idempotencyKey?: string | null, signal?: AbortSignal): Promise<NoteResult> {
      const me = principal?.credential && typeof principal.credential.userId === "string" ? principal.credential.userId : "unrecognised";
      const text = typeof note === "string" ? note.trim() : "";
      if (!text) return refuse(me, "note-empty", "Nothing typed yet.", [leadId]);
      if (text.length > NOTE_MAX) return refuse(me, "note-too-long", `Keep a note under ${NOTE_MAX} characters.`, [leadId]);
      if (idempotencyKey !== undefined && idempotencyKey !== null && (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey))) {
        return refuse(me, "idempotency-key-invalid", "Not saved — reload the page and try again.", [leadId]);
      }
      if (!idempotencyKey) return run(principal, leadId as string, text, signal);
      if (!presses) return refuse(me, "unavailable", "Not saved — the console cannot guard a double press right now. Try again.", [leadId]);
      const once = await presses.once(`${me}:${principal.sessionId}:${idempotencyKey}`, `${String(leadId)}\n${text}`, () => run(principal, leadId as string, text, signal));
      if (once.kind === "ran" || once.kind === "replay") return once.result;
      if (once.kind === "reused") return refuse(me, "key-reused", "Not saved — that press was already used for a different note.", [leadId]);
      if (once.kind === "busy") return refuse(me, "busy", "Still saving the same note. Wait a moment.", [leadId]);
      return refuse(me, "unavailable", "Not saved — the console cannot guard a double press right now. Try again.", [leadId]);
    },
  });
}
export type LeadNotes = ReturnType<typeof createLeadNotes>;
