/**
 * M13-S02-T02 — THE TICKETS REGISTER: Cases read by the seat's scope (D12, D45, D53).
 *
 * WHERE = ./predicate ownerWhere(cases scope) — the one owner predicate the team views share:
 *   KAM (own-book) Owner = me · Head of AM (subtree) Owner in (subtree) or their token under the role
 *   hierarchy · Finance / Head / Compliance / Auditor (org) and the super user (all) every Case the token sees.
 * Each row is checked against the scope again (a Case owned by someone else in an own-book read is a
 * scope drift: the whole read is refused and one Plane B line written — never somebody else's ticket).
 *
 * The counts (open, high-priority open, waiting, closed, all) come from ONE group-by on the same
 * predicate, cached under the person's cases scope (server/data/scope) — so the rail badge and the page's
 * tiles read the same number. "Mine" is one person's, so it is counted from the rows and never cached. Rows are read live and never cached (D45/D52).
 *
 * Field names are the org as found (read-only getFields, 28 Sep 2026): the investor is `Related_To`
 * (lookup → Contacts; the org has no Cases.Contact_Name), the category is `Ticket_Category`, Status is
 * New / Escalated / On Hold / Closed, Priority High / Medium / Low, Case_Origin Email / Phone / Web.
 * Writes (open, waiting, close, reply) are ./writes.ts (M13-S03-T02); `readOnly` marks the viewer seats.
 */

import type { CacheError, CacheFresh, CacheStale, ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ImTicket } from "../../lib/im/types";
import type { InvestorEvents } from "../data/events";
import { checkProjection } from "../data/projections";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";
import { idOf, inClause, istStamp, ownerWhere, pagedSelect, str } from "./predicate";

export const CASES_MODULE = "Cases";
export const CASE_FIELDS = checkProjection(CASES_MODULE, [
  "id", "Case_Number", "Subject", "Description", "Related_To", "Owner", "Priority", "Status", "Case_Origin",
  "Created_Time", "Ticket_Category", "SLA_Due", "Closed_At",
  // M13-S04: the watcher (user lookup) and when it was handed on. Zoho config: created by Sahil (HUMAN).
  "Handed_By", "Handed_At",
]);
/** Seats that read the register and may never act on it (the Auditor). */
export const READ_ONLY_SEATS: ReadonlySet<string> = new Set(["audit"]);

/** Scope-wide counts (cached under the scope). "Mine" is per person, so it is counted from the rows instead. */
export type CaseCuts = Readonly<Record<"open" | "high" | "waiting" | "closed" | "all", number>>;
export type CutsRead = CacheFresh<CaseCuts> | CacheStale<CaseCuts> | CacheError<CaseCuts>;
export interface CasesPrincipal { readonly credential: UserCredential; readonly seat: string }
export interface CaseRow extends ImTicket {
  readonly number: string | null;
  /** M13-S04: handed on by the person reading, and no longer theirs — they see where it got to and cannot work it. */
  readonly watched?: boolean;
}

export interface CasesDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  /** A Head of AM's subtree; absent/null → their own token under the role hierarchy (PROVISIONAL, as live.ts). */
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
  readonly maxPages?: number;
}

const stateOf = (status: string | null): ImTicket["state"] =>
  status === "Closed" ? "closed" : status === "On Hold" ? "waiting" : "open";

/** M13-S04: a Case's handover as the row carries it — Handed_By set and no longer the owner. */
export function handedOf(x: ZohoRecord): { readonly by: string; readonly at: string } | null {
  const by = idOf(x.Handed_By);
  if (!by || by === idOf(x.Owner)) return null;
  return Object.freeze({ by, at: istStamp(str(x, "Handed_At", 40)) ?? "" });
}

/**
 * M13-S04: the register's predicate — the owner predicate, and for Account Management the tickets they
 * handed on too (they keep watching: Handed_By = me, or anyone in the Head of AM's subtree).
 */
export function casesWhere(scope: BookScope, team: readonly string[] | null): string | null {
  const own = ownerWhere(scope, { team });
  if (!own) return null;
  if (scope.kind === "own-book") return `(${own} or Handed_By = '${scope.userId}')`;
  if (scope.kind === "subtree" && team) {
    const handed = inClause("Handed_By", [scope.managerId, ...team]);
    return handed ? `(${own} or ${handed})` : own;
  }
  return own;
}

export function caseOf(x: ZohoRecord): CaseRow | null {
  if (!idOf(x.id)) return null;
  const closed = istStamp(str(x, "Closed_At", 40));
  const handed = handedOf(x);
  return Object.freeze({
    id: x.id, number: str(x, "Case_Number", 30), inv: idOf(x.Related_To) ?? "", t: str(x, "Subject", 255) ?? "",
    cat: str(x, "Ticket_Category", 40) ?? "", opened: istStamp(str(x, "Created_Time", 40)) ?? "",
    // Case_Origin is Email / Phone / Web in the org: no "investor" value exists yet (GAP) — Web is read as the investor's app.
    by: str(x, "Case_Origin", 20) === "Web" ? "investor" : "staff",
    own: idOf(x.Owner) ?? "", pri: str(x, "Priority", 20) === "High" ? "high" : "normal",
    state: stateOf(str(x, "Status", 20)), d: str(x, "Description", 2000) ?? "", sla: istStamp(str(x, "SLA_Due", 40)) ?? "",
    ...(closed ? { closed } : {}),
    ...(handed ? { handed } : {}),
  });
}

/** Group-by rows (Status, Priority, COUNT) → the cuts. Pure: exported for tests. */
export function cutsOf(rows: readonly Readonly<Record<string, string | number | null>>[]): CaseCuts {
  const c = { open: 0, high: 0, waiting: 0, closed: 0, all: 0 };
  for (const r of rows) {
    const n = typeof r["COUNT(id)"] === "number" ? (r["COUNT(id)"] as number) : 0;
    if (n <= 0) continue;
    const state = stateOf(typeof r.Status === "string" ? r.Status : null);
    c.all += n;
    if (state === "closed") { c.closed += n; continue; }
    c.open += n;
    if (state === "waiting") c.waiting += n;
    if (r.Priority === "High") c.high += n;
  }
  return c;
}

export function createCasesRegister(deps: CasesDeps) {
  return Object.freeze({
    async list(p: CasesPrincipal, signal?: AbortSignal): Promise<
      | { readonly ok: true; readonly rows: readonly CaseRow[]; readonly truncated: boolean; readonly cuts: CutsRead; readonly mine: number; readonly readOnly: boolean; readonly offersMine: boolean }
      | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "scope-drift" | "source-invalid" }
      | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean }
    > {
      const me = p.credential.userId;
      const scope: BookScope = scopesFor(p.seat, me).cases;
      const team = scope.kind === "subtree" && deps.subtreeOf ? await deps.subtreeOf(scope.managerId, signal) : null;
      const where = casesWhere(scope, team);
      if (!where) {
        deps.events.refusal(me, "cases-list", "seat-denied");
        return { ok: false, kind: "refused", reason: "no-book" };
      }
      const r = await pagedSelect(deps.crm, p.credential, CASE_FIELDS, CASES_MODULE, where, "Created_Time desc", signal, deps.maxPages);
      if (!r.ok) return r;
      const rows = r.rows.map(caseOf).filter((x): x is CaseRow => x !== null)
        .map((x) => (x.handed?.by === me && x.own !== me ? Object.freeze({ ...x, watched: true }) : x));
      const allowed = scope.kind === "own-book" ? new Set([me]) : scope.kind === "subtree" && team ? new Set([scope.managerId, ...team]) : null;
      const foreign = allowed ? rows.filter((x) => !allowed.has(x.own) && !(x.handed && allowed.has(x.handed.by))) : [];
      if (foreign.length) {
        deps.events.refusal(me, "cases-list", "scope-drift", foreign.map((x) => x.id));
        return { ok: false, kind: "refused", reason: "scope-drift" };
      }
      const cuts = await deps.cache.readSettled<CaseCuts>(scopedKey<CaseCuts>(scope, "cases.cuts"), async () => {
        const a = await deps.crm.aggregate(p.credential,
          `select Status, Priority, COUNT(id) from ${CASES_MODULE} where (${where}) group by Status, Priority limit 0, 2000`, { signal });
        if (!a.ok) throw Object.assign(new Error("zoho"), { kind: a.error.kind });
        return cutsOf(a.value);
      });
      return {
        ok: true, rows: Object.freeze(rows), truncated: r.truncated, cuts,
        mine: rows.filter((x) => x.own === me && x.state !== "closed").length,
        readOnly: READ_ONLY_SEATS.has(p.seat),
        // A KAM's register is all theirs: "Mine" would repeat "Open".
        offersMine: scope.kind !== "own-book",
      };
    },
  });
}
export type CasesRegister = ReturnType<typeof createCasesRegister>;
