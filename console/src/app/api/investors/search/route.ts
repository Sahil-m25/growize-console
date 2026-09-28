/* GET /api/investors/search?q=<name, ARL code, city or phone digits>&farm=<LLP id> — the Investors page search box
   (M09-S07-T01, D69). Only `q` and `farm` are read; a request naming another module or its own criteria is refused
   before anything is read; an owner filter is ignored — the book is the caller's, on the caller's own token (D53).
   200 → { book, hits: [{ id, name, code, city, phoneLast4 }], more, farmId }   · never the full number
   4xx → { error, code } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import { createInvestorSearch, investorSearchRequestOf } from "@/server/investors/search";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = {
  "invalid-request": 400, "term-too-short": 400, "module-refused": 403, "capability-missing": 403, "scope-drift": 403, "source-invalid": 502,
};

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { rt, crm, principal } = c.ctx;
  const asked = investorSearchRequestOf(new URL(req.url).searchParams);
  if (!asked.ok) {
    // The wall: nothing is read. Plane B keeps who and why, never what was typed.
    rt.events.refusal(principal.credential.userId, "investor-search", asked.reasonCode);
    return Response.json({ error: "Search finds your investors only.", code: asked.reasonCode }, { status: STATUS[asked.reasonCode] ?? 400, headers: NO_STORE });
  }
  const r = await createInvestorSearch({ crm, events: rt.events, log: rt.log, cache: rt.cache })
    .find({ credential: principal.credential, seat: principal.session.seat }, asked, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: "No search.", code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors/search", get), "/api/investors/search");
