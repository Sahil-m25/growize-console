/* GET /api/leads/[id]/gate — the finance gate on the lead's next rung, read live (M08-S02-T01).
   200 → { leadId, done, gate, met, who: "fin"|"ir"|null, says, payment, holdUntil, docs, doer: "finance",
           mayConfirm: false, superUser }  — read-only for every seat; Finance clears gates in the IM portal.
   4xx → { error, code } */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { leadsConfigured, leadsRuntime } from "@/server/leads/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "session-changed": 401, "capability-missing": 403, "not-in-book": 403, "not-visible": 404, "source-invalid": 502 };

async function get_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!leadsConfigured()) return Response.json({ error: "The gate reads Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await leadsRuntime().gates.read({ credential: s.credential, sessionId: sid }, id, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: "The lead is unavailable.", code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/leads", get_), "/api/leads/[id]/gate");
