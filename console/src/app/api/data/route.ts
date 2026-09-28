/* GET /api/data — the one read every page hydrates from (D45: nothing kept client-side between loads). */
import { loadPayload } from "@/lib/data/source";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get() {
  return Response.json(await loadPayload(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(get, "/api/data");
