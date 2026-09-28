/* GET /api/queues/investors — the Investors side of Today for the signed-in seat (M05-S07, M05-S08).
   Money / paper / KYC seats and viewers → { queue: { side: "money", readOnly, rows, waiting, today, problems, asOf } }
     rows: claim ("Answer it"), hold, verify, remind, kyc ("Check it"), fema — no amount on any row.
   KAM / Head of AM → { queue: { side: "am", book, rows, waiting, today, tiles: { goneQuiet, accountsHeld,
     ticketsOpenOnYou, conversationsLogged }, accounts, tickets, problems, asOf } } — no money field at all.
   An IR, a channel partner or an IR Manager → 403. Rows are read live and never cached: a done item is gone on the
   next read. Answering a claim stays /api/claims/[id]. Server: server/queues/queue.ts. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, queueFailure, queuesContext } from "@/server/queues/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  const c = await queuesContext();
  if (!c.ok) return c.response;
  const r = await c.queues.today(c.principal, req.signal);
  if (!r.ok) return queueFailure(r);
  return Response.json({ queue: r.queue }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/queues", get_), "/api/queues/investors");
