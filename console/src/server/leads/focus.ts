/**
 * M05-S02 — what the Today focus panel shows for one selected lead: its next step, the last
 * contact (the newest Touch, D76) and the latest note. Read live with the person's own token; a
 * lead Zoho will not show them is "unavailable", never a partial panel. Nothing is cached.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { LeadsAccessAuthority } from "./book";
import { LEADS_MODULE } from "./capture";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export interface FocusPanel {
  readonly leadId: string;
  readonly nextStep: { readonly text: string | null; readonly channel: string | null; readonly at: string | null };
  readonly lastReplyAt: string | null;
  readonly lastContact: { readonly channel: string | null; readonly at: string; readonly isReply: boolean } | null;
  readonly latestNote: { readonly text: string; readonly at: string } | null;
}
export type FocusResult =
  | { readonly ok: true; readonly value: FocusPanel }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface FocusDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "getRelated">;
  readonly access: LeadsAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const s = (r: ZohoRecord, k: string, max: number, re?: RegExp): string | null | undefined => {
  const v = r[k];
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && v.length <= max && (!re || re.test(v)) ? v : undefined;
};

export function createFocusRead(deps: FocusDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.getRelated !== "function"
    || typeof deps.access?.recheck !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The focus panel needs crm.getRecord/coql/getRelated, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: Extract<FocusResult, { kind: "refused" }>["reasonCode"], ids: string[] = []): FocusResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-focus", reason: reasonCode, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode };
  };
  const zoho = (k: ZohoFailureKind): FocusResult => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" });

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, leadId: string, signal?: AbortSignal): Promise<FocusResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId) || !validId(leadId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      try {
        const a = await access.recheck(cred, principal.sessionId, signal);
        if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
        if (!a.mayViewLeads) return refuse(me, "capability-missing");
      } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      try {
        const lead = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: ["Next_Step", "Next_Step_Channel", "Next_Step_At", "Last_Reply_At"], signal });
        if (!lead.ok) return lead.error.kind === "not-found" || lead.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(lead.error.kind);
        if (!lead.value) return refuse(me, "not-visible", [leadId]);
        const L = lead.value;
        const next = { text: s(L, "Next_Step", 200), channel: s(L, "Next_Step_Channel", 120), at: s(L, "Next_Step_At", 40, DATETIME) };
        const lastReplyAt = s(L, "Last_Reply_At", 40, DATETIME);
        if (L.id !== leadId || Object.values(next).includes(undefined) || lastReplyAt === undefined) return refuse(me, "source-invalid", [leadId]);

        const touch = await crm.coql(cred, `select id, Channel, Occurred_At, Is_Reply, Lead from Touches where Lead = '${leadId}' order by Occurred_At desc limit 0, 1`, { signal });
        if (!touch.ok) return zoho(touch.error.kind);
        let lastContact: FocusPanel["lastContact"] = null;
        const t = touch.value.records[0];
        if (t) {
          const at = s(t, "Occurred_At", 40, DATETIME), ch = s(t, "Channel", 120);
          if ((t.Lead as { id?: unknown } | null)?.id !== leadId || !at || ch === undefined || typeof t.Is_Reply !== "boolean") return refuse(me, "source-invalid", [leadId]);
          lastContact = { channel: ch, at, isReply: t.Is_Reply };
        }

        const notes = await crm.getRelated(cred, LEADS_MODULE, leadId, "Notes", { fields: ["Note_Content", "Created_Time"], perPage: 200, signal });
        if (!notes.ok) return zoho(notes.error.kind);
        let latestNote: FocusPanel["latestNote"] = null;
        for (const n of notes.value.records) {
          const text = s(n, "Note_Content", 32_000), at = s(n, "Created_Time", 40, DATETIME);
          if (!text || !at) return refuse(me, "source-invalid", [leadId]);
          if (!latestNote || Date.parse(at) > Date.parse(latestNote.at)) latestNote = { text, at };
        }
        return { ok: true, value: Object.freeze({ leadId, nextStep: next as FocusPanel["nextStep"], lastReplyAt, lastContact, latestNote }) };
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
      }
    },
  });
}
