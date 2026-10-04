/**
 * Server-only composition of the lead search, the finance gates and cover (M06-S05, M08-S02, M08-S05)
 * for /api/leads/search, /api/leads/[id]/gate and /api/leads/[id]/cover.
 *
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime)
 *   ZOHO_UNASSIGNED_QUEUE_USER_ID                  the "Needs an owner" queue user (optional)
 *   ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN          the cover-window-share service job's grant (D53); with
 *   ZOHO_ACCOUNTS_ORIGIN, ZOHO_OAUTH_CLIENT_ID/SECRET   no grant a window is still written and `shared` is false
 *
 * Access is re-derived from the live session on every recheck, the way the data layer does it
 * (server/data/live.ts): the leads scope of the seat; an IR Manager with no subtree reader reads under
 * Zoho's role hierarchy (teamOrgWide, PROVISIONAL as there); Digital Infrastructure org-wide.
 * The roster (Plane C availability, D49) is read from the log sink (server/roster): a secondary is admitted by a window, or by the
 * owner's live absence when they are themself in; a failed roster read admits nobody.
 */

import { createHmac, randomBytes } from "node:crypto";
import { createZohoClient, createZohoServiceClient, type UserCredential } from "../../lib/zoho/client";
import { runCoverWindowShare } from "../../lib/zoho/cover-window-share";
import { dataRuntime } from "../data/zoho-source";
import { zohoSeatOf } from "../data/live";
import { scopesFor } from "../data/scope";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import type { LeadsAccess, LeadsAccessAuthority } from "./book";
import { createCover, sweepExpiredCovers, type CoverShare } from "./cover";
import { createGates } from "./gates";
import { rosterRuntime } from "../roster/runtime";
import { createLeadSearch } from "./search";

export const leadsConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  zohoSignInConfigured(env) && /^\d{6,16}$/.test(env.ZOHO_CRM_RECORD_ID_PREFIX ?? "");

/** The leads capability of the seat the live session holds now. */
export function sessionLeadsAccess(
  recheckSession: (sid: string, signal?: AbortSignal) => Promise<{ credential: UserCredential; session: { seat: string } } | null>,
  unassignedQueueUserId: string | null,
): LeadsAccessAuthority {
  return {
    async recheck(cred, sid, signal): Promise<LeadsAccess | null> {
      const now = await recheckSession(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      const scope = scopesFor(now.session.seat, cred.userId).leads;
      return {
        actor: { userId: cred.userId, roleId: "", profileId: "", seat },
        mayViewLeads: scope.kind !== "none",
        teamOwnerIds: null,
        teamOrgWide: scope.kind === "all" || scope.kind === "subtree",
        unassignedQueueUserId,
        seesUnassignedInPersonal: now.session.seat === "ir",
      };
    },
  };
}

/** A per-process key for the search cache's term hash: the term never reaches the cache key (D47/D52). */
const TERM_KEY = randomBytes(32);
export const termKey = (term: string): string => createHmac("sha256", TERM_KEY).update(term).digest("hex").slice(0, 24);

function build(env: NodeJS.ProcessEnv) {
  if (!leadsConfigured(env)) throw new Error("Leads are not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const access = sessionLeadsAccess(async (sid) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  }, env.ZOHO_UNASSIGNED_QUEUE_USER_ID || null);

  let provider: ServiceTokenProvider | null = null;
  const service = createZohoServiceClient({ gate: rt.gate, log: rt.log, recordIdPrefix, maxAttempts: 2 });
  const serviceCredential = () => {
    if (!env.ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN || !env.ZOHO_ACCOUNTS_ORIGIN || !env.ZOHO_OAUTH_CLIENT_ID || !env.ZOHO_OAUTH_CLIENT_SECRET) return null;
    provider ??= createServiceTokenProvider({
      job: "cover-window-share", accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN, clientId: env.ZOHO_OAUTH_CLIENT_ID,
      clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET, refreshToken: env.ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN, log: rt.log,
    });
    return provider;
  };
  const share: CoverShare = async (windows, signal) => {
    const p = serviceCredential();
    if (!p) return windows.map((w) => ({ leadId: w.leadId, state: w.state, ok: false }));
    return runCoverWindowShare(service, await p.credential(signal), windows);
  };

  return {
    search: createLeadSearch({ crm, access, log: rt.log, recordIdPrefix, cache: rt.cache, termKey, roster: rosterRuntime() }),
    gates: createGates({ crm, access, log: rt.log, recordIdPrefix, roster: rosterRuntime() }),
    cover: createCover({ crm, access, share, log: rt.log, planeC: rt.planeC, recordIdPrefix, roster: rosterRuntime() }),
    /** For the schedule: close expired windows on the service token. null when the grant is not set. */
    async sweep(signal?: AbortSignal) {
      const p = serviceCredential();
      return p ? sweepExpiredCovers(service, await p.credential(signal), rt.planeC, recordIdPrefix, Date.now, signal) : null;
    },
  };
}

type Leads = ReturnType<typeof build>;
const G = globalThis as typeof globalThis & { __gzLeadsRuntime?: Leads };

/** The one leads runtime of this process (kept across dev reloads). Throws if not configured. */
export function leadsRuntime(env: NodeJS.ProcessEnv = process.env): Leads {
  return (G.__gzLeadsRuntime ??= build(env));
}
