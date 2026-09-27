/* GET /api/data/version — fixture mode only: moves whenever a fixture is applied or reset, so an
   open page re-hydrates without a reload (the UI-case runner applies fixtures after page load). */
import { fixtureModeOn, fixtureVersion } from "@/lib/fixture-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!fixtureModeOn()) return new Response("Not found", { status: 404 });
  return Response.json({ version: fixtureVersion() }, { headers: { "Cache-Control": "no-store" } });
}
