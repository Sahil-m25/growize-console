/**
 * The HTTP half every C2 route shares (app/api/leads/[id]/{journey,notes,permission,details,forecast}): read a small JSON
 * body, and turn a service result into the route's answer — 200 with the value, a refusal as { error, code, field? }
 * on its status, a Zoho failure as 503 (retryable) or 502. Nothing in a body is logged.
 */

import { cookies } from "next/headers";
import { noteZohoFailure } from "../http/error-capture";
import { sessionCredential } from "../oauth/request";
import { SID_COOKIE } from "../oauth/user-session";
import type { UserCredential } from "../../lib/zoho/client";

export const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 16 * 1024;

type Result =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: string; readonly reason: string; readonly field?: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

/** The shared refusal statuses; a route adds its own. */
export const BASE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  "invalid-request": 400, "session-changed": 401, "capability-missing": 403, "not-in-book": 403, "not-visible": 404,
  "lead-changed": 409, "lead-closed": 409, "field-missing": 422,
});

export function answer(r: Result, status: Readonly<Record<string, number>> = {}): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") {
    return Response.json({ error: r.reason, code: r.reasonCode, ...(r.field ? { field: r.field } : {}) },
      { status: status[r.reasonCode] ?? BASE_STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  }
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Not saved — Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const notReady = (): Response =>
  Response.json({ error: "The lead record is written in Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
export const badBody = (): Response =>
  Response.json({ error: "Not saved — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });

/** A JSON object body (≤16 KB), or null. */
export async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > MAX_BODY) return null;
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { return null; }
}

/** The signed-in principal (credential + session id), or the sign-in refusal to answer with. */
export async function principalOf(): Promise<{ ok: true; principal: { credential: UserCredential; sessionId: string } } | { ok: false; response: Response }> {
  const s = await sessionCredential();
  if (!s.ok) return s;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  return { ok: true, principal: { credential: s.credential, sessionId: sid } };
}
