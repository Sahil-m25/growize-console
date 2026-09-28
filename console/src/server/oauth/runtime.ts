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
 */

import { fixtureModeOn } from "../../lib/fixture-mode";
import { createGate } from "../../lib/zoho/gate";
import { createMemorySink, createOpsLog } from "../../lib/zoho/log";
import { createPlaneCLog, createPlaneCMemorySink } from "../identity/plane-c";
import { createSealer } from "./crypto";
import { createZohoSeatDirectory, type ZohoSeatDirectoryConfig } from "./seat";
import { createMemorySessionStore, createUserSessions, NO_GRANTS, type UserSessions } from "./user-session";
import { createZohoAccounts } from "./zoho-accounts";
import { alertingOpsSink } from "../ops/runtime";

/** The scopes M02-S10-T02 registers for a human, less Zoho Sign (added with AP3/M02-S14). */
export const DEFAULT_USER_SCOPES: readonly string[] = Object.freeze([
  "ZohoCRM.modules.ALL",
  "ZohoCRM.settings.READ",
  "ZohoCRM.coql.READ",
  "ZohoCRM.users.READ",
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

type Held = { sessions: UserSessions };
const G = globalThis as typeof globalThis & { __gzUserSessions?: Held };

/** The one UserSessions of this process (kept across dev reloads). Throws if not configured. */
export function userSessions(env: NodeJS.ProcessEnv = process.env): UserSessions {
  if (G.__gzUserSessions) return G.__gzUserSessions.sessions;
  if (!zohoSignInConfigured(env)) throw new Error("Zoho sign-in is not configured.");
  const log = createOpsLog(alertingOpsSink(createMemorySink()));
  const seatIds = JSON.parse(env.ZOHO_SEAT_IDS!) as Pick<ZohoSeatDirectoryConfig, "roleIds" | "profileIds">;
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const sessions = createUserSessions({
    accounts: createZohoAccounts({
      accountsOrigin: env.ZOHO_ACCOUNTS_ORIGIN!,
      clientId: env.ZOHO_OAUTH_CLIENT_ID!,
      clientSecret: env.ZOHO_OAUTH_CLIENT_SECRET!,
      redirectUri: env.ZOHO_OAUTH_REDIRECT_URI!,
      scopes: env.ZOHO_OAUTH_SCOPES ? env.ZOHO_OAUTH_SCOPES.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_USER_SCOPES,
      log,
    }),
    sealer: createSealer(env.ZOHO_SESSION_KEY!),
    store: createMemorySessionStore(),
    seats: createZohoSeatDirectory({ recordIdPrefix, roleIds: seatIds.roleIds, profileIds: seatIds.profileIds }),
    grants: NO_GRANTS,
    planeC: createPlaneCLog(createPlaneCMemorySink()),
    gate: createGate(),
    log,
    recordIdPrefix,
  });
  G.__gzUserSessions = { sessions };
  return sessions;
}

/** Cookie options shared by the routes: httpOnly, lax (the Zoho redirect back is a top-level GET), secure off localhost. */
export const cookieBase = (env: NodeJS.ProcessEnv = process.env) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (env.ZOHO_OAUTH_REDIRECT_URI ?? "").startsWith("https:"),
  path: "/",
});
