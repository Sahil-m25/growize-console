/**
 * M03-S02 / M01-S10 — server-only composition of the grant API and the step-up.
 *
 *   grantService()                 POST/DELETE /api/grants (grant-service.ts over the shared grant store)
 *   stepUp()                       the step-up round trip (identity/step-up.ts)
 *   requireStepUp(action, handler) wraps a route: without a live step-up for this session and action it
 *                                  answers 403 {code:"step-up", start} (or 423 {code:"locked"}) and the
 *                                  handler never runs.
 *
 *   STEPUP_ALERT_TO     where a lock is reported (Sahil and Pradeep; a human item with the mail provider)
 *   GZ_RELEASE_APPROVAL "on" once Sahil has built the Zoho approval process on releases (M01-S10-T03)
 *
 *   seatChanges()                  PUT /api/users/{id} (seat-change.ts, M03-S04-T02; Leads side M17-S02), behind step-up "seat"
 *   managerChanges()               PUT /api/users/{id}/manager (manager-change.ts, M17-S02-T01)
 *   ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN  the "kam-pool-return" service grant (ZohoCRM.coql.READ +
 *                       ZohoCRM.modules.contacts.READ on a profile that sees every Contact, identity fields
 *                       hidden). Without it a KAM cannot be moved off the seat (503, nothing changed).
 */

import { cookies } from "next/headers";
import { createZohoClient, createZohoServiceClient, userCredential } from "../../lib/zoho/client";
import { createServiceTokenProvider, type ServiceTokenProvider } from "../oauth/service-token";
import { createSeatChangeService, kamBookOrgRead, type SeatChangeService } from "./seat-change";
import { authorityEvents, identityLog } from "../identity/authority";
import { createStepUp, STEP_UP_MESSAGES, type StepUp, type StepUpAction } from "../identity/step-up";
import { createZohoUserDirectory } from "../identity/users";
import { oauthParts, zohoSignInConfigured } from "../oauth/runtime";
import { SID_COOKIE } from "../oauth/user-session";
import { alertOutbox } from "../ops/runtime";
import { createGrantService, type GrantService } from "./grant-service";
import { sharedGrantStore } from "./grants";
import { createManagerChangeService, type ManagerChangeService } from "./manager-change";

type Held = { grants: GrantService; stepUp: StepUp; seats: SeatChangeService; managers: ManagerChangeService };
const G = globalThis as typeof globalThis & { __gzAccessRuntime?: Held };

export const accessRuntimeConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => zohoSignInConfigured(env);

function held(): Held {
  if (G.__gzAccessRuntime) return G.__gzAccessRuntime;
  const o = oauthParts();
  const grants = createGrantService({
    store: sharedGrantStore(),
    users: createZohoUserDirectory({ seats: o.seats, gate: o.gate, log: o.log }),
    events: authorityEvents(),
    sessions: o.sessions,
  });
  const stepUp = createStepUp({
    accounts: o.accounts,
    sealer: o.sealer,
    current: async (sid) => {
      const r = await o.sessions.current(sid);
      return r.ok ? { ok: true as const, session: r.session } : { ok: false as const };
    },
    identify: async (grant) => {
      const c = await userCredential({ access_token: grant.access_token, api_domain: grant.api_domain, expires_in: grant.expires_in },
        { recordIdPrefix: o.recordIdPrefix, gate: o.gate, log: o.log });
      return c.userId;
    },
    planeC: identityLog(),
    onLock: (who, action) => {
      void alertOutbox.send({
        to: process.env.STEPUP_ALERT_TO ?? process.env.ALERT_EMAIL_TO ?? null,
        subject: `Console: step-up locked (${action})`,
        text: `Three failed Zoho confirmations locked "${action}" for Zoho user ${who}. Digital Infrastructure lifts the lock. Plane C holds the attempts.`,
      }).catch(() => undefined);
    },
  });
  const env = process.env;
  let provider: ServiceTokenProvider | null = null;
  const poolCredential = async (signal?: AbortSignal) => {
    if (!env.ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN || !env.ZOHO_ACCOUNTS_ORIGIN || !env.ZOHO_OAUTH_CLIENT_ID || !env.ZOHO_OAUTH_CLIENT_SECRET) return null;
    provider ??= createServiceTokenProvider({
      job: "kam-pool-return", accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN, clientId: env.ZOHO_OAUTH_CLIENT_ID,
      clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET, refreshToken: env.ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN, log: o.log,
    });
    return provider.credential(signal);
  };
  const seats = createSeatChangeService({
    users: createZohoUserDirectory({ seats: o.seats, gate: o.gate, log: o.log }),
    seats: o.seats,
    crm: createZohoClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix, maxAttempts: 1 }),
    kamBook: kamBookOrgRead(createZohoServiceClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix, maxAttempts: 2 }), poolCredential),
    events: authorityEvents(),
    sessions: o.sessions,
    store: sharedGrantStore(),
  });
  const managers = createManagerChangeService({
    users: createZohoUserDirectory({ seats: o.seats, gate: o.gate, log: o.log }),
    crm: createZohoClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix, maxAttempts: 1 }),
    events: authorityEvents(),
    store: sharedGrantStore(),
  });
  G.__gzAccessRuntime = { grants, stepUp, seats, managers };
  return G.__gzAccessRuntime;
}

export const grantService = (): GrantService => held().grants;
export const stepUp = (): StepUp => held().stepUp;
export const seatChanges = (): SeatChangeService => held().seats;
/** PUT /api/users/{id}/manager (manager-change.ts, M17-S02-T01). */
export const managerChanges = (): ManagerChangeService => held().managers;

const NO_STORE = { "Cache-Control": "no-store" };

/** Wrap a route handler behind a live step-up for this session and action (M01-S10-T01). */
export function requireStepUp<A extends unknown[]>(action: StepUpAction, handler: (...args: A) => Response | Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    if (!zohoSignInConfigured()) return Response.json({ error: STEP_UP_MESSAGES["not-configured"], code: "not-configured" }, { status: 503, headers: NO_STORE });
    const sid = (await cookies()).get(SID_COOKIE)?.value;
    const v = await stepUp().valid(sid, action);
    if (!v.ok) {
      const status = v.code === "locked" ? 423 : v.code === "signed-out" ? 401 : 403;
      return Response.json({ error: STEP_UP_MESSAGES[v.code], code: v.code, start: `/api/auth/step-up?action=${action}` }, { status, headers: NO_STORE });
    }
    return handler(...args);
  };
}
