/* GET /api/leads/[id]/hints — the IR's word on this lead's paperwork (M12-S11-T03), for Finance beside its queue.
   Read on the viewer's own token (D53): Zoho's sharing decides whether this seat sees the lead at all.
   ?paper=nda|supplementary narrows to the one document open (a hint about another paper never shows).
   200 → { hints: [{ leadId, round, paper, by: { id, name }, at, words }], note: "That is what they were told, not a signature." }
   503 → { error, code, fallback: "age-order" } — the IR's side could not be read. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { hintReader } from "@/server/leads/email-runtime";
import { hintForDocument, NOT_A_SIGNATURE, NO_WORD, type DocPaper } from "@/server/leads/hints";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };
const PAPERS: readonly string[] = ["nda", "fema", "supplementary", "allocation-letter"];

async function get_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let reader: ReturnType<typeof hintReader>;
  try { reader = hintReader(); } catch {
    return Response.json({ error: "Hints are read from Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  }
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const paper = new URL(req.url).searchParams.get("paper");
  if (paper !== null && !PAPERS.includes(paper)) return Response.json({ error: "Unknown paper.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const r = await reader.byLeads(s.credential, [id], req.signal);
  if (!r.ok) return Response.json({ error: "The IR's side could not be read.", code: r.errorKind, fallback: "age-order" }, { status: 503, headers: NO_STORE });
  const all = r.hints.get(id) ?? [];
  const hints = paper === null ? all : [hintForDocument({ paper: paper as DocPaper, leadId: id }, all)].filter((h) => h !== null);
  return Response.json({ hints, note: hints.length ? NOT_A_SIGNATURE : NO_WORD }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/leads/[id]/hints", get_), "/api/leads/[id]/hints");
