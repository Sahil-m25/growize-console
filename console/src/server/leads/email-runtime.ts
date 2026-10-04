/**
 * Server-only composition of the email Send (M07-S05-T02) for POST /api/leads/[id]/email.
 *
 *   ORG_EMAIL_DOMAINS       comma-separated mail domains a sender's own address must be on (agresearchlabs.com)
 *   FOLLOWUP_UNDO_SECRET    the follow-up writer's Undo key (32+ characters), shared with M07-S03
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime)
 *
 * Access is re-derived from the live session on every recheck: only a seat whose leads scope is its own
 * book (IR, channel partner) or a team (IR Manager) may send. PROVISIONAL: with no subtree reader yet a
 * manager sends only on leads they own or cover (teamOwnerIds empty). The NDA reader is the Lead's own
 * NDA_Verified_At (M12-S13: Zoho Sign's completion filing and Finance's verification stamp it). The deck mailer is
 *   GROWIZE_DECK_FILE_ID  the approved deck's file id from Zoho's Files API (MA4); unset → Deck follow-up answers
 *                         "deck-not-ready" rather than going out bare. PROVISIONAL until TC-E07-024 on the sandbox.
 *
 * Also composes the lead page's paperwork row (M12-S11/S12, POST|GET /api/leads/[id]/paperwork) on the same
 * access and FOLLOWUP_UNDO_SECRET, and the IR-hint reader (GET /api/leads/[id]/hints).
 */

import { createZohoClient, type UserCredential } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { zohoSeatOf } from "../data/live";
import { scopesFor } from "../data/scope";
import { userSessions, zohoSignInConfigured } from "../oauth/runtime";
import { createDeckMailer, createEmailSender, createLeadNdaReader, type NdaReader } from "./email";
import { sharedState } from "../state/runtime";
import { createHintReader } from "./hints";
import { createPaperwork } from "./paperwork";
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
  const sender = createEmailSender({ crm, followups, access, log: rt.log, recordIdPrefix, orgDomains: orgDomainsOf(env.ORG_EMAIL_DOMAINS),
    nda: nda ?? createLeadNdaReader(crm), deck: createDeckMailer(crm, env.GROWIZE_DECK_FILE_ID), state: sharedState() });
  G.__gzEmailSender = sender;
  return sender;
}

type PaperworkSvc = ReturnType<typeof createPaperwork>;
type Hints = ReturnType<typeof createHintReader>;
const P = globalThis as typeof globalThis & { __gzPaperwork?: PaperworkSvc; __gzHints?: Hints };

/** The lead page's paperwork row writer (M12-S11/S12). Needs the same configuration as email. */
export function paperworkService(env: NodeJS.ProcessEnv = process.env): PaperworkSvc {
  if (P.__gzPaperwork) return P.__gzPaperwork;
  if (!emailConfigured(env)) throw new Error("Paperwork is not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const access = sessionAccess(async (sid) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  });
  return (P.__gzPaperwork = createPaperwork({ crm, access, log: rt.log, recordIdPrefix, undoSecret: env.FOLLOWUP_UNDO_SECRET! }));
}

/** The IR-hint reader (M12-S11-T03), on the reader's own token. */
export function hintReader(env: NodeJS.ProcessEnv = process.env): Hints {
  if (P.__gzHints) return P.__gzHints;
  if (!zohoSignInConfigured(env) || !/^\d{6,16}$/.test(env.ZOHO_CRM_RECORD_ID_PREFIX ?? "")) throw new Error("Hints are not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  return (P.__gzHints = createHintReader({ crm, log: rt.log, recordIdPrefix }));
}
