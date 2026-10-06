/**
 * Server-only composition of "my profile", "my badge" and the activity export line (M17-S05, J14, J15).
 *
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime)
 *
 * My name and mobile are written on MY token (ZohoCRM.users.UPDATE, requested at sign-in) to MY user id, which comes
 * from the credential — never from the request. The session is rechecked live before the write.
 */

import { createZohoClient } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { createProfile } from "../people/profile";
import { sharedState } from "../state/runtime";
import { createExportAudit } from "./export-audit";
import { createStyle } from "./style";

export const meConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  zohoSignInConfigured(env) && /^\d{6,16}$/.test(env.ZOHO_CRM_RECORD_ID_PREFIX ?? "");

function build(env: NodeJS.ProcessEnv) {
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX ?? "" });
  const sessions = userSessions(env);
  return {
    profile: createProfile({
      crm, log: rt.log,
      session: { async recheck(cred, sid) { const r = await sessions.credential(sid); return r.ok && r.credential.userId === cred.userId; } },
    }),
  };
}
const G = globalThis as typeof globalThis & { __gzMeRuntime?: ReturnType<typeof build> };
/** The profile writer (needs Zoho sign-in). Throws when not configured; check `meConfigured` first. */
export function meRuntime(env: NodeJS.ProcessEnv = process.env) {
  if (!meConfigured(env)) throw new Error("My profile is not configured.");
  return (G.__gzMeRuntime ??= build(env));
}

/** Style and the export line need no Zoho: only the shared state store and the ops log. */
export const styleStore = () => createStyle({ state: sharedState() });
export const exportAudit = () => createExportAudit({ log: dataRuntime().log, state: sharedState() });
