"use client";

/* D137 ruling 3 — after Reserved, the IR chases the balance. One queue item on the IR's Today per Reserved allotment of their
   own-lead investor that is not yet converted in full: who, which farm, units, the amount due (D138 / B-10: receivable − received
   as Zoho returns them on the IR's own token; nothing where Zoho hides them — never a figure worked out here) and the deadline with
   the day it counts from (D138 G4: "Balance due 9 Nov — 30 days from Finance confirming the 10% on 10 Oct", lib/money/balance-clock,
   days left in IST). The rows are
   GET /api/investors/mine `chase` (server/investors/ir-list buildChase); a row is gone the moment Finance matches the remainder
   (the allotment is stamped Converted_At automatically) or someone marks it fully paid by hand. Read-only: no write here. */

import { useApiRead } from "@/lib/data/api";
import { irInvestorList } from "@/lib/data/endpoints/investors";
import { useIm } from "@/features/im/host";
import { balanceDueText, shortDay } from "@/lib/money/balance-clock";

const inr = (n: number): string => "₹" + n.toLocaleString("en-IN");
export function BalanceChase({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const { s, me } = useIm();
  const r = useApiRead(irInvestorList, { s, me }, true);
  if (r.state !== "ok") return r.state === "error" && r.err.status !== 403 ? <p className="note bad" role="alert">Balances to chase: {r.err.error}</p> : null;
  const rows = r.data.chase ?? [];
  if (!rows.length) return null;
  return (
    <section className="card" aria-label="Balances to chase" data-testid="balance-chase" style={{ marginBottom: 12 }}>
      <div className="ch"><h3>Balances to chase</h3><div className="sp" /><span className="tag due"><span className="dot" />{rows.length}</span></div>
      <div className="cb">
        <p className="sm" style={{ margin: "0 0 8px" }}>Reserved — the 10% is in. The balance is yours to chase until Finance confirms it; then they convert in full by themselves.</p>
        <ul className="work-rows">{rows.map((x) => (
          <li key={x.allotmentId} className="led">
            <span className={`tag ${x.daysLeft != null && x.daysLeft <= 7 ? "late" : "due"}`}>{x.daysLeft == null ? "no deadline" : x.daysLeft < 0 ? -x.daysLeft + "d over" : x.daysLeft + "d left"}</span>
            <span style={{ minWidth: 0, flex: 1 }}><b>{x.name || x.code}</b>{" "}<span className="sm mono">{x.code}</span>
              <div className="sm">{x.farm ? x.farm + " · " : ""}{x.units} unit{x.units === 1 ? "" : "s"}{x.due != null ? " · " + inr(x.due) + " due" : ""}</div>
              {x.holdUntil && x.fromDay ? <div className="sm" data-testid="balance-due-line">{balanceDueText({ dueDay: x.holdUntil, fromDay: x.fromDay, extendedBy: x.extendedBy })}</div> : null}
              {/* D139: the state of the IR's own payment reports — never a receipt line (Jev p=1.00, owner 10 Oct) */}
              {(x.claims ?? []).map((c) => (
                <div className="sm" key={c.claimId} data-testid="chase-claim">
                  {"You reported " + (c.amount != null ? inr(c.amount) : "a payment") + (c.claimedOn ? " (paid " + shortDay(c.claimedOn) + ")" : "") + " — "}
                  {c.state === "pending" ? "pending, Finance has not found it yet"
                    : c.state === "matched" ? "matched by Finance" + (c.answeredOn ? " on " + shortDay(c.answeredOn) : "")
                    : c.state === "rejected" ? "Finance did not find it" + (c.answeredOn ? " on " + shortDay(c.answeredOn) : "") + (c.reason ? ": " + c.reason : "")
                    : "answered by Finance" + (c.answeredOn ? " on " + shortDay(c.answeredOn) : "")}
                </div>))}</span>
            {x.leadId ? <button type="button" className="chip" onClick={() => onOpenLead(x.leadId!)}>Open lead</button> : null}
          </li>))}</ul>
      </div>
    </section>
  );
}
