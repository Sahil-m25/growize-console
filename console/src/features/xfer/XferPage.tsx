"use client";

/* ── Transfers — the merged prototype's `vXfer()` (ir-merged.js 6907–6932).
   Leads that became investors (GC-1527 / D137: when Finance confirmed the 10%), by month. The page leads with transfers per
   month; a month opens in place into who, when, how they came in, whose they are, how long it took
   and what has happened since. Read only: nothing here writes. Rules: `@/lib/selectors/xfer`. ── */

import { Tw } from "@/components/ui";
import { UNIT } from "@/domain";
import { P, median, may, seeMoney } from "@/lib/selectors";
import { xfAfter, xfHow, xfMonths } from "@/lib/selectors/xfer";
import type { XfMonth, XfRow } from "@/lib/selectors/xfer";
import { useConsole } from "@/lib/store";
import { useGo } from "@/features/pay/common";
/* the lead page's "Investor copy" door drawer was registered from here; keep it registered */
import "@/features/lead/drawers/investor-copy";

declare module "@/lib/store" {
  interface UiState {
    /** the month opened in place, "2026-7". ir-merged.js 6879 */
    XFMON?: string | null;
  }
}

const mName = (d: Date): string => d.toLocaleString("en-GB", { month: "long", year: "numeric" });
const inr = (v: number): string => v >= 1e7 ? "₹" + String(+(v / 1e7).toFixed(2)) + " Cr" : "₹" + String(+(v / 1e5).toFixed(2)) + " L";

export function XferPage() {
  const { state, dispatch } = useConsole();
  const go = useGo();
  if (!may(state, "xfer", "view")) return null;
  const months = xfMonths(state), all = months.flatMap(m => m.rows), cash = seeMoney(state);
  const XFMON = state.ui.XFMON ?? null;
  const units = (rs: XfRow[]) => rs.reduce((a, r) => a + (Number(r.l.units) || 0), 0);
  const size = (rs: XfRow[]) => { const u = units(rs); return u + " unit" + (u === 1 ? "" : "s") + (cash ? " · " + inr(u * UNIT) : ""); };
  const med = median(all.map(r => r.days));
  const medT = med == null ? "" : " · median " + (Math.round(med * 10) / 10) + " day" + (med === 1 ? "" : "s") + " from capture";
  const xfToggle = (k: string) => dispatch({ type: "setUi", patch: { XFMON: XFMON === k ? null : k } });

  const list = (m: XfMonth) => (
    <Tw className="d60c-tw"><table className="d60c-t"><thead><tr><th>Investor</th><th>10% confirmed</th><th>How they came in</th><th>Owner</th><th className="d60c-n">Days</th><th>Since</th></tr></thead><tbody>
      {m.rows.map(({ l, yes, days }) => {
        const a = xfAfter(l);
        return (
          <tr key={l.id}>
            <td><button type="button" className="chip" onClick={() => go("lead", l.id)}>{l.n}</button></td>
            <td className="mono">{yes.getDate() + " " + yes.toLocaleString("en-GB", { month: "short" })}</td>
            <td>{xfHow(state, l)}</td>
            <td>{l.own ? P(state.PEOPLE, l.own).n : "Unassigned"}</td>
            <td className="mono d60c-n">{days == null ? "—" : days}</td>
            <td><span className={`tag ${a.c}`}>{a.t}</span></td></tr>
        );
      })}</tbody></table></Tw>
  );

  return (
    <>
      <div className="ph"><h1>Transfers</h1><span className="sub">Leads that became investors — Finance confirmed the 10% — by month · read only</span></div>
      <section className="d60c-xfer">{months.length ? (<>
        <p className="d60c-sum">{all.length} transferred since {mName(months[months.length - 1].d)}{medT}</p>
        <div className="card d60c-card">{months.map(m => {
          const open = XFMON === m.k;
          return (
            <div className="d60c-m" key={m.k}>
              <button type="button" className="d60c-mb" id={`d60c-m-${m.k}`} aria-expanded={open} aria-controls={`d60c-l-${m.k}`}
                onClick={() => xfToggle(m.k)}>
                <span className="d60c-mn">{mName(m.d)}</span><span className="d60c-mc"><b>{m.rows.length}</b> transferred</span>
                <span className="d60c-mu">{size(m.rows)}</span><span className="d60c-cv" aria-hidden="true">{open ? "−" : "+"}</span></button>
              {open ? <div id={`d60c-l-${m.k}`}>{list(m)}</div> : null}</div>
          );
        })}</div>
        <p className="sm d60c-foot">A lead is transferred on the day Finance confirms its 10% — that is when its investor record is created, on Finance's own sign-in (D137). Nobody copies a lead by hand. A lead lost afterwards still counts, on that date.{cash ? " Value is units × " + inr(UNIT) + "." : ""}</p>
      </>) : (
        <div className="card"><div className="empty">No transfers yet. A lead appears here the day Finance confirms its 10%.</div></div>
      )}</section>
    </>
  );
}
