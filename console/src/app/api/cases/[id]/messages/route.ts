/* GET /api/cases/[id]/messages — the ticket thread: the Notes on the Case, oldest first (M13-S05-W1).
   200 { caseId, messages: [{ id, kind: "reply" | "note", text, at, by: { id, name } | null }], truncated } — "reply" is a
   Note the person's seat sent through POST /reply (title "Reply to the investor"); "note" is any other Note on the Case.
   at is naive IST (rule 9). An identity-shaped value in the text is masked. Read on the person's own token; the same reach as
   the register. 403 not your seat · 404 not found or not yours · 502/503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createCaseMessages } from "@/server/cases/messages";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function get(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createCaseMessages({ crm: c.ctx.crm, events: c.ctx.events })
    .forCase({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ caseId: r.caseId, messages: r.messages, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/cases/[id]/messages", get), "/api/cases/[id]/messages");
