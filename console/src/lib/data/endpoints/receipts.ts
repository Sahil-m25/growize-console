/* M10-S02-W1 — "Match it": POST /api/receipts/[id]/match { expectedModifiedTime } (server/money/match).
   Live: the route (Head of Finance / super user, never the recorder; 409 when the row changed).
   Fixture: the reducer's matchReceipt, which applies the same second-hand rule to the demo book. */

import type { MatchView } from "@/server/money/match";
import type { ClaimDetail, ClaimRow, ConfirmView, NotThereView } from "@/server/money/claim-answer";
import { CMODE, CREF, UNIT, I, claimsOpen, dueBy, gotBy, isSuper, may, nOpen, safeNote, who } from "@/lib/im";
import { fail, ok, type ApiResult, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type MatchArgs = { id: string; expectedModifiedTime: string | null };
export type Matched = Pick<MatchView, "receiptId" | "state">;

export const receiptMatch: WriteEndpoint<ImBook, MatchArgs, Matched, ImDispatch> = {
  method: "POST",
  path: a => `/api/receipts/${encodeURIComponent(a.id)}/match`,
  body: a => ({ expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => (j as { match: MatchView }).match,
  fixture: (b, d, a) => imFixtureWrite(b, d, { type: "matchReceipt", tid: a.id }, { receiptId: a.id, state: "matched" as const }),
  onLiveError: imLiveError,
};

/* ── M10-S03-W1 — Finance answers an IR's payment report (GET /api/claims, GET /api/claims/[id],
   POST /api/claims/[id]/confirm, POST /api/claims/[id]/not-there; server/money/claim-answer).
   Live: the routes (the "pay" capability only; the super user sees the drawer with Finance named as the doer).
   Fixture: the demo book's open "claim" INBOX notes and the reducer's confirmClaim / rejectClaim.
   (This section is separate from the match pilot above so another agent's claim/receipt reads add beside it.) ── */

export type ClaimList = { claims: ClaimRow[]; superUser: boolean };
export type ClaimOne = { claim: ClaimDetail };

/** claim-answer.ts SUPER_USER_NOTE / notFoundText — the words, not a value import from @/server */
const SUPER_NOTE = "You are here as the super user. Finance answers this report.";
const NOT_FOUND = "Finance did not find it";
const NOT_FINANCE = () => fail(403, "not-finance", "Finance answers the IR's payment reports.");

/** the demo note's kind / mode / ref, read from its words the way the reducer's confirmClaim reads them */
function claimFacts(b: ImBook, n: ReturnType<typeof claimsOpen>[number]) {
  const txt = (n.d || "") + " " + (n.t || "");
  const mode = (txt.match(CMODE) || [])[1];
  const ref = (txt.match(CREF) || [])[1] || null;
  const x = I(b.s, b.me, n.inv);
  const kind: ClaimRow["kind"] = /\bin full\b|\bbalance\b/i.test(txt) || gotBy(b.s, b.me, n.inv) > 0 ? "balance" : "advance";
  const amt = x ? (kind === "advance" ? Math.round(x.units * UNIT * 0.1) : dueBy(b.s, b.me, n.inv)) : 0;
  const allot = (b.s.data.ALLOT || []).find(a => a.Customer === n.inv);
  const row: ClaimRow = { claimId: n.id, leadId: "", allotmentId: allot ? allot.id : "", kind, mode: mode ? mode.toUpperCase() : "RTGS",
    amountRupees: amt, saidOn: n.at, byId: n.ir };
  return { row, ref, x };
}

export const claimList: ReadEndpoint<ImBook, void, ClaimList> = {
  path: () => "/api/claims",
  pick: j => j as ClaimList,
  fixture(b) {
    if (!may(b.s, b.me, "pay")) return NOT_FINANCE();
    const claims = claimsOpen(b.s).filter(n => { const x = I(b.s, b.me, n.inv); return !!x && x.st !== "lapsed"; }).map(n => claimFacts(b, n).row);
    return ok({ claims, superUser: isSuper(b.s, b.me) });
  },
};

export const claimOne: ReadEndpoint<ImBook, string | null, ClaimOne> = {
  path: id => (id ? `/api/claims/${encodeURIComponent(id)}` : null),
  pick: j => j as ClaimOne,
  fixture(b, id) {
    if (!may(b.s, b.me, "pay")) return NOT_FINANCE();
    const n = b.s.data.INBOX.find(y => y.id === id && y.kind === "claim");
    if (!n) return fail(404, "not-a-claim", "This is not an IR's payment report.");
    const { row, ref, x } = claimFacts(b, n);
    if (!x) return fail(403, "not-visible", "This report is not available to you.");
    if (!nOpen(b.s, n)) return fail(409, "already-answered", "Finance has already answered this report.");
    const su = isSuper(b.s, b.me);
    return ok({ claim: { ...row, investorId: n.inv, byName: who(b.s, n.ir).n || null, words: safeNote(b.s, b.me, n.d),
      refLastFour: ref ? ref.slice(-4) : null, alreadyInRupees: gotBy(b.s, b.me, n.inv), outstandingRupees: dueBy(b.s, b.me, n.inv),
      holdUntil: x.hold ?? null, doer: "Finance", superUser: su, superUserNote: su ? SUPER_NOTE : null, offers: ["confirm", "not-there"] } });
  },
};

/** ref: the bank reference Finance found (the report keeps only its last four); the fixture's reducer reads the note's own. */
export type ConfirmArgs = { id: string; ref: string; receivedOn?: string };
export type Confirmed = Pick<ConfirmView, "claimId" | "answered" | "linked">;
export const claimConfirm: WriteEndpoint<ImBook, ConfirmArgs, Confirmed, ImDispatch> = {
  method: "POST",
  path: a => `/api/claims/${encodeURIComponent(a.id)}/confirm`,
  body: a => ({ ref: a.ref, ...(a.receivedOn ? { receivedOn: a.receivedOn } : {}) }),
  idempotent: true,
  pick: j => (j as { confirm: ConfirmView }).confirm,
  fixture: (b, d, a): ApiResult<Confirmed> => imFixtureWrite(b, d, { type: "confirmClaim", nid: a.id }, { claimId: a.id, answered: true, linked: true }),
  onLiveError: imLiveError,
};

/** reason: why it is not there yet (≤ 500) — the route requires it; the fixture's reducer defaults it. */
export type NotThereArgs = { id: string; reason: string };
export type Answered = Pick<NotThereView, "claimId" | "says" | "duplicate">;
export const claimNotThere: WriteEndpoint<ImBook, NotThereArgs, Answered, ImDispatch> = {
  method: "POST",
  path: a => `/api/claims/${encodeURIComponent(a.id)}/not-there`,
  body: a => ({ reason: a.reason }),
  pick: j => (j as { answer: NotThereView }).answer,
  fixture: (b, d, a): ApiResult<Answered> => imFixtureWrite(b, d, { type: "rejectClaim", nid: a.id, ...(a.reason.trim() ? { why: a.reason.trim() } : {}) },
    { claimId: a.id, says: `${NOT_FOUND}: ${a.reason.trim() || "Not in the account yet"}`, duplicate: false }),
  onLiveError: imLiveError,
};
