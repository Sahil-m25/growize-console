/* POST /api/auth/step-up/release { allotmentId } — release a lapsed reservation (M01-S10-T04, D22).
   Needs a live step-up for "release" (requireStepUp), a seat with the release right, and Zoho's approval
   process (GZ_RELEASE_APPROVAL=on once Sahil has built it). The allotment's Allocation_Status → Cancelled
   is written on the person's own token with If-Unmodified-Since; Zoho's approval process holds it.
   200 → { allotmentId, state: "pending-approval" | "released" }   4xx/5xx → { error, code } — nothing changed. */
import { guardApi } from "@/server/access/guard";
import { releaseLapsedHold } from "@/server/access/lapse-release";
import { requireStepUp } from "@/server/access/runtime";
import { authorityEvents } from "@/server/identity/authority";
import { sessionCredential } from "@/server/oauth/request";
import { oauthParts } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { createZohoClient } from "@/lib/zoho/client";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function post_(req: Request) {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const raw = await req.text().catch(() => "");
  let id: unknown = null;
  try { id = raw.length <= 1024 ? (JSON.parse(raw) as { allotmentId?: unknown }).allotmentId : null; } catch { id = null; }
  if (typeof id !== "string") return Response.json({ error: "Name the reservation to release.", code: "bad-request" }, { status: 400, headers: NO_STORE });
  const o = oauthParts();
  const r = await releaseLapsedHold({
    crm: createZohoClient({ gate: o.gate, log: o.log, recordIdPrefix: o.recordIdPrefix }),
    as: s.credential, session: s.session, allotmentId: id, events: authorityEvents(),
    approvalConfigured: process.env.GZ_RELEASE_APPROVAL === "on",
  });
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal }, { status: r.status, headers: NO_STORE });
  return Response.json({ allotmentId: r.allotmentId, state: r.state }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/auth/step-up", requireStepUp("release", post_)), "/api/auth/step-up/release");
