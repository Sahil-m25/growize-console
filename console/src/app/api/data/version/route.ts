/* GET /api/data/version — fixture mode only: moves whenever a fixture is applied or reset, so an
   open page re-hydrates without a reload (the UI-case runner applies fixtures after page load). */
import { currentLane, fixtureModeOn, fixtureVersion } from "@/lib/fixture-mode";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get() {
  if (!fixtureModeOn()) return new Response("Not found", { status: 404 });
  return Response.json({ version: fixtureVersion(await currentLane()) }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = withErrorCapture(guardApi("/api/data/version", get), "/api/data/version");
