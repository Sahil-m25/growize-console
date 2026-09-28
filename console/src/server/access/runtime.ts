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
 */

import { cookies } from "next/headers";
import { userCredential } from "../../lib/zoho/client";
import { authorityEvents, identityLog } from "../identity/authority";
import { createStepUp, STEP_UP_MESSAGES, type StepUp, type StepUpAction } from "../identity/step-up";
import { createZohoUserDirectory } from "../identity/users";
import { oauthParts, zohoSignInConfigured } from "../oauth/runtime";
import { SID_COOKIE } from "../oauth/user-session";
import { alertOutbox } from "../ops/runtime";
import { createGrantService, type GrantService } from "./grant-service";
import { sharedGrantStore } from "./grants";

type Held = { grants: GrantService; stepUp: StepUp };
const G = globalThis as typeof globalThis & { __gzAccessRuntime?: Held };

export const accessRuntimeConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => zohoSignInConfigured(env);

function held(): Held {
  if (G.__gzAccessRuntime) return G.__gzAccessRuntime;
  const o = oauthParts();
  const grants = createGrantService({
    store: sharedGrantStore(),
    users: createZohoUserDirectory({ seats: o.seats, gate: o.gate, log: o.log }),
    events: authorityEvents(),
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
  G.__gzAccessRuntime = { grants, stepUp };
  return G.__gzAccessRuntime;
}

export const grantService = (): GrantService => held().grants;
export const stepUp = (): StepUp => held().stepUp;

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
