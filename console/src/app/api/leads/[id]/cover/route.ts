/* /api/leads/[id]/cover — hand the lead to its secondary for a set window (M08-S05-T01, D44).
   POST   { expectedModifiedTime, duration: "today"|"d3"|"w1"|"w2"|"back" } → start the window
   DELETE { expectedModifiedTime }                                          → end it
   200 → { leadId, coverById, coverUntil, modifiedTime }  (Zoho field sharing on Cover_By does the access, D123)
   4xx → { error: <the inline message>, code } — nothing changed. */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import type { CoverDuration, CoverResult } from "@/server/leads/cover";
import { leadsConfigured, leadsRuntime } from "@/server/leads/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 4 * 1024;
const STATUS: Record<string, number> = { "invalid-request": 400, "session-changed": 401, "capability-missing": 403, "not-yours-to-cover": 403,
  "not-yours-to-end": 403, "not-visible": 404, "lead-changed": 409, "lead-closed": 409, "no-secondary": 409, "no-cover": 409 };

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return null;
  try { const p: unknown = JSON.parse(raw); return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { return null; }
}
function answer(r: CoverResult): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function handle(req: Request, params: Promise<{ id: string }>, end: boolean) {
  if (!leadsConfigured()) return Response.json({ error: "Cover is written to Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const b = await body(req);
  if (!b) return Response.json({ error: "Nothing changed — the request is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const p = { credential: s.credential, sessionId: (await cookies()).get(SID_COOKIE)?.value ?? "" };
  const cover = leadsRuntime().cover;
  return answer(end
    ? await cover.end(p, id, b.expectedModifiedTime as string, req.signal)
    : await cover.start(p, id, b.expectedModifiedTime as string, b.duration as CoverDuration, req.signal));
}

const post_ = (req: Request, { params }: { params: Promise<{ id: string }> }) => handle(req, params, false);
const delete_ = (req: Request, { params }: { params: Promise<{ id: string }> }) => handle(req, params, true);

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/cover");
export const DELETE = withErrorCapture(guardApi("/api/leads", delete_), "/api/leads/[id]/cover");
