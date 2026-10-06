/* POST /api/leads — the Add page's one lead (M04-S01, cluster C3).
   Header: Idempotency-Key (one per press; the same key and body answers the first press, it never adds twice).
   Body: { name, mobile, email?, city?, source, eventId?, introducedById?, ownerId?, units?, consent?: {msg,call,email,visit},
           consentHow? }. Owner, source and attribution are decided on the server from the seat (capture.ts), never trusted from here.
   Introduced_By is written only when an introducer is given; if Zoho has no such field the answer is 422
   { code: "introducer-field-missing" } and nothing is saved.
   200 → { leadId, ownerId, replayed }   4xx/5xx → { error: <the in-page sentence>, code }  — nothing was added.
   Written on the person's own token (D53); the lead's owner is the IR for an IR or partner. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import type { CaptureCommand } from "@/server/leads/capture";
import { intakeConfigured, intakeRuntime } from "@/server/leads/intake-runtime";
import { bodyRefused, failure, jsonBody, NO_STORE } from "@/server/leads/intake-http";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;

async function post_(req: Request) {
  if (!intakeConfigured()) return Response.json({ error: "Leads are added to Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const b = await jsonBody(req, MAX_BODY);
  if (!b.ok) return bodyRefused(b.status, "added");
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await intakeRuntime().intake.add({ credential: s.credential, sessionId: sid }, req.headers.get("idempotency-key"), b.body as unknown as CaptureCommand, req.signal);
  if (r.ok) return Response.json({ leadId: r.value.leadId, ownerId: r.value.ownerId, replayed: r.replayed }, { headers: NO_STORE });
  /* a missing Introduced_By field is its own answer (J11 is not built in the org yet), not a generic refusal */
  if (r.kind === "refused" && r.reasonCode === "introducer-field-missing") {
    return Response.json({ error: `Not added — ${r.reason}.`, code: r.reasonCode }, { status: 422, headers: NO_STORE });
  }
  return failure(r, "Not added");
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads");
