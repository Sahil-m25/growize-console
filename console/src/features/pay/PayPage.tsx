"use client";

/* ── Payments — `vPay()`, ir-merged.js:6557 (7. PAYMENTS — Finance-owned history, read-only) ──
   Receipts as Finance recorded them in the Investors pages. One table answers the page (D59); the
   "Record a payment" form is gone because Finance records receipts in the IM portal.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { FORFEIT, IMP, ST, UNIT } from "@/domain";
import type { Lead, PayRec } from "@/domain";
import { DAY, money, when } from "@/lib/format";
import { financeBook, financePaySummary, invAlloc, invFree, invRes, may, P, refShown, refTxt, scopedFinanceReader, seeMoney } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import "@/features/lead/drawers/finance";

type Row = { l: Lead; p: PayRec; d: number | null };

export function PayPage() {
  const { state, dispatch } = useConsole();
  if (!may(state, "pay", "view")) return null;

  /* D59: one table answers the page. Part/Full counts sit in its header, the 30-day clock is the
     last column (soonest first), and the forfeit rule shows once, only when a hold is close. Finance
     records receipts in the IM portal, so the unreachable "Record a payment" form is gone. */
  const left = (l: Lead, p: PayRec): number | null => {
    if (!(p.hold && l.done < ST.PAID)) return null;
    const d = when(p.hold, state.NOW);
    /* `when(hold)-NOW` in the prototype: an unreadable stamp is NaN, which reads as "no hold date" */
    return d ? Math.round((d.getTime() - state.NOW.getTime()) / DAY) : NaN;
  };
  const key = (r: Row) => r.d === null ? Infinity : Number.isFinite(r.d) ? r.d : -Infinity;
  const rows: Row[] = financeBook(state, "pay").flatMap(l => {
    const p = financePaySummary(state, l);
    return p ? [{ l, p, d: left(l, p) }] : [];
  }).sort((a, b) => key(a) === key(b) ? 0 : key(a) < key(b) ? -1 : 1);
  const part = rows.filter(r => r.p.state === "part").length, full = rows.filter(r => r.p.state === "full").length;
  const close = rows.some(r => r.d !== null && !(r.d > 7));

  const hold = (r: Row) => {
    if (r.d === null) return <span className="sm">—</span>;
    const ok = Number.isFinite(r.d), x = state.EXT[r.l.id], d = r.d;
    return (<>
      <span className="g5-clk" title={`₹${(FORFEIT * r.l.units).toLocaleString("en-IN")} at risk`}>
        <span className={`rag ${!ok ? "amber" : d <= 3 ? "red" : d <= 7 ? "amber" : "green"}`}
          title={!ok ? "No hold date on the receipt" : d < 0 ? "Hold lapsed" : d <= 3 ? "Inside three days" : d <= 7 ? "Inside a week" : "On track"} />
        <b className="mono">{!ok ? "—" : d < 0 ? (-d) + "d over" : d + "d left"}</b></span>
      <div className="sm mono">{r.p.hold}</div>
      {x ? <span className={`tag ${x.state === "waiting" ? "due" : "go"}`}>{x.state === "waiting" ? "extension asked" : "extended"}</span> : null}
    </>);
  };

  const open = (id: string) => dispatch({ type: "openDrawer", k: "money", id });

  return (
    <>
      <div className="ph"><h1>Payments</h1>
        <span className="sub">Read only · recorded by Finance in the {IMP}</span></div>
      <section className="ux-pay ux-section">
      <div className="card fill"><div className="ch"><h3>Money received</h3><div className="sp" />
        <span className="sm">{part} part · {full} full</span></div><div className="tw"><table>
        <thead><tr><th>Investor</th><th>Received</th><th>Status</th><th>Payment reference</th><th>Hold</th></tr></thead>
        <tbody>{rows.map(r => { const { l, p } = r, k = `pay:${l.id}`, see = seeMoney(state, l), shown = refShown(state, k);
          return (
          <tr className="k" key={l.id} tabIndex={0} onClick={() => open(l.id)}
            onKeyDown={e => { if (e.key === "Enter") open(l.id); }}>
            <td><b>{l.n}</b><div className="sm">{l.units} unit{l.units === 1 ? "" : "s"}</div></td>
            <td className="n">{see ? money(p.got) : "•••"}<div className="sm">of {see ? money(l.units * UNIT) : "•••"}</div></td>
            <td><span className={`tag ${p.state === "full" ? "go" : "due"}`}>{p.state === "full" ? "Full" : "Part"}</span></td>
            <td className="sm mono">{p.mode} · {refTxt(state, k)}
              {!p.utr || p.utr === "—" || scopedFinanceReader(state) || !see ? null : shown
                ? <> <button type="button" className="chip g5-ref" title="Cover it again"
                    onClick={e => { e.stopPropagation(); dispatch({ type: "hideRef", k }); }}>Hide the reference</button></>
                : <> <button type="button" className="chip g5-ref" title="Shows the whole reference and writes your name and the minute into the log"
                    onClick={e => { e.stopPropagation(); dispatch({ type: "showRef", k, id: l.id, where: "Payments" }); }}>Show the reference</button></>}</td>
            <td>{hold(r)}</td></tr>); })}
          {!rows.length ? <tr><td colSpan={5} className="empty">No confirmed receipts yet.</td></tr> : null}
        </tbody></table></div>
        {close ? <p className="sm g5-foot">A lapse forfeits ₹{FORFEIT.toLocaleString("en-IN")} per unit and returns the units. Only the BU Owner may extend.</p> : null}
      </div>

      {scopedFinanceReader(state) ? null : <Inventory />}
      </section>
    </>
  );
}

/* READ ONLY HERE — PLAN IS THE ONLY WRITER of released inventory. Do not put a stepper back. */
function Inventory() {
  const { state } = useConsole();
  const a = invAlloc(state), r2 = invRes(state), f = Math.max(0, invFree(state)), t = Math.max(1, state.INV.released);
  return (
    <details className="ux-disclosure" data-ux-key="pay-inventory"><summary>Sellable inventory · {f} units free</summary>
      <div className="card" style={{ marginTop: 8 }}><div className="cb"><div className="invb">
        <i className="a" style={{ width: `${a / t * 100}%` }} />
        <i className="r" style={{ width: `${r2 / t * 100}%` }} />
        <i className="f" style={{ width: `${f / t * 100}%` }} /></div>
        <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {([["Allocated", a], ["Reserved", r2], ["Free to sell", f]] as const).map(([n2, v]) => (
            <div className="stat" key={n2}><b>{v}</b><span>{n2}</span></div>))}</div>
        <p className="sm" style={{ margin: "9px 0 0" }}><span className="mono">{state.INV.released} of {state.INV.total}</span> released — set on Plan by{" "}
          {P(state.PEOPLE, state.INV.by).n} <span className="mono">{state.INV.at}</span>. An advance is refused when nothing is free.</p>
      </div></div></details>
  );
}
