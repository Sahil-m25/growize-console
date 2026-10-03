/**
 * Server-only composition for the account-management list (M09-S04, M09-S02, M16-S08): the signed-in person's own
 * credential (D53), the AM book, the Cases register and the Zoho user list for the manager names. Nothing here holds
 * records (D45); the service reads fresh on every request.
 */
import { cookies } from "next/headers";
import { createZohoClient } from "../../lib/zoho/client";
import { ZOHO_SEAT_SIDES } from "../access/policy";
import { createCasesRegister } from "../cases/register";
import type { SeatIds } from "../data/live";
import { kamAccess } from "../queues/runtime";
import { seatOrg } from "../teams/teams";
import { createKamBookService } from "./book";
import { createAmService, type AmKamName, type AmService, type AmServicePrincipal } from "./am-service";
import { NO_STORE } from "./http";

const USERS_PER_PAGE = 200;
const MAX_USER_PAGES = 10;

export async function amServiceContext(env: NodeJS.ProcessEnv = process.env):
  Promise<{ ok: true; service: AmService; principal: AmServicePrincipal } | { ok: false; response: Response }> {
  const { zohoSignInConfigured, userSessions, oauthParts } = await import("../oauth/runtime");
  if (!zohoSignInConfigured(env)) {
    return { ok: false, response: Response.json({ error: "Accounts are read from Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }) };
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
  const seats = oauthParts(env).seats;
  const service = createAmService({
    crm, log: rt.log,
    cases: createCasesRegister({ crm, cache: rt.cache, events: rt.events }),
    amBook: createKamBookService({ crm, log: rt.log, recordIdPrefix, access: kamAccess(s.session, seatIds, async (sid) => {
      const r = await sessions.credential(sid);
      return r.ok ? { credential: r.credential, session: r.session } : null;
    }) }),
    /* the Key Account Managers, on the person's own token: every Zoho user holding that seat, leavers included */
    async kams(cred, signal): Promise<readonly AmKamName[] | null> {
      const users: unknown[] = [];
      for (let page = 1; page <= MAX_USER_PAGES; page++) {
        const r = await crm.listUsers(cred, { type: "AllUsers", page, perPage: USERS_PER_PAGE, signal });
        if (!r.ok) return null;
        users.push(...r.value.users);
        if (!r.value.moreRecords) {
          return seatOrg(users, seats).members.filter((m) => ZOHO_SEAT_SIDES[m.seat].im === "kam").map((m) => ({ id: m.id, name: m.name, left: m.left }));
        }
      }
      return null;
    },
  });
  return { ok: true, service, principal: { credential: s.credential, sessionId, seat: s.session.seat } };
}

/** A refusal or a Zoho failure as an HTTP answer (codes only). */
export function amServiceFailure(r: { readonly kind: string; readonly reason?: string; readonly errorKind?: string }): Response {
  return r.kind === "refused"
    ? Response.json({ error: "Accounts are not part of your seat.", code: r.reason ?? "refused" }, { status: 403, headers: NO_STORE })
    : Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind ?? "source-error" }, { status: 503, headers: NO_STORE });
}
