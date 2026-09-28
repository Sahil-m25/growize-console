/**
 * M11-S05-T02 — ALLOTMENT ON THE VERIFIED ALLOCATION LETTER (D19, D45, D48, D54, D70).
 *
 * Finance presses Verify on the Allocation letter row. On the person's own token (D53), in this order:
 *   1. read the allotment (LLP_UnitAllocation_Module): it must name this Contact, be Reserved, and carry the
 *      signed Allocation_Letter file (../documents/list PAPERS "allocation-letter");
 *   2. stamp the verification — Alloc_Letter_Verified_At / _By, one guarded write (If-Unmodified-Since, D44). These
 *      are not blueprint-owned; the blueprint's Issued condition reads them, so they go first. A later refusal
 *      leaves the letter verified and on file (T03: "the letter stays on file");
 *   3. read Finance's facts — balance (matched inbound − matched refunds ≥ units × unit price, ../leads/gates'
 *      rule), KYC (Contacts.KYC = Completed), FEMA (Contacts.FEMA_Applicable → FEMA_Verified_At). A missing fact
 *      is refused in-page naming it, and nothing else is sent (he stays Reserved);
 *   4. the oversell guard (../farms/oversell check, the allotment itself left out of the count);
 *   5. GET /{module}/{id}/actions/blueprint — the transition whose target is Issued (or named Allot/Issue) is
 *      discovered, never hard-coded; none → refused "no-transition" (Sahil builds the blueprint, M11-S05-T01);
 *   6. PUT /{module}/{id}/actions/blueprint with that transition id — never a field write of Allocation_Status
 *      (D45). A refused transition is mapped back to the fact that is missing;
 *   7. allotment.done { units, project, at } goes to the investor app (../contracts/runtime publishToInvestorApp);
 *      a failed push never undoes the allotment — it is reported and the outbox retries.
 * Second press on an Issued allotment answers `already`, nothing is written, no event is re-emitted.
 * Logs: ids and short codes only — never the name, the reference or Zoho's criteria text (D47).
 */

import type { BlueprintTransitionInfo, UserCredential, ZohoClient, ZohoFields, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailure, ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { newEvent } from "../contracts/outbox";
import type { OversellGuard } from "../farms/oversell";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "../money/register";

export const ALLOT_MODULE = ALLOTMENTS_MODULE;
export const ISSUED = "Issued";
/** Fallback names of the Reserved → Issued transition when Zoho does not give its target value. PROVISIONAL. */
export const ALLOT_TRANSITION_NAMES = Object.freeze(["allot", "allotted", "issue", "issued"]);
export const ALLOTTED_TEXT = "Allotted. The units are theirs and the allocation letter is on file.";
export const ALLOT_FIELDS = Object.freeze(["Name", "Customer", "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units", "Unit_Price",
  "Allocation_Letter", "Alloc_Letter_Verified_At", "Modified_Time"]);
export const ALLOT_CONTACT_FIELDS = Object.freeze(["First_Name", "Last_Name", "ARL_ID", "KYC", "FEMA_Applicable", "FEMA_Verified_At"]);
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/-]{2,63}$/;
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
const RECEIPT_PAGE = 2_000;

export type AllotFact = "balance" | "kyc" | "fema";
export type AllotRefusal = "invalid-request" | "not-finance" | "not-visible" | "cancelled" | "letter-missing" | "changed"
  | "facts-missing" | "oversell" | "no-transition" | "blueprint-refused";

export interface AllotPrincipal { readonly credential: UserCredential; readonly sessionId: string }
export interface AllotAuthority {
  /** Re-derived from the live session: may this person verify an allocation letter (the Investors "doc" capability)? */
  mayVerify(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}
export type PublishFn = (event: Record<string, unknown>) => Promise<{ readonly ok: boolean; readonly eventId?: string; readonly reason?: string }>;

export interface AllotInput { readonly allotmentId?: unknown; readonly reference?: unknown; readonly expectedModifiedTime?: unknown }
export interface Allotted {
  readonly allotmentId: string;
  readonly contactId: string;
  readonly status: typeof ISSUED;
  readonly text: string;
  readonly units: number;
  readonly llp: { readonly id: string; readonly label: string };
  /** allotment.done: published, or why not (the allotment stands either way). */
  readonly event: { readonly published: boolean; readonly eventId: string | null; readonly reason: string | null } | null;
}
export type AllotResult =
  | { readonly ok: true; readonly value: Allotted; readonly already: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: AllotRefusal; readonly message: string; readonly missing?: readonly AllotFact[]; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface AllotDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update" | "blueprint" | "blueprintTransition">;
  readonly oversell: Pick<OversellGuard, "check">;
  readonly authority: AllotAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly publish: PublishFn;
  readonly clock?: () => number;
}

/** "the balance is still outstanding", "KYC has not passed and FEMA is not cleared". */
const FACT_TEXT: Readonly<Record<AllotFact, string>> = Object.freeze({
  balance: "the balance is still outstanding",
  kyc: "KYC has not passed",
  fema: "FEMA is not cleared",
});
export function refusalMessage(name: string | null, missing: readonly AllotFact[]): string {
  const who = name || "This investor";
  const parts = missing.map((f) => FACT_TEXT[f]);
  const list = parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return parts.length
    ? `${who} cannot be allotted yet because ${list}. The allocation letter stays on file; the units stay reserved.`
    : `${who} cannot be allotted yet — Zoho's allotment conditions are not met. The units stay reserved.`;
}

/** The Reserved → Issued transition among those Zoho offers: by target value, else by name. */
export function allotTransition(ts: readonly BlueprintTransitionInfo[]): BlueprintTransitionInfo | null {
  return ts.find((t) => t.nextFieldValue === ISSUED)
    ?? ts.find((t) => t.nextFieldValue === null && ALLOT_TRANSITION_NAMES.includes(t.name.trim().toLowerCase()))
    ?? null;
}

/** Zoho datetime in Asia/Kolkata. */
export const zohoIst = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
const retryableKind = (k: string): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const text = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
/** A blueprint PUT that Zoho answered with a refusal (conditions, not in process, not permitted) rather than an outage. */
const isTransitionRefusal = (e: ZohoFailure): boolean =>
  e.kind === "invalid-data" || e.kind === "partial" || e.kind === "forbidden" || (e.kind === "unexpected" && e.status >= 400 && e.status < 500);

export function createAllot(deps: AllotDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.update !== "function"
    || typeof deps.crm?.blueprint !== "function" || typeof deps.crm?.blueprintTransition !== "function" || typeof deps.oversell?.check !== "function"
    || typeof deps.authority?.mayVerify !== "function" || typeof deps.log?.refusal !== "function" || typeof deps.publish !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("allot needs crm (getRecord/coql/update/blueprint/blueprintTransition), the oversell guard, the Finance authority, the ops log, publish and the record-id prefix");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const nameOf = (v: unknown): string | null => (v && typeof v === "object" ? text((v as { name?: unknown }).name) : null);
  const now = (): number => { try { return clock(); } catch { return 0; } };
  const refuse = (me: string, reasonCode: AllotRefusal, message: string, ids: readonly unknown[] = [], missing?: readonly AllotFact[]): AllotResult => {
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "allotment-allot", reason: missing?.length ? `${reasonCode}.${missing.join("-")}` : reasonCode, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode, message, ...(missing ? { missing: Object.freeze([...missing]) } : {}), retryable: false };
  };
  const done = (me: string, reason: string, ids: readonly string[]) =>
    log.event?.({ at: now(), actor: { kind: "user", userId: me }, action: "allotment-allot", reason, recordIds: ids.filter(validId) });
  const failed = (kind: ZohoFailureKind | "unexpected"): AllotResult => ({
    ok: false, kind: "source-error", errorKind: kind, message: "Not allotted — Zoho is not answering. Try again.", retryable: retryableKind(kind),
  });
  const trusted = (p: unknown): AllotPrincipal | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId } : null;
  };
  const get = async (cred: UserCredential, module: string, id: string, fields: readonly string[], signal?: AbortSignal): Promise<ZohoRecord | null> => {
    const r = await crm.getRecord(cred, module, id, { fields, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null;
      throw new SourceFail(r.error.kind);
    }
    return r.value && r.value.id === id ? r.value : null;
  };

  /** Finance's facts for one allotment and its Contact; `missing` in the order the refusal names them. */
  async function factsOf(cred: UserCredential, a: ZohoRecord, contact: ZohoRecord, units: number, signal?: AbortSignal): Promise<AllotFact[]> {
    const price = int(a.Unit_Price);
    const q = await crm.coql(cred, `select id, Allotment, Kind, Amount, Match_State from ${RECEIPTS_MODULE} where Allotment = '${a.id}' limit 0, ${RECEIPT_PAGE}`, { signal });
    if (!q.ok) throw new SourceFail(q.error.kind);
    if (q.value.moreRecords) throw new SourceFail("unexpected");
    let inbound = 0, refunded = 0;
    for (const r of q.value.records) {
      const amt = int(r.Amount);
      if (idOf(r.Allotment) !== a.id || amt === null || amt <= 0 || r.Match_State !== "Matched" || typeof r.Kind !== "string") continue;
      if (INBOUND.has(r.Kind)) inbound += amt; else if (r.Kind === "Refund") refunded += amt;
    }
    const missing: AllotFact[] = [];
    if (price === null || price <= 0 || Math.max(0, inbound - refunded) < units * price) missing.push("balance");
    if (contact.KYC !== "Completed") missing.push("kyc");
    if (contact.FEMA_Applicable === true && !(typeof contact.FEMA_Verified_At === "string" && DATETIME.test(contact.FEMA_Verified_At))) missing.push("fema");
    return missing;
  }

  async function allot(principal: unknown, contactId: unknown, input: AllotInput = {}, signal?: AbortSignal): Promise<AllotResult> {
    const p = trusted(principal);
    if (!p) { log.refusal({ at: now(), actor: { kind: "user", userId: "unrecognised" }, action: "allotment-allot", reason: "invalid-request", recordIds: [] }); return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Sign in again.", retryable: false }; }
    const me = p.credential.userId, cred = p.credential;
    const allotmentId = input?.allotmentId, expected = input?.expectedModifiedTime, reference = input?.reference;
    if (!validId(contactId) || !validId(allotmentId)) return refuse(me, "invalid-request", "Not allotted — open the investor again.");
    if (expected !== undefined && expected !== null && (typeof expected !== "string" || !DATETIME.test(expected))) {
      return refuse(me, "invalid-request", "Not allotted — reload the investor and try again.", [contactId, allotmentId]);
    }
    if (reference !== undefined && reference !== null && reference !== "" && (typeof reference !== "string" || !REFERENCE.test(reference.trim()))) {
      return refuse(me, "invalid-request", "That is not a signing reference.", [contactId, allotmentId]);
    }
    let may = false;
    try { may = (await deps.authority.mayVerify(cred, p.sessionId, signal)) === true; } catch { may = false; }
    if (!may) return refuse(me, "not-finance", "Only Finance verifies an allocation letter.", [contactId, allotmentId]);

    try {
      const a = await get(cred, ALLOT_MODULE, allotmentId, ALLOT_FIELDS, signal);
      if (!a || idOf(a.Customer) !== contactId) return refuse(me, "not-visible", "Not allotted — this allotment is not visible to you.", [contactId, allotmentId]);
      const llpId = idOf(a.LLP);
      const status = a.Allocation_Status;
      const reserved = int(a.Reserved_Units) ?? 0, issued = int(a.Issued_Units) ?? 0;
      const label = nameOf(a.LLP) ?? "This LLP";
      if (status === ISSUED) {
        return { ok: true, already: true, value: Object.freeze({ allotmentId, contactId, status: ISSUED, text: ALLOTTED_TEXT,
          units: Math.max(issued, reserved), llp: Object.freeze({ id: llpId ?? "", label }), event: null }) };
      }
      if (status !== "Reserved" || !llpId) return refuse(me, "cancelled", "Not allotted — this allotment is not reserved.", [contactId, allotmentId]);
      const letter = a.Allocation_Letter;
      if (letter === null || letter === undefined || letter === "" || (Array.isArray(letter) && letter.length === 0)) {
        return refuse(me, "letter-missing", "The signed allocation letter is not on the allotment yet.", [contactId, allotmentId]);
      }
      const modified = typeof a.Modified_Time === "string" && DATETIME.test(a.Modified_Time) ? a.Modified_Time : null;
      if (typeof expected === "string" && modified && expected !== modified) {
        return refuse(me, "changed", "Not allotted — this allotment changed since you opened it. Reload and look again.", [contactId, allotmentId]);
      }
      const units = reserved;
      if (units <= 0) return refuse(me, "cancelled", "Not allotted — this allotment holds no reserved units.", [contactId, allotmentId]);

      // 2. The verification stamp (not blueprint-owned; the Issued condition reads it).
      if (!(typeof a.Alloc_Letter_Verified_At === "string" && DATETIME.test(a.Alloc_Letter_Verified_At))) {
        const w = await crm.update(cred, ALLOT_MODULE, allotmentId, { Alloc_Letter_Verified_At: zohoIst(now()), Alloc_Letter_Verified_By: { id: me } },
          { ifUnmodifiedSince: (expected as string | undefined) ?? modified, signal });
        if (!w.ok) {
          if (w.error.kind === "conflict") return refuse(me, "changed", "Not allotted — this allotment changed since you opened it. Reload and look again.", [contactId, allotmentId]);
          if (w.error.kind === "not-found" || w.error.kind === "forbidden") return refuse(me, "not-visible", "Not allotted — this allotment is not visible to you.", [contactId, allotmentId]);
          throw new SourceFail(w.error.kind);
        }
        done(me, "letter-verified", [allotmentId]);
      }

      // 3. Finance's facts.
      const contact = await get(cred, "Contacts", contactId, ALLOT_CONTACT_FIELDS, signal);
      if (!contact) return refuse(me, "not-visible", "Not allotted — this investor is not visible to you.", [contactId, allotmentId]);
      const name = [text(contact.First_Name, 80), text(contact.Last_Name, 80)].filter(Boolean).join(" ") || null;
      const missing = await factsOf(cred, a, contact, units, signal);
      if (missing.length) return refuse(me, "facts-missing", refusalMessage(name, missing), [contactId, allotmentId], missing);

      // 4. The oversell guard.
      const g = await deps.oversell.check(cred, { llpId, units, exceptAllotmentId: allotmentId, investorName: name }, signal);
      if (!g.ok) {
        if (g.kind === "refused") return refuse(me, "oversell", g.message, [contactId, allotmentId, llpId]);
        throw new SourceFail((g.errorKind as ZohoFailureKind) ?? "unexpected");
      }
      const llpLabel = g.llp.label;

      // 5. Discover the transition.
      const bp = await crm.blueprint(cred, ALLOT_MODULE, allotmentId, { signal });
      if (!bp.ok && !isTransitionRefusal(bp.error)) throw new SourceFail(bp.error.kind);
      const t = bp.ok && bp.value ? allotTransition(bp.value.transitions) : null;
      if (!t || !validId(t.id)) {
        return refuse(me, "no-transition", "Not allotted — Zoho offers no allotment step on this record. Finance's allotment blueprint is not in place.", [contactId, allotmentId]);
      }
      if (!t.criteriaMatched) return refuse(me, "blueprint-refused", refusalMessage(name, []), [contactId, allotmentId]);

      // 6. The transition — never a field write of Allocation_Status.
      // Only the During fields the transition asks for and the allotment can fill; any other one Zoho names in its refusal.
      const data: Record<string, number> = {};
      if (t.fields.includes("Issued_Units")) data.Issued_Units = units;
      if (t.fields.includes("Reserved_Units")) data.Reserved_Units = 0;
      const put = await crm.blueprintTransition(cred, ALLOT_MODULE, allotmentId, t.id, data as ZohoFields, { signal });
      if (!put.ok) {
        if (put.error.kind === "conflict") return refuse(me, "changed", "Not allotted — this allotment changed since you opened it. Reload and look again.", [contactId, allotmentId]);
        if (!isTransitionRefusal(put.error)) throw new SourceFail(put.error.kind);
        // Zoho refused: name the fact from a fresh read (it may have moved since step 3); else Zoho's word stands.
        const again = await factsOf(cred, a, contact, units, signal).catch(() => [] as AllotFact[]);
        return refuse(me, "blueprint-refused", refusalMessage(name, again), [contactId, allotmentId], again);
      }
      done(me, "allotted", [allotmentId, contactId, llpId]);
      done(me, "under-account-management", [contactId]);

      // 7. allotment.done — the allotment stands whatever the push does.
      const arl = typeof contact.ARL_ID === "string" && /^ARL-INV-\d{4}$/.test(contact.ARL_ID) ? contact.ARL_ID : null;
      const at = now();
      const event = newEvent("allotment.done", {
        actor: { kind: "user", zoho_user_id: me },
        ids: { investor_contact_id: contactId, ...(arl ? { arl_code: arl } : {}) },
        payload: { units, project: llpLabel, at: zohoIst(at) }, occurredAt: at,
      }, () => at);
      let pub: { published: boolean; eventId: string | null; reason: string | null };
      try {
        const r = await deps.publish(event);
        pub = { published: r.ok, eventId: r.ok ? r.eventId ?? (event.event_id as string) : null, reason: r.ok ? null : r.reason ?? "refused" };
      } catch { pub = { published: false, eventId: null, reason: "push-threw" }; }
      if (!pub.published) log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "allotment-done-push", reason: pub.reason ?? "refused", recordIds: [allotmentId] });
      return { ok: true, already: false, value: Object.freeze({ allotmentId, contactId, status: ISSUED, text: ALLOTTED_TEXT, units,
        llp: Object.freeze({ id: llpId, label: llpLabel }), event: Object.freeze(pub) }) };
    } catch (e) {
      return failed(e instanceof SourceFail ? e.kind : "unexpected");
    }
  }

  return Object.freeze({ allot });
}
export type AllotService = ReturnType<typeof createAllot>;
