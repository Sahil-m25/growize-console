/* /api/statements — the weekly bank statement on the Payments page (M10-S05-T02, D21/D71).
   GET  → { latest: { statementId, name, from, to, lines, matched, needsOwner, reconciledAt } | null }  ("last reconciled")
   POST multipart/form-data, field "file" (the net-banking CSV, ≤ 2 MB) →
        { statement: { statementId, attachmentId, name, from, to, counts, matched: [...], needsOwner: [...] } }
        matched lines awaiting the match are matched by the Head of Finance through POST /api/receipts/[id]/match
        (suggestions only here). Finance only ("pay"): a KAM is refused 403 before anything is read or stored.
   The file is parsed in memory and streamed to Zoho as an attachment on the Statements record; nothing is kept
   on the server and no line, reference or narration is logged. Server: server/money/statements.ts. */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";

export const dynamic = "force-dynamic";
const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });
const MAX_REQUEST = 2 * 1024 * 1024 + 64 * 1024;

async function principal() {
  const s = await sessionCredential();
  if (!s.ok) return { ok: false as const, response: s.response };
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  return { ok: true as const, principal: { credential: s.credential, sessionId: sid } };
}

async function get_() {
  const { statementsConfigured, statements, moneyFailure } = await import("@/server/money/runtime");
  if (!statementsConfigured()) return Response.json({ latest: null, configured: false }, { headers: NO_STORE });
  const p = await principal();
  if (!p.ok) return p.response;
  const r = await (await statements()).latest(p.principal);
  if (r.ok) return Response.json({ latest: r.value, configured: true }, { headers: NO_STORE });
  return moneyFailure(r, NO_STORE);
}

async function post_(req: Request) {
  const { statementsConfigured, statements, moneyFailure } = await import("@/server/money/runtime");
  if (!statementsConfigured()) return Response.json({ error: "Not uploaded — the Statements module is not in Zoho yet.", code: "not-configured", saved: false }, { status: 503, headers: NO_STORE });
  const p = await principal();
  if (!p.ok) return p.response;
  const len = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(len) && len > MAX_REQUEST) return Response.json({ error: "The statement is larger than 2 MB. Upload one week's CSV from net banking.", code: "too-large", saved: false }, { status: 413, headers: NO_STORE });
  let file: { name: string; type: string; bytes: Uint8Array } | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f && typeof f === "object" && "arrayBuffer" in f) {
      const blob = f as File;
      if (blob.size <= MAX_REQUEST) file = { name: blob.name, type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) };
    }
  } catch { file = null; }
  const r = await (await statements()).upload(p.principal, file, req.signal);
  if (r.ok) return Response.json({ statement: r.value }, { headers: NO_STORE });
  return moneyFailure(r, NO_STORE);
}

export const GET = withErrorCapture(guardApi("/api/statements", get_), "/api/statements");
export const POST = withErrorCapture(guardApi("/api/statements", post_), "/api/statements");
