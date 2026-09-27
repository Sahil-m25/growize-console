/**
 * M04-S04 — load a lead file (CSV read in the browser) into Zoho, tagged to an event.
 *
 * Every row is checked again here with capture's own rules. Nothing is written until an event is
 * named. Rows land with NO consent whatever the file says (a file's "yes" is not the investor's —
 * prototype, "what a file may claim about consent"), source Events and the event's lookup, and an
 * owner by the rule the manager picked: round-robin across who staffed the event, all to me, all
 * to one person, or leave unassigned (D82/D84). An IR's import is always theirs.
 *
 * Writes are the person's own, 100 rows per call. Zoho's duplicate check on Mobile (M04-S02) makes
 * a retry safe: a row that already landed comes back as a duplicate and is never written twice.
 */

import type { UserCredential, ZohoClient, ZohoFields } from "../../lib/zoho/client";
import { isUserCredential, MAX_UPSERT_RECORDS } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { CaptureAccessAuthority } from "./capture";
import { EMAIL, LEADS_MODULE, mobileToE164, splitName } from "./capture";

export const MAX_IMPORT_ROWS = 2_000;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;

export type OwnerRule =
  | { readonly kind: "round-robin"; readonly staffIds: readonly string[] }
  | { readonly kind: "me" }
  | { readonly kind: "one"; readonly ownerId: string }
  | { readonly kind: "unassigned" };

export interface ImportRow {
  readonly name: string;
  readonly mobile: string;
  readonly email?: string;
  readonly city?: string;
  readonly units?: number | null;
}

export type RowVerdict =
  | { readonly row: number; readonly status: "added"; readonly leadId: string; readonly ownerId: string | null }
  | { readonly row: number; readonly status: "refused"; readonly reason: "name" | "mobile" | "email" | "units" | "duplicate-in-file" | "duplicate-on-book" | "zoho" };

export type ImportResult =
  | { readonly ok: true; readonly value: { readonly added: number; readonly refused: number; readonly rows: readonly RowVerdict[] } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "event-missing" | "session-changed" | "capability-missing" | "owner-not-assignable" | "unassigned-queue-missing" | "too-many-rows" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface ImportDependencies {
  readonly crm: Pick<ZohoClient, "insert">;
  readonly access: CaptureAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

/** What the preview shows before anything is written: each row's fate by the file alone. */
export function checkRows(rows: readonly ImportRow[]): { readonly good: readonly { row: number; fields: ZohoFields }[]; readonly refused: readonly RowVerdict[] } {
  const seen = new Set<string>();
  const good: { row: number; fields: ZohoFields }[] = [];
  const refused: RowVerdict[] = [];
  rows.forEach((r, row) => {
    const name = typeof r?.name === "string" ? splitName(r.name) : null;
    if (!name) return void refused.push({ row, status: "refused", reason: "name" });
    const mobile = mobileToE164(r.mobile);
    if (!mobile) return void refused.push({ row, status: "refused", reason: "mobile" });
    const email = typeof r.email === "string" ? r.email.trim() : "";
    if (email && (email.length > 100 || !EMAIL.test(email))) return void refused.push({ row, status: "refused", reason: "email" });
    const units = r.units ?? null;
    if (units !== null && (!Number.isSafeInteger(units) || units < 0)) return void refused.push({ row, status: "refused", reason: "units" });
    if (seen.has(mobile)) return void refused.push({ row, status: "refused", reason: "duplicate-in-file" });
    seen.add(mobile);
    const city = typeof r.city === "string" ? r.city.trim().slice(0, 255) : "";
    good.push({ row, fields: { ...name, Mobile: mobile, ...(email ? { Email: email } : {}), ...(city ? { City: city } : {}),
      ...(units !== null ? { Units_Interested: units } : {}) } });
  });
  return { good, refused };
}

export function createLeadImport(deps: ImportDependencies) {
  if (!deps || typeof deps.crm?.insert !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Import needs crm.insert, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: Extract<ImportResult, { kind: "refused" }>["reasonCode"]): ImportResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "import-leads", reason: reasonCode, recordIds: [] });
    return { ok: false, kind: "refused", reasonCode };
  };

  return Object.freeze({
    async load(principal: { credential: UserCredential; sessionId: string }, eventId: string, rule: OwnerRule, rows: readonly ImportRow[], signal?: AbortSignal): Promise<ImportResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || !Array.isArray(rows) || !rule || typeof rule !== "object") {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      if (!validId(eventId)) return refuse(me, "event-missing");
      if (rows.length > MAX_IMPORT_ROWS) return refuse(me, "too-many-rows");
      let a;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
      if (!a.mayCapture) return refuse(me, "capability-missing");

      // Who carries each row. An IR or Channel Partner keeps what they load, whatever rule is sent.
      const keepsOwn = a.actor.seat === "investor-relations" || a.actor.seat === "channel-partner";
      const may = (id: string) => validId(id) && (id === me || a!.assignableOwnerIds.includes(id));
      let ownerFor: (i: number) => string | null;
      if (keepsOwn || rule.kind === "me") ownerFor = () => me;
      else if (rule.kind === "one") {
        if (!may(rule.ownerId)) return refuse(me, "owner-not-assignable");
        ownerFor = () => rule.ownerId;
      } else if (rule.kind === "round-robin") {
        const staff = Array.isArray(rule.staffIds) ? [...new Set(rule.staffIds)] : [];
        if (staff.length === 0 || !staff.every(may)) return refuse(me, "owner-not-assignable");
        ownerFor = (i) => staff[i % staff.length];
      } else if (rule.kind === "unassigned") ownerFor = () => null;
      else return refuse(me, "invalid-request");
      if (!keepsOwn && rule.kind === "unassigned" && !validId(a.unassignedQueueUserId)) return refuse(me, "unassigned-queue-missing");

      const { good, refused } = checkRows(rows);
      const verdicts: RowVerdict[] = [...refused];
      const planned = good.map((g, i) => ({ ...g, ownerId: ownerFor(i) }));
      for (let i = 0; i < planned.length; i += MAX_UPSERT_RECORDS) {
        const batch = planned.slice(i, i + MAX_UPSERT_RECORDS);
        const records: ZohoFields[] = batch.map((p) => ({
          ...p.fields, Lead_Source: "Events", Lead_Event: { id: eventId },
          Owner: { id: p.ownerId ?? (a!.unassignedQueueUserId as string) },
          ...(p.ownerId ? { Owner_Assigned_At: `${new Date(clock() + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30` } : {}),
        }));
        let res: Awaited<ReturnType<typeof crm.insert>> | null = null;
        try { res = await crm.insert(cred, LEADS_MODULE, records, { signal }); } catch { res = null; }
        const outcomes = res && (res.ok ? res.value : res.error.kind === "partial" ? (res.error as { records?: readonly { ok: boolean; id: string | null; code: string; field: string | null }[] }).records ?? null : null);
        batch.forEach((p, k) => {
          const o = outcomes?.[k];
          if (o && o.ok && validId(o.id)) verdicts.push({ row: p.row, status: "added", leadId: o.id, ownerId: p.ownerId });
          else if (o && o.code === "DUPLICATE_DATA") verdicts.push({ row: p.row, status: "refused", reason: "duplicate-on-book" });
          else verdicts.push({ row: p.row, status: "refused", reason: "zoho" });
        });
      }
      verdicts.sort((x, y) => x.row - y.row);
      const added = verdicts.filter((v) => v.status === "added").length;
      return { ok: true, value: { added, refused: verdicts.length - added, rows: Object.freeze(verdicts) } };
    },
  });
}
