/* GET /api/investors/mine — an IR's Investors list (M09-S08, D69, D113 ruling 2): the investors that came from the
   signed-in IR's own leads (Contacts.Originating_IR = me, Origin_Lead present), read on their own token with the IR's
   own filter in the WHERE and every row re-admitted by the IR guard. Columns only: id, ARL code, name, farms (name,
   block, units), state, lead link. The rows carry no price, amount, yield, receipt, phone, email, address or identity field.
   Any seat but the IR is refused 403 by the list itself (no Zoho call). Nothing kept (D45).
   D137 ruling 3: `chase` — the IR's balance to-do: each Reserved allotment not yet converted in full (farm, units, Hold_Until,
   days left). D138: `due` = Total_Amount_Receivable − Total_Amount_Received as Zoho returns them on the IR's token (null where
   hidden; `dueReadable` says whether any was shown), `fromDay` = the day Finance confirmed the 10% (the 30 days count from it).
   200 → { rows: [{ id, code, name, farms, state, leadId }], truncated, chase, dueReadable }   · 403 → { error, code } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { createIrInvestorList } = await import("@/server/investors/ir-list");
  const { rt, crm, principal } = c.ctx;
  const r = await createIrInvestorList({ crm, events: rt.events }).list(principal.credential, principal.session.seat, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ rows: r.rows, truncated: r.truncated, chase: r.chase ?? [], dueReadable: r.dueReadable ?? false }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors/mine", get), "/api/investors/mine");
