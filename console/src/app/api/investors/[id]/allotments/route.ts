/* GET /api/investors/[id]/allotments — the investor's allotments, one row per LLP (M11-S02-T02): the
   Contacts→allotment related list on the person's own token, scoped by seat (KAM own book, IR own lead);
   money fields only for a seat whose record has Money. Read-only; nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createAllotmentReader } = await import("@/server/investors/allotments");
  const { rt, crm, principal } = c.ctx;
  const r = await createAllotmentReader({ crm, events: rt.events }).byContact(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ contactId: r.contactId, allotments: r.rows, money: r.money, paper: r.paper, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/[id]/allotments");
