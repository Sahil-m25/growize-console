/**
 * M01-S10-T01 — STEP-UP: A FRESH ZOHO SIGN-IN BEFORE A REVEAL, AN EXPORT, AN ERASURE OR MONEY LEAVING
 * (D13/D19/D21/D22/D47).
 *
 *   start(sid, action)   a fresh state + PKCE verifier, sealed with the action and a hash of the session
 *                        id into a ten-minute flow cookie; the Zoho authorize URL with prompt=login and
 *                        max_age (zoho-accounts.ts `stepUpUrl`). Plane C: step-up ok `attempt-<action>`.
 *   finish(sid, …)       the callback: the flow must belong to THIS session, the state must match, the
 *                        code is traded and the token names its CRM user (CurrentUser) — who must be the
 *                        session's own person. Success opens the action for STEP_UP_VALID_MS (5 min) on
 *                        this session only; Plane C: step-up ok `<action>`. Anything else — cancelled at
 *                        Zoho, a code Zoho refuses, somebody else signing in — is a failure: Plane C
 *                        step-up refused `failed-<action>` / `cancelled-<action>`, and one on the count.
 *   valid(sid, action)   what `requireStepUp` asks before the action runs.
 *
 * The counter is per person + action; the third failure locks that action for that person (STEP_UP_LOCK_AT)
 * and alerts Sahil and Pradeep (`onLock`); a success clears the count. Only Digital Infrastructure lifts
 * a lock (`unlock`). Nothing here keeps a token: the step-up grant (access_type=online, no refresh token)
 * names the person once and is dropped. PROVISIONAL: windows, counters and locks are process memory — a
 * restart forgets them (a lock is lifted, an open window closes).
 */

import type { PlaneCLog } from "./plane-c";
import { idHash, pkceChallenge, randomToken, sameToken, type Sealer } from "../oauth/crypto";
import type { TokenGrant, ZohoAccounts } from "../oauth/zoho-accounts";

/* "seat": a seat change on Teams (M17-S02, D22) */
export const STEP_UP_ACTIONS = ["reveal", "export", "erase", "release", "seat"] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];
export const isStepUpAction = (x: unknown): x is StepUpAction => typeof x === "string" && (STEP_UP_ACTIONS as readonly string[]).includes(x);

export const STEP_UP_VALID_MS = 5 * 60 * 1_000;
export const STEP_UP_FLOW_TTL_MS = 10 * 60 * 1_000;
export const STEP_UP_LOCK_AT = 3;
/** max_age sent to Zoho: the person must have signed in within this many seconds (with prompt=login, now). */
export const STEP_UP_MAX_AGE_S = 0;
export const STEP_UP_FLOW_COOKIE = "gz_stepup";
export const STEP_UP_BACK_COOKIE = "gz_stepup_back";
/** Where to send the person back: a same-site path only ("/investors/123") — never "//host" or a scheme. */
export const safeBack = (v: string | null | undefined): string => (typeof v === "string" && /^\/(?!\/)[A-Za-z0-9/_\-.]{0,200}$/.test(v) ? v : "/");

export type StepUpRefusal = "signed-out" | "locked" | "not-configured" | "failed" | "cancelled" | "step-up";

export const STEP_UP_MESSAGES: Readonly<Record<StepUpRefusal, string>> = Object.freeze({
  "signed-out": "You are signed out. Sign in with Zoho first.",
  locked: "This action is locked for you after three failed confirmations. Ask Digital Infrastructure to unlock it; Sahil and Pradeep have been told.",
  "not-configured": "Confirming it is you with Zoho is not set up on this deployment.",
  failed: "Zoho did not confirm it was you. Nothing was done.",
  cancelled: "The Zoho confirmation was cancelled. Nothing was done.",
  "step-up": "Confirm it is you with a fresh Zoho sign-in first.",
});

export interface StepUpDeps {
  readonly accounts: Pick<ZohoAccounts, "stepUpReady" | "stepUpUrl" | "exchangeStepUpCode">;
  readonly sealer: Sealer;
  /** the console session behind a session id (user-session.ts `current`) */
  readonly current: (sid: string | null | undefined) => Promise<{ ok: true; session: { who: string; seat: string } } | { ok: false }>;
  /** names the CRM user a step-up grant belongs to (CurrentUser); null when it cannot */
  readonly identify: (grant: TokenGrant) => Promise<string | null>;
  readonly planeC: PlaneCLog;
  /** the third failure: tell Sahil and Pradeep (ids and the action code only) */
  readonly onLock?: (who: string, action: StepUpAction) => void;
  readonly clock?: () => number;
}

export type StepUpStart =
  | { readonly ok: true; readonly url: string; readonly flowCookie: string }
  | { readonly ok: false; readonly code: "signed-out" | "locked" | "not-configured" };

export type StepUpFinish =
  | { readonly ok: true; readonly action: StepUpAction; readonly until: number }
  | { readonly ok: false; readonly code: "signed-out" | "locked" | "failed" | "cancelled"; readonly action: StepUpAction | null };

export type StepUpCheck =
  | { readonly ok: true; readonly until: number }
  | { readonly ok: false; readonly code: "signed-out" | "locked" | "step-up" };

export interface StepUp {
  readonly configured: boolean;
  start(sid: string | null | undefined, action: StepUpAction): Promise<StepUpStart>;
  finish(sid: string | null | undefined, p: { readonly code: string | null; readonly state: string | null; readonly error: string | null }, flowCookie: string | null | undefined): Promise<StepUpFinish>;
  valid(sid: string | null | undefined, action: StepUpAction): Promise<StepUpCheck>;
  locked(who: string, action: StepUpAction): boolean;
  failures(who: string, action: StepUpAction): number;
  /** Digital Infrastructure lifts a lock (and the count). */
  unlock(who: string, action: StepUpAction): void;
}

const FLOW_AAD = "gz-stepup-flow";

export function createStepUp(d: StepUpDeps): StepUp {
  const clock = d.clock ?? Date.now;
  const open = new Map<string, number>();       /* session-key|action → valid until */
  const fails = new Map<string, number>();      /* who|action → failures since the last success */
  const locks = new Set<string>();              /* who|action */

  const log = (who: string, seat: string | null, outcome: "ok" | "refused", reason: string) =>
    d.planeC.record({ at: clock(), who, action: "step-up", outcome, reason, seat });

  function fail(who: string, seat: string, action: StepUpAction, why: "failed" | "cancelled"): StepUpFinish {
    const k = `${who}|${action}`;
    const n = (fails.get(k) ?? 0) + 1;
    fails.set(k, n);
    log(who, seat, "refused", `${why}-${action}`);
    if (n >= STEP_UP_LOCK_AT && !locks.has(k)) {
      locks.add(k);
      log(who, seat, "refused", `locked-${action}`);
      try {
        d.onLock?.(who, action);
      } catch {
        /* an alert that cannot be sent never fails the request */
      }
      return { ok: false, code: "locked", action };
    }
    return { ok: false, code: why, action };
  }

  return Object.freeze({
    configured: d.accounts.stepUpReady,

    async start(sid: string | null | undefined, action: StepUpAction): Promise<StepUpStart> {
      if (!d.accounts.stepUpReady) return { ok: false, code: "not-configured" };
      const s = await d.current(sid);
      if (!s.ok || typeof sid !== "string") return { ok: false, code: "signed-out" };
      const { who, seat } = s.session;
      if (locks.has(`${who}|${action}`)) {
        log(who, seat, "refused", `locked-${action}`);
        return { ok: false, code: "locked" };
      }
      const state = randomToken();
      const verifier = randomToken();
      const now = clock();
      const flowCookie = d.sealer.seal(JSON.stringify({ s: state, v: verifier, x: now + STEP_UP_FLOW_TTL_MS, a: action, k: idHash(sid) }), FLOW_AAD);
      log(who, seat, "ok", `attempt-${action}`);
      return { ok: true, url: d.accounts.stepUpUrl({ state, codeChallenge: pkceChallenge(verifier), maxAgeS: STEP_UP_MAX_AGE_S }), flowCookie };
    },

    async finish(sid: string | null | undefined, p: { readonly code: string | null; readonly state: string | null; readonly error: string | null }, flowCookie: string | null | undefined): Promise<StepUpFinish> {
      const s = await d.current(sid);
      if (!s.ok || typeof sid !== "string") return { ok: false, code: "signed-out", action: null };
      const { who, seat } = s.session;
      let flow: { s?: unknown; v?: unknown; x?: unknown; a?: unknown; k?: unknown } | null = null;
      try {
        const opened = typeof flowCookie === "string" ? d.sealer.open(flowCookie, FLOW_AAD) : null;
        flow = opened === null ? null : JSON.parse(opened);
      } catch {
        flow = null;
      }
      /* a flow that is not this session's, or has run out, or a state that does not match: nothing to
         count against the person (it may be somebody else's link), but it is refused and logged */
      if (!flow || !isStepUpAction(flow.a) || typeof flow.v !== "string" || typeof flow.x !== "number"
        || flow.k !== idHash(sid) || clock() > flow.x || !sameToken(p.state, flow.s)) {
        log(who, seat, "refused", "bad-flow");
        return { ok: false, code: "failed", action: null };
      }
      const action = flow.a;
      if (locks.has(`${who}|${action}`)) {
        log(who, seat, "refused", `locked-${action}`);
        return { ok: false, code: "locked", action };
      }
      if (p.error !== null) return fail(who, seat, action, "cancelled");
      if (typeof p.code !== "string" || p.code.length === 0 || p.code.length > 1_024) return fail(who, seat, action, "failed");
      const got = await d.accounts.exchangeStepUpCode({ code: p.code, codeVerifier: flow.v });
      if (!got.ok) return fail(who, seat, action, "failed");
      let named: string | null = null;
      try {
        named = await d.identify(got.value);
      } catch {
        named = null;
      }
      if (named !== who) return fail(who, seat, action, "failed");   /* somebody else signed in: not a step-up */
      const until = clock() + STEP_UP_VALID_MS;
      open.set(`${idHash(sid)}|${action}`, until);
      fails.delete(`${who}|${action}`);
      log(who, seat, "ok", action);
      return { ok: true, action, until };
    },

    async valid(sid: string | null | undefined, action: StepUpAction): Promise<StepUpCheck> {
      const s = await d.current(sid);
      if (!s.ok || typeof sid !== "string") return { ok: false, code: "signed-out" };
      if (locks.has(`${s.session.who}|${action}`)) return { ok: false, code: "locked" };
      const key = `${idHash(sid)}|${action}`;
      const until = open.get(key);
      if (until === undefined || clock() >= until) {
        open.delete(key);
        return { ok: false, code: "step-up" };
      }
      return { ok: true, until };
    },

    locked: (who: string, action: StepUpAction) => locks.has(`${who}|${action}`),
    failures: (who: string, action: StepUpAction) => fails.get(`${who}|${action}`) ?? 0,
    unlock(who: string, action: StepUpAction): void {
      locks.delete(`${who}|${action}`);
      fails.delete(`${who}|${action}`);
    },
  });
}
