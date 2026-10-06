/* PUT /api/investors/[id]/details — change what the investor asked to change about themselves (saveDetails, D132).
   Body: { expectedModifiedTime: "<the record's version>", changes: { ph?, em?, city?, nominee? } }
   On the signed-in person's own token (D53): the Investors "details" right from the live session (a KAM only on their
   own account), then one PUT of Contacts.Mobile / Email / Mailing_City / Nominee_Name (+ Nominee_Relation when the
   nominee reads "Name (Relation)") with If-Unmodified-Since (server/investors/care saveDetails). Not the name and not the
   address: D132 (owner decision). Never an identity field.
   200 → { contactId, fields, modifiedTime } · 400 invalid-request · 403 seat-denied, not-visible, not-yours · 409 conflict ·
   503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { careAnswer, careBody, tooLong } from "@/server/investors/care-http";

export const dynamic = "force-dynamic";

async function put_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const b = await careBody(req);
  if ("tooLong" in b) return tooLong();
  const { careService } = await import("@/server/investors/care-runtime");
  const { principal } = c.ctx;
  return careAnswer(await (await careService(c.ctx)).saveDetails({ credential: principal.credential, sessionId: principal.sessionId }, id, b.body, req.signal));
}

export const PUT = withErrorCapture(guardApi("/api/investors/[id]/details", put_), "/api/investors/[id]/details");
