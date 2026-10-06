/**
 * Server-only composition of the contact-and-next-step writes (cluster C1) for
 *   POST   /api/leads/[id]/followup    the follow-up save: lpFinish, lpLose, saveFollowup
 *   POST   /api/leads/[id]/touches     logTouch, saveTouch
 *   PUT    /api/leads/[id]/next        saveNext
 *   POST   /api/leads/[id]/next/move   pullIn, moveNextTo
 *   POST   /api/leads/[id]/lost        closeLost
 *   DELETE /api/leads/[id]/lost        reopenLost
 * Same configuration as the email sender (server/leads/email-runtime): Zoho sign-in, ZOHO_CRM_RECORD_ID_PREFIX,
 * ORG_EMAIL_DOMAINS and FOLLOWUP_UNDO_SECRET. Every write is on the person's own token (D53).
 *
 * `pressOnce` is the double-press guard for the writes that INSERT (a Touch, a Note, a next-step activity): the same
 * Idempotency-Key from the same person and lead, asking for the same thing, runs once on any instance and answers what
 * the first press did (server/state/idempotent). A different request under a used key is refused.
 */

import { createZohoClient } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { userSessions } from "../oauth/runtime";
import { sharedState } from "../state/runtime";
import { createIdempotency, type Once } from "../state/idempotent";
import { emailConfigured, sessionAccess } from "./email-runtime";
import { createFollowups } from "./followup";
import { createTouches } from "./touches";

type Followups = ReturnType<typeof createFollowups>;
type Touches = ReturnType<typeof createTouches>;
const G = globalThis as typeof globalThis & { __gzC1Followups?: Followups; __gzC1Touches?: Touches };

function parts(env: NodeJS.ProcessEnv) {
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const access = sessionAccess(async (sid) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  });
  return { rt, recordIdPrefix, crm, access };
}

/** The follow-up writer: save, setNext, close, reopen, reschedule. Throws if not configured. */
export function followupService(env: NodeJS.ProcessEnv = process.env): Followups {
  if (G.__gzC1Followups) return G.__gzC1Followups;
  if (!emailConfigured(env)) throw new Error("Follow-ups are not configured.");
  const p = parts(env);
  return (G.__gzC1Followups = createFollowups({ crm: p.crm, access: p.access, log: p.rt.log, recordIdPrefix: p.recordIdPrefix, undoSecret: env.FOLLOWUP_UNDO_SECRET! }));
}

/** The touch recorder. Throws if not configured. */
export function touchesService(env: NodeJS.ProcessEnv = process.env): Touches {
  if (G.__gzC1Touches) return G.__gzC1Touches;
  if (!emailConfigured(env)) throw new Error("Touches are not configured.");
  const p = parts(env);
  return (G.__gzC1Touches = createTouches({ crm: p.crm, access: p.access, log: p.rt.log, recordIdPrefix: p.recordIdPrefix }));
}

export const PRESS_TTL_S = 600;
export type PressRefused = { readonly ok: false; readonly kind: "press"; readonly code: "busy" | "key-reused" | "unavailable" };
type PressResult = { readonly ok: boolean };
const PRESSES = new Map<string, ReturnType<typeof createIdempotency<PressResult>>>();

/** Run `work` once for this person, lead and Idempotency-Key. Only a success is kept for replay. */
export async function pressOnce<R extends PressResult>(ns: string, scope: { userId: string; leadId: string; key: string },
  fingerprint: string, work: () => Promise<R>): Promise<R | PressRefused> {
  let idem = PRESSES.get(ns);
  if (!idem) {
    idem = createIdempotency<PressResult>({ state: sharedState(), ns: `lead-${ns}`, ttlSeconds: PRESS_TTL_S, keep: (r) => r.ok,
      save: (r) => JSON.stringify(r), load: (s) => { try { return JSON.parse(s) as PressResult; } catch { return null; } } });
    PRESSES.set(ns, idem);
  }
  const o: Once<PressResult> = await idem.once(`${scope.userId}|${scope.leadId}|${scope.key}`, fingerprint, work);
  if (o.kind === "ran" || o.kind === "replay") return o.result as R;
  return { ok: false, kind: "press", code: o.kind === "reused" ? "key-reused" : o.kind === "busy" ? "busy" : "unavailable" };
}
