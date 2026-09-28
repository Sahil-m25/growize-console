/**
 * Server-only composition for "Match it" (M10-S02, /api/receipts/[id]/match) and the claim answers
 * (M10-S03, /api/claims/**). One of each per process; nothing here holds records (D45).
 *
 *   match    — Head of Finance or the super user (lib/im/money.ts `mayMatch`), decided on the live session's seat;
 *   answers  — the Investors-side "pay" capability (Head of Finance, Finance Operations, super user), as recording is;
 *   publish  — server/contracts/runtime.ts publishToInvestorApp (the signed outbox; the stub until MA1).
 *
 * Needs what /api/receipts needs (receiptsConfigured): Zoho sign-in, ZOHO_CRM_RECORD_ID_PREFIX and the two receipt secrets.
 */
import { createZohoClient } from "../../lib/zoho/client";
import type { ReceiptMatch, Publish } from "./match";
import type { ClaimAnswers } from "./claim-answer";
import type { Statements } from "./statements";

type Seat = { readonly seat: string | null; readonly pay: boolean } | null;
const G = globalThis as typeof globalThis & { __gzReceiptMatch?: ReceiptMatch; __gzClaimAnswers?: ClaimAnswers; __gzStatements?: Statements };

async function parts(env: NodeJS.ProcessEnv) {
  const { dataRuntime } = await import("../data/zoho-source");
  const { userSessions } = await import("../oauth/runtime");
  const { zohoSeatOf } = await import("../data/live");
  const { seatAccess } = await import("../access/policy");
  const { createReceiptReplayService } = await import("./receipt-replay");
  const { createAllotmentReceiptWrites } = await import("./allotment-receipts");
  const { publishToInvestorApp } = await import("../contracts/runtime");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  /** The seat the live session holds now (a fresh check on every press). */
  const seatNow = async (userId: string, sid: string): Promise<Seat> => {
    const now = await userSessions(env).credential(sid);
    if (!now.ok || now.credential.userId !== userId) return null;
    const seat = zohoSeatOf(now.session.seat);
    return seat ? { seat, pay: seatAccess(seat, now.session.who, {}).imCan("pay") } : null;
  };
  // paymentStatus() never writes, so the replay service here is only the allotment guard's required partner.
  const replay = createReceiptReplayService({
    crm, log: rt.log, recordIdPrefix,
    idempotencySecret: env.RECEIPT_IDEMPOTENCY_SECRET!, contextSigningSecret: env.RECEIPT_CONTEXT_SIGNING_SECRET!,
    session: { async recheck() { return false; } }, permission: { async recheck() { return false; } },
  });
  const writes = createAllotmentReceiptWrites({ crm, replay, log: rt.log, recordIdPrefix });
  const publish: Publish = async (event) => publishToInvestorApp(event);
  return { rt, crm, recordIdPrefix, seatNow, writes, publish };
}

export async function receiptMatch(env: NodeJS.ProcessEnv = process.env): Promise<ReceiptMatch> {
  if (G.__gzReceiptMatch) return G.__gzReceiptMatch;
  const { createReceiptMatch } = await import("./match");
  const { rt, crm, recordIdPrefix, seatNow, writes, publish } = await parts(env);
  return (G.__gzReceiptMatch = createReceiptMatch({
    crm, writes, publish, log: rt.log, recordIdPrefix,
    authority: {
      async mayMatch(cred, sid) {
        const s = await seatNow(cred.userId, sid);
        return !!s && (s.seat === "head-of-finance" || s.seat === "digital-infrastructure");
      },
    },
  }));
}

export async function claimAnswers(env: NodeJS.ProcessEnv = process.env): Promise<ClaimAnswers> {
  if (G.__gzClaimAnswers) return G.__gzClaimAnswers;
  const { createClaimAnswers } = await import("./claim-answer");
  const { recordReceipt } = await import("../../app/api/receipts/compose");
  const { rt, crm, recordIdPrefix, seatNow, writes, publish } = await parts(env);
  const record = await recordReceipt(env);
  return (G.__gzClaimAnswers = createClaimAnswers({
    crm, record, writes, publish, log: rt.log, recordIdPrefix,
    authority: {
      async seatOf(cred, sid) {
        const s = await seatNow(cred.userId, sid);
        return { mayAnswer: !!s && s.pay, superUser: s?.seat === "digital-infrastructure" };
      },
    },
  }));
}

/** M10-S05: the Statements module's API name — set once Sahil makes it (M10-S05-T01); until then uploads answer 503. */
export function statementsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^\d{6,16}$/.test(env.ZOHO_CRM_RECORD_ID_PREFIX ?? "") && /^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(env.ZOHO_STATEMENTS_MODULE ?? "");
}

/** M10-S05 "Upload the bank statement": Finance ("pay") on the live session; the store is the Zoho Statements module. */
export async function statements(env: NodeJS.ProcessEnv = process.env): Promise<Statements> {
  if (G.__gzStatements) return G.__gzStatements;
  const { createStatements, createZohoStatementStore } = await import("./statements");
  const { dataRuntime } = await import("../data/zoho-source");
  const { userSessions } = await import("../oauth/runtime");
  const { zohoSeatOf } = await import("../data/live");
  const { seatAccess } = await import("../access/policy");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  return (G.__gzStatements = createStatements({
    crm, log: rt.log, recordIdPrefix,
    store: createZohoStatementStore({ crm, recordIdPrefix, module: env.ZOHO_STATEMENTS_MODULE }),
    authority: {
      async mayUpload(cred, sid) {
        const now = await userSessions(env).credential(sid);
        if (!now.ok || now.credential.userId !== cred.userId) return false;
        const seat = zohoSeatOf(now.session.seat);
        return !!seat && seatAccess(seat, now.session.who, {}).imCan("pay");
      },
    },
  }));
}

/** A refusal or failure as HTTP. Refusals by code; every non-confirmed answer says "Not saved yet"/"Not matched". */
export function moneyFailure(r: { kind: string; reasonCode?: string; errorKind?: string; message: string; retryable: boolean }, headers: HeadersInit): Response {
  const status = r.kind === "refused"
    ? ({ "not-matcher": 403, "not-finance": 403, "not-visible": 403, "same-hand": 403, "read-only": 403, "invalid-request": 400,
        "idempotency-key-invalid": 400, "session-changed": 401, "actor-changed": 401, "busy": 429, "source-invalid": 502,
        "reference-required": 422, "reason-required": 422, "fields": 422,
        "file-type": 415, "too-large": 413, "unreadable": 422, "too-many-refs": 422 } as Record<string, number>)[r.reasonCode ?? ""] ?? 409
    : r.retryable ? 503 : 502;
  return Response.json({ error: r.message, code: r.reasonCode ?? r.errorKind ?? r.kind, saved: false, retry: r.retryable }, { status, headers });
}
