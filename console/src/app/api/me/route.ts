/* /api/me — my own display name and mobile, on my own Zoho user (M17-S05, D53; ZohoCRM.users.UPDATE).
   PATCH { name?, mobile? } → { name, mobile }  either alone (B-26); omitted = leave it (name answers null); mobile "" or null = clear it
   The user id is the signed-in credential's own: the request cannot name another user. The sign-in email is Zoho's and is
   refused (400 email-read-only). 4xx/5xx → { error, code } — nothing changed: 400 invalid · 409 session changed ·
   422 name too short or mobile not a number · 502 Zoho refused · 503 Zoho not configured. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { meConfigured, meRuntime } from "@/server/me/runtime";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "email-read-only": 400, "session-changed": 409, "name-too-short": 422, "invalid-mobile": 422 };

async function body(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  const raw = await req.text().catch(() => "");
  if (raw.length > 2048) return null;
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { return null; }
}

async function patch(req: Request) {
  if (!meConfigured()) return Response.json({ error: "Nothing changed — Zoho sign-in is not connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const b = await body(req);
  if (!b) return Response.json({ error: "Nothing changed — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const sessionId = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await meRuntime().profile.update({ credential: s.credential, sessionId },
    { ...("name" in b ? { name: b.name as string } : {}), ...("mobile" in b ? { mobile: b.mobile as string | null } : {}), ...("email" in b ? { email: b.email } : {}) }, req.signal);
  if (r.ok) {
    /* B-26: the session's own name / mobile follow what Zoho just accepted, so /api/session shows it on reload */
    try {
      const { userSessions } = await import("@/server/oauth/runtime");
      await userSessions().noteOwnProfile(sessionId, { ...(r.value.name ? { name: r.value.name } : {}), ...("mobile" in b ? { mobile: r.value.mobile } : {}) });
    } catch { /* the save stands; the next CurrentUser read brings it */ }
    return Response.json(r.value, { headers: NO_STORE });
  }
  if (r.kind === "refused") return Response.json({ error: `Nothing changed — ${r.reason}.`, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: "Nothing changed — Zoho did not accept it. Try again.", code: r.errorKind }, { status: 502, headers: NO_STORE });
}

export const PATCH = withErrorCapture(guardApi("/api/me", patch), "/api/me");
