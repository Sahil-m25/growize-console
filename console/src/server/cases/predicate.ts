/**
 * M13-S02-T02 — THE ONE OWNER PREDICATE for a book scope, and the paged COQL read the Farms, Events and
 * Tickets readers share (D45, D53).
 *
 * `ownerWhere` is the role-subtree predicate the story asks the Cases read to share with the team views:
 *   user / own-lead / own-book  Owner = me            (leads also: or Secondary_Owner = me)
 *   subtree                      Owner in (the manager's subtree), ≤100 ids per IN, OR-joined;
 *                                with no subtree reader: the manager's own token under Zoho's role hierarchy
 *                                (PROVISIONAL, the same fallback as server/data/live.ts teamOrgWide)
 *   org / all                    every record the person's own token sees
 *   none                         null — nothing is read
 * Ids are checked against the record-id shape before they reach a query; nothing else is interpolated.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { BookScope } from "../data/scope";

export const RECORD_ID = /^\d{15,22}$/;
export const IN_CHUNK = 100;
export const PAGE = 200;
export const DEFAULT_MAX_PAGES = 10;

const q = (ids: readonly string[]) => ids.map((x) => `'${x}'`).join(", ");

/** `field in (…)` over any number of ids, IN_CHUNK at a time, OR-joined. Empty or malformed → null. */
export function inClause(field: string, ids: readonly string[]): string | null {
  const good = [...new Set(ids.filter((x) => RECORD_ID.test(x)))];
  if (!good.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < good.length; i += IN_CHUNK) parts.push(`${field} in (${q(good.slice(i, i + IN_CHUNK))})`);
  return parts.length === 1 ? parts[0]! : `(${parts.join(" or ")})`;
}

export interface OwnerWhereOptions {
  /** Leads: a secondary owner reads the lead too. */
  readonly secondaryOwner?: boolean;
  /** The manager's subtree (their own id included), or null/undefined → their token under the role hierarchy. */
  readonly team?: readonly string[] | null;
}

export function ownerWhere(scope: BookScope, o: OwnerWhereOptions = {}): string | null {
  switch (scope.kind) {
    case "user":
    case "own-lead":
    case "own-book": {
      if (!RECORD_ID.test(scope.userId)) return null;
      const me = `Owner = '${scope.userId}'`;
      return o.secondaryOwner ? `(${me} or Secondary_Owner = '${scope.userId}')` : me;
    }
    case "subtree": {
      if (!RECORD_ID.test(scope.managerId)) return null;
      if (!o.team) return "id is not null";
      const team = [...new Set([scope.managerId, ...o.team])];
      const own = inClause("Owner", team);
      if (!own) return null;
      return o.secondaryOwner ? `(${own} or ${inClause("Secondary_Owner", team)})` : own;
    }
    case "org":
    case "all":
      return "id is not null";
    default:
      return null;
  }
}

export type Paged =
  | { readonly ok: true; readonly rows: readonly ZohoRecord[]; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "source-invalid" };

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";

/** Every page of one SELECT on the person's own token (the client writes the Plane B call line). */
export async function pagedSelect(
  crm: Pick<ZohoClient, "coql">, cred: UserCredential, fields: readonly string[], module: string, where: string,
  order = "id asc", signal?: AbortSignal, maxPages = DEFAULT_MAX_PAGES,
): Promise<Paged> {
  const rows: ZohoRecord[] = [];
  for (let page = 0; page < maxPages; page++) {
    let res: Awaited<ReturnType<typeof crm.coql>>;
    try {
      res = await crm.coql(cred, `select ${fields.join(", ")} from ${module} where (${where}) order by ${order} limit ${page * PAGE}, ${PAGE}`, { signal });
    } catch {
      return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
    }
    if (!res.ok) return { ok: false, kind: "source-error", errorKind: res.error.kind, retryable: retryable(res.error.kind) };
    if (res.value.invalidRecordIds) return { ok: false, kind: "refused", reason: "source-invalid" };
    rows.push(...res.value.records);
    if (!res.value.moreRecords) return { ok: true, rows, truncated: false };
  }
  return { ok: true, rows, truncated: true };
}

/* ---- tiny parsers shared by the three readers ---- */
export const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
export const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" && !Array.isArray(v) ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n ? n.slice(0, 120) : null;
};
export const str = (r: ZohoRecord, k: string, max = 250): string | null => {
  const v = r[k];
  return typeof v === "string" && v !== "" && v !== "-None-" ? v.slice(0, max) : null;
};
export const num = (r: ZohoRecord, k: string): number | null => {
  const v = r[k];
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[%,\s]/g, "")) : NaN;
  return Number.isFinite(x) ? x : null;
};
export const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** A Zoho datetime as naive IST "YYYY-MM-DDTHH:mm" (rule 9: every clock in Asia/Kolkata). */
export const istStamp = (v: string | null): string | null => {
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 16) : day(v);
};
