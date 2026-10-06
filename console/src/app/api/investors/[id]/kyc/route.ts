/* POST /api/investors/[id]/kyc — Compliance passes or fails an investor's KYC (passKyc / failKyc, D132).
   Body: { expectedModifiedTime: "<the record's version>", result: "passed"|"failed", why? }
   On the signed-in person's own token (D53): the Investors "kyc" right from the live session (Compliance, the super user),
   a pass only with a PAN and (unless non-resident) an Aadhaar reference on file — asked as COQL presence tests, no value
   read (rule 7) — then one guarded PUT of Contacts.KYC ("Completed" | "Failed") and KYC_Completed_On; a failure's reason
   as a Note on the Contact (server/investors/care decideKyc).
   200 → { contactId, kyc, on, noteId, modifiedTime } · 400 invalid-request · 403 seat-denied, not-visible · 409 conflict ·
   422 no-pan, no-aadhaar · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { careAnswer, careBody, tooLong } from "@/server/investors/care-http";

export const dynamic = "force-dynamic";

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const b = await careBody(req);
  if ("tooLong" in b) return tooLong();
  const { careService } = await import("@/server/investors/care-runtime");
  const { principal } = c.ctx;
  return careAnswer(await (await careService(c.ctx)).decideKyc({ credential: principal.credential, sessionId: principal.sessionId }, id, b.body, req.signal));
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/kyc", post_), "/api/investors/[id]/kyc");
