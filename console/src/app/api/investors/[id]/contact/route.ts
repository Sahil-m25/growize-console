/* POST /api/investors/[id]/contact — a KAM logs a conversation (logContact, D132). Header Idempotency-Key (one per press).
   Body: { expectedModifiedTime: "<the record's version>", channel: "call"|"visit"|"email"|"msg", mood: "good"|"ok"|"concern", note? }
   On the signed-in person's own token (D53): the Investors "care" right from the live session (a KAM only on their own
   account), an Issued allotment, then one Touch on the Contact's Origin_Lead (D76) — and Contacts.KAM_Intro_At, guarded,
   the first time the account's own KAM logs one (server/investors/care logContact).
   200 → { contactId, touchId, introduced, modifiedTime } · 400 invalid-request / idempotency-key-needed · 403 seat-denied,
   not-visible, not-yours · 409 conflict / sending · 422 not-allotted, no-origin-lead · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";
import { careAnswer, careBody, tooLong } from "@/server/investors/care-http";
import { CARE_TEXT } from "@/server/investors/care";

export const dynamic = "force-dynamic";
const KEY = /^[A-Za-z0-9_-]{8,128}$/;

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const b = await careBody(req);
  if ("tooLong" in b) return tooLong();
  const { careService, mayCare } = await import("@/server/investors/care-runtime");
  const { pressOnce } = await import("@/server/leads/followup-runtime");
  const { principal } = c.ctx;
  const p = { credential: principal.credential, sessionId: principal.sessionId };
  /* the right first: a seat without "care" is refused 403 before a key is asked for and before Zoho is touched
     (the service re-derives it again inside the press) */
  if (!(await mayCare(p.credential, p.sessionId, "care"))) return Response.json({ error: CARE_TEXT["seat-denied"], code: "seat-denied" }, { status: 403, headers: NO_STORE });
  const key = req.headers.get("Idempotency-Key") ?? "";
  if (!KEY.test(key)) return Response.json({ error: "Not saved — the press has no key.", code: "idempotency-key-needed" }, { status: 400, headers: NO_STORE });
  const service = await careService(c.ctx);
  const r = await pressOnce("inv-contact", { userId: principal.credential.userId, leadId: id, key }, b.raw, () => service.logContact(p, id, b.body, req.signal));
  if (!r.ok && "kind" in r && r.kind === "press") {
    const status = r.code === "busy" ? 409 : r.code === "key-reused" ? 422 : 503;
    return Response.json({ error: r.code === "busy" ? "That press is already being saved. Wait a moment." : r.code === "key-reused"
      ? "Not saved — that press key was used for a different request." : "Not saved — the console could not guard against a double press. Try again.",
      code: r.code === "busy" ? "sending" : r.code }, { status, headers: NO_STORE });
  }
  return careAnswer(r as Exclude<typeof r, { kind: "press" }>);
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/contact", post_), "/api/investors/[id]/contact");
