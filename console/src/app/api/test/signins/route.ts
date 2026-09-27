import { admitted } from "@/lib/data/admission";
import { fixtureSource } from "@/lib/data/source";
import { fixtureModeOn } from "@/lib/fixture-mode";

export const dynamic = "force-dynamic";

/* GET /api/test/signins — the dev sign-in list: same people and order as the sign-in screen. */
export async function GET() {
  if (!fixtureModeOn()) return new Response("Not found", { status: 404 });
  const ds = await fixtureSource.load();
  return Response.json(admitted(ds).map((k) => ({ key: k, name: ds.PEOPLE[k]?.n ?? k })));
}
