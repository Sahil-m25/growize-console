/**
 * THE HUMAN SESSION BEHIND "CONTINUE WITH ZOHO" (M01-S02, D06/D30/D53/D60).
 *
 * T01  start(): a fresh `state` and PKCE verifier, sealed into a ten-minute flow cookie, and the
 *      Zoho authorize URL. callback(): checks state in constant time, pins the data centre, trades
 *      the code (with the verifier) for a grant, mints the person's own credential with
 *      userCredential() — whose one CurrentUser request also resolves the seat (seat.ts) — and stores
 *      the session with the refresh token sealed (AES-256-GCM, bound to the session key) at rest.
 * T02  signOut(): revokes the refresh token at Zoho and deletes the session. Every read of a session
 *      enforces a 12-hour absolute life. A refresh Zoho refuses — or a refreshed CurrentUser that no
 *      longer resolves to the same person on the same seat — ends the session as 'revoked'.
 * T03  A Zoho user with no seat, or a granted-only seat with no granted page, is refused with a
 *      named message; their token is revoked, never kept; Plane C records the refusal.
 *
 * The cookie carries only an opaque id; the store is keyed by its hash. Nothing here logs a token,
 * a code, an email or a body: Plane B gets call lines, Plane C gets who (a Zoho user id) / what /
 * outcome / reason code.
 */

import { userCredential, type UserCredential, type UserIdentityFetchLike } from "../../lib/zoho/client";
import type { Gate } from "../../lib/zoho/gate";
import type { LogActor, OpsLog } from "../../lib/zoho/log";
import type { PlaneCLog } from "../identity/plane-c";
import { idHash, pkceChallenge, randomToken, sameToken, type Sealer } from "./crypto";
import type { ZohoSeat, ZohoSeatDirectory } from "./seat";
import type { TokenGrant, ZohoAccounts } from "./zoho-accounts";

/** SIGNOUTMSG's three reasons (src/domain/signin.ts). */
export type SignOutWhy = "chose" | "expired" | "revoked";

/** A console session lasts 12 hours from sign-in, however busy it is (SIGNOUTMSG.expired). */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1_000;
export const FLOW_TTL_MS = 10 * 60 * 1_000;
/** Refresh an access token this long before Zoho would refuse it. */
export const ACCESS_REFRESH_SKEW_MS = 60 * 1_000;

export const SID_COOKIE = "gz_zsid";
export const FLOW_COOKIE = "gz_oauth";
export const NOTE_COOKIE = "gz_signin_note";

/** The console seat token a Zoho seat signs in as (the vocabulary of `Session.seat` and the stub). Administrator seats never sign in. */
export const CONSOLE_SEAT: Readonly<Record<ZohoSeat, string | null>> = Object.freeze({
  "corporate-root": null,
  "digital-infrastructure": null,
  "business-unit-owner": "bu",
  "ir-manager": "conv",
  "investor-relations": "ir",
  "channel-partner": "cp",
  "head-of-finance": "head",
  "finance-operations": "fin",
  "compliance-audit": "comp",
  "head-of-account-management": "amlead",
  "key-account-manager": "kam",
  viewer: "exec",
});

/** D60 / BYGRANT: these seats sign in only while Digital Infrastructure has granted them a page. */
export const GRANT_ONLY_SEATS: ReadonlySet<string> = new Set(["exec", "bu", "corp", "cp"]);

export type RefusalCode = "no-seat" | "no-grant" | "cancelled" | "failed";

/** The named message the sign-in screen shows for each refusal. */
export const SIGNIN_REFUSALS: Readonly<Record<RefusalCode, string>> = Object.freeze({
  "no-seat": "No console access: your Zoho account does not hold a console seat. Digital Infrastructure can give you one.",
  "no-grant": "No console access: this seat signs in only once Digital Infrastructure grants it a page.",
  cancelled: "Zoho sign-in was cancelled. Nobody was signed in.",
  failed: "Zoho sign-in did not complete. Try again.",
});

export interface ConsoleSession {
  /** The Zoho CRM user id (PROVISIONAL: the person key until the Zoho data source keys PEOPLE). */
  readonly who: string;
  readonly seat: string;
}

export interface StoredSession extends ConsoleSession {
  /** AES-256-GCM, bound to this record's key; never the plain token. */
  readonly sealedRefresh: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/** M01-S04 supplies the durable store; until then a process-local map. */
export interface SessionStore {
  get(key: string): Promise<StoredSession | null>;
  put(key: string, record: StoredSession): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createMemorySessionStore(): SessionStore & { readonly size: () => number; readonly raw: () => readonly StoredSession[] } {
  const m = new Map<string, StoredSession>();
  return Object.freeze({
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, r: StoredSession) => { m.set(k, Object.freeze({ ...r })); },
    delete: async (k: string) => { m.delete(k); },
    size: () => m.size,
    raw: () => [...m.values()],
  });
}

/** Whether a granted-only seat holds at least one granted page (M03-S02 owns the grants). */
export interface GrantDirectory {
  hasGrantedPage(zohoUserId: string, seat: string): Promise<boolean> | boolean;
}
/** Until grants are stored (M03-S02), no granted-only seat holds a page: they are refused, fail closed. */
export const NO_GRANTS: GrantDirectory = Object.freeze({ hasGrantedPage: () => false });

export interface UserSessionDeps {
  readonly accounts: ZohoAccounts;
  readonly sealer: Sealer;
  readonly store: SessionStore;
  readonly seats: ZohoSeatDirectory;
  readonly grants: GrantDirectory;
  readonly planeC: PlaneCLog;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly identityFetch?: UserIdentityFetchLike;
  readonly clock?: () => number;
}

export interface CallbackParams {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  /** Zoho's `accounts-server` query parameter, when sent. */
  readonly accountsServer: string | null;
}

export type CallbackResult =
  | { readonly ok: true; readonly sid: string; readonly session: ConsoleSession }
  | { readonly ok: false; readonly code: RefusalCode; readonly message: string };

export type CurrentResult =
  | { readonly ok: true; readonly session: ConsoleSession; readonly expiresAt: number }
  /** why: null when there simply is no session; a reason when this read ended one. */
  | { readonly ok: false; readonly why: SignOutWhy | null };

export type CredentialResult =
  | { readonly ok: true; readonly credential: UserCredential; readonly session: ConsoleSession }
  | { readonly ok: false; readonly why: SignOutWhy | null; readonly unavailable?: true };

export interface UserSessions {
  start(): { readonly url: string; readonly flowCookie: string };
  callback(params: CallbackParams, flowCookie: string | null | undefined): Promise<CallbackResult>;
  current(sid: string | null | undefined): Promise<CurrentResult>;
  credential(sid: string | null | undefined): Promise<CredentialResult>;
  signOut(sid: string | null | undefined, why?: SignOutWhy): Promise<void>;
}

const FLOW_AAD = "gz-oauth-flow";
const SID = /^[A-Za-z0-9_-]{43}$/;

const normalised = (g: TokenGrant): TokenGrant => ({ access_token: g.access_token, api_domain: g.api_domain, expires_in: g.expires_in });

export function createUserSessions(d: UserSessionDeps): UserSessions {
  const clock = d.clock ?? Date.now;
  /** Access credentials live in memory only, never at rest; keyed like the store. */
  const live = new Map<string, UserCredential>();
  /** One refresh at a time per session. */
  const refreshing = new Map<string, Promise<CredentialResult>>();

  const actorOf = (who: string): LogActor => ({ kind: "user", userId: who });

  function refuse(code: RefusalCode, reason: string, who: string | null, seat: string | null): CallbackResult {
    d.planeC.record({ at: clock(), who: who ?? "unrecognised", action: "sign-in-refused", outcome: "refused", reason, seat });
    return { ok: false, code, message: SIGNIN_REFUSALS[code] };
  }

  async function revokeQuietly(refreshToken: string | undefined, who: string | null): Promise<void> {
    if (!refreshToken) return;
    try {
      await d.accounts.revoke(refreshToken, actorOf(who ?? "unrecognised"));
    } catch {
      /* best effort: the session is gone either way */
    }
  }

  /** Mint the person's credential; the same CurrentUser answer names their seat. */
  async function identify(grant: TokenGrant): Promise<{ credential: UserCredential; resolution: ReturnType<ZohoSeatDirectory["resolveCurrentUser"]> } | null> {
    let body: unknown = null;
    try {
      const credential = await userCredential(normalised(grant), {
        recordIdPrefix: d.recordIdPrefix, gate: d.gate, log: d.log, clock,
        ...(d.identityFetch ? { fetch: d.identityFetch } : {}),
        onCurrentUser: (b) => { body = b; },
      });
      return { credential, resolution: d.seats.resolveCurrentUser(body) };
    } catch {
      return null;
    }
  }

  async function end(key: string, rec: StoredSession, why: SignOutWhy, revoke: boolean): Promise<void> {
    live.delete(key);
    await d.store.delete(key);
    if (revoke) await revokeQuietly(d.sealer.open(rec.sealedRefresh, key) ?? undefined, rec.who);
    const action = why === "chose" ? "sign-out" : why === "expired" ? "session-expired" : "session-revoked";
    d.planeC.record({ at: clock(), who: rec.who, action, outcome: "ended", reason: why, seat: rec.seat });
  }

  async function load(sid: string | null | undefined): Promise<{ key: string; rec: StoredSession } | CurrentResult> {
    if (typeof sid !== "string" || !SID.test(sid)) return { ok: false, why: null };
    const key = idHash(sid);
    const rec = await d.store.get(key);
    if (!rec) return { ok: false, why: null };
    if (clock() >= rec.expiresAt) {
      await end(key, rec, "expired", true);
      return { ok: false, why: "expired" };
    }
    return { key, rec };
  }

  async function refresh(key: string, rec: StoredSession): Promise<CredentialResult> {
    const token = d.sealer.open(rec.sealedRefresh, key);
    if (token === null) {
      await end(key, rec, "revoked", false);
      return { ok: false, why: "revoked" };
    }
    const r = await d.accounts.refresh(token, actorOf(rec.who));
    if (!r.ok) {
      if (r.reason === "unavailable") return { ok: false, why: null, unavailable: true };
      await end(key, rec, "revoked", false);
      return { ok: false, why: "revoked" };
    }
    const id = await identify(r.value);
    if (id === null) return { ok: false, why: null, unavailable: true };
    const seat = id.resolution.ok ? CONSOLE_SEAT[id.resolution.value.seat] : null;
    if (id.credential.userId !== rec.who || seat !== rec.seat) {
      await end(key, rec, "revoked", true);
      return { ok: false, why: "revoked" };
    }
    live.set(key, id.credential);
    return { ok: true, credential: id.credential, session: { who: rec.who, seat: rec.seat } };
  }

  return Object.freeze({
    start() {
      const state = randomToken();
      const verifier = randomToken();
      const flowCookie = d.sealer.seal(JSON.stringify({ s: state, v: verifier, x: clock() + FLOW_TTL_MS }), FLOW_AAD);
      return { url: d.accounts.authorizeUrl({ state, codeChallenge: pkceChallenge(verifier) }), flowCookie };
    },

    async callback(p: CallbackParams, flowCookie: string | null | undefined): Promise<CallbackResult> {
      const opened = typeof flowCookie === "string" ? d.sealer.open(flowCookie, FLOW_AAD) : null;
      let flow: { s?: unknown; v?: unknown; x?: unknown } | null = null;
      try {
        flow = opened === null ? null : (JSON.parse(opened) as { s?: unknown; v?: unknown; x?: unknown });
      } catch {
        flow = null;
      }
      if (!flow || typeof flow.v !== "string" || typeof flow.x !== "number" || clock() > flow.x) {
        return refuse("failed", "no-flow", null, null);
      }
      if (!sameToken(p.state, flow.s)) return refuse("failed", "bad-state", null, null);
      if (p.error !== null) return refuse("cancelled", "denied-at-zoho", null, null);
      if (p.accountsServer !== null && p.accountsServer.replace(/\/+$/, "") !== d.accounts.accountsOrigin) {
        return refuse("failed", "wrong-dc", null, null);
      }
      if (typeof p.code !== "string" || p.code.length === 0 || p.code.length > 1_024) return refuse("failed", "no-code", null, null);

      const exchanged = await d.accounts.exchangeCode({ code: p.code, codeVerifier: flow.v });
      if (!exchanged.ok) return refuse("failed", "code-refused", null, null);
      const grant = exchanged.value;

      const id = await identify(grant);
      if (id === null) {
        await revokeQuietly(grant.refresh_token, null);
        return refuse("failed", "unverified", null, null);
      }
      const who = id.credential.userId;
      if (!id.resolution.ok) {
        await revokeQuietly(grant.refresh_token, who);
        return refuse("no-seat", id.resolution.reason, who, null);
      }
      const seat = CONSOLE_SEAT[id.resolution.value.seat];
      if (seat === null) {
        await revokeQuietly(grant.refresh_token, who);
        return refuse("no-seat", "administrator-profile", who, null);
      }
      if (GRANT_ONLY_SEATS.has(seat)) {
        let granted = false;
        try {
          granted = (await d.grants.hasGrantedPage(who, seat)) === true;
        } catch {
          granted = false;
        }
        if (!granted) {
          await revokeQuietly(grant.refresh_token, who);
          return refuse("no-grant", "no-grant", who, seat);
        }
      }

      const sid = randomToken();
      const key = idHash(sid);
      const now = clock();
      await d.store.put(key, {
        who, seat,
        sealedRefresh: d.sealer.seal(grant.refresh_token!, key),
        createdAt: now,
        expiresAt: now + SESSION_ABSOLUTE_MS,
      });
      live.set(key, id.credential);
      d.planeC.record({ at: now, who, action: "sign-in", outcome: "ok", reason: "zoho", seat });
      return { ok: true, sid, session: { who, seat } };
    },

    async current(sid: string | null | undefined): Promise<CurrentResult> {
      const got = await load(sid);
      if (!("key" in got)) return got;
      return { ok: true, session: { who: got.rec.who, seat: got.rec.seat }, expiresAt: got.rec.expiresAt };
    },

    async credential(sid: string | null | undefined): Promise<CredentialResult> {
      const got = await load(sid);
      if (!("key" in got)) return got.ok ? { ok: false, why: null } : got;
      const { key, rec } = got;
      const held = live.get(key);
      if (held && held.expiresAt !== null && held.expiresAt > clock() + ACCESS_REFRESH_SKEW_MS) {
        return { ok: true, credential: held, session: { who: rec.who, seat: rec.seat } };
      }
      let pending = refreshing.get(key);
      if (!pending) {
        pending = refresh(key, rec).finally(() => refreshing.delete(key));
        refreshing.set(key, pending);
      }
      return pending;
    },

    async signOut(sid: string | null | undefined, why: SignOutWhy = "chose"): Promise<void> {
      if (typeof sid !== "string" || !SID.test(sid)) return;
      const key = idHash(sid);
      const rec = await d.store.get(key);
      if (!rec) {
        live.delete(key);
        return;
      }
      await end(key, rec, why, true);
    },
  });
}
