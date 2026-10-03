/**
 * M13-S05 — which of these Cases may this person read? One COQL on their own token (D53), then the register's own
 * reach: a KAM (own-book) only a Case they own, a Head of AM their subtree (their token under the role hierarchy when
 * no subtree reader is wired). Shared by the ticket thread and the delivery reads, so the two cannot drift.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { scopesFor } from "../data/scope";
import { idOf, inClause, RECORD_ID } from "./predicate";
import { CASES_MODULE } from "./register";

export type Reach =
  | { readonly ok: true; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "invalid-request" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface ReachDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
}

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
export const MAX_CASE_IDS = 100;

/** The subset of `ids` the person may read. A malformed id is `invalid-request`; an empty list reads nothing. */
export async function readableCases(
  deps: ReachDeps, p: { readonly credential: UserCredential; readonly seat: string }, ids: readonly unknown[], signal?: AbortSignal,
): Promise<Reach> {
  const me = p.credential.userId;
  if (!ids.length || ids.length > MAX_CASE_IDS || !ids.every((x): x is string => typeof x === "string" && RECORD_ID.test(x))) return { ok: false, kind: "refused", reason: "invalid-request" };
  const scope = scopesFor(p.seat, me).cases;
  if (scope.kind === "none") return { ok: false, kind: "refused", reason: "no-book" };
  const where = inClause("id", ids as string[]);
  if (!where) return { ok: false, kind: "refused", reason: "invalid-request" };
  let r;
  try { r = await deps.crm.coql(p.credential, `select id, Owner from ${CASES_MODULE} where ${where} limit 0, ${MAX_CASE_IDS}`, { signal }); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: false }; }
  if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
  let team: readonly string[] | null = null;
  if (scope.kind === "subtree" && deps.subtreeOf) team = await deps.subtreeOf(scope.managerId, signal);
  const out = new Set<string>();
  for (const rec of r.value.records) {
    const id = idOf(rec.id), owner = idOf(rec.Owner);
    if (!id || !(ids as string[]).includes(id)) continue;
    if (scope.kind === "own-book" && owner !== me) continue;
    if (scope.kind === "subtree" && team && !(owner && [scope.managerId, ...team].includes(owner))) continue;
    out.add(id);
  }
  return { ok: true, ids: out };
}
