/* POST /api/receipts/[id]/reveal — "Show the reference" on the Payments register (TC-E11-016, D13/D22/D68/D110, rule 7).
   Body optional: { why } — the reason chosen, a REVEAL_WHY code (server/identity/plane-c.ts); it is filed on the Plane C line,
   "unstated" when absent or not a known code (M15-S05-NOTE-1). The register sends every reference masked; this is the second, logged call, on the person's own token. A live
   step-up ("reveal") is asked first: 403 { code: "step-up", start } until the person has confirmed. The seat must hold the
   "bank" capability (Head of Finance, Finance Operations, the super user); every reveal — given or refused — is a Plane C
   line carrying the receipt id and never the value.
   200 → { reveal: { receiptId, mode, utr } } · 400 · 401 · 403 step-up / locked / not allowed / not visible · 502/503 Zoho.
   Server: server/money/reveal-ref.ts. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { requireStepUp } from "@/server/access/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, receiptsConfigured, RECEIPTS_OFF } from "../../compose";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  if (!receiptsConfigured()) return Response.json({ error: "Not shown — " + RECEIPTS_OFF, code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const { revealRef } = await import("@/server/money/runtime");
  let why: string | null = null;
  try { const b = (await req.json()) as { why?: unknown }; why = typeof b?.why === "string" ? b.why.slice(0, 80) : null; } catch { /* no body */ }
  const r = await (await revealRef()).reveal({ credential: s.credential, sessionId: sid }, (await params).id, req.signal, why);
  if (r.ok) return Response.json({ reveal: r.value }, { headers: NO_STORE });
  const status = r.kind === "refused" ? ({ "not-allowed": 403, "not-visible": 403, "invalid-request": 400, "source-invalid": 502 } as const)[r.reasonCode] : r.retryable ? 503 : 502;
  return Response.json({ error: r.message, code: r.kind === "refused" ? r.reasonCode : r.errorKind }, { status, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/receipts", requireStepUp("reveal", post_)), "/api/receipts/[id]/reveal");
