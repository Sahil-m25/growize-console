"use client";

/* ── DRAWERS.investorcopy — ir-console-redesigned.html:9131-9166 (investorCopyStatus),
   9179-9185 (investorCopyBody). Four short paragraphs — a status line, the account id if one
   exists, when and how a recorded copy was made, why the status is what it is, and a reminder that
   copying changes nothing about the lead itself — and nothing else the prototype has: no kv block,
   no "Local demo copy status." filler line, and no foot button (the prototype's own investorcopy
   drawer has none). The one thing this port adds on top, the manual "Copy to investor demo"
   recovery action (`canRecordInvestorCopy`/`copyInvestor`), stays: it is not in the prototype
   because live investor intake never exists there to fall behind in the first place, and it is
   also reachable from the xfer page's own register (`@/features/pay`), the same as the button
   below — this is the drawer's copy of the identical action, not a duplicate of the removed
   "Open lead" foot. */

import { canViewInvestorCopy, P } from "@/lib/selectors";
import { canRecordInvestorCopy, investorCopyEligibility, investorCopyOf } from "@/lib/investor-copy";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

export function InvestorCopyBody({ lead }: DrawerProps) {
  const { state, dispatch, saves, retrySave } = useConsole();
  if (!lead || !canViewInvestorCopy(state, lead)) return <div className="empty">Investor copy is unavailable for this lead.</div>;
  const l = state.LEADS.find((x) => x.id === lead.id)!, c = investorCopyOf(state, l), e = investorCopyEligibility(state, l);
  /* ir-console-redesigned.html:9161-9166's `investorCopyStatus` carries exactly these three
     labels; this port's own `investorCopyEligibility` (@/lib/investor-copy, not owned by this
     agent) does not surface the middle one directly, so it reads here off `e.eligible` instead of
     an unmatched fourth label. */
  const label = c ? "Local demo copy recorded" : e.eligible ? "Already present in portal · demo source" : "Waiting for Finance verification";
  const accountId = c?.accountId || e.accountId;
  const queued = saves?.find((s) => s.actor === state.WHO && s.id === l.id && s.label === "Investor copy (demo)");
  const permitted = canRecordInvestorCopy(state, l);
  return (
    <>
      <p className="sm">{label}. Local demo; live investor intake is not connected.</p>
      {accountId ? <p className="mono">{accountId}</p> : null}
      {c ? <p className="sm">{c.mode === "automatic" ? "Automatic demo projection" : "Manual demo recovery"} · {c.copiedAt}</p> : null}
      <p className="sm">{e.reason}</p>
      <p className="sm">The lead stays with {P(state.PEOPLE, l.own).n}. Copying does not close or allocate the investment.</p>
      {queued && !c ? (
        <p className="sm" role="status">{queued.status === "failed" ? "Copy save failed. Review and retry." : "Copy waiting for browser connection."}</p>
      ) : null}
      {!c && e.eligible && permitted ? (
        <button
          type="button" className="act" disabled={!!queued && queued.status !== "failed"}
          onClick={() => (queued?.status === "failed" ? retrySave(queued.key) : dispatch({ type: "copyInvestor", id: l.id }))}
        >
          {queued?.status === "failed" ? "Retry copy (demo)" : "Copy to investor demo"}
        </button>
      ) : null}
    </>
  );
}

registerDrawer("investorcopy", { lead: true, w: 430, title: () => "Investor copy", sub: (_s, a) => a.lead!.n, Body: InvestorCopyBody });
