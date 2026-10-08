/* Shared by /api/claims/** (M10-S03): the session principal, the service and the answer shape. */
import { cookies } from "next/headers";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { NO_STORE, receiptsConfigured, RECEIPTS_OFF } from "../receipts/compose";

export { NO_STORE };

export async function claimsContext() {
  const s = await sessionCredential();
  if (!s.ok) return { ok: false as const, response: s.response };
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const { claimAnswers, moneyFailure, sessionMayPay } = await import("@/server/money/runtime");
  // The seat wall answers before the config check: a seat that may not answer reports learns nothing about Zoho (B-09).
  if (!(await sessionMayPay(sid, s.credential.userId))) return { ok: false as const, response: Response.json({ error: "Reports are answered by Finance.", code: "not-finance", saved: false }, { status: 403, headers: NO_STORE }) };
  if (!receiptsConfigured()) return { ok: false as const, response: Response.json({ error: "Reports cannot be answered yet — " + RECEIPTS_OFF, code: "not-configured", saved: false }, { status: 503, headers: NO_STORE }) };
  return { ok: true as const, answers: await claimAnswers(), principal: { credential: s.credential, sessionId: sid }, moneyFailure };
}

export async function jsonBody(req: Request, max = 4 * 1024): Promise<unknown> {
  const raw = await req.text().catch(() => "");
  if (!raw || raw.length > max) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
