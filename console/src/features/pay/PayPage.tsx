"use client";

/* ── Payments — `vPay()`, `ref/03-app.js` 3753–3858 ─────────────────────────────────────────
   Receipts as Finance recorded them. Every figure on this screen is a read of something written in
   the Investor Management portal; the one panel that writes is Finance's own, and it is not on the
   screen at all for anybody else, because a second place to type a receipt is how two books stop
   agreeing.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { FORFEIT, ST, UNIT } from "@/domain";
import type { Lead, PayRec } from "@/domain";
import { DAY, money, when } from "@/lib/format";
import { financeBook, financePaySummary, invAlloc, invFree, invRes, isFin, may, navFor, P, refTxt, roleOf, visible } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { ImBanner, RefButton, useGo } from "./common";
import { PMODE, PSEL2, PUTR, recordRefusal, recordShort } from "./reducer";
import "@/features/lead/drawers/finance";

type Row = { l: Lead; p: PayRec };

const MODES = ["NEFT", "RTGS", "IMPS", "SWIFT", "Cheque"];

export function PayPage() {
  const { state, dispatch } = useConsole();
  const go = useGo();
  if (!may(state, "pay", "view")) return <div className="empty">Payments are unavailable for your account.</div>;

  /* `when(hold) - NOW` in the prototype: an unreadable stamp reads as 0, which is what
     Number.isFinite is asked about below */
  const gap = (hold: string | null): number => {
    const d = when(hold, state.NOW);
    return ((d ? d.getTime() : 0) - state.NOW.getTime()) / DAY;
  };

  const rows: Row[] = financeBook(state,"pay").flatMap(l => {
    const p = financePaySummary(state,l);
    return p ? [{l,p}] : [];
  });

  const hot = rows.filter(r => r.p.hold && r.l.done < ST.PAID
    && Number.isFinite(gap(r.p.hold)) && gap(r.p.hold) <= 7).length;

  const a = invAlloc(state), r2 = invRes(state), f = Math.max(0, invFree(state)),
    t = Math.max(1, state.INV.released);

  const holds = rows.filter(r => r.p.hold && r.l.done < ST.PAID)
    .map(r => ({ ...r, d: Math.round(gap(r.p.hold)) }))
    .sort((x, y) => x.d - y.d);

  const onRecord = (id: string, kind: string) => {
    const why = recordRefusal(state, id, kind);
    if (why) {
      window.alert(why);
      if (recordShort(state, id, kind)) { dispatch({ type: "closeDrawer" }); go("goals"); }
      return;
    }
    dispatch({ type: "record", id, kind });
  };

  return (
    <>
      <div className="ph"><h1>Payments</h1>
        <span className="sub">Finance payment history for your accessible investors · read only</span></div>
      <section className="ux-pay ux-section">
      <ImBanner />
      <div className="grid g3" style={{ marginBottom: 12 }}>
        <div className="kpi"><div className="l">Part paid</div>
          <div className="v">{rows.filter(r => r.p.state === "part").length}</div>
          <div className="s">advance held</div></div>
        <div className="kpi"><div className="l">Fully paid</div>
          <div className="v">{rows.filter(r => r.p.state === "full").length}</div>
          <div className="s">ready to transfer</div></div>
        <div className={`kpi ${hot ? "bad" : ""}`}><div className="l">Hold expiring</div>
          <div className="v">{hot}</div>
          <div className="s">inside 7 days · ₹50,000 a unit forfeit on lapse</div></div>
      </div>
      <div className="colsw"><div>

        <div className="card fill"><div className="ch"><h3>Money received</h3></div>
          <div className="tw"><table>
            <thead><tr><th>Investor</th><th>Total</th><th>Received</th><th>Status</th>
              <th>Payment reference</th><th>Hold ends</th></tr></thead>
            <tbody>{rows.map(({ l, p }) => (
              <tr className="k" key={l.id} tabIndex={0} onClick={() => dispatch({type:"openDrawer",k:"money",id:l.id})}
                onKeyDown={e => {if(e.key === "Enter") dispatch({type:"openDrawer",k:"money",id:l.id});}}>
                <td><b>{l.n}</b><div className="sm">{l.units} unit{l.units === 1 ? "" : "s"}</div></td>
                <td className="n">{money(l.units * UNIT)}</td>
                <td className="n">{money(p.got)}</td>
                <td><span className={`tag ${p.state === "full" ? "go" : "due"}`}>
                  {p.state === "full" ? "Full" : "Part"}</span></td>
                <td className="sm mono">{p.mode} · {refTxt(state, `pay:${l.id}`)}{" "}
                  <RefButton k={`pay:${l.id}`} id={l.id} where="Payments" /></td>
                <td className="sm mono">{p.hold || "—"}</td></tr>
            ))}{!rows.length ? <tr><td colSpan={6} className="empty">No confirmed receipts yet.</td></tr> : null}</tbody></table></div></div>

        {!["ir","conv"].includes(roleOf(state.PEOPLE, state.WHO) || "") ? (
          /* READ ONLY HERE — Plan is the only writer of released inventory. A stepper on this card
             too is how two people each free the units the other had just sold. */
          <details className="ux-disclosure" data-ux-key="pay-inventory">
            <summary>Sellable inventory · {f} units free</summary>
            <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Sellable inventory</h3>
              <div className="sp" />
              <span className="sm mono">{state.INV.released} of {state.INV.total} released</span></div>
              <div className="cb"><div className="invb">
                <i className="a" style={{ width: `${a / t * 100}%` }} />
                <i className="r" style={{ width: `${r2 / t * 100}%` }} />
                <i className="f" style={{ width: `${f / t * 100}%` }} /></div>
                <div className="stats" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                  {([["Allocated", a], ["Reserved", r2], ["Free to sell", f]] as const).map(([n2, v]) => (
                    <div className="stat" key={n2}><b>{v}</b><span>{n2}</span></div>))}
                </div>
                <div className="dialrow" style={{ border: 0, paddingBottom: 0 }}>
                  <span className="sm">Released for sale</span><div className="sp" />
                  <b className="mono">{state.INV.released}</b></div>
                <p className="sm" style={{ margin: "9px 0 0" }}>Released inventory is set on Plan — last changed by{" "}
                  {P(state.PEOPLE, state.INV.by).n} <span className="mono">{state.INV.at}</span>.</p>
                <p className="sm" style={{ margin: "6px 0 0" }}>An advance is refused when nothing is free — no unit is
                  ever reserved twice.</p>
              </div></div>
          </details>
        ) : null}

      </div><div>
        <RecordPanel onRecord={onRecord} />

        <div className="card fill" style={{ marginTop: 8 }}><div className="ch"><h3>Reservation clocks</h3>
          <div className="sp" /><span className="sm">30 days from the advance</span></div><div className="cb">
          {holds.length ? holds.map(h => (
            <div className="mini" key={h.l.id} role="button" tabIndex={0} style={{ cursor: "pointer" }}
              onClick={() => go("lead", h.l.id)}
              onKeyDown={e => { if (e.key === "Enter") go("lead", h.l.id); }}>
              <span className={`rag ${!Number.isFinite(h.d) ? "amber" : h.d <= 3 ? "red" : h.d <= 7 ? "amber" : "green"}`}
                title={!Number.isFinite(h.d) ? "No hold date on the receipt"
                  : h.d < 0 ? (-h.d) + " days over"
                  : h.d <= 3 ? "Inside three days" : h.d <= 7 ? "Inside a week" : h.d + " days left"} />
              <span><b>{h.l.n}</b> <span className="sm">{h.l.units} unit{h.l.units > 1 ? "s" : ""} ·
                ₹{(FORFEIT * h.l.units).toLocaleString("en-IN")} at risk</span></span>
              <span className="n2 sm">{!Number.isFinite(h.d) ? h.p.hold
                : h.d < 0 ? (-h.d) + "d over" : h.d + "d left"}</span>
              {state.EXT[h.l.id] && (
                <span className={`tag ${state.EXT[h.l.id].state === "waiting" ? "due" : "go"}`}>
                  {state.EXT[h.l.id].state === "waiting" ? "extension asked" : "extended"}</span>)}
            </div>
          )) : <p className="sm" style={{ margin: 0 }}>No reservation is running a clock.</p>}
          <p className="sm" style={{ margin: "9px 0 0" }}>A lapse forfeits ₹{FORFEIT.toLocaleString("en-IN")} per unit
            and returns the units to the shelf. Only the BU Owner may extend.</p>
        </div></div>

      </div></div>
      </section>
    </>
  );
}

/* ---- Finance's own half of the screen. Nobody else sees it at all. 03-app.js:3798 ------------- */
function RecordPanel({ onRecord }: { onRecord: (id: string, kind: string) => void }) {
  const { state, dispatch } = useConsole();
  const go = useGo();
  if (!isFin(state.ROLE) || !may(state, "pay", "record")) return null;

  const cands = visible(state).filter(l => l.done >= ST.CONVERTED - 1 && l.done < ST.ALLOCATED);
  const tgt = cands.find(l => l.id === PSEL2(state)) || cands.find(l => !state.PAY[l.id])
    || cands[0] || null;
  if (!tgt) return (
    <div className="card"><div className="ch"><h3>Record a payment</h3></div>
      <div className="empty">There is nobody to record money against. A receipt needs an investor who
        has already said yes, and nobody has reached that rung — the IR moves them there, on the lead,
        and this screen only records what arrives afterwards.
        {navFor(state).some(n => n.k === "leads") ? (
          <><br /><button type="button" className="chip" style={{ marginTop: 10 }}
            onClick={() => go("leads")}>Open the leads book</button></>
        ) : null}</div></div>
  );

  const held = state.PAY[tgt.id] ? state.PAY[tgt.id].got : 0;
  const tot = tgt.units * UNIT, adv = Math.round(tot * 0.1), bal = tot - held;
  const utrOK = /^[A-Za-z0-9]{6,22}$/.test(PUTR(state).trim());

  const btn = (k: string, t2: string, amt: number, ok: boolean, why: string) => (
    <button type="button" key={k} className={`chip ${k === "balance" && ok ? "on" : ""}`}
      {...(ok && utrOK
        ? { onClick: () => onRecord(tgt.id, k) }
        : { disabled: true, title: !ok ? why : "Enter the UTR first" })}
    >{t2}<span className="u">{money(amt)}</span></button>
  );

  return (
    <div className="card"><div className="ch"><h3>Record a payment</h3></div><div className="cb">
      <label className="fi" style={{ marginBottom: 14 }}><span>Investor</span>
        <select className="selw" id="pwho" value={tgt.id}
          onChange={e => dispatch({ type: "setPay", f: "who", v: e.target.value })}>
          {cands.map(l => (
            <option value={l.id} key={l.id}>{l.n} — {l.units} unit{l.units > 1 ? "s" : ""} ·{" "}
              {money(l.units * UNIT)}{state.PAY[l.id] ? " · " + money(state.PAY[l.id].got) + " held" : ""}</option>
          ))}
        </select></label>
      <p className="lbl">How much</p>
      <div className="chips" style={{ marginBottom: 6 }}>
        {btn("advance", "Advance — 10%", adv, !held, "An advance is already held against this one.")}
        {btn("balance", "Balance received", bal, held > 0 && bal > 0, "No advance is held, so there is no balance.")}
        {btn("full", "Paid in full", tot, !held, "An advance is held — record the balance instead.")}
      </div>
      <p className="sm" style={{ margin: "0 0 14px" }}>{held
        ? money(held) + " is already held against " + tgt.n.split(" ")[0] + "; the balance is " + money(bal) + "."
        : "Nothing recorded yet. The 10% advance starts a 30-day clock; a full payment does not."}</p>
      <p className="lbl">Mode</p>
      <div className="chips" style={{ marginBottom: 14 }}>{MODES.map(m => (
        <button type="button" key={m} className={`chip ${PMODE(state) === m ? "on" : ""}`}
          onClick={() => dispatch({ type: "setPay", f: "mode", v: m })}>{m}</button>))}</div>
      <label className="fi" style={{ marginBottom: 6 }}><span>UTR or reference</span>
        <input className="inp mono" id="putr" value={PUTR(state)} placeholder="KKBK2908417"
          onChange={e => dispatch({ type: "setPay", f: "utr", v: e.target.value })} /></label>
      <p className="sm" style={{ margin: 0 }}>{utrOK ? "" : (
        <><b style={{ color: "var(--late)" }}>The reference is what makes
          a receipt evidence.</b> Six characters or more, letters and digits. </>)}An advance is a liability.
        It is never shown as capital.</p>
    </div></div>
  );
}
