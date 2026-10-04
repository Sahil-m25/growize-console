/* GET /api/documents/queue — M12-S11-NOTE-3: Finance's papers out for signature, ordered by what the IR says is back.
   On the viewer's own token (D53). Finance seats only (the seats that verify); anyone else is refused.
   200 → { queue: { rows: [DocRow + { leadId, hint }], outCount, irSideRead, note } }
        irSideRead false → the IR's side could not be read: rows are in age order and `note` says so.
   403 → { error, code } · 503 → { error, code } (the Documents read failed: no rows). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { rt, crm, principal } = c.ctx;
  const { documentsList } = await import("@/server/documents/runtime");
  const { hintReader } = await import("@/server/leads/email-runtime");
  const { createPaperworkQueue } = await import("@/server/documents/queue");
  let hints: ReturnType<typeof hintReader>;
  try { hints = hintReader(); } catch { return Response.json({ error: "The queue is read from Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE }); }
  const r = await createPaperworkQueue({ documents: documentsList(crm, rt.log), hints }).read(principal.credential, principal.session.seat, req.signal);
  if (r.ok) return Response.json({ queue: r.queue }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: "Finance works the paperwork queue.", code: r.reason }, { status: 403, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/queue");
