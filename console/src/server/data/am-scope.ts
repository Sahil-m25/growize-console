/**
 * M09-S02-T02 — SCOPE KEYS FOR ACCOUNT-MANAGEMENT READS (D12, D40, D52, D53; CARRY-FORWARD A-19).
 *
 * The two account-management seats read the Investors side as one of two scopes, a discriminated union
 * so a key cannot be minted for the wrong one:
 *
 *   kam      — a Key Account Manager: the accounts named to them (Contacts.KAM = their Zoho user id),
 *              cached BY USER  → "user:<id>|own-book.am.<name>"
 *   head-am  — the Head of Account Management: every allotted account and the pool, cached BY SUBTREE
 *              → "subtree:<id>|subtree.am.<name>"
 *
 * Both are derived from ./scope (the one seat → scope table), never from a request. The AM projection
 * (./projections PROJECTIONS.amAllotments, checkAmProjection) carries no Receipt, money or identity
 * field, and an AM read never touches the Receipts module (./live).
 */

import type { AggregateValue, CacheKey } from "../../lib/zoho/cache";
import { scopedKey, scopesFor, type BookScope } from "./scope";

export type AmScope =
  | { readonly kind: "kam"; readonly userId: string }
  | { readonly kind: "head-am"; readonly managerId: string };

/** The AM scope of a signed-in seat, or null when the seat is not an account-management seat. */
export function amScopeOf(seat: string, userId: string): AmScope | null {
  const s = scopesFor(seat, userId).investors;
  if (seat === "kam" && s.kind === "own-book") return Object.freeze({ kind: "kam", userId: s.userId });
  if (seat === "amlead" && s.kind === "subtree") return Object.freeze({ kind: "head-am", managerId: s.managerId });
  return null;
}

export const isAmSeat = (seat: string): boolean => seat === "kam" || seat === "amlead";

/** The book scope an AM scope reads under (./scope vocabulary). */
export function amBookScope(s: AmScope): BookScope {
  return s.kind === "kam" ? Object.freeze({ kind: "own-book", userId: s.userId }) : Object.freeze({ kind: "subtree", managerId: s.managerId });
}

/** The only way an AM aggregate is keyed: a KAM's by user, the Head of AM's by subtree — never by role. */
export function amKey<V extends AggregateValue = AggregateValue>(s: AmScope, name: string): CacheKey<V> {
  const k = scopedKey<V>(amBookScope(s), `am.${name}`);
  const ok = s.kind === "kam"
    ? k.scope.kind === "user" && k.scope.userId === s.userId
    : k.scope.kind === "subtree" && k.scope.managerId === s.managerId;
  if (!ok) throw new TypeError("An account-management aggregate is keyed by its own user or subtree (A-19, D53).");
  return k;
}
