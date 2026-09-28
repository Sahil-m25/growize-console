/* GET /api/activity/history?module=Leads&id=<record id> — one record's history, read live from Zoho's
   __timeline on the signed-in person's own token: exactly one Zoho call (M15-S03-T05, TC-E11-013).
   Which fields changed, who and when — never the values. 404 when Zoho does not show the record to them. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { recordHistory } from "@/server/activity/sources";
import { userCrm } from "@/server/activity/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const MODULES = new Set(["Leads", "Contacts", "Cases", "Receipts", "ARL_Transactions", "LLP_UnitAllocation_Module", "LLP_Creation_Module", "ARL_Holdings", "Investor_Updates"]);

async function get(request: Request): Promise<Response> {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const q = new URL(request.url).searchParams;
  const module = q.get("module") ?? "", id = q.get("id") ?? "";
  if (!MODULES.has(module) || !/^\d{15,22}$/.test(id)) return Response.json({ error: "Ask by module and record id." }, { status: 400, headers: NO_STORE });
  const r = await recordHistory(userCrm(), s.credential, module, id, request.signal);
  if (!r.ok) {
    const status = r.error === "not-found" || r.error === "forbidden" ? 404 : 503;
    return Response.json({ error: status === 404 ? "This record's history is not available to you." : "Zoho is not answering. Try again." }, { status, headers: NO_STORE });
  }
  return Response.json({ entries: r.entries, more: r.more }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/activity", get), "/api/activity/history");
