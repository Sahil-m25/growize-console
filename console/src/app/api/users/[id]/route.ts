/* /api/users/[id] — a seat change on Teams (M03-S04-T02, M17-S02-T01; D22/D40/D47/D60).
     PUT { seat }                 seat = an Investors seat key ("amlead", "kam", "head", "ops", "comp")
     PUT { seat, side: "lead" }   seat = a Leads seat key ("ir", "conv", "cp", "bu", "exec"): canGrant/seatClash
                                  decide it (an IR Manager gives only "ir"); 200 → { whom, from, to, side, overridesCleared }
   A live step-up ("seat", D22) is asked first: 403 { code: "step-up", start } until the person has confirmed.
   200 → { whom, from, to, returned, notReturned }   (returned = Contacts put back in the pool)
   4xx/5xx → { error, code } — 400 bad request · 403 own seat / super admin / not yours to move / your seat moved
   · 404 not a Zoho user you see · 409 already that seat · 502 Zoho refused · 503 Zoho not answering, the book
   unreadable (nothing changed) or the write unconfirmed ("unconfirmed").
   On the changer's own Zoho token (Users PUT role+profile, Contacts KAM cleared); the KAM's book is listed by
   the "kam-pool-return" service read. maySeat decides it (server/access/seat-change.ts); Plane C seat-change. */
import { guardApi } from "@/server/access/guard";
import { requireStepUp, seatChanges } from "@/server/access/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 1024;
type Ctx = { params: Promise<{ id: string }> };

async function put(req: Request, ctx: Ctx) {
  if (!zohoSignInConfigured()) return Response.json({ error: "Seats are changed once Zoho sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const raw = await req.text().catch(() => "");
  let seat: unknown = null, side: unknown = undefined;
  if (raw.length <= MAX_BODY) {
    try {
      const p: unknown = JSON.parse(raw);
      const o = p && typeof p === "object" && !Array.isArray(p) ? (p as { seat?: unknown; side?: unknown }) : null;
      seat = o ? o.seat : null; side = o ? o.side : undefined;
    } catch { seat = null; }
  }
  const r = await seatChanges().change(s.credential, s.session, { whom: id, to: seat, side });
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal }, { status: r.status, headers: NO_STORE });
  if ("side" in r) return Response.json({ whom: r.whom, from: r.from, to: r.to, side: r.side, overridesCleared: r.overridesCleared }, { headers: NO_STORE });
  return Response.json({ whom: r.whom, from: r.from, to: r.to, returned: r.returned.length, returnedIds: r.returned, notReturned: r.notReturned }, { headers: NO_STORE });
}

export const PUT = withErrorCapture(guardApi("/api/users", requireStepUp("seat", put)), "/api/users");
