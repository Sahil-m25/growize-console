/**
 * Route-side composition for /api/payouts (M10-S20-T02): the reads per request on the live context, and one
 * process-wide mark-paid and schedule job (their double-press and per-allotment guards are process state).
 * The seat is re-read from the live session on every call (./authority): a seat changed mid-session loses
 * the capability at once. Every answer is no-store; bodies carry codes, never values.
 */
import type { UserCredential } from "../../lib/zoho/client";
import type { LiveContext } from "../data/zoho-source";
import type { MarkPaid } from "./mark-paid";
import type { PayoutScheduleJob } from "./schedule";
import { payoutCapsOf, type PayoutCaps } from "./authority";

export const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/** A fresh capability check for the session behind this credential. */
export async function liveCaps(sessionId: string, cred: UserCredential, env: NodeJS.ProcessEnv = process.env): Promise<PayoutCaps> {
  const { userSessions } = await import("../oauth/runtime");
  const now = await userSessions(env).credential(sessionId);
  if (!now.ok || now.credential.userId !== cred.userId) return { read: false, pay: false };
  return payoutCapsOf(now.session.seat, now.session.who);
}

export async function payoutReads(ctx: LiveContext, env: NodeJS.ProcessEnv = process.env) {
  const { createPayoutReads } = await import("./queue");
  const sid = ctx.principal.sessionId;
  return createPayoutReads({ crm: ctx.crm, log: ctx.rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX ?? "",
    mayRead: async (cred) => (await liveCaps(sid, cred, env)).read });
}

const G = globalThis as typeof globalThis & { __gzMarkPaid?: MarkPaid; __gzPayoutJob?: PayoutScheduleJob; __gzPayoutSid?: WeakMap<object, string> };
const sids = () => (G.__gzPayoutSid ??= new WeakMap<object, string>());

/** The process-wide mark-paid; the session id rides beside the credential for the fresh pay check. */
export async function markPaid(ctx: LiveContext, env: NodeJS.ProcessEnv = process.env): Promise<MarkPaid> {
  sids().set(ctx.principal.credential, ctx.principal.sessionId);
  if (G.__gzMarkPaid) return G.__gzMarkPaid;
  const { createMarkPaid } = await import("./mark-paid");
  return (G.__gzMarkPaid = createMarkPaid({ crm: ctx.crm, log: ctx.rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX ?? "",
    mayPay: async (cred) => { const sid = sids().get(cred); return !!sid && (await liveCaps(sid, cred, env)).pay; } }));
}

export async function scheduleJob(ctx: LiveContext, env: NodeJS.ProcessEnv = process.env): Promise<PayoutScheduleJob> {
  if (G.__gzPayoutJob) return G.__gzPayoutJob;
  const { createPayoutScheduleJob } = await import("./schedule");
  return (G.__gzPayoutJob = createPayoutScheduleJob({ crm: ctx.crm, log: ctx.rt.log, recordIdPrefix: env.ZOHO_CRM_RECORD_ID_PREFIX ?? "" }));
}

/** A read or job failure as an HTTP answer: refusals 403 (never "not found"), bad input 400, Zoho 503. */
export function readFailure(r: { readonly kind: string; readonly reason?: string; readonly errorKind?: string }): Response {
  if (r.kind === "refused") {
    const status = r.reason === "invalid-request" ? 400 : r.reason === "source-invalid" ? 502 : 403;
    return Response.json({ error: status === 403 ? "Read only — payouts are Finance's." : "Reload the page and try again.", code: r.reason ?? "refused" }, { status, headers: NO_STORE });
  }
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind ?? "source-error" }, { status: 503, headers: NO_STORE });
}

/** A mark-paid failure as the drawer shows it. */
export function writeFailure(r: { kind: string; reasonCode?: string; message: string; errorKind?: string; retryable: boolean; paidOn?: string | null }): Response {
  const status = r.kind === "refused"
    ? ({ "read-only": 403, "not-visible": 403, busy: 429, "idempotency-key-invalid": 400, "invalid-request": 400, fields: 400, "utr-required": 400,
        "tds-out-of-range": 400, "paid-on-future": 400, "source-invalid": 502 } as Record<string, number>)[r.reasonCode ?? ""] ?? 409
    : r.retryable ? 503 : 502;
  return Response.json({ error: r.message, code: r.reasonCode ?? r.errorKind ?? r.kind, saved: false, retry: r.retryable,
    ...(r.paidOn !== undefined ? { paidOn: r.paidOn } : {}) }, { status, headers: NO_STORE });
}
