/* GET /api/data — the one read every page hydrates from (D45: nothing kept client-side between loads). */
import { loadPayload } from "@/lib/data/source";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

/* M01-S09-T02: every answer carries `fresh` (source, last good read, failed, tone — the contract of
   @/lib/data/freshness); a primary-book failure is a 503 with that block, never an empty or old book. */
async function get() {
  const { serveWithFreshness } = await import("@/server/data/freshness");
  // LiveReadError (server/data/zoho-source) by name, so fixture mode never loads the live source.
  const r = await serveWithFreshness(() => loadPayload(), (e) => e instanceof Error && e.name === "LiveReadError");
  return Response.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(guardApi("/api/data", get), "/api/data");
