/* POST /api/leads/updates/read — mark groups of lead updates as seen (M15-S01, cluster C3).
   Body: { kinds: ["added"|"owner"|"stage"|"next-step"|"lost"|"consent"|"details", ...] }.
   Records the time in the person's own "last seen" (Plane C, the console's memory — not a business fact, D47); nothing in Zoho changes.
   It lives under /api/leads (not /api/updates, which is the investor-updates route) so the leads guard prefix covers it.
   200 → { ok: true }   4xx → { error, code }. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import type { UpdateKind } from "@/server/leads/updates";
import { intakeConfigured, intakeRuntime } from "@/server/leads/intake-runtime";
import { bodyRefused, jsonBody, NO_STORE } from "@/server/leads/intake-http";

export const dynamic = "force-dynamic";
const MAX_BODY = 1024;

async function post_(req: Request) {
  if (!intakeConfigured()) return Response.json({ error: "Updates are marked read once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const b = await jsonBody(req, MAX_BODY);
  if (!b.ok) return bodyRefused(b.status, "marked");
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  let r: { ok: boolean };
  try {
    r = await intakeRuntime().updates.markRead({ credential: s.credential, sessionId: sid }, b.body.kinds as UpdateKind[], req.signal);
  } catch {
    return Response.json({ error: "Not marked — the console could not save it. Try again.", code: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (r.ok) return Response.json({ ok: true }, { headers: NO_STORE });
  return Response.json({ error: "Not marked — the request is invalid or the session changed.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/updates/read");
