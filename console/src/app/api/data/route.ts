/* GET /api/data — the one read every page hydrates from (D45: nothing kept client-side between loads). */
import { loadPayload } from "@/lib/data/source";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await loadPayload(), { headers: { "Cache-Control": "no-store" } });
}
