/**
 * Server-only composition of the Zoho sign-in (M01-S02). Secrets are read lazily and never
 * defaulted. Zoho sign-in is "configured" only outside fixture mode and only when every one of these
 * is set (values live in the deployment secret store, never the repo — M02-S10-T02):
 *
 *   ZOHO_ACCOUNTS_ORIGIN       https://accounts.zoho.in
 *   ZOHO_OAUTH_CLIENT_ID       the server-based client registered for this deployment
 *   ZOHO_OAUTH_CLIENT_SECRET
 *   ZOHO_OAUTH_REDIRECT_URI    this deployment's exact https …/api/auth/zoho/callback
 *   ZOHO_SESSION_KEY           32 random bytes, base64 — seals refresh tokens and the flow cookie
 *   ZOHO_CRM_RECORD_ID_PREFIX  this org's id prefix
 *   ZOHO_SEAT_IDS              JSON {"roleIds":{…},"profileIds":{…}} from the sanitized settings export
 *   ZOHO_OAUTH_SCOPES          optional, comma-separated; defaults to DEFAULT_USER_SCOPES
 *   ZOHO_STEPUP_REDIRECT_URI   optional (M01-S10): this deployment's exact https …/api/auth/step-up/callback,
 *                              registered on the same Zoho client; without it every step-up is refused
 *
 * Grants (M03-S02) are read from the process's grant store (server/access/grants.ts), not NO_GRANTS.
 */

import { fixtureModeOn } from "../../lib/fixture-mode";
import { createGate, type Gate } from "../../lib/zoho/gate";
import { createOpsLog, type OpsLog } from "../../lib/zoho/log";
import { createPlaneCLog } from "../identity/plane-c";
import { sharedOpsSink, sharedPlaneCSink } from "../logs/factory";
import { createSealer, type Sealer } from "./crypto";
import { createZohoSeatDirectory, type ZohoSeatDirectory, type ZohoSeatDirectoryConfig } from "./seat";
import { createMemorySessionStore, createUserSessions, type UserSessions } from "./user-session";
import { createZohoAccounts, type ZohoAccounts } from "./zoho-accounts";
import { sharedGrantReader } from "../access/grants";
import { alertingOpsSink } from "../ops/runtime";

/** The scopes M02-S10-T02 registers for a human, less Zoho Sign (added with AP3/M02-S14). */
export const DEFAULT_USER_SCOPES: readonly string[] = Object.freeze([
  "ZohoCRM.modules.ALL",
  "ZohoCRM.settings.READ",
  "ZohoCRM.coql.READ",
  "ZohoCRM.users.READ",
  /* M03-S04-T02: a seat change writes Users role/profile (PUT /users/{id}) on the changer's own token. Zoho's
     "Manage Users" profile permission still decides who may; the console's maySeat narrows it further. */
  "ZohoCRM.users.UPDATE",
  "ZohoCRM.send_mail.all.CREATE",
  "ZohoCRM.Files.CREATE",
  "ZohoCRM.modules.attachments.CREATE",
  "AaaServer.profile.READ",
]);

const REQUIRED = [
  "ZOHO_ACCOUNTS_ORIGIN", "ZOHO_OAUTH_CLIENT_ID", "ZOHO_OAUTH_CLIENT_SECRET", "ZOHO_OAUTH_REDIRECT_URI",
  "ZOHO_SESSION_KEY", "ZOHO_CRM_RECORD_ID_PREFIX", "ZOHO_SEAT_IDS",
] as const;

export const zohoSignInConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !fixtureModeOn(env) && REQUIRED.every((k) => typeof env[k] === "string" && env[k] !== "");

/** Everything the Zoho sign-in is built from, for the step-up and the grant API to share (one gate, one sealer). */
export interface OAuthParts {
  readonly sessions: UserSessions;
  readonly accounts: ZohoAccounts;
  readonly sealer: Sealer;
  readonly seats: ZohoSeatDirectory;
  readonly gate: Gate;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
}
const G = globalThis as typeof globalThis & { __gzUserSessions?: OAuthParts };

/** The one set of OAuth parts of this process (kept across dev reloads). Throws if not configured. */
export function oauthParts(env: NodeJS.ProcessEnv = process.env): OAuthParts {
  if (G.__gzUserSessions && "accounts" in G.__gzUserSessions) return G.__gzUserSessions;
  if (!zohoSignInConfigured(env)) throw new Error("Zoho sign-in is not configured.");
  const log = createOpsLog(alertingOpsSink(sharedOpsSink()));
  const seatIds = JSON.parse(env.ZOHO_SEAT_IDS!) as Pick<ZohoSeatDirectoryConfig, "roleIds" | "profileIds">;
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const accounts = createZohoAccounts({
    accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN!,
    clientId: env.ZOHO_OAUTH_CLIENT_ID!,
    clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET!,
    redirectUri: env.ZOHO_OAUTH_REDIRECT_URI!,
    scopes: env.ZOHO_OAUTH_SCOPES ? env.ZOHO_OAUTH_SCOPES.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_USER_SCOPES,
    stepUpRedirectUri: env.ZOHO_STEPUP_REDIRECT_URI || null,
    log,
  });
  const sealer = createSealer(env.ZOHO_SESSION_KEY!);
  const seats = createZohoSeatDirectory({ recordIdPrefix, roleIds: seatIds.roleIds, profileIds: seatIds.profileIds });
  const gate = createGate();
  const sessions = createUserSessions({
    accounts,
    sealer,
    store: createMemorySessionStore(),
    seats,
    grants: sharedGrantReader(),
    planeC: createPlaneCLog(sharedPlaneCSink()),
    gate,
    log,
    recordIdPrefix,
  });
  G.__gzUserSessions = Object.freeze({ sessions, accounts, sealer, seats, gate, log, recordIdPrefix });
  return G.__gzUserSessions;
}

/** The one UserSessions of this process (kept across dev reloads). Throws if not configured. */
export function userSessions(env: NodeJS.ProcessEnv = process.env): UserSessions {
  return oauthParts(env).sessions;
}

/** Cookie options shared by the routes: httpOnly, lax (the Zoho redirect back is a top-level GET), secure off localhost. */
export const cookieBase = (env: NodeJS.ProcessEnv = process.env) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (env.ZOHO_OAUTH_REDIRECT_URI ?? "").startsWith("https:"),
  path: "/",
});
