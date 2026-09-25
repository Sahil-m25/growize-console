import { fixtureModeOn, signinList } from "../../../../lib/fixture-mode";

export async function GET() {
  return fixtureModeOn() ? Response.json(signinList()) : new Response("Not found", { status: 404 });
}
