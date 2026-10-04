/* M08-S03-W1 — money in.
     leadClaimRead   GET  /api/leads/[id]/claim     (server/leads/claim)    the latest report and Finance's answer (M10-S03)
     leadClaim       POST /api/leads/[id]/claim     (server/leads/claim)    the IR reports "the investor says they paid"
     receiptPrepare  POST /api/receipts/prepare     (server/money/record-receipt)  seal the allotment's live context
     receiptRecord   POST /api/receipts             (server/money/record-receipt)  Finance records the receipt, per-press Idempotency-Key
   Recording money is always allowed; only matching is gated (D21, rule 3) — so nothing here refuses on unsigned paper:
   the record's answer carries `matchable` / `matchNote` and the page says matching waits. When the paper allows, a
   Finance seat's receipt is matched as it is recorded (D113 ruling 1; `state: "matched"`).
   (endpoints/receipts.ts stays the Match pilot; the record drawer's two writes live here so that file is untouched.) */

import type { ClaimStateView, ClaimView } from "@/server/leads/claim";
import type { Prepared, RecordedReceipt } from "@/server/money/record-receipt";
import { claimFieldsError, claimOf, claimOpen, canClaim, claimWhy, openable } from "@/lib/selectors";
import { may, roundOf } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";
import { consoleFixtureWrite, NOT_YOURS, type ConsoleBook, type ConsoleDispatch } from "./lead";

/* ---- the IR's payment report ---------------------------------------------------------------- */
export type ClaimArgs = { id: string; kind: string; mode: string; amount: number; said_on: string; ref: string; note: string };
export type Reported = Pick<ClaimView, "claimId" | "state" | "says" | "row">;

export const leadClaim: WriteEndpoint<ConsoleBook, ClaimArgs, Reported, ConsoleDispatch> = {
  method: "POST",
  path: a => `/api/leads/${encodeURIComponent(a.id)}/claim`,
  body: a => ({ kind: a.kind, mode: a.mode, amount: a.amount, said_on: a.said_on, ref: a.ref, note: a.note }),
  pick: j => (j as { claim: ClaimView }).claim,
  fixture(state, dispatch, a) {
    const l = state.LEADS.find(x => x.id === a.id);
    if (!l || !openable(state).some(x => x.id === a.id)) return NOT_YOURS();
    /* the route judges the fields first (claimFieldsError's own words), then whether this lead may be reported on */
    const bad = claimFieldsError(state, { kind: a.kind, mode: a.mode, amount: a.amount, said_on: a.said_on, ref: a.ref, note: a.note });
    if (bad) return fail(422, "fields", bad);
    if (claimOpen(state, l.id)) return fail(409, "already-waiting", claimWhy(state, l));
    if (!canClaim(state, l)) return fail(409, "not-reportable", claimWhy(state, l));
    return consoleFixtureWrite(state, dispatch, { type: "claimPaid", id: a.id },
      next => (claimOf(next, a.id) ? null : fail(409, "not-reportable", "Nothing was reported.")),
      next => ({ claimId: claimOf(next, a.id)!.id, state: "waiting" as const,
        says: "Payment reported — waiting for Finance to find it in the bank." as const, row: "Waiting on Finance" as const }));
  },
};

/* M10-S03: what the lead page shows once Finance has answered. `answer: "not-found"` carries the reason in `says`
   ("Finance did not find it: <reason>"); a found answer says nothing (the gate's `payment.notFound` is true for both). */
export type ClaimRead = ClaimStateView;
export const leadClaimRead: ReadEndpoint<ConsoleBook, string | null, ClaimRead> = {
  path: id => (id ? `/api/leads/${encodeURIComponent(id)}/claim` : null),
  pick: j => (j as { claim: ClaimRead }).claim,
  fixture(state, id) {
    const l = state.LEADS.find(x => x.id === id);
    if (!l || !openable(state).some(x => x.id === l.id)) return NOT_YOURS();
    const c = claimOf(state, l.id);
    const answer = c && c.state === "notfound" ? "not-found" as const : c && c.state === "confirmed" ? "found" as const : null;
    return ok({ leadId: l.id, claimId: c ? c.id : null, state: !c ? "none" as const : c.state === "waiting" ? "waiting" as const : "answered" as const,
      answer, reason: answer === "not-found" ? c!.why || null : null, says: answer === "not-found" ? `Finance did not find it: ${c!.why || ""}` : null });
  },
};

/* ---- Record a receipt: prepare, then record ---------------------------------------------------- */
export type PrepareArgs = { allotmentId: string | null };
/* the fixture has no allotment context to seal: its `expected` is a placeholder the fixture record never reads; its preparedAt is the local clock
   (M01-S08: the demo's stand-in for the server's, so the five-minute offline rule behaves the same in both modes) */
export const receiptPrepare: WriteEndpoint<ImBook, PrepareArgs, Prepared, ImDispatch> = {
  method: "POST",
  path: () => "/api/receipts/prepare",
  body: a => ({ allotmentId: a.allotmentId }),
  pick: j => (j as { prepared: Prepared }).prepared,
  fixture: ({ s, me }) => {
    if (!may(s, me, "pay")) return fail(403, "read-only", "Read only — Finance Operations and the Head of Finance record money.");
    return ok({ preparedAt: Date.now(), contextToken: "fixture", expected: {} as Prepared["expected"], amountDueRupees: 0, matchable: true, matchNote: null });
  },
  onLiveError: imLiveError,
};

export type RecordArgs = { inv: string; allotmentId: string | null; kind: "advance" | "balance"; mode: string; ref: string; prepared: Prepared; queuedAt?: number | null };
export type Recorded = Pick<RecordedReceipt, "receiptId" | "state" | "matchable" | "matchNote">;
/** record-receipt MATCH_BLOCKED_TEXT — the same words (a client module cannot import the server's value) */
const MATCH_BLOCKED = "Recorded. It cannot be matched until the supplementary agreement is signed and verified.";

export const receiptRecord: WriteEndpoint<ImBook, RecordArgs, Recorded, ImDispatch> = {
  method: "POST",
  path: () => "/api/receipts",
  body: a => ({ allotmentId: a.allotmentId, kind: a.kind, mode: a.mode, ref: a.ref, prepared: a.prepared, ...(a.queuedAt != null ? { queuedAt: a.queuedAt } : {}) }),
  idempotent: true,
  pick: j => (j as { receipt: RecordedReceipt }).receipt,
  fixture(b, d, a) {
    const matchable = roundOf(b.s, b.me, a.inv, "supp").state === "done";
    /* D113 ruling 1: a Finance seat's receipt is matched as it is recorded, when the paper allows — the route and the
       reducer's recordPay agree (matched by the recorder; otherwise recorded pending with the note) */
    return imFixtureWrite(b, d, { type: "recordPay", id: a.inv, kind: a.kind, mode: a.mode, utr: a.ref, allot: a.allotmentId || undefined },
      { receiptId: "T-" + String(b.s.data.TSEQ + 1).padStart(4, "0"), state: matchable ? "matched" as const : "unmatched" as const, matchable, matchNote: matchable ? null : MATCH_BLOCKED });
  },
  onLiveError: imLiveError,
};
