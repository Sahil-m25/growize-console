/* GET /api/investors/app-activity?ids=a,b,c — App activity (GC-1525): who has signed in to the investor app, and when.
   Reads the Contacts the investor app writes back to (App_First/Last_Sign_In_At, App_Sign_In_Count, App_Last_Failed_Sign_In_At,
   App_Failed_Sign_In_Count, plus App_Access, App_Welcome_At/Channel) on the signed-in person's own token (D53), for the ids asked
   (at most 200) that the seat may see: a KAM their own accounts, the Head of AM and Finance the book, an IR their own leads'
   investors. An id the seat may not see is simply absent. If Zoho has no sign-in columns yet the answer carries only the account
   facts and activityUnavailable: true; a column hidden from the seat by field security is left out of the read and named in hiddenFields (never a 502). Read only; nothing kept (D45). Timestamps and counts, never a value in a log.
   200 → { rows: [{ contactId, access, welcomeAt, welcomeChannel, firstSignInAt, lastSignInAt, signInCount, lastFailedAt, failedCount }],
           activityUnavailable, hiddenFields }  · 400 bad ids · 403 seat / scope · 502 Zoho refused · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const { createAppActivity } = await import("@/server/investors/app-activity");
  const { rt, crm, principal } = c.ctx;
  const r = await createAppActivity({ crm, events: rt.events }).read(principal.credential, principal.session.seat, ids, req.signal);
  if (r.ok) return Response.json({ rows: r.rows, activityUnavailable: r.activityUnavailable, hiddenFields: r.hiddenFields }, { headers: NO_STORE });
  if (r.kind === "refused" && r.reason === "invalid-request") return Response.json({ error: "Ask for at most 200 investors by id.", code: r.reason }, { status: 400, headers: NO_STORE });
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/investors/app-activity", get), "/api/investors/app-activity");
