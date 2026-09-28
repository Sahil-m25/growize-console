/**
 * Server-only composition of the email Send (M07-S05-T02) for POST /api/leads/[id]/email.
 *
 *   ORG_EMAIL_DOMAINS       comma-separated mail domains a sender's own address must be on (agresearchlabs.com)
 *   FOLLOWUP_UNDO_SECRET    the follow-up writer's Undo key (32+ characters), shared with M07-S03
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime)
 *
 * Access is re-derived from the live session on every recheck: only a seat whose leads scope is its own
 * book (IR, channel partner) or a team (IR Manager) may send. PROVISIONAL: with no subtree reader yet a
 * manager sends only on leads they own or cover (teamOwnerIds empty). The NDA reader is not wired until
 * the Zoho Sign completion is stamped on the Lead, so deck and webinar templates stay shut.
 */

import { createZohoClient, type UserCredential } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { zohoSeatOf } from "../data/live";
import { scopesFor } from "../data/scope";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { createEmailSender, type NdaReader } from "./email";
import { createFollowups, type FollowupAccessAuthority } from "./followup";

export const emailConfigured = (env: NodeJS.ProcessEnv = process.env): boolean =>
  zohoSignInConfigured(env) && !!env.ORG_EMAIL_DOMAINS && (env.FOLLOWUP_UNDO_SECRET ?? "").length >= 32;

export function orgDomainsOf(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

/** The follow-up capability, from the seat the live session holds now. */
export function sessionAccess(recheckSession: (sid: string, signal?: AbortSignal) => Promise<{ credential: UserCredential; session: { seat: string } } | null>): FollowupAccessAuthority {
  return {
    async recheck(cred, sid, signal) {
      const now = await recheckSession(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      const kind = scopesFor(now.session.seat, cred.userId).leads.kind;
      return { actor: { userId: cred.userId, roleId: "", profileId: "", seat }, mayRecordFollowup: kind === "user" || kind === "subtree", teamOwnerIds: [] };
    },
  };
}

type Sender = ReturnType<typeof createEmailSender>;
const G = globalThis as typeof globalThis & { __gzEmailSender?: Sender };

/** The one email sender of this process (kept across dev reloads). Throws if not configured. */
export function emailSender(env: NodeJS.ProcessEnv = process.env, nda: NdaReader | null = null): Sender {
  if (G.__gzEmailSender) return G.__gzEmailSender;
  if (!emailConfigured(env)) throw new Error("Email send is not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const access = sessionAccess(async (sid) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  });
  const followups = createFollowups({ crm, access, log: rt.log, recordIdPrefix, undoSecret: env.FOLLOWUP_UNDO_SECRET! });
  const sender = createEmailSender({ crm, followups, access, log: rt.log, recordIdPrefix, orgDomains: orgDomainsOf(env.ORG_EMAIL_DOMAINS), nda });
  G.__gzEmailSender = sender;
  return sender;
}
