import { fixtureModeOn, resetFixtures } from "@/lib/fixture-mode";

/* POST /api/test/reset — clear every applied fixture (fixture mode only). */
export async function POST() {
  if (!fixtureModeOn()) return new Response("Not found", { status: 404 });
  resetFixtures();
  return Response.json({ reset: true });
}
