"use client";

/* ── Investor copies — `vXfer()`, redesigned prototype line 9219 ───────────────────────────
   Copy status and the manual fallback, D43's local demo tracking of the three accounts the
   Investor Management portal already links by `INV.lead`. Below it, read-only, the legacy transfer
   register that predates the copy model — kept for history, never a second writer.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { Lead, XferRow } from "@/domain";
import { canViewInvestorCopy, may, openable, own, P, roleOf } from "@/lib/selectors";
import { canRecordInvestorCopy, investorCopyBook, investorCopyEligibility, investorCopyOf } from "@/lib/investor-copy";
import { xName } from "@/features/pay/reducer";
import { useConsole, type ConsoleState } from "@/lib/store";
import { useGo } from "@/features/pay/common";
import "@/features/lead/drawers/investor-copy";
import "./drawer";

/* xferRows() — redesigned prototype line ~9202. Historical rows carry no live ownership record to
   check; only an explicitly held elevated transfer scope (never a borrowed one) may read them. */
function xferRows(state: ConsoleState): XferRow[] {
  if (!may(state, "xfer", "view")) return [];
  const ids = new Set(openable(state).map(l => l.id));
  const history = ["exec","ops","corp","bu"].includes(roleOf(state.PEOPLE, state.WHO) || "") && own(state, "xfer", "view");
  return state.XFER.filter(x => x.state === "done" && (state.LEADS.some(l => l.id === x.lead)
    ? ids.has(x.lead) && canViewInvestorCopy(state, state.LEADS.find(l => l.id === x.lead) as Lead)
    : history));
}

export function XferPage() {
  const { state, dispatch, saves, retrySave } = useConsole();
  const go = useGo();
  if (!may(state,"xfer","view")) return <div className="empty">Investor copies are unavailable.</div>;

  const rows = investorCopyBook(state).map(l => ({l, c: investorCopyOf(state,l), e: investorCopyEligibility(state,l)}));
  const legacy = xferRows(state);

  return (
    <>
      <div className="ph"><h1>Investor copies</h1><span className="sub">Copy status and manual fallback</span>
        <button type="button" className="chip" onClick={() => dispatch({ type: "openDrawer", k: "p:xfer.how" })}>
          How copying works</button></div>
      <section className="ux-xfer ux-section">
        <div className="note">Signed agreements and Finance-confirmed payment of at least 10% trigger the
          copy. The lead remains with its IR. <span className="sm">Local demo; live intake is not connected.</span></div>
        <div className="card fill"><div className="ch"><h3>Investor copy status</h3></div>
          <div className="tw"><table>
            <thead><tr><th>Investor</th><th>Account link</th><th>Copy status</th><th>Manual fallback</th></tr></thead>
            <tbody>{rows.map(({l,c,e}) => {
              /* investorCopyStatus(l) — redesigned prototype 9131-9140: the label reads whether a
                 Finance source account is linked (e.accountId), never full eligibility, so a
                 linked-but-ineligible lead reads "Already present in portal" like the prototype,
                 not the eligibility-refusal reason. */
              const label = c ? "Local demo copy recorded" : e.accountId ? "Already present in portal · demo source" : "Waiting for Finance verification";
              const accountId = c?.accountId || e.accountId || null;
              const queued = saves?.find(sv => sv.actor === state.WHO && sv.id === l.id && sv.label === "Investor copy (demo)");
              const canManual = canRecordInvestorCopy(state,l);
              return (
                <tr key={l.id}>
                  <td><button type="button" className="chip" onClick={() => go("lead", l.id)}>{l.n}</button>
                    <div className="sm">{P(state.PEOPLE, l.own).n}</div></td>
                  <td className="sm mono">{accountId || "Not linked"}</td>
                  <td><b>{label}</b><div className="sm">{c ? `${c.mode} · ${c.copiedAt}` : e.reason}</div></td>
                  <td>{!canManual ? <span className="sm">View only</span>
                    : c ? (
                      <button type="button" className="chip" disabled title="This account is already recorded locally">
                        Copy already recorded</button>
                    ) : (
                      <button type="button" className="chip" disabled={!!queued && queued.status !== "failed"}
                        onClick={() => queued?.status === "failed" ? retrySave(queued.key) : dispatch({type:"copyInvestor",id:l.id})}>
                        {queued?.status === "failed" ? "Retry copy (demo)" : "Copy to investor demo"}</button>
                    )}</td>
                </tr>
              );
            })}{!rows.length ? <tr><td colSpan={4} className="empty">No readable lead copy status.</td></tr> : null}</tbody></table></div></div>
        <details className="ux-disclosure" data-ux-key="xfer-register">
          <summary>Legacy investor register · {legacy.length}</summary>
          <div className="tw"><table>
            <thead><tr><th>Investor</th><th>Account link</th><th>Legacy date</th></tr></thead>
            <tbody>{legacy.map(x => (
              <tr key={x.lead}><td>{xName(state,x)}</td><td className="mono">{x.code || "—"}</td>
                <td className="sm">{x.on || "—"}</td></tr>
            ))}</tbody></table></div>
        </details>
      </section>
    </>
  );
}
