/**
 * M16-S03 — the lead-side Numbers sections, worked out live from Zoho one scope at a time.
 *
 * Each section is COQL COUNT/SUM … GROUP BY on Leads in the person's scope (their own book, their
 * team, or every book for an org-wide seat), so what is fetched is already counts. The result sits in
 * the scope-keyed cache (D53: two seats with different visibility never share figures). D138 (B-10 ruling,
 * 10 Oct 2026): no rupee value is worked out here. A lead carries no price in Zoho, and the old figure was
 * units × the prototype's unit price (plan.ts UNIT) — a guess. The forecast is in units; there is no money field.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { CacheError, CacheFresh, CacheStale, ScopedCache, Scope } from "../../lib/zoho/cache";
import { cacheKey } from "../../lib/zoho/cache";
import type { OpsLog } from "../../lib/zoho/log";
import { coqlAll, coqlWhere } from "../../lib/zoho/coql";
import type { SeatedZohoUser } from "../oauth/seat";

export const SECTIONS = ["funnel", "checks", "owners", "sources", "lost", "forecast"] as const;
export type Section = (typeof SECTIONS)[number];
const RUNG_FIELDS = ["First_Touch_At", "Qualified_At", "Engaged_At", "Said_Yes_At", "Reserved_At", "Fully_Paid_At", "Allocated_At", "Onboarded_At"];
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export interface SectionsAccess {
  readonly actor: SeatedZohoUser;
  readonly seesNumbers: boolean;
  /** Owners in scope; null with orgWide for every book. An IR's is themselves. */
  readonly ownerIds: readonly string[] | null;
  readonly orgWide: boolean;
  readonly unassignedQueueUserId: string | null;
  readonly scope: Scope;
}
export interface SectionsAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<SectionsAccess | null>;
}
export type SectionResult =
  | { readonly ok: true; readonly value: { readonly section: Section; readonly counts: Readonly<Record<string, number>>; readonly asOf: number; readonly stale: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" }
  | { readonly ok: false; readonly kind: "source-error"; readonly reason: string; readonly retryable: boolean };

export interface SectionsDependencies {
  readonly crm: Pick<ZohoClient, "aggregate">;
  readonly access: SectionsAccessAuthority;
  readonly cache: Pick<ScopedCache, "readSettled">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export function createNumbersSections(deps: SectionsDependencies) {
  if (!deps || typeof deps.crm?.aggregate !== "function" || typeof deps.access?.recheck !== "function" || typeof deps.cache?.readSettled !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Numbers sections need crm.aggregate, the access authority, the scoped cache, the ops log and the record-id prefix.");
  }
  const { crm, access, cache, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);

  const count = async (cred: UserCredential, where: string, groupBy?: string, sum?: string): Promise<{ key: string | null; n: number; s: number }[]> => {
    const cols = [groupBy, "COUNT(id)", sum ? `SUM(${sum})` : null].filter(Boolean).join(", ");
    const q = `select ${cols} from Leads where ${coqlWhere(where)}${groupBy ? ` group by ${groupBy}` : ""}`;
    const r = await crm.aggregate(cred, q);
    if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
    return r.value.map((row) => ({
      key: groupBy ? (typeof row[groupBy] === "string" ? row[groupBy] as string : null) : null,
      n: typeof row["COUNT(id)"] === "number" ? row["COUNT(id)"] as number : 0,
      s: sum && typeof row[`SUM(${sum})`] === "number" ? row[`SUM(${sum})`] as number : 0,
    }));
  };

  const load = async (cred: UserCredential, a: SectionsAccess, section: Section): Promise<Record<string, number>> => {
    const scope = a.orgWide ? "id is not null" : `Owner in (${(a.ownerIds ?? []).map((id) => `'${id}'`).join(", ")})`;
    const out: Record<string, number> = {};
    const now = zohoTime(clock());
    if (section === "funnel") {
      out["rung:1"] = (await count(cred, scope))[0]?.n ?? 0;
      for (const [i, f] of RUNG_FIELDS.entries()) out[`rung:${i + 2}`] = (await count(cred, coqlAll([scope, `${f} is not null`])))[0]?.n ?? 0;
    } else if (section === "checks") {
      const open = [scope, "Lost_At is null", "Onboarded_At is null"];
      out.overdue = (await count(cred, coqlAll([...open, `Next_Step_At < '${now}'`])))[0]?.n ?? 0;
      out.noNextStep = (await count(cred, coqlAll([...open, "Next_Step_At is null"])))[0]?.n ?? 0;
      out.lostHeld = (await count(cred, coqlAll([scope, "Lost_At is not null"])))[0]?.n ?? 0;
      out.unassigned = a.unassignedQueueUserId && (a.orgWide || (a.ownerIds ?? []).includes(a.unassignedQueueUserId))
        ? (await count(cred, `Owner = '${a.unassignedQueueUserId}'`))[0]?.n ?? 0 : 0;
    } else if (section === "owners") {
      for (const g of await count(cred, coqlAll([scope, "Lost_At is null"]), "Owner")) if (g.key && validId(g.key)) out[g.key] = g.n;
    } else if (section === "sources") {
      for (const g of await count(cred, scope, "Lead_Source")) out[g.key ?? "none"] = g.n;
    } else if (section === "lost") {
      for (const g of await count(cred, coqlAll([scope, "Lost_At is not null"]), "Lost_Reason")) out[g.key ?? "none"] = g.n;
    } else {
      for (const g of await count(cred, coqlAll([scope, "Lost_At is null", "Forecast is not null"]), "Forecast", "Units_Interested")) {
        out[`leads:${g.key ?? "none"}`] = g.n;
        out[`units:${g.key ?? "none"}`] = g.s;
      }
    }
    return out;
  };

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, section: Section, signal?: AbortSignal): Promise<SectionResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || !SECTIONS.includes(section)) return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      let a: SectionsAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch { return { ok: false, kind: "source-error", reason: "access", retryable: true }; }
      if (!a || a.actor?.userId !== cred.userId) return { ok: false, kind: "refused", reasonCode: "session-changed" };
      if (!a.seesNumbers || (!a.orgWide && !(a.ownerIds ?? []).length) || (a.ownerIds ?? []).some((id) => !validId(id)) || (a.ownerIds ?? []).length > 100) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: cred.userId }, action: "numbers-section", reason: "capability-missing", recordIds: [] });
        return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      }
      const seat = a.actor.seat === "investor-relations" ? { ...a, ownerIds: [cred.userId], orgWide: false, scope: { kind: "user", userId: cred.userId } as Scope } : a;
      const key = cacheKey<Readonly<Record<string, number>>>(seat.scope, `numbers.${section}`);
      const got = await cache.readSettled(key, () => load(cred, seat, section)) as CacheFresh<Record<string, number>> | CacheStale<Record<string, number>> | CacheError<Record<string, number>>;
      if (got.state === "error") return { ok: false, kind: "source-error", reason: got.reason, retryable: true };
      /* D138: never units × the prototype's unit price — a lead has no price in Zoho, so there is no rupee figure to give */
      return { ok: true, value: { section, counts: got.value, asOf: got.asOf, stale: got.state !== "fresh" } };
    },
  });
}
