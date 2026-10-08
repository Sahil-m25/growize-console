/* Server-only composition for /api/receipts and /api/receipts/prepare (M08-S03-T04): the M01-S08 replay
   service (one per process — its in-flight guards are process state), the M10-S07 allotment guard in front of
   it, and commit()'s own guard (server/money/record-receipt).

     RECEIPT_IDEMPOTENCY_SECRET        ≥ 32 bytes: derives the durable Idempotency_Key stored on the receipt
     RECEIPT_CONTEXT_SIGNING_SECRET    ≥ 32 bytes, distinct: seals the prepared allotment context
     ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured

   Who records: the Investors-side "pay" capability of the seat the live session holds now (Finance Operations,
   Head of Finance, super user) — the same check /api/investors/add-paid makes. What they record is matched at once
   when the paper allows it (D113 ruling 1: Finance's record is Finance's approval). */
import { sharedState } from "@/server/state/runtime";
import { createZohoClient } from "@/lib/zoho/client";
import type { RecordReceipt } from "@/server/money/record-receipt";

export const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

/** What keeps receipts (and payment reports) switched off, by variable NAME — never a value (B-06a). Empty when configured. */
export function receiptsConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (!/^\d{6,16}$/.test(env.ZOHO_CRM_RECORD_ID_PREFIX ?? "")) out.push("ZOHO_CRM_RECORD_ID_PREFIX is missing or not 6–16 digits");
  for (const k of ["RECEIPT_IDEMPOTENCY_SECRET", "RECEIPT_CONTEXT_SIGNING_SECRET"] as const) {
    const v = env[k];
    if (typeof v !== "string" || !v) out.push(`${k} is missing`);
    else if (Buffer.byteLength(v, "utf8") < 32) out.push(`${k} is shorter than 32 bytes`);
  }
  if (env.RECEIPT_IDEMPOTENCY_SECRET && env.RECEIPT_IDEMPOTENCY_SECRET === env.RECEIPT_CONTEXT_SIGNING_SECRET) {
    out.push("RECEIPT_IDEMPOTENCY_SECRET and RECEIPT_CONTEXT_SIGNING_SECRET are the same value; they must differ");
  }
  return out;
}

let toldOnce = false;
export function receiptsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const problems = receiptsConfigProblems(env);
  if (problems.length && !toldOnce) {
    toldOnce = true;
    // the server log says exactly what to set (names and rules only); the page says receipts are switched off
    console.error(`[receipts] switched off: ${problems.join("; ")}. /api/receipts/** and Finance's /api/claims/** answer 503 not-configured until this is fixed.`);
  }
  return problems.length === 0;
}

/** The page's words while receipts are switched off (503 not-configured): honest, and no setting named to a browser. */
export const RECEIPTS_OFF = "receipts are switched off on this server (its receipt secrets are not set). Tell Digital Infrastructure.";

const G = globalThis as typeof globalThis & { __gzRecordReceipt?: RecordReceipt };
export async function recordReceipt(env: NodeJS.ProcessEnv = process.env): Promise<RecordReceipt> {
  if (G.__gzRecordReceipt) return G.__gzRecordReceipt;
  const { createReceiptReplayService } = await import("@/server/money/receipt-replay");
  const { createAllotmentReceiptWrites } = await import("@/server/money/allotment-receipts");
  const { createRecordReceipt } = await import("@/server/money/record-receipt");
  const { dataRuntime } = await import("@/server/data/zoho-source");
  const { userSessions } = await import("@/server/oauth/runtime");
  const { zohoSeatOf } = await import("@/server/data/live");
  const { seatAccess } = await import("@/server/access/policy");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const mayPay = async (userId: string, sid: string): Promise<boolean> => {
    const now = await userSessions(env).credential(sid);
    if (!now.ok || now.credential.userId !== userId) return false;
    const seat = zohoSeatOf(now.session.seat);
    return !!seat && seatAccess(seat, now.session.who, {}).imCan("pay");
  };
  const sessionIds = new WeakMap<object, string>();
  const replay = createReceiptReplayService({
    crm, log: rt.log, recordIdPrefix,
    idempotencySecret: env.RECEIPT_IDEMPOTENCY_SECRET!,
    contextSigningSecret: env.RECEIPT_CONTEXT_SIGNING_SECRET!,
    session: { async recheck(cred, sid) { const now = await userSessions(env).credential(sid); return now.ok && now.credential.userId === cred.userId; } },
    permission: { async recheck(cred) { const sid = sessionIds.get(cred); return !!sid && mayPay(cred.userId, sid); } },
    state: sharedState(),
  });
  /* M01-S08-NOTE-6: sign-out / change of person aborts this person's queued replays before the session is destroyed */
  const { onSessionEnd } = await import("@/server/oauth/session-end");
  onSessionEnd((who, sid) => replay.discardSession(who, sid));
  const writes = createAllotmentReceiptWrites({ crm, replay, log: rt.log, recordIdPrefix });
  return (G.__gzRecordReceipt = createRecordReceipt({
    replay: {
      prepare: (p, allotmentId, signal) => { sessionIds.set(p.credential, p.sessionId); return replay.prepare(p, allotmentId, signal); },
    },
    writes: {
      record: (p, command, signal) => { sessionIds.set(p.credential, p.sessionId); return writes.record(p, command, signal); },
    },
    authority: { mayRecord: (cred, sid) => mayPay(cred.userId, sid) },
    // D113: a Finance seat's receipt is matched as it is recorded — through "Match it" (server/money/match), lazily
    // composed so the two share one match service per process.
    match: { async match(p, id, body, signal) { const { receiptMatch } = await import("@/server/money/runtime"); return (await receiptMatch(env)).match(p, id, body, signal); } },
    log: rt.log,
    recordIdPrefix,
    state: sharedState(),
  }));
}

/** A failure as the drawer shows it: every answer that is not a confirmed id reads "Not saved yet". */
export function failureResponse(r: { kind: string; reasonCode?: string; message: string; errorKind?: string; retryable: boolean }): Response {
  const status = r.kind === "refused"
    ? ({ "read-only": 403, "permission-changed": 403, "session-changed": 401, "actor-changed": 401, "allotment-not-visible": 403, "busy": 429,
        "idempotency-key-invalid": 400, "invalid-request": 400, "context-token-invalid": 400, "source-invalid": 502 } as Record<string, number>)[r.reasonCode ?? ""] ?? 409
    : r.kind === "unknown-outcome" ? 503 : r.retryable ? 503 : 502;
  return Response.json({ error: r.message, code: r.reasonCode ?? r.errorKind ?? r.kind, saved: false, retry: r.retryable }, { status, headers: NO_STORE });
}
