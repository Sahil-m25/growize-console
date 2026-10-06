/* D132 — the one way the care routes answer (server/investors/care). Bodies carry a code and the in-page words, never a
   value and never a Zoho body; every answer is no-store (D45). */
import { CARE_STATUS, CARE_TEXT, type CareResult } from "./care";
import { NO_STORE } from "./http";

export const CARE_MAX_BODY = 4 * 1024;

export function careAnswer<V>(r: CareResult<V>): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: CARE_TEXT[r.reason], code: r.reason }, { status: CARE_STATUS[r.reason], headers: NO_STORE });
  if (r.kind === "conflict") return Response.json({ error: "Changed by someone else — reload.", code: "conflict" }, { status: 409, headers: NO_STORE });
  return Response.json({ error: "Not saved — Zoho is not answering. Try again.", code: r.errorKind }, { status: 503, headers: NO_STORE });
}

/** The request body: null when it is over the limit or not JSON (the service refuses null as invalid-request). */
export async function careBody(req: Request): Promise<{ raw: string; body: unknown } | { tooLong: true }> {
  const raw = await req.text().catch(() => "");
  if (raw.length > CARE_MAX_BODY) return { tooLong: true };
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  return { raw, body };
}
export const tooLong = (): Response => Response.json({ error: "Not saved — that is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
