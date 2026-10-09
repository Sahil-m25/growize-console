"use client";

/* D137 ruling 2(a) — the 10% trail, as the investor's App access card and the lead's Money view show it: every Finance-matched
   receipt (date-time in IST, amount, the reference masked to its last four, who matched it) with the running total against the
   10% threshold. The numbers come from lib/money/ten-percent (the server's own arithmetic); this file only draws them. */

import { Tw } from "@/components/ui";
import { trailSummary, type TenPercentTrail } from "@/lib/money/ten-percent";

const inr = (n: number): string => (n < 0 ? "−₹" : "₹") + Math.abs(n).toLocaleString("en-IN");

export function TenTrail({ trail, nameOf, title = "The 10% so far" }: {
  trail: TenPercentTrail; nameOf: (userId: string) => string; title?: string;
}) {
  return (
    <div className="drwsec" data-trail="ten-percent">
      <p className="lbl">{title}</p>
      <p className="sm" role="status" style={{ margin: "0 0 6px" }}>{trailSummary(trail)}</p>
      {trail.rows.length ? (
        <Tw label="Matched receipts toward the 10%"><table className="d60c-t"><thead><tr>
          <th>When (IST)</th><th>Kind</th><th className="d60c-n">Amount</th><th>Reference</th><th>Matched by</th><th className="d60c-n">Running total</th>
        </tr></thead><tbody>{trail.rows.map((r) => (
          <tr key={r.receiptId}>
            <td className="mono">{r.atIst}</td><td>{r.kind}</td><td className="mono d60c-n">{inr(r.amount)}</td>
            <td className="mono">{r.refMasked}</td><td>{r.matchedById ? nameOf(r.matchedById) : "—"}</td>
            <td className="mono d60c-n">{inr(r.runningTotal)}{r.reachedTen ? " · 10% reached" : ""}{r.reachedFull ? " · fully paid" : ""}</td>
          </tr>))}</tbody></table></Tw>
      ) : <p className="sm" style={{ margin: 0 }}>No matched receipt yet.</p>}
    </div>
  );
}
