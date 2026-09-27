/* /api/auth/zoho — "Continue with Zoho". Phase 1 stub: phase 2 turns this into the Zoho OAuth
   redirect and callback (every human on their own seat and token, D53). Until then it says so —
   except outside fixture mode and outside production, where `ZOHO_STUB_USER="Full Name|email|seat"`
   (@/lib/data/stub-user) names the one person this button signs in, so the empty product can be
   walked seat by seat. The session then holds that person and seat; /api/data adds them to the
   empty book for as long as it lasts. */
import { cookies } from "next/headers";
import { signInAdmits } from "@/lib/data/admission";
import { clockDay, kolkataNow } from "@/lib/data/clock";
import { emptyDataset } from "@/lib/data/empty";
import { encodeSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/data/session";
import { parseStubUser, stubAllowed, withStubUser } from "@/lib/data/stub-user";

export const dynamic = "force-dynamic";

const PHASE2 = "Zoho sign-in is connected in phase 2.";
const stub = () => Response.json({ wired: false, message: PHASE2 }, { status: 501 });

export const GET = stub;

export async function POST() {
  const raw = process.env.ZOHO_STUB_USER;
  if (!stubAllowed() || !raw) return stub();
  const r = parseStubUser(raw);
  if (!r.ok) return Response.json({ wired: false, message: r.error }, { status: 500 });
  const now = kolkataNow();
  const ds = withStubUser(emptyDataset(clockDay(now), now), r.user);
  if (!signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, r.user.key)) {
    return Response.json({ wired: false, message: "No console access: this seat signs in only once Digital Infrastructure grants it a page." }, { status: 403 });
  }
  const session = { who: r.user.key, seat: r.user.seat };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(session), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE_S });
  return Response.json({ wired: true, session });
}
