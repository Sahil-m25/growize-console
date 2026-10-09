"use client";

/* ── DRAWERS.investorcopy — ir-console-redesigned.html:9131-9166 (investorCopyStatus),
   9179-9185 (investorCopyBody). A status line, the account id if one exists, when and how a recorded copy was made, why the
   status is what it is, and a reminder that the lead itself does not change.
   G3 / GC-1527 (D137, owner 9 Oct): the investor record is created ONLY when Finance confirms the 10%, on Finance's own token
   (server/investors/convert) — so there is no manual "Copy to investor" action any more, here or on Transfers. This drawer reads;
   it never writes. */

import { canViewInvestorCopy, P } from "@/lib/selectors";
import { investorCopyEligibility, investorCopyOf } from "@/lib/investor-copy";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

export function InvestorCopyBody({ lead }: DrawerProps) {
  const { state } = useConsole();
  if (!lead || !canViewInvestorCopy(state, lead)) return <div className="empty">Investor copy is unavailable for this lead.</div>;
  const l = state.LEADS.find((x) => x.id === lead.id)!, c = investorCopyOf(state, l), e = investorCopyEligibility(state, l);
  const label = c ? "Investor record created" : e.eligible ? "Already present on the Investors side" : "Waiting for Finance to confirm the 10%";
  const accountId = c?.accountId || e.accountId;
  return (
    <>
      <p className="sm">{label}.</p>
      {accountId ? <p className="mono">{accountId}</p> : null}
      {c ? <p className="sm">{c.mode === "automatic" ? "Created on Finance's confirmation" : "Recorded earlier"} · {c.copiedAt}</p> : null}
      <p className="sm">{e.reason}</p>
      <p className="sm">The lead stays with {P(state.PEOPLE, l.own).n}. The investor record is created by Finance when the 10% is confirmed — nobody copies a lead by hand (D137).</p>
    </>
  );
}

registerDrawer("investorcopy", { lead: true, w: 430, title: () => "Investor copy", sub: (_s, a) => a.lead!.n, Body: InvestorCopyBody });
