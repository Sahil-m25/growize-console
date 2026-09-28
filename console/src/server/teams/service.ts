/**
 * M17-S01-T01 — the Teams reads, on the signed-in person's own token (D53).
 *
 *   list(cred, session)        GET /users?type=AllUsers (every page, ≤10 × 200), /settings/roles,
 *                              /settings/profiles, the grant store; then teamsAccess → counts → teamsView.
 *   member(cred, session, id)  one member in full, only when the list would let the viewer open them.
 *
 * Lead counts (Leads by Owner) and account counts (Contacts by KAM) are COQL aggregates on the same
 * token, ≤100 ids per IN, and the only thing cached: `{key: user id, count}` buckets in the scoped
 * cache, keyed by the viewer's book scope (data/scope.ts scopedKey — subtree for the IR Manager, org
 * for Finance, all for Digital Infrastructure). Names, emails and the member list are never cached.
 * A failed count read says so (`counts: "unavailable"`) rather than showing zeroes.
 *
 * Unreadable roles/profiles (a profile without settings access) do not fail the page: the grid falls
 * back to the pinned policy and says `source: "pinned"`. Unreadable Users does: 503, nothing shown.
 * Plane B gets the client's call lines (ids and status only) and one refusal line on a refused open.
 */

import type { CapGrid } from "../../domain";
import type { CountBucket, ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { readGrants, ZOHO_SEAT_SIDES, type GrantReader } from "../access/policy";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";
import type { ZohoSeatDirectory } from "../oauth/seat";
import type { ConsoleSession } from "../oauth/user-session";
import {
  countTargets, memberDetail, rightsGrid, seatOrg, teamsAccess, teamsView,
  type MemberDetail, type Org, type PinnedSeatIds, type RightsGrid, type TeamsAccess, type TeamsView,
} from "./teams";

export const USERS_PER_PAGE = 200;
export const MAX_USER_PAGES = 10;
export const IN_MAX = 100;
const USER_ID = /^\d{15,25}$/;

export type TeamsCode = "not-seated" | "seat-moved" | "no-teams" | "cannot-open" | "zoho-unavailable";

export type CountsState = "live" | "cached" | "unavailable" | "none";

export type TeamsResult =
  | { readonly ok: true; readonly view: TeamsView; readonly grid: RightsGrid; readonly counts: CountsState }
  | { readonly ok: false; readonly status: 403 | 503; readonly code: TeamsCode; readonly message: string };

export type MemberResult =
  | { readonly ok: true; readonly detail: MemberDetail }
  | { readonly ok: false; readonly status: 403 | 404 | 503; readonly code: TeamsCode; readonly message: string };

export interface TeamsDeps {
  readonly crm: Pick<ZohoClient, "listUsers" | "settingsRoles" | "settingsProfiles" | "aggregate">;
  readonly seats: ZohoSeatDirectory;
  readonly pinned: PinnedSeatIds;
  readonly grants: GrantReader;
  readonly cache: ScopedCache;
  readonly log: Pick<OpsLog, "refusal">;
  readonly clock?: () => number;
}

export interface TeamsService {
  list(as: UserCredential, session: ConsoleSession, signal?: AbortSignal): Promise<TeamsResult>;
  member(as: UserCredential, session: ConsoleSession, id: string, signal?: AbortSignal): Promise<MemberResult>;
}

const UNAVAILABLE = "Zoho did not answer. Try again.";

const chunks = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export function createTeamsService(d: TeamsDeps): TeamsService {
  const clock = d.clock ?? Date.now;

  async function readOrg(as: UserCredential, signal?: AbortSignal): Promise<Org | null> {
    const users: unknown[] = [];
    for (let page = 1; page <= MAX_USER_PAGES; page++) {
      const r = await d.crm.listUsers(as, { type: "AllUsers", page, perPage: USERS_PER_PAGE, signal });
      if (!r.ok) return null;
      users.push(...r.value.users);
      if (!r.value.moreRecords) return seatOrg(users, d.seats);
    }
    return null;   /* more than 2,000 users: refuse rather than show a partial org */
  }

  async function grantsOf(org: Org): Promise<Record<string, CapGrid>> {
    const out: Record<string, CapGrid> = {};
    for (const m of org.members) out[m.id] = m.left ? {} : await readGrants(d.grants, m.id, ZOHO_SEAT_SIDES[m.seat].lead);
    return out;
  }

  /** `{id: count}` for these ids, grouped by `field` on `module`; cached as buckets under the viewer's book scope. */
  async function countBy(as: UserCredential, scope: BookScope, name: string, module: "Leads" | "Contacts", field: "Owner" | "KAM", ids: readonly string[], signal?: AbortSignal):
    Promise<{ readonly counts: Record<string, number>; readonly origin: "live" | "cached" } | null> {
    const clean = [...new Set(ids.filter((id) => USER_ID.test(id)))].sort();
    if (!clean.length) return { counts: {}, origin: "live" };
    if (scope.kind === "none") return null;
    const load = async (): Promise<CountBucket[]> => {
      const buckets: CountBucket[] = [];
      for (const part of chunks(clean, IN_MAX)) {
        const r = await d.crm.aggregate(as, `select ${field}, COUNT(id) from ${module} where ${field} in (${part.map((id) => `'${id}'`).join(", ")}) group by ${field} limit 0, 2000`, { signal });
        if (!r.ok) throw Object.assign(new Error("count-failed"), { reason: r.error.kind });
        for (const row of r.value) {
          const k = row[field];
          const n = row["COUNT(id)"];
          if (typeof k === "string" && clean.includes(k) && typeof n === "number" && Number.isSafeInteger(n) && n >= 0) buckets.push({ key: k, count: n });
        }
      }
      return buckets;
    };
    const read = await d.cache.readSettled<readonly CountBucket[], CountBucket[]>(scopedKey<readonly CountBucket[]>(scope, `teams.${name}`), load);
    if (read.state === "error") return null;
    const counts: Record<string, number> = {};
    for (const b of read.value) counts[b.key] = b.count;
    return { counts, origin: read.state === "fresh" && read.origin === "live" ? "live" : "cached" };
  }

  async function build(as: UserCredential, session: ConsoleSession, signal?: AbortSignal):
    Promise<{ ok: true; a: Extract<TeamsAccess, { ok: true }>; org: Org; grants: Record<string, CapGrid>; view: TeamsView; counts: CountsState } | Exclude<TeamsResult, { ok: true }>> {
    const org = await readOrg(as, signal);
    if (!org) return { ok: false, status: 503, code: "zoho-unavailable", message: UNAVAILABLE };
    const grants = await grantsOf(org);
    const now = new Date(clock());
    const a = teamsAccess(session.who, session.seat, org, grants, now);
    if (!a.ok) {
      try { d.log.refusal({ at: clock(), actor: { kind: "user", userId: as.userId }, action: "teams-open", reason: a.refusal, recordIds: [] }); } catch { /* never fail on a log */ }
      return { ok: false, status: 403, code: a.refusal, message: a.message };
    }
    const scopes = scopesFor(session.seat, session.who);
    const byId = new Map(org.members.map((m) => [m.id, m]));
    const t = countTargets(a, org);
    const kamsInScope = (a.imScope ?? []).filter((id) => ZOHO_SEAT_SIDES[byId.get(id)!.seat].im === "kam");
    const leads = a.leadScope ? await countBy(as, scopes.leads, "leads-by-owner", "Leads", "Owner", a.leadScope, signal) : null;
    const accountsAll = kamsInScope.length ? await countBy(as, scopes.investors, "accounts-by-kam", "Contacts", "KAM", kamsInScope, signal) : null;
    const accounts = accountsAll && Object.fromEntries(t.kams.map((id) => [id, accountsAll.counts[id] ?? 0]));
    const wanted = !!a.leadScope || kamsInScope.length > 0;
    const failed = (a.leadScope && !leads && scopes.leads.kind !== "none") || (kamsInScope.length > 0 && !accountsAll && scopes.investors.kind !== "none");
    const counts = !wanted ? "none" : failed ? "unavailable" : [leads, accountsAll].some((c) => c?.origin === "live") ? "live" : "cached";
    const view = teamsView(a, org, grants, { leads: leads?.counts ?? null, accounts }, now);
    return { ok: true, a, org, grants, view, counts: counts as CountsState };
  }

  const service: TeamsService = {
    async list(as, session, signal): Promise<TeamsResult> {
      const b = await build(as, session, signal);
      if (!b.ok) return b;
      let roles = null, profiles = null;
      const [r, p] = [await d.crm.settingsRoles(as, { signal }), await d.crm.settingsProfiles(as, { signal })];
      if (r.ok && p.ok) { roles = r.value; profiles = p.value; }
      return { ok: true as const, view: b.view, grid: rightsGrid(roles, profiles, d.pinned, new Date(clock())), counts: b.counts };
    },
    async member(as, session, id, signal): Promise<MemberResult> {
      if (typeof id !== "string" || !USER_ID.test(id)) return { ok: false, status: 404, code: "cannot-open", message: "That is not a member you can open." };
      const b = await build(as, session, signal);
      if (!b.ok) return b;
      const r = memberDetail(b.a, b.org, b.grants, b.view, id, new Date(clock()));
      if (!r.ok) {
        try { d.log.refusal({ at: clock(), actor: { kind: "user", userId: as.userId }, action: "teams-member", reason: r.code, recordIds: [id] }); } catch { /* never fail on a log */ }
        return { ok: false, status: 403, code: "cannot-open", message: r.message };
      }
      return { ok: true, detail: r.detail };
    },
  };
  return Object.freeze(service);
}
