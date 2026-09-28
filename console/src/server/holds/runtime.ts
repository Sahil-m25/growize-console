/**
 * Server-only composition for /api/holds/** (M08-S04): the signed-in person's own credential and session (D53),
 * one client on the process-wide gate, cache and log, the release/extend right, and the contract push for
 * hold.changed. Nothing here holds records (D45).
 */
import { cookies } from "next/headers";
import { createZohoClient } from "../../lib/zoho/client";
import { NO_STORE } from "../cases/http";
import { ZOHO_SEAT_OF_TOKEN } from "../access/guard-core";
import { seatAccess } from "../access/policy";
import type { Publish } from "../money/match";

/** The seat holds the "refund" right (Head of Finance, the super user): release and extend. */
export function mayReleaseHold(session: { readonly who: string; readonly seat: string }): boolean {
  const z = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, session.seat) ? ZOHO_SEAT_OF_TOKEN[session.seat]! : null;
  return !!z && seatAccess(z, session.who, {}).imCan("refund");
}

export async function holdsContext(env: NodeJS.ProcessEnv = process.env) {
  const { zohoSignInConfigured } = await import("../oauth/runtime");
  if (!zohoSignInConfigured(env)) {
    return { ok: false as const, response: Response.json({ error: "This page reads Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }) };
  }
  const { sessionCredential } = await import("../oauth/request");
  const s = await sessionCredential();
  if (!s.ok) return s;
  const { SID_COOKIE } = await import("../oauth/user-session");
  const sessionId = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const { dataRuntime } = await import("../data/zoho-source");
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX! });
  return { ok: true as const, ctx: { credential: s.credential, session: s.session, sessionId, seat: s.session.seat, crm, cache: rt.cache, events: rt.events, log: rt.log,
    recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX!, mayRelease: mayReleaseHold(s.session) } };
}

export async function holdsPublish(): Promise<Publish> {
  const { publishToInvestorApp } = await import("../contracts/runtime");
  return async (event) => publishToInvestorApp(event);
}
