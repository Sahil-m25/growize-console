/**
 * What the C3 routes share: reading a small JSON body, and answering a refusal or a source error in the
 * `{ error, code }` shape every route uses (the in-page sentence, never a Zoho body). Server-only.
 */

import { noteZohoFailure } from "../http/error-capture";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** HTTP status of each refusal code the intake services can name. Anything not listed is 422. */
export const INTAKE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  "invalid-request": 400, "invalid-key": 400, "invalid-mobile": 422, "session-changed": 401, "capability-missing": 403,
  "owner-not-assignable": 403, "duplicate-mobile": 409, "key-reused": 409, "in-progress": 409, "already-owned": 409, "lead-changed": 409,
  "not-visible": 404, "too-many-rows": 413, "source-invalid": 502, "unassigned-queue-missing": 503,
});

export async function jsonBody(req: Request, maxBytes: number): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: 400 | 413 }> {
  const raw = await req.text().catch(() => "");
  if (raw.length > maxBytes) return { ok: false, status: 413 };
  try {
    const p: unknown = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? { ok: true, body: p as Record<string, unknown> } : { ok: false, status: 400 };
  } catch {
    return { ok: false, status: 400 };
  }
}

export const bodyRefused = (status: 400 | 413, what: string): Response =>
  Response.json({ error: `Nothing was ${what} — the request ${status === 413 ? "is too large" : "is incomplete"}.`, code: status === 413 ? "too-many-rows" : "invalid-request" },
    { status, headers: NO_STORE });

type Refusal = { readonly kind: "refused"; readonly reasonCode: string; readonly reason?: string };
type SourceError = { readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

/** A refusal or a source error as a Response. `done` is the in-page "Not <done>." prefix ("Not added", "Not assigned"). */
export function failure(r: Refusal | SourceError, done: string): Response {
  if (r.kind === "refused") {
    return Response.json({ error: `${done} — ${r.reason ?? r.reasonCode}.`, code: r.reasonCode }, { status: INTAKE_STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  }
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: `${done} — Zoho is not answering. Try again.`, code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}
