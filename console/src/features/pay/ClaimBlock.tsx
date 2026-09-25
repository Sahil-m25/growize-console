"use client";

/* ── the payment-report relay's one block — `claimBlock()`, ir-console-redesigned.html:5494 ──
   One block, so a report reads identically on the lead, in the money drawer and on Finance's day.

   THE INVESTOR SAYS THEY HAVE PAID. That is a report, never a receipt. Finance still records money
   nowhere but the bank, and matching a report to an already-confirmed receipt (`confirmClaim`,
   5459-5468) never records a second one — it sets the report's own state, attaches the exact
   receipt `claimReceiptMatch` found, and appends to its history. A report Finance cannot match
   (no receipt yet, or more than one candidate) stays open and says why, on `b.match.why`.

   A claim cannot exist before the agreement it pays against — `canClaim` asks `suppOK` — and this
   block is a reading of the record, never a second place to type one. The reference prints masked,
   through the same store-wide `REFSEEN` reveal as Payments (`refTxt`/`RefButton`, ./common) — D42's
   own rule applies here exactly as it does to a recorded receipt.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { IMP } from "@/domain";
import type { Lead } from "@/domain";
import { claimBlock, isFin, may, P, refTxt } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { ProvL, RefButton } from "./common";

export function ClaimBlock({ l, actions = true }: { l: Lead; actions?: boolean }) {
  const { state, dispatch } = useConsole();
  const b = claimBlock(state, l, actions);
  if (!b) return null;
  const c = b.c;
  /* whether the match-refusal line reads at all is a raw Finance-role question, independent of
     `actions` — a read-only mirror of this block (the money drawer's, e.g.) still tells Finance
     why a report will not match, it just does not offer the button that would act on it. */
  const finReader = isFin(state.ROLE) && may(state, "pay", "record");

  return (
    <div className={`note ${c.state === "notfound" ? "due" : ""}`} style={{ margin: "0 0 12px" }}>
      <b>{P(state.PEOPLE, c.by).n} reported a payment</b>
      <p className="sm" style={{ margin: "6px 0" }}>{b.label} · {c.mode}{" "}
        <span className="mono">{refTxt(state, `claim:${l.id}`)}</span></p>
      <span className="sm">{c.id} · reported <span className="mono">{c.at}</span></span>
      {c.note ? <p className="sm" style={{ margin: "8px 0" }}>{c.note}</p> : null}
      <p className="sm" style={{ margin: "8px 0 0" }}>
        {c.state === "confirmed"
          ? <> Matched to a confirmed receipt by {P(state.PEOPLE, c.did!).n} <span className="mono">{c.on}</span> <ProvL />.</>
          : c.state === "notfound"
            ? <> {P(state.PEOPLE, c.did!).n} could not find it — {c.why} <span className="mono">{c.on}</span>.</>
            : <> Waiting on Finance to find it in the account.</>}
      </p>
      <RefButton k={`claim:${l.id}`} id={l.id} where="Payment reported" style={{ marginLeft: 6 }} />
      {b.answerable ? (
        <>
          <div className="chips" style={{ marginTop: 9 }}>
            <button type="button" className="chip on" disabled={!b.match.ok}
              title={!b.match.ok ? b.match.why : undefined}
              onClick={() => dispatch({ type: "confirmClaim", id: l.id })}
            >Match recorded receipt</button>
            <button type="button" className="chip"
              onClick={() => dispatch({ type: "rejectClaim", id: l.id, why: "Not in the account yet" })}
            >Not in the account yet</button></div>
          <p className="sm" style={{ margin: "7px 0 0" }}>Answered against the bank in the {IMP}; the IR
            sees the answer on their lead without asking anybody.</p>
        </>
      ) : b.reopenable && c.state === "notfound" ? (
        <div className="chips" style={{ marginTop: 9 }}>
          <button type="button" className="chip"
            onClick={() => dispatch({ type: "reopenClaim", id: l.id })}
          >Ask Finance to look again</button></div>
      ) : null}
      {c.state === "waiting" && finReader && !b.match.ok
        ? <p className="sm" style={{ margin: "10px 0 0" }}>{b.match.why}</p> : null}
      {c.matchError ? <p className="ux-date-error" role="alert">{c.matchError}</p> : null}
    </div>
  );
}
