/**
 * The route half shared by /api/farms, /api/events and /api/cases (M11-S01, M14-S01, M13-S02): the
 * signed-in person's own credential (D53) and one client on the process-wide gate, cache and log
 * (server/data/zoho-source dataRuntime), and the mapping of a reader's answer to a response.
 * Responses carry no-store; a failure answer carries a short code, never a Zoho body.
 */

import type { CacheError, CacheFresh, CacheStale } from "../../lib/zoho/cache";
import { createZohoClient, type UserCredential, type ZohoClient } from "../../lib/zoho/client";
import type { ScopedCache } from "../../lib/zoho/cache";
import type { InvestorEvents } from "../data/events";

export const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

export interface RouteContext {
  readonly credential: UserCredential;
  readonly seat: string;
  readonly crm: ZohoClient;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
}

/** The signed-in person and the shared runtime, or the response to send instead (503 not configured, 401 signed out). */
export async function routeContext(env: NodeJS.ProcessEnv = process.env): Promise<{ ok: true; ctx: RouteContext } | { ok: false; response: Response }> {
  const { zohoSignInConfigured } = await import("../oauth/runtime");
  if (!zohoSignInConfigured(env)) {
    return { ok: false, response: Response.json({ error: "This page reads Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }) };
  }
  const { sessionCredential } = await import("../oauth/request");
  const s = await sessionCredential();
  if (!s.ok) return s;
  const { dataRuntime } = await import("../data/zoho-source");
  const rt = dataRuntime();
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX! });
  return { ok: true, ctx: { credential: s.credential, seat: s.session.seat, crm, cache: rt.cache, events: rt.events } };
}

/** A cached aggregate as the page reads it: the number and when it was true, or that it failed. */
export function cacheView<V>(r: CacheFresh<V> | CacheStale<V> | CacheError<V>) {
  return r.state === "error"
    ? { state: "error" as const, reason: r.reason, lastGoodAt: r.lastGoodAt }
    : { state: r.state, value: r.value, asOf: r.asOf };
}

const REFUSED: Readonly<Record<string, [number, string]>> = Object.freeze({
  "no-book": [403, "This page is not part of your seat."],
  "not-found": [404, "Not found, or not yours to open."],
  "invalid-request": [400, "That is not a record id."],
  "scope-drift": [403, "Zoho returned a record outside your book; nothing is shown. Digital Infrastructure has been told."],
  "source-invalid": [502, "Zoho returned a record this console cannot read."],
});

/** A refusal or a source failure as a response. */
export function failureResponse(r: { kind: "refused"; reason: string } | { kind: "source-error"; errorKind: string; retryable: boolean }): Response {
  if (r.kind === "refused") {
    const [status, error] = REFUSED[r.reason] ?? [403, "Refused."];
    return Response.json({ error, code: r.reason }, { status, headers: NO_STORE });
  }
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}
