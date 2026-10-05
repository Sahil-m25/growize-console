/* POST /api/kams/[userId]/move-book — move a whole book to another key account manager (R5; a KAM leaves, or rebalancing).
   Body: { toKamUserId: "<Zoho user id>", continueFrom?: "<Contact id>" }.
   Each Contact goes through the same guarded PUT as /api/investors/[id]/kam (server/investors/kam-assign: the live "assign"
   right, Key-Account-Manager-only assignee, Issued allotment, If-Unmodified-Since), on the person's own token. A book that
   does not fit the request deadline answers continueFrom = the first Contact not tried; POST again with it.
   200 → { moved: <count>, movedIds, notMoved: <ids>, reasons: {code: count}, continueFrom }
   403 → seat-denied / assignee-not-am · 400 → invalid-request, same-kam · 503 → Zoho not answering (nothing half-read).
   Bodies carry codes and ids, never names. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 1024;

async function post(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { userId } = await params;
  const raw = await req.text().catch(() => "");
  let body: unknown = null;
  if (raw.length <= MAX_BODY) { try { body = JSON.parse(raw); } catch { body = null; } }
  const { createKamMoveBook, parseMoveBook } = await import("@/server/investors/kam-move-book");
  const { kamServices } = await import("@/server/investors/kam-wiring");
  const k = await kamServices(c.ctx);
  const service = createKamMoveBook({ crm: k.crm, assignment: k.assignment, users: k.users, events: k.events, authority: k.authority });
  const { principal } = c.ctx;
  const r = await service.move({ credential: principal.credential, sessionId: principal.sessionId }, parseMoveBook(userId, body), req.signal);
  if (r.ok) return Response.json({ moved: r.value.moved.length, movedIds: r.value.moved, notMoved: r.value.notMoved, reasons: r.value.reasons, continueFrom: r.value.continueFrom }, { headers: NO_STORE });
  if (r.kind === "refused") {
    const bad = r.reason === "invalid-request" || r.reason === "same-kam";
    const error = r.reason === "assignee-not-am" ? "Only a key account manager can be named." : r.reason === "seat-denied" ? "Naming a key account manager is the Head of Account Management's." : "The request is not valid.";
    return Response.json({ error, code: r.reason }, { status: bad ? 400 : 403, headers: NO_STORE });
  }
  return Response.json({ error: "Zoho is not answering. Nothing more was moved; try again.", code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/kams", post), "/api/kams");
