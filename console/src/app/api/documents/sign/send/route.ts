/* POST /api/documents/sign/send — M12-S04-T04: send one paper through Zoho Sign on the sender's own token.
   Template: Content-Type application/json, body { paper, recordId, method: "aadhaar"|"email-otp", templateId, expectedModifiedTime }.
   Uploaded PDF: Content-Type application/pdf, the bytes as the body (20 MB at most), and the query
     paper, id, method, expected (Modified_Time), name (file name), page, x, y, w, h (the signature box Finance placed).
   Header Idempotency-Key: one per Send press (a second press reuses it and gets the first answer).
   200 → { sent } · 400/403/409 → { error, code } nothing sent · 503 → { error: "Not saved yet", code, recalled } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = {
  "invalid-request": 400, "idempotency-key-invalid": 400, "idempotency-key-reused": 409, "seat-denied": 403, "not-visible": 403,
  "already-on-file": 409, "already-out": 409, "nda-first": 409, "no-agreed-draft": 409, "aadhaar-not-for-nri": 409, "aadhaar-needs-template": 409, "no-recipient": 409,
  "record-changed": 409, "busy": 409, "template-shape": 409,
};

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime, signPersonConfigured } = await import("@/server/zoho-sign/runtime");
  if (!signPersonConfigured()) return Response.json({ error: "Sending for signature is not connected yet.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const { SEND_MESSAGE } = await import("@/server/zoho-sign/send");
  const { mayActOnPaper, isPaper, SEND_BELONGS_TO } = await import("@/server/zoho-sign/papers");
  const { MAX_UPLOAD_BYTES } = await import("@/lib/zoho/client");
  const seat = principal.session.seat;
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const q = new URL(req.url).searchParams;
  let input: Parameters<ReturnType<typeof signPersonRuntime>["sender"]["commit"]>[1];
  if (type === "application/json") {
    let b: Record<string, unknown>;
    try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: SEND_MESSAGE["invalid-request"], code: "invalid-request" }, { status: 400, headers: NO_STORE }); }
    if (isPaper(b?.paper) && !mayActOnPaper(seat, b.paper)) return Response.json({ error: SEND_BELONGS_TO, code: "seat-denied" }, { status: 403, headers: NO_STORE });
    input = { paper: b.paper as never, recordId: String(b.recordId ?? ""), method: b.method as never, expectedModifiedTime: String(b.expectedModifiedTime ?? ""),
      source: { kind: "template", templateId: String(b.templateId ?? "") } };
  } else if (type === "application/pdf") {
    const paper = q.get("paper");
    // Refuse before reading a byte when the seat does not send this paper.
    if (!isPaper(paper) || !mayActOnPaper(seat, paper)) return Response.json({ error: isPaper(paper) ? SEND_BELONGS_TO : SEND_MESSAGE["invalid-request"], code: isPaper(paper) ? "seat-denied" : "invalid-request" }, { status: isPaper(paper) ? 403 : 400, headers: NO_STORE });
    const { readLimitedBytes } = await import("@/server/documents/upload-body");
    const body = await readLimitedBytes(req, MAX_UPLOAD_BYTES, req.signal);
    if (!body.ok) return Response.json({ error: SEND_MESSAGE["invalid-request"], code: body.reason }, { status: body.reason === "payload-too-large" ? 413 : 400, headers: NO_STORE });
    const n = (k: string) => Number(q.get(k));
    input = { paper, recordId: q.get("id") ?? "", method: (q.get("method") ?? "") as never, expectedModifiedTime: q.get("expected") ?? "",
      source: { kind: "pdf", fileName: q.get("name") ?? "document.pdf", bytes: body.bytes, field: { page: n("page"), x: n("x"), y: n("y"), width: n("w"), height: n("h") } } };
  } else {
    return Response.json({ error: SEND_MESSAGE["invalid-request"], code: "invalid-request" }, { status: 415, headers: NO_STORE });
  }
  const r = await signPersonRuntime().sender.commit({ credential: principal.credential, seat }, input, req.headers.get("idempotency-key"), req.signal);
  if (r.ok) return Response.json({ sent: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode, ...(r.requestId ? { requestId: r.requestId } : {}) }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind, recalled: r.recalled, retry: "same-key" }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/documents", post), "/api/documents/sign/send");
