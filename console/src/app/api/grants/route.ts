/* /api/grants — Digital Infrastructure (or an IR Manager, for their own IRs) grants pages by name (M03-S02-T01, D60).
     POST   { whom, page, cap }        add one capability ("view" first; any other adds "view")
     DELETE { whom, page, cap }        take one away (taking "view" takes the page)
     DELETE { whom, page }             reset the page to the seat's preset
   200 → { whom, page, grants: {page: caps}, consoleAccount }   4xx → { error, code } — nothing changed.
   On the granter's own Zoho token (the holder and both manager chains are read from Zoho Users); every
   change and every refusal is a Plane C grant-change line. Guarded: the Teams page (people). */
import { guardApi } from "@/server/access/guard";
import { grantService } from "@/server/access/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import type { GrantOp } from "@/server/access/grant-rules";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 4 * 1024;

async function change(req: Request, op: "add" | "remove-or-reset") {
  if (!zohoSignInConfigured()) return Response.json({ error: "Grants are stored once Zoho sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const raw = await req.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  if (raw.length <= MAX_BODY) {
    try { const p: unknown = JSON.parse(raw); body = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { body = null; }
  }
  if (!body || typeof body.whom !== "string" || typeof body.page !== "string" || (body.cap !== undefined && typeof body.cap !== "string")) {
    return Response.json({ error: "That is not a page and capability the console grants.", code: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  const gop: GrantOp = op === "add" ? "add" : body.cap === undefined ? "reset" : "remove";
  if (gop === "add" && body.cap === undefined) return Response.json({ error: "Name the capability to grant.", code: "bad-request" }, { status: 400, headers: NO_STORE });
  const r = await grantService().change(s.credential, s.session, { op: gop, whom: body.whom, page: body.page, ...(typeof body.cap === "string" ? { cap: body.cap } : {}) });
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal }, { status: r.status, headers: NO_STORE });
  return Response.json({ whom: r.whom, page: r.page, grants: r.grants, consoleAccount: r.consoleAccount }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/grants", (req: Request) => change(req, "add")), "/api/grants");
export const DELETE = withErrorCapture(guardApi("/api/grants", (req: Request) => change(req, "remove-or-reset")), "/api/grants");
