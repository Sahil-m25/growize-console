/**
 * Server-only composition for /api/queues/** (M05-S07, M05-S08): the signed-in person's own credential and session
 * (D53), one client on the process-wide gate, and the existing readers the queue is built from. The seat's
 * capabilities are decided here from the session's seat token (the same seatAccess the holds runtime uses) — never
 * from the request. Nothing here holds records (D45).
 */
import { cookies } from "next/headers";
import { createZohoClient, type UserCredential } from "../../lib/zoho/client";
import type { ImCan } from "../../lib/im/types";
import { ZOHO_SEAT_OF_TOKEN } from "../access/guard-core";
import { seatAccess } from "../access/policy";
import { createCasesRegister } from "../cases/register";
import { NO_STORE } from "../cases/http";
import { createDocumentsList } from "../documents/list";
import { createHolds } from "../holds/holds";
import { createKamBookService, type KamBookAccessAuthority } from "../investors/book";
import type { SeatIds } from "../data/live";
import { zohoSeatOf } from "../data/live";
import type { ConsoleSession } from "../oauth/user-session";
import type { ZohoProfileName, ZohoRoleName, ZohoSeat } from "../oauth/seat";
import { createInvestorQueues, type QueuePrincipal } from "./queue";

export { NO_STORE };

/** The seat's Investors-side capabilities (the front end's ROLE table through the access policy). */
export function capsOf(session: { readonly who: string; readonly seat: string }): (c: ImCan) => boolean {
  const z = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, session.seat) ? ZOHO_SEAT_OF_TOKEN[session.seat]! : null;
  if (!z) return () => false;
  const a = seatAccess(z, session.who, {});
  return (c) => a.imCan(c);
}

/* The KAM book's seat re-check, as the live data layer builds it (server/data/live.ts kamAccess — private there). */
const AM_SEAT_ROLE: Readonly<Partial<Record<ZohoSeat, { role: ZohoRoleName; profile: ZohoProfileName }>>> = Object.freeze({
  "key-account-manager": { role: "Key Account Manager", profile: "KAM" },
  "head-of-account-management": { role: "Head of Account Management", profile: "AM Head" },
});
function kamAccess(start: ConsoleSession, seatIds: SeatIds | undefined,
  recheck: (sid: string) => Promise<{ credential: UserCredential; session: ConsoleSession } | null>): KamBookAccessAuthority {
  return {
    async recheck(cred, sid) {
      const now = await recheck(sid);
      if (!now || now.credential.userId !== cred.userId || now.session.seat !== start.seat) return null;
      const seat = zohoSeatOf(now.session.seat);
      const ids = seat ? AM_SEAT_ROLE[seat] : undefined;
      if (!seat || !ids) return null;
      const actor = { userId: cred.userId, roleId: seatIds?.roleIds[ids.role] ?? "", profileId: seatIds?.profileIds[ids.profile] ?? "", seat };
      // The Head of AM's active-KAM list is not read yet (as live.ts): a named manager still reads as named (rules use Contacts.KAM).
      return seat === "key-account-manager" ? { actor, activeKamUserIds: [cred.userId] } : { actor, activeKamUserIds: [] };
    },
  };
}

export async function queuesContext(env: NodeJS.ProcessEnv = process.env) {
  const { zohoSignInConfigured, userSessions } = await import("../oauth/runtime");
  if (!zohoSignInConfigured(env)) {
    return { ok: false as const, response: Response.json({ error: "Today reads Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }) };
  }
  const { sessionCredential } = await import("../oauth/request");
  const s = await sessionCredential();
  if (!s.ok) return s;
  const { SID_COOKIE } = await import("../oauth/user-session");
  const sessionId = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const { dataRuntime } = await import("../data/zoho-source");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  let seatIds: SeatIds | undefined;
  try { seatIds = JSON.parse(env.ZOHO_SEAT_IDS!) as SeatIds; } catch { seatIds = undefined; }
  const sessions = userSessions(env);
  const { receiptsConfigured } = await import("../../app/api/receipts/compose");
  const claims = receiptsConfigured() ? await (await import("../money/runtime")).claimAnswers(env) : null;
  const queues = createInvestorQueues({
    crm, log: rt.log, claims,
    holds: createHolds({ crm, cache: rt.cache, events: rt.events }),
    documents: createDocumentsList({ crm, log: rt.log }),
    cases: createCasesRegister({ crm, cache: rt.cache, events: rt.events }),
    amBook: createKamBookService({ crm, log: rt.log, recordIdPrefix, access: kamAccess(s.session, seatIds, async (sid) => {
      const r = await sessions.credential(sid);
      return r.ok ? { credential: r.credential, session: r.session } : null;
    }) }),
  });
  const principal: QueuePrincipal = { credential: s.credential, sessionId, seat: s.session.seat, can: capsOf(s.session) };
  return { ok: true as const, queues, principal };
}

/** A refusal or a Zoho failure as an HTTP answer (codes only). */
export function queueFailure(r: { readonly kind: string; readonly reason?: string; readonly errorKind?: string }): Response {
  if (r.kind === "refused") {
    return r.reason === "invalid-request"
      ? Response.json({ error: "Not a request this page makes.", code: r.reason }, { status: 400, headers: NO_STORE })
      : Response.json({ error: "Today on the Investors side is not part of your seat.", code: r.reason ?? "refused" }, { status: 403, headers: NO_STORE });
  }
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind ?? "source-error" }, { status: 503, headers: NO_STORE });
}
