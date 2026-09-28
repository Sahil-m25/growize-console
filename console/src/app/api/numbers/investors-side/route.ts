/* GET /api/numbers/investors-side[?section=cash|risk|paper|comp] — the Investors side of Numbers (M16-S08-T01,
   M16-S09-T01). Without a section: the sections this seat is offered (null = no Investors side switch). With one:
   that section, live from Zoho on the person's own token; Collection is a scope-keyed cached aggregate (D53).
   A money section asked for by a seat without Receipts read (KAM, Head of AM) is refused server-side, before any
   cache or Zoho read, and the refusal is written to Plane C. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, routeContext } from "@/server/cases/http";
import { authorityEvents } from "@/server/identity/authority";
import { createInvestorsSide, investorsSideFor } from "@/server/numbers/investors-side";

export const dynamic = "force-dynamic";

const REFUSED: Readonly<Record<string, [number, string]>> = Object.freeze({
  "invalid-request": [400, "That is not a Numbers section."],
  "no-book": [403, "This section is not part of your seat."],
  "money-hidden": [403, "Money figures are Finance only."],
});

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const section = new URL(req.url).searchParams.get("section");
  if (!section) return Response.json({ side: investorsSideFor(c.ctx.seat, c.ctx.credential.userId) }, { headers: NO_STORE });
  const { dataRuntime } = await import("@/server/data/zoho-source");
  const { documentsSignStatus } = await import("@/server/documents/runtime");
  const a = authorityEvents();
  const r = await createInvestorsSide({ crm: c.ctx.crm, cache: c.ctx.cache, log: dataRuntime().log, signStatus: documentsSignStatus(), refusedAction: (w, s, x) => a.refusedAction(w, s, x) })
    .read({ credential: c.ctx.credential, seat: c.ctx.seat }, section, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") {
    const [status, error] = REFUSED[r.reason] ?? [403, "Refused."];
    return Response.json({ error, code: r.reason }, { status, headers: NO_STORE });
  }
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind, lastGoodAt: r.lastGoodAt }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/numbers/investors-side", get), "/api/numbers/investors-side");
