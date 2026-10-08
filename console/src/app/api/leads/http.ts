/* The shared door of the contact-and-next-step routes under /api/leads/[id]/ (cluster C1): followup, touches, next,
   next/move and lost. Not a route itself (Next serves only route.ts).

   - not configured                       → 503 { code: "not-configured" }, nothing written
   - body over 16 KB / not a JSON object  → 413 / 400 { code: "invalid-request" }
   - a write that INSERTS (a Touch, a Note, a next-step activity) needs an Idempotency-Key header (one per press): the same
     key from the same person on the same lead, with the same body, runs once and replays its answer (server/state/idempotent)
   - a refusal → { error: <the inline message>, code } with the status below; a Zoho failure → 502/503, never a Zoho body
   - a Zoho REFUSAL after the Lead write (everything taken back) → its code: 403 activity-forbidden / zoho-forbidden for
     NO_PERMISSION, 502 zoho-refused for invalid data, each with { zoho: { module, code, field } } — codes, never values (B-01) */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { emailConfigured } from "@/server/leads/email-runtime";
import { pressOnce, type PressRefused } from "@/server/leads/followup-runtime";
import type { FollowupRefusal, FollowupResult } from "@/server/leads/followup";
import type { UserCredential } from "@/lib/zoho/client";

export const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 16 * 1024;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
export const STATUS: Partial<Record<FollowupRefusal, number>> = {
  "session-changed": 401, "capability-missing": 403, "not-in-book": 403, "not-visible": 404, "no-consent": 403,
  "lead-changed": 409, "scheduled-changed": 409, "lead-lost": 409, "money-in": 409, "not-lost": 409,
  "undo-expired": 410, "undo-invalid": 403, "followup-partial": 502, "source-invalid": 502,
};
const PRESS: Record<PressRefused["code"], { status: number; error: string }> = {
  "busy": { status: 409, error: "That press is already being saved. Wait a moment." },
  "key-reused": { status: 422, error: "Not saved — that press key was used for a different request." },
  "unavailable": { status: 503, error: "Not saved — the console could not guard against a double press. Try again." },
};

export function answer<T>(r: FollowupResult<T> | PressRefused): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "press") return Response.json({ error: PRESS[r.code].error, code: r.code === "busy" ? "sending" : r.code }, { status: PRESS[r.code].status, headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: `Not saved — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  const d = r.kind === "source-error" ? r.detail : undefined;
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null, ...(d?.code ? { code: d.code } : {}) } as never);
  // B-01: when Zoho answered with a refusal, say so (its code and the module), not "Zoho is not answering". Everything the
  // save wrote was taken back before this answer (a partial take-back is the followup-partial refusal above).
  if (d) {
    const what = MODULE_WORD[d.module] ?? d.module;
    const zoho = { module: d.module, code: d.code, field: d.field };
    if (d.kind === "forbidden") {
      return Response.json({ error: `Not saved — your Zoho profile cannot save ${what}; nothing was kept.`,
        code: ACTIVITY.has(d.module) ? "activity-forbidden" : "zoho-forbidden", zoho }, { status: 403, headers: NO_STORE });
    }
    if (d.kind === "invalid-data" || d.kind === "partial") {
      return Response.json({ error: `Not saved — Zoho refused the ${what.replace(/s$/, "")} (${d.code ?? "INVALID_DATA"}${d.field ? ` on ${d.field}` : ""}); nothing was kept.`,
        code: "zoho-refused", zoho }, { status: 502, headers: NO_STORE });
    }
    return Response.json({ error: "Not saved — Zoho is not answering; nothing was kept. Try again.", code: d.kind, zoho }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
  }
  if (r.errorKind === "forbidden") return Response.json({ error: "Not saved — your Zoho profile does not allow this.", code: "zoho-forbidden" }, { status: 403, headers: NO_STORE });
  return Response.json({ error: "Not saved — Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}
/** The person's word for a Zoho module named in a refusal (API "Events" are Meetings in the CRM's own UI). */
const MODULE_WORD: Readonly<Record<string, string>> = { Tasks: "Tasks", Calls: "Calls", Events: "Meetings", Touches: "Touches", Leads: "Leads", Notes: "Notes" };
const ACTIVITY: ReadonlySet<string> = new Set(["Tasks", "Calls", "Events"]);

export interface LeadWriteContext {
  readonly principal: { credential: UserCredential; sessionId: string };
  readonly leadId: string;
  readonly body: Record<string, unknown>;
  readonly signal: AbortSignal;
}

/** One write on a lead: configuration, session, body, the press key when `idem` names a namespace, then `run`. */
export async function leadWrite(req: Request, { params }: { params: Promise<{ id: string }> },
  o: { idem?: string; run: (c: LeadWriteContext) => Promise<FollowupResult<unknown>> }): Promise<Response> {
  if (!emailConfigured()) return Response.json({ error: "This is recorded in Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Not saved — that is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> | null = null;
  try { const p: unknown = JSON.parse(raw); body = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { body = null; }
  if (!body) return Response.json({ error: "Not saved — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const ctx: LeadWriteContext = { principal: { credential: s.credential, sessionId: sid }, leadId: id, body, signal: req.signal };
  if (!o.idem) return answer(await o.run(ctx));
  const key = req.headers.get("Idempotency-Key") ?? "";
  if (!KEY.test(key)) return Response.json({ error: "Not saved — the press has no key.", code: "idempotency-key-needed" }, { status: 400, headers: NO_STORE });
  return answer(await pressOnce(o.idem, { userId: s.credential.userId, leadId: id, key }, raw, () => o.run(ctx)));
}
