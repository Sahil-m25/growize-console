/* POST /api/leads/import — load rows of a CSV, tagged to an event, with no consent (M04-S04, cluster C3).
   Header: Idempotency-Key (one per file press; a retried press replays the rows that landed and writes only the rest).
   Body: { eventId, ownerId?, rows: [{ name, mobile, email?, city?, units? }] } — at most 200 rows a call.
   Each row is one capture (server/leads/capture): source Events, the event's lookup, no consent whatever the file says,
   owner by the seat (an IR's rows are always the IR's own).
   200 → { added, refused, rows: [{ row, status: "added", leadId, ownerId, replayed } | { row, status: "refused", reason, message }] }
   A bad row is its own verdict and never stops the good ones. 4xx → { error, code } — nothing was loaded. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import type { ImportInput } from "@/server/leads/intake";
import { intakeConfigured, intakeRuntime } from "@/server/leads/intake-runtime";
import { bodyRefused, failure, jsonBody, NO_STORE } from "@/server/leads/intake-http";

export const dynamic = "force-dynamic";
const MAX_BODY = 256 * 1024;

async function post_(req: Request) {
  if (!intakeConfigured()) return Response.json({ error: "Files are loaded into Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const b = await jsonBody(req, MAX_BODY);
  if (!b.ok) return bodyRefused(b.status, "loaded");
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await intakeRuntime().intake.importRows({ credential: s.credential, sessionId: sid }, req.headers.get("idempotency-key"), b.body as unknown as ImportInput, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  return failure(r, "Not loaded");
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/import");
