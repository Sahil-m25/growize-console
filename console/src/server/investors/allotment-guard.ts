/**
 * M11-S02-NOTE-2 — AN ALLOTMENT NEVER SAVES WITHOUT ITS CUSTOMER AND ITS LLP (M11-S02 AC1).
 *
 * One rule, three doors. Every allotment write in the console passes it:
 *   create  — add-paid (./add-paid) checks the fields before the insert
 *   update  — allot (./allot, the verification stamp and the transition) and the hold start (../money/match)
 *             check the record they read, so an unlinked row is refused rather than carried further
 *   any     — `guardAllotmentWrites` wraps a ZohoClient so an insert / upsert / update of LLP_UnitAllocation_Module
 *             that lacks or blanks Customer or LLP is refused before it leaves, whoever the caller is
 * The refusal code is `allotment-unlinked`; the page text names what is missing. Rows already in Zoho without a
 * link are not hidden: reads give them `linked: false` (./allotments) and the pages mark them "Needs a link".
 * Ids only in the log (rule 7).
 */

import type { UserCredential, ZohoClient, ZohoFields } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";

export const ALLOTMENT_MODULE = "LLP_UnitAllocation_Module";
export const ALLOTMENT_UNLINKED = "allotment-unlinked";
export type Link = "Customer" | "LLP";
const RECORD_ID = /^\d{15,22}$/;

/** A lookup value as Zoho carries it: an id string or { id }. */
export const linkIdOf = (v: unknown): string | null => {
  if (typeof v === "string") return RECORD_ID.test(v) ? v : null;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};

/** What is missing, in the order the message names it. */
export function missingLinks(customer: unknown, llp: unknown): Link[] {
  const out: Link[] = [];
  if (!linkIdOf(customer)) out.push("Customer");
  if (!linkIdOf(llp)) out.push("LLP");
  return out;
}

/** "An allotment needs its Customer and its LLP — this one has no LLP. Link it first; nothing was saved." */
export function unlinkedMessage(missing: readonly Link[]): string {
  const what = missing.length === 2 ? "no Customer and no LLP" : missing[0] === "Customer" ? "no Customer" : "no LLP";
  return `An allotment needs both its Customer and its LLP — this one has ${what}. Link it in Zoho first; nothing was saved.`;
}

/** A create must carry both links. An update is judged on the fields it names: it may not blank one. */
export function writeMissing(kind: "create" | "update", fields: ZohoFields | undefined | null): Link[] {
  const f = (fields ?? {}) as Record<string, unknown>;
  if (kind === "create") return missingLinks(f.Customer, f.LLP);
  const out: Link[] = [];
  if (Object.hasOwn(f, "Customer") && !linkIdOf(f.Customer)) out.push("Customer");
  if (Object.hasOwn(f, "LLP") && !linkIdOf(f.LLP)) out.push("LLP");
  return out;
}

/**
 * The belt: wrap a client so no allotment insert, upsert or update can drop a link, whichever page or job calls it.
 * Refusals look like the client's own (`{ ok: false, error: { kind: "refused", reason } }`).
 */
export function guardAllotmentWrites<C extends Pick<ZohoClient, "insert" | "update" | "upsert">>(crm: C, log?: Pick<OpsLog, "refusal">): C {
  const refuse = (as: UserCredential, action: string, ids: readonly string[]) => {
    log?.refusal({ at: Date.now(), actor: { kind: "user", userId: as.userId }, action: `allotment-${action}`, reason: ALLOTMENT_UNLINKED, recordIds: ids.filter((i) => RECORD_ID.test(i)) });
    return Promise.resolve({ ok: false as const, error: { kind: "refused" as const, status: null, reason: ALLOTMENT_UNLINKED }, creditsRemaining: null });
  };
  const bad = (kind: "create" | "update", rs: readonly ZohoFields[]) => rs.some((r) => writeMissing(kind, r).length > 0);
  return Object.freeze({
    ...crm,
    insert: (as: UserCredential, module: string, records: readonly ZohoFields[], o?: Parameters<C["insert"]>[3]) =>
      module === ALLOTMENT_MODULE && bad("create", records) ? refuse(as, "insert", []) : crm.insert(as, module, records, o),
    update: (as: UserCredential, module: string, id: string, fields: ZohoFields, o: Parameters<C["update"]>[4]) =>
      module === ALLOTMENT_MODULE && bad("update", [fields]) ? refuse(as, "update", [id]) : crm.update(as, module, id, fields, o),
    upsert: (as: UserCredential, module: string, records: readonly ZohoFields[], dup: readonly string[], o?: Parameters<C["upsert"]>[4]) =>
      module === ALLOTMENT_MODULE && bad("create", records) ? refuse(as, "upsert", []) : crm.upsert(as, module, records, dup, o),
  }) as unknown as C;
}
