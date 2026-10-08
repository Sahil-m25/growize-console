/* GET /api/investors/finance — Finance's Investors list (M09-S01-T01, M08-S07-T02): one row per investor on
   the book (said-yes Contacts included) and the summary counts. Org-wide seats only; any other seat is
   refused by the list itself. Read live on the person's own token; nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { createFinanceInvestorList } = await import("@/server/investors/finance-list");
  const { rt, crm, principal } = c.ctx;
  const list = createFinanceInvestorList({ crm, cache: rt.cache, events: rt.events });
  const r = await list.list(principal.credential, principal.session.seat, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ rows: r.rows, summary: r.summary, truncated: r.truncated, statusHidden: r.statusHidden }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/finance");
