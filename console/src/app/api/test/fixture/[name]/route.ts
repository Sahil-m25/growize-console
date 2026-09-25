import { applyFixture, fixtureModeOn } from "../../../../../lib/fixture-mode";

export async function POST(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  if (!fixtureModeOn()) return new Response("Not found", { status: 404 });
  const { name } = await params;
  const key = applyFixture(decodeURIComponent(name));
  return key ? Response.json({ applied: key }) : new Response(`Unknown fixture ${name}`, { status: 404 });
}
