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

/* ---- the write half (M13-S03-T02, M13-S06-T02) ---- */

const WRITE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  "read-only": 403, "not-yours": 403, "bank-seat": 403, "cannot-assign": 403, "no-book": 403, "kind-not-yours": 403,
  "not-found": 404, "invalid-request": 400, "not-in-book": 422, "identity-in-reply": 422, "identity-in-text": 422,
  "audience-not-in-zoho": 422, "empty-segment": 422, "segment-too-large": 422,
  "not-finance-work": 422, "already-finance": 409, "no-finance": 409,   /* M13-S04 hand to Finance */
});

/** A write's refusal, conflict or source failure as a response: the in-page message and a short code, never a Zoho body. */
export function writeFailure(r:
  | { kind: "refused"; reason: string; message: string }
  | { kind: "conflict"; recordId: string | null; reason: string }
  | { kind: "source-error"; errorKind: string; retryable: boolean }): Response {
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reason }, { status: WRITE_STATUS[r.reason] ?? 422, headers: NO_STORE });
  if (r.kind === "conflict") return Response.json({ error: r.reason, code: "changed", recordId: r.recordId }, { status: 409, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Nothing was changed that you cannot see; try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const MAX_WRITE_BODY = 64 * 1024;
/** A JSON object body, or {} (the writers refuse what is missing). */
export async function jsonBody(req: Request, max = MAX_WRITE_BODY): Promise<Record<string, unknown>> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > max) return {};
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}; } catch { return {}; }
}

/** The contract push (server/contracts/runtime publishToInvestorApp), loaded only when a write needs it. */
export async function investorAppPush(): Promise<(event: Record<string, unknown>) => Promise<{ ok: boolean; eventId?: string; state?: { label: string; status: string } }>> {
  const { publishToInvestorApp } = await import("../contracts/runtime");
  return async (e) => {
    const r = await publishToInvestorApp(e);
    return r.ok ? { ok: true, eventId: r.eventId, state: { label: r.state.label, status: r.state.status } } : { ok: false };
  };
}
