/**
 * M01-S03-T03 — SCOPE KEYS FOR EVERY BOOK (D53, D69).
 *
 * A book is one list the console shows (the Leads list, the Investors list, the money on those
 * investors, their tickets, the corporate holdings, the farm shelf). Each signed-in seat gets exactly
 * one visibility scope per book, decided here from the session's seat token and Zoho user id alone:
 *
 *   user      — an IR's (or channel partner's) own leads
 *   subtree   — an IR Manager's team leads; the Head of AM's allotted-and-pool investors
 *   own-lead  — the investors whose lead an IR owned at "said yes" (Contacts.Originating_IR, D69)
 *   own-book  — a KAM's own book (Contacts.KAM = their Zoho user id)
 *   org       — Finance, Head of Finance, Compliance and the viewers
 *   all       — Digital Infrastructure (Sahil): everything, PII still masked (projections never carry it)
 *   none      — this seat has no such book
 *
 * Every cache key is minted through `scopedKey`, which wraps `cacheKey` (lib/zoho/cache, D53) and puts
 * the book-scope kind in the name as well as the scope in the key, so an IR's own-lead investor count
 * (`user:<id>|own-lead.investors.count`) and a KAM's own-book count never share a key even though
 * both are one person's, and no scope can be served another's number.
 */

import { cacheKey, type AggregateValue, type CacheKey, type Scope } from "../../lib/zoho/cache";

export type BookScope =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "subtree"; readonly managerId: string }
  | { readonly kind: "own-lead"; readonly userId: string }
  | { readonly kind: "own-book"; readonly userId: string }
  | { readonly kind: "org" }
  | { readonly kind: "all" }
  | { readonly kind: "none" };
export type BookScopeKind = BookScope["kind"];

export type BookName = "leads" | "investors" | "money" | "cases" | "holdings" | "farms";
export const BOOKS: readonly BookName[] = Object.freeze(["leads", "investors", "money", "cases", "holdings", "farms"]);
export type SeatScopes = Readonly<Record<BookName, BookScope>>;

const USER_ID = /^\d{15,22}$/;
const NONE: BookScope = Object.freeze({ kind: "none" });
const ORG: BookScope = Object.freeze({ kind: "org" });
const ALL: BookScope = Object.freeze({ kind: "all" });

type Rule = "user" | "subtree" | "own-lead" | "own-book" | "org" | "all" | "none";
/** Seat token (ConsoleSession.seat, the vocabulary of CONSOLE_SEAT) → one rule per book. */
const TABLE: Readonly<Record<string, Readonly<Record<BookName, Rule>>>> = Object.freeze({
  //            leads       investors   money       cases       holdings  farms
  ir:     { leads: "user",    investors: "own-lead", money: "own-lead", cases: "none",     holdings: "none", farms: "org" },
  cp:     { leads: "user",    investors: "none",     money: "none",     cases: "none",     holdings: "none", farms: "org" },
  conv:   { leads: "subtree", investors: "none",     money: "none",     cases: "none",     holdings: "none", farms: "org" },
  kam:    { leads: "none",    investors: "own-book", money: "own-book", cases: "own-book", holdings: "none", farms: "org" },
  amlead: { leads: "none",    investors: "subtree",  money: "subtree",  cases: "subtree",  holdings: "none", farms: "org" },
  head:   { leads: "none",    investors: "org",      money: "org",      cases: "org",      holdings: "org",  farms: "org" },
  fin:    { leads: "none",    investors: "org",      money: "org",      cases: "org",      holdings: "org",  farms: "org" },
  comp:   { leads: "none",    investors: "org",      money: "org",      cases: "org",      holdings: "org",  farms: "org" },
  audit:  { leads: "none",    investors: "org",      money: "org",      cases: "org",      holdings: "org",  farms: "org" },
  exec:   { leads: "none",    investors: "org",      money: "org",      cases: "none",     holdings: "org",  farms: "org" },
  bu:     { leads: "none",    investors: "org",      money: "org",      cases: "none",     holdings: "org",  farms: "org" },
  // Digital Infrastructure — "ops" on the lead side, "di" on the Investors side (stub-user.ts). PROVISIONAL:
  // CONSOLE_SEAT does not yet let an Administrator-profile seat sign in; when it does, this is its scope.
  ops:    { leads: "all", investors: "all", money: "all", cases: "all", holdings: "all", farms: "all" },
  di:     { leads: "all", investors: "all", money: "all", cases: "all", holdings: "all", farms: "all" },
});

/** The scope of each book for one signed-in person. An unknown seat or a malformed id gets none anywhere. */
export function scopesFor(seat: string, userId: string): SeatScopes {
  const row = Object.hasOwn(TABLE, seat) ? TABLE[seat]! : null;
  const ok = typeof userId === "string" && USER_ID.test(userId);
  const one = (rule: Rule): BookScope => {
    if (!ok) return NONE;
    switch (rule) {
      case "user": return Object.freeze({ kind: "user", userId });
      case "subtree": return Object.freeze({ kind: "subtree", managerId: userId });
      case "own-lead": return Object.freeze({ kind: "own-lead", userId });
      case "own-book": return Object.freeze({ kind: "own-book", userId });
      case "org": return ORG;
      case "all": return ALL;
      default: return NONE;
    }
  };
  return Object.freeze(Object.fromEntries(BOOKS.map((b) => [b, one(row ? row[b] : "none")])) as Record<BookName, BookScope>);
}

/** The cache's own scope for a book scope. Person-bound kinds key by the person; org and all by a role. */
export function cacheScopeOf(s: BookScope): Scope {
  switch (s.kind) {
    case "user":
    case "own-lead":
    case "own-book":
      return { kind: "user", userId: s.userId };
    case "subtree":
      return { kind: "subtree", managerId: s.managerId };
    case "org":
      return { kind: "role", role: "org" };
    case "all":
      return { kind: "role", role: "all" };
    default:
      throw new TypeError("A book this seat does not have has no cache key (D53).");
  }
}

/** The only way the data layer mints a cache key: scope in the key, scope kind in the name. */
export function scopedKey<V extends AggregateValue = AggregateValue>(s: BookScope, name: string): CacheKey<V> {
  return cacheKey<V>(cacheScopeOf(s), `${s.kind}.${name}`);
}

/** The key as a string, for logs and tests ("user:123|own-lead.investors.count"). */
export function scopedKeyString(s: BookScope, name: string): string {
  const k = scopedKey(s, name);
  const id = k.scope.kind === "user" ? k.scope.userId : k.scope.kind === "subtree" ? k.scope.managerId : k.scope.role;
  return `${k.scope.kind}:${id}|${k.name}`;
}
