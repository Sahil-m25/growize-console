/* GET /api/investors/am/managers — the account-management list (M09-S04-T03, M09-S02-T03): the Key Account Managers with
   their accounts, Tier A, gone quiet, conversations and tickets open; the shared pool; and the AM row list the Investors
   page shows. A KAM gets their own row only (no pool); the Head of AM gets everyone. Any other seat is refused 403.
   200 → { managers: [{ id, name, left, accounts, tierA, goneQuiet, conversations, openTickets, onConcern }], pool: { accounts,
           tierA, goneQuiet, shouldBeNamed } | null, accounts: [{ id, code, name, city, nri, units, tier, kamUserId, introduced,
           lastHeardAt, lastMood, overdue }], book: "kam" | "head", problems, asOf }
   No Receipt, price, amount or identity field. Read live on the person's own token; nothing is cached. Server: server/investors/am-service.ts. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE } from "@/server/investors/http";
import { amServiceContext, amServiceFailure } from "@/server/investors/am-runtime";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await amServiceContext();
  if (!c.ok) return c.response;
  const r = await c.service.read(c.principal, req.signal);
  if (!r.ok) return amServiceFailure(r);
  const { managers, pool, accounts, book, problems, asOf } = r.view;
  return Response.json({ managers, pool, accounts, book, problems, asOf }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors/am", get), "/api/investors/am/managers");
