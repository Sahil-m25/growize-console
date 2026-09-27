/* /api/session — who is signed in (M03-S01-T04).
   GET    → { session: {who, seat} | null }
   POST   → { who } signs in as a listed person. Fixture mode only: outside it the only door is
            Zoho OAuth (/api/auth/zoho, phase 2), and no person can be picked.
   DELETE → signs out (clears the cookie). */
import { cookies } from "next/headers";
import { admitted } from "@/lib/data/admission";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/data/session";
import { fixtureSource } from "@/lib/data/source";
import { fixtureModeOn } from "@/lib/fixture-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  return Response.json({ session: decodeSession(jar.get(SESSION_COOKIE)?.value) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!fixtureModeOn()) return Response.json({ error: "Zoho sign-in is connected in phase 2." }, { status: 403 });
  const body: unknown = await req.json().catch(() => null);
  const who = body && typeof body === "object" ? (body as { who?: unknown }).who : null;
  if (typeof who !== "string") return Response.json({ error: "who is required" }, { status: 400 });
  const ds = await fixtureSource.load();
  if (!admitted(ds).includes(who)) return Response.json({ error: "No console access" }, { status: 403 });
  const session = { who, seat: ds.PEOPLE[who]!.seat };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(session), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return Response.json({ session });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ session: null });
}
