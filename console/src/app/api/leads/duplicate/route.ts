/* POST /api/leads/duplicate — "is this number already in my book?", asked while the mobile is typed (M04-S02, cluster C3).
   Body: { mobile } — in the body, never the URL. Asked on the person's own token, so it can only find a lead they may see.
   200 → { status: "none" } | { status: "own"|"visible", leadId, firstName }   (the number itself is never returned or logged)
   4xx → { error, code }. A number held in a book the person cannot see is stopped later, at the write, without a name. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import { intakeConfigured, intakeRuntime } from "@/server/leads/intake-runtime";
import { bodyRefused, failure, jsonBody, NO_STORE } from "@/server/leads/intake-http";

export const dynamic = "force-dynamic";
const MAX_BODY = 1024;

async function post_(req: Request) {
  if (!intakeConfigured()) return Response.json({ error: "Numbers are checked against Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const b = await jsonBody(req, MAX_BODY);
  if (!b.ok) return bodyRefused(b.status, "checked");
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await intakeRuntime().duplicates.lookup({ credential: s.credential, sessionId: sid }, b.body.mobile as string, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  return failure(r, "Not checked");
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/duplicate");
