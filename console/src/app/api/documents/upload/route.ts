/* POST /api/documents/upload — M12-S02-T02: file one paper straight to Zoho on the uploader's own token.
   Query: scope=personal|allotment|project|lead · id=<record id> · slot=<typed slot key, optional> · name=<file name>
          · expected=<record Modified_Time, required with a slot>
   Headers: Content-Type = the file's type (PDF, JPEG, PNG) · Idempotency-Key = one per chosen file (a second press reuses it)
   Body: the file's bytes, 20 MB at most (MAX_UPLOAD_BYTES; over it → 413, a type off the allow-list → 415, both before a byte is read or sent). Held in memory for the one Zoho call, then zeroed — never written to disk.
   200 → { uploaded } · 400/403/409/413/415 → { error, code } nothing sent · 503 → { error: "Not saved yet", code } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  "invalid-request": 400, "idempotency-key-invalid": 400, "idempotency-key-reused": 409, "seat-denied": 403, "unknown-slot": 400,
  "too-large": 413, "empty": 400, "type-not-allowed": 415, "type-mismatch": 415, "not-in-book": 403, "not-visible": 403,
  "record-changed": 409, "busy": 409,
};

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal, rt } = c.ctx;
  const { documentUploader } = await import("@/server/documents/runtime");
  const { isAllowedUploadType, mayUpload, MAX_UPLOAD_BYTES, UPLOAD_MESSAGE, UPLOAD_MODULE } = await import("@/server/documents/upload");
  const { readLimitedBytes } = await import("@/server/documents/upload-body");
  const q = new URL(req.url).searchParams;
  const scope = q.get("scope") ?? "";
  const seat = principal.session.seat;
  const refuse = (code: keyof typeof UPLOAD_MESSAGE) => {
    rt.log.refusal({ at: Date.now(), actor: { kind: "user", userId: principal.credential.userId }, action: "document-upload", reason: code, recordIds: [] });
    return Response.json({ error: UPLOAD_MESSAGE[code], code }, { status: STATUS[code] ?? 400, headers: NO_STORE });
  };
  // Refuse before reading a byte: unknown scope, a seat that files nothing here, or a declared size over the limit.
  if (!Object.hasOwn(UPLOAD_MODULE, scope)) return refuse("invalid-request");
  if (!mayUpload(seat, scope as never)) return refuse("seat-denied");
  // M18-S15-H4: a type outside the allow-list is 415 before the body is read (the uploader re-checks the bytes).
  if (!isAllowedUploadType(req.headers.get("content-type"))) return refuse("type-not-allowed");
  const body = await readLimitedBytes(req, MAX_UPLOAD_BYTES, req.signal);
  if (!body.ok) return refuse(body.reason === "payload-too-large" ? "too-large" : body.reason === "empty" ? "empty" : "invalid-request");
  const r = await documentUploader().commit({ credential: principal.credential, seat }, {
    scope: scope as never, recordId: q.get("id") ?? "", slot: q.get("slot") || null, fileName: q.get("name") ?? "",
    contentType: req.headers.get("content-type") ?? "", bytes: body.bytes, expectedModifiedTime: q.get("expected"),
  }, req.headers.get("idempotency-key"), req.signal);
  if (r.ok) return Response.json({ uploaded: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind, retry: "same-key", unknownOutcome: r.unknownOutcome }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/documents", post), "/api/documents/upload");
