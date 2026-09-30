/* GET /api/leads/search?q=<word or phone>[&module=Leads|Contacts] — the top-bar search (M06-S03), scoped by the
   seat (D110, M06-S03-W2; server/leads/seat-search): an IR their own book, an IR Manager the team, Digital
   Infrastructure and the business owner org-wide over leads AND investors, Finance/KAM/Head of AM investors within
   their scope. The Contacts wall (M06-S05) holds for the IR seats: a request of theirs naming another module or its
   own criteria is refused before anything is read. An owner filter is ignored — the book is the caller's, on the
   caller's own token (D53).
   200 → { book, investorBook, hits: [{ kind: "lead", id, name, phoneLast4, stage, ownerId, mine }
                                    | { kind: "investor", id, name, code, city, phoneLast4 }], more }
         · never the full number (D60)
   4xx → { error, code } */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { dataRuntime } from "@/server/data/zoho-source";
import { createSeatSearch, searchPlanOf, seatSearchRequestOf } from "@/server/leads/seat-search";
import { leadsConfigured, leadsRuntime } from "@/server/leads/runtime";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const STATUS: Record<string, number> = { "invalid-request": 400, "term-too-short": 400, "module-refused": 403, "session-changed": 401, "capability-missing": 403, "source-invalid": 502, "scope-drift": 403 };

async function get_(req: Request) {
  if (!leadsConfigured()) return Response.json({ error: "Search reads Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const plan = searchPlanOf(s.session.seat);
  const asked = seatSearchRequestOf(new URL(req.url).searchParams, plan);
  if (!asked.ok) {
    // The wall: nothing is read. Plane B keeps who and why, never what was typed.
    dataRuntime().log.refusal({ at: Date.now(), actor: { kind: "user", userId: s.credential.userId }, action: "lead-search", reason: asked.reasonCode, recordIds: [] });
    return Response.json({ error: plan.contactsWall ? "Search finds leads only." : "Search finds what your seat reads, and nothing else.", code: asked.reasonCode }, { status: STATUS[asked.reasonCode] ?? 400, headers: NO_STORE });
  }
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const search = createSeatSearch({
    leads: leadsRuntime().search,
    /* the investor half on the same person's own token (the live investors context), only for a seat that holds it */
    investors: async () => {
      const [{ investorsContext }, { createInvestorSearch }] = await Promise.all([import("@/server/investors/http"), import("@/server/investors/search")]);
      const c = await investorsContext();
      if (!c.ok) return null;
      const { rt, crm } = c.ctx;
      return createInvestorSearch({ crm, events: rt.events, log: rt.log, cache: rt.cache });
    },
  });
  const r = await search.find({ credential: s.credential, sessionId: sid, seat: s.session.seat }, { term: asked.term, only: asked.only }, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: "No search.", code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/leads/search", get_), "/api/leads/search");
