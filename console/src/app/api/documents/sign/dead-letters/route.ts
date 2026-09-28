/* GET /api/documents/sign/dead-letters — M12-S05-T01 (TC-IM07-017): the Zoho Sign callbacks that failed or were refused —
   time, reason code, request id (only for a verified body), retryable. Ids and codes only. Digital Infrastructure (di/ops) only. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get() {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const seat = c.ctx.principal.session.seat;
  if (seat !== "di" && seat !== "ops") return Response.json({ error: "The callback dead-letter list belongs to Digital Infrastructure.", code: "seat-denied" }, { status: 403, headers: NO_STORE });
  const { signDeadLetters } = await import("@/server/zoho-sign/runtime");
  return Response.json({ deadLetters: signDeadLetters().slice(-200) }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/sign/dead-letters");
