/**
 * M03-S09-T02 — THE IR INVESTOR GUARD: the one choke point for every Investors-side read by an IR seat (D69, D74).
 *
 * An IR (seat "ir", book scope `own-lead`) may read an investor only when that investor came from the
 * IR's own lead: the Contact carries Origin_Lead (the lead it came from) AND Originating_IR = the IR's
 * Zoho user id (the lead's owner at "said yes"). Anything else is refused — a Contact from another IR's
 * lead, and a Contact with no Origin_Lead (default deny). Allotments, receipts and cases are then read
 * only for the admitted Contact ids (./adapters), so nothing on the Investors side reaches an IR except
 * through `admitContact`. The lead-side top-bar search (server/leads/search) never names Contacts (D69).
 *
 * Two layers, both kept (jev "b", 1.00 — D74): Zoho's record share at hand-off
 * (../investors/handoff-share) lets the IR's own token read those records under Private sharing, and
 * this guard re-checks every row, so a stale or wrong share becomes a refusal, never another IR's investor.
 *
 * Refusals are logged by id only: Plane B through InvestorEvents.refusal; Plane C through the optional
 * `planeCRefusal` hook — PROVISIONAL (jev "b", 0.71): Plane C has no read-refusal action yet, so the
 * identity owner wires the hook once it does. Rows are never cached; an IR's investor aggregates are keyed
 * by `investorsKey`, which carries the IR's user id, and `mayServeKey` refuses any other scope's key.
 *
 * M09-S08-T02 adds: an IR reads the `irContacts` projection (no money, no identity) and allotments without price
 * or amount, never a Receipt (./live, ../investors/record); a one-investor read carries the IR's own filter in its
 * WHERE, so another IR's investor is not returned by Zoho at all. Who "owns" an investor is Originating_IR —
 * the lead's owner at Said yes, stamped by Zoho (M09-S08-T01) — never the lead's current owner, so a lead
 * reassigned before Said yes belongs to whoever held it then, and one reassigned after stays with that IR.
 */

import type { AggregateValue, CacheKey } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { parseContact, type ContactRow } from "./contact-row";
import type { InvestorEvents } from "./events";
import { MODULES, PROJECTIONS, type ModuleKey } from "./projections";
import { scopedKey, scopesFor, type BookScope } from "./scope";

const RECORD_ID = /^\d{15,22}$/;

export type IrRefusal = "no-origin" | "not-own-lead" | "not-visible" | "seat-denied" | "invalid-request";
export type Admission = { readonly ok: true } | { readonly ok: false; readonly reason: IrRefusal };
export type GuardRefusal = { readonly ok: false; readonly kind: "refused"; readonly reason: IrRefusal };

/** The Contacts WHERE clause for a scope, or null when the scope has no Contacts at all. */
export function contactsWhere(scope: BookScope): string | null {
  switch (scope.kind) {
    case "own-lead":
      return RECORD_ID.test(scope.userId) ? `Originating_IR = '${scope.userId}' and Origin_Lead is not null` : null;
    case "own-book":
      return RECORD_ID.test(scope.userId) ? `KAM = '${scope.userId}'` : null;
    case "subtree":
    case "org":
    case "all":
      return "id is not null";
    default:
      return null;
  }
}

/**
 * M09-S08-T02: the Contacts projection a scope reads. An IR's own-lead read takes `irContacts` — no money, no
 * identity, no street address or nominee (D69); every other scope the Investors-side `contacts` projection.
 */
export function contactsKeyFor(scope: BookScope): Extract<ModuleKey, "contacts" | "irContacts"> {
  return scope.kind === "own-lead" ? "irContacts" : "contacts";
}

/**
 * M09-S08-T02: the WHERE of a one-investor read. A person-bound scope (IR, KAM) asks Zoho for the id AND the
 * scope's own filter, so a Contact from another IR's lead is not even returned — nothing of it is read (AC2);
 * the row that does come back is still admitted by `admitContact`. Null when the id or the scope is unusable.
 */
export function oneContactWhere(scope: BookScope, contactId: string): string | null {
  const w = contactsWhere(scope);
  if (!w || !RECORD_ID.test(contactId)) return null;
  return scope.kind === "own-lead" || scope.kind === "own-book" ? `(id = '${contactId}') and (${w})` : `(id = '${contactId}')`;
}

/** May this scope see this Contact? For an IR: Origin_Lead present and Originating_IR = me; else deny. */
export function admitContact(scope: BookScope, c: Pick<ContactRow, "originLeadId" | "originatingIrId" | "kamId">): Admission {
  switch (scope.kind) {
    case "own-lead":
      if (!c.originLeadId || !c.originatingIrId) return { ok: false, reason: "no-origin" };
      return c.originatingIrId === scope.userId ? { ok: true } : { ok: false, reason: "not-own-lead" };
    case "own-book":
      return c.kamId === scope.userId ? { ok: true } : { ok: false, reason: "not-own-lead" };
    case "subtree":
    case "org":
    case "all":
      return { ok: true };
    default:
      return { ok: false, reason: "seat-denied" };
  }
}

/** The cache key of an Investors-side aggregate. An IR's carries that IR's user id, or it is not minted. */
export function investorsKey<V extends AggregateValue = AggregateValue>(scope: BookScope, name: string): CacheKey<V> {
  const k = scopedKey<V>(scope, `investors.${name}`);
  if (scope.kind === "own-lead" && (k.scope.kind !== "user" || k.scope.userId !== scope.userId)) {
    throw new TypeError("An IR's investor aggregate is keyed by that IR (D53).");
  }
  return k;
}

/** May a number cached for `keyScope` be served to a person whose scope is `mine`? Only the very same scope. */
export function mayServeKey(mine: BookScope, keyScope: BookScope): boolean {
  if (mine.kind === "none" || mine.kind !== keyScope.kind) return false;
  switch (mine.kind) {
    case "user":
    case "own-lead":
    case "own-book":
      return (keyScope as { readonly userId: string }).userId === mine.userId;
    case "subtree":
      return (keyScope as { readonly managerId: string }).managerId === mine.managerId;
    default:
      return true;
  }
}

export interface PlaneCRefusal {
  readonly who: string;
  readonly seat: string | null;
  readonly action: string;
  readonly reason: IrRefusal;
  readonly recordIds: readonly string[];
}

export interface GuardDeps {
  readonly events: InvestorEvents;
  /** Plane C's half of a refusal (PROVISIONAL): wired by identity/** once Plane C has a read-refusal action. */
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
}

export type OneResult =
  | { readonly ok: true; readonly contact: ContactRow }
  | GuardRefusal
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export function createInvestorGuard(deps: GuardDeps) {
  const refuse = (userId: string, seat: string | null, action: string, reason: IrRefusal, recordIds: readonly string[]): GuardRefusal => {
    const ids = recordIds.filter((x) => RECORD_ID.test(x));
    deps.events.refusal(userId, action, reason, ids);
    try { deps.planeCRefusal?.({ who: userId, seat, action, reason, recordIds: ids }); } catch { /* a log sink never breaks the refusal */ }
    return Object.freeze({ ok: false as const, kind: "refused" as const, reason });
  };

  return Object.freeze({
    refuse,

    /**
     * The Contact rows a list read may keep. Every row must be admitted; one that is not means Zoho's
     * sharing let through what the scope forbids, and the whole read is refused (logged) — never trimmed silently.
     */
    filterContacts<T extends Pick<ContactRow, "id" | "originLeadId" | "originatingIrId" | "kamId">>(
      userId: string, seat: string | null, scope: BookScope, rows: readonly T[], action = "investors-book",
    ): { readonly ok: true; readonly rows: readonly T[] } | GuardRefusal {
      const bad: { id: string; reason: IrRefusal }[] = [];
      for (const r of rows) { const a = admitContact(scope, r); if (!a.ok) bad.push({ id: r.id, reason: a.reason }); }
      if (!bad.length) return { ok: true, rows };
      return refuse(userId, seat, action, bad.some((b) => b.reason === "not-own-lead") ? "not-own-lead" : bad[0]!.reason, bad.map((b) => b.id));
    },

    /**
     * One investor opened by URL or API, on the person's own token. The id is asked for alone, so a row
     * that sharing lets through is seen and refused with its real reason. A record the person may not see
     * is refused, never "not found", so the answer does not reveal whether it exists.
     */
    async one(crm: Pick<ZohoClient, "coql">, cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal, action = "investor-open"): Promise<OneResult> {
      const me = cred.userId;
      if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return refuse(me, seat, action, "invalid-request", []);
      const scope = scopesFor(seat, me).investors;
      const where = oneContactWhere(scope, contactId);
      if (!where) return refuse(me, seat, action, "seat-denied", [contactId]);
      const key = contactsKeyFor(scope);
      let r: Awaited<ReturnType<typeof crm.coql>>;
      try {
        r = await crm.coql(cred, `select ${PROJECTIONS[key].join(", ")} from ${MODULES[key]} where ${where} limit 0, 1`, { signal });
      } catch {
        return { ok: false, kind: "source-error", errorKind: "unexpected" };
      }
      if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind };
      const raw = r.value.records.find((x) => x.id === contactId);
      const c = raw ? parseContact(raw) : null;
      if (!c) return refuse(me, seat, action, "not-visible", [contactId]);
      const a = admitContact(scope, c);
      return a.ok ? { ok: true, contact: c } : refuse(me, seat, action, a.reason, [contactId]);
    },
  });
}
export type InvestorGuard = ReturnType<typeof createInvestorGuard>;
