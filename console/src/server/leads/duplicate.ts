/**
 * M04-S02 — "is this number already on the book?", asked while the mobile is typed.
 *
 * The question is put to Zoho with the person's own token (CLAUDE.md rule 2: a service token never
 * serves a screen), so it can only find a lead the person may already see. That is enough to offer
 * "Open <first name>" on their own book and to say nothing about anybody else's. A number held in a
 * book the person cannot see is stopped at the write by Zoho's duplicate check on Mobile
 * (capture.ts, isDuplicateMobile) and is reported without a name. Only the id and the first name of
 * a visible match leave this module; the number itself is never logged or returned.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { CaptureAccessAuthority, CapturePrincipal } from "./capture";
import { LEADS_MODULE, mobileToE164 } from "./capture";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;

export type DuplicateAnswer =
  | { readonly status: "none" }
  | { readonly status: "own"; readonly leadId: string; readonly firstName: string | null }
  | { readonly status: "visible"; readonly leadId: string; readonly firstName: string | null };

export type DuplicateResult =
  | { readonly ok: true; readonly value: DuplicateAnswer }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "invalid-mobile" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface DuplicateDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: CaptureAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

/** The spellings a stored Indian number may have been saved in, plus a match on its last ten digits. */
export function mobileClause(e164: string): string {
  const digits = e164.slice(1);
  const forms = new Set([e164, digits]);
  if (e164.startsWith("+91")) {
    const ten = e164.slice(3);
    forms.add(ten).add("0" + ten);
    /* stored with spaces, as imported or seeded: "+91 98765 43210", "+91 9876543210", "98765 43210" */
    forms.add(`+91 ${ten.slice(0, 5)} ${ten.slice(5)}`).add(`+91 ${ten}`).add(`${ten.slice(0, 5)} ${ten.slice(5)}`);
    return `(Mobile in (${[...forms].map((f) => `'${f}'`).join(", ")}) or Mobile like '%${ten}')`;
  }
  return `Mobile in (${[...forms].map((f) => `'${f}'`).join(", ")})`;
}

export function createDuplicateCheck(deps: DuplicateDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The duplicate check needs crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: Extract<DuplicateResult, { kind: "refused" }>["reasonCode"]): DuplicateResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-duplicate-check", reason: reasonCode, recordIds: [] });
    return { ok: false, kind: "refused", reasonCode };
  };

  return Object.freeze({
    async lookup(principal: CapturePrincipal, mobile: string, signal?: AbortSignal): Promise<DuplicateResult> {
      const cred: UserCredential | undefined = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const e164 = mobileToE164(mobile);
      if (!e164) return refuse(cred.userId, "invalid-mobile");
      let a;
      try {
        a = await access.recheck(cred, principal.sessionId, signal);
      } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== cred.userId) return refuse(cred.userId, "session-changed");
      // Probing whether a number exists is part of adding a lead; a seat that cannot add may not ask.
      if (!a.mayCapture) return refuse(cred.userId, "capability-missing");

      let res: Awaited<ReturnType<typeof crm.coql>>;
      try {
        res = await crm.coql(cred, `select id, First_Name, Owner from ${LEADS_MODULE} where ${mobileClause(e164)} order by id asc limit 0, 5`, { signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
      }
      if (!res.ok) {
        const k = res.error.kind;
        return { ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" };
      }
      if (res.value.invalidRecordIds) return refuse(cred.userId, "source-invalid");
      const rows = res.value.records;
      if (rows.length === 0) return { ok: true, value: { status: "none" } };
      const own = rows.find((r) => (r.Owner as { id?: unknown } | null)?.id === cred.userId);
      const hit = own ?? rows[0];
      if (!validId(hit.id)) return refuse(cred.userId, "source-invalid");
      const first = typeof hit.First_Name === "string" && hit.First_Name.length <= 40 ? hit.First_Name : null;
      return { ok: true, value: Object.freeze({ status: own ? "own" as const : "visible" as const, leadId: hit.id, firstName: first }) };
    },
  });
}
