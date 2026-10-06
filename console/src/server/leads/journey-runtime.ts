/**
 * Server-only composition of cluster C2 (ir-write-map.md): the ladder and the lead record, every write on the person's
 * own token (D53) — for /api/leads/[id]/{journey,notes,permission,details,forecast}.
 *
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime) — the same as the leads runtime
 *
 * Access is the follow-up capability re-derived from the live session (email-runtime sessionAccess): an IR, a channel
 * partner or an IR Manager works the lead; a manager only on leads they own or cover until a subtree reader exists
 * (PROVISIONAL, as there). The journey's GateReader is gates.ts's reader, which never reads money on this token (D69).
 */

import { createZohoClient } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { userSessions } from "../oauth/runtime";
import { sharedState } from "../state/runtime";
import { sessionAccess } from "./email-runtime";
import { createGates } from "./gates";
import { createJourney } from "./journey";
import { createLeadNotes } from "./notes";
import { createLeadDetails } from "./details";
import { createLeadForecast } from "./forecast";
import { leadsConfigured, sessionLeadsAccess } from "./runtime";

export const recordConfigured = (env: NodeJS.ProcessEnv = process.env): boolean => leadsConfigured(env);

function build(env: NodeJS.ProcessEnv) {
  if (!recordConfigured(env)) throw new Error("The lead record is not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const recheck = async (sid: string) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  };
  const access = sessionAccess(recheck);
  const gates = createGates({ crm, access: sessionLeadsAccess(recheck, env.ZOHO_UNASSIGNED_QUEUE_USER_ID || null), log: rt.log, recordIdPrefix });
  return {
    journey: createJourney({ crm, access, log: rt.log, recordIdPrefix, gates: gates.reader() }),
    notes: createLeadNotes({ crm, access, log: rt.log, recordIdPrefix, state: sharedState() }),
    details: createLeadDetails({ crm, access, log: rt.log, recordIdPrefix }),
    forecast: createLeadForecast({ crm, access, log: rt.log, recordIdPrefix }),
  };
}

type Record_ = ReturnType<typeof build>;
const G = globalThis as typeof globalThis & { __gzLeadRecord?: Record_ };

/** The one C2 runtime of this process (kept across dev reloads). Throws if not configured. */
export function recordRuntime(env: NodeJS.ProcessEnv = process.env): Record_ {
  return (G.__gzLeadRecord ??= build(env));
}
