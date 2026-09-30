"use client";

/* Page-level pieces for the later owner decisions: Match it on Payments (M10-S02), the payouts due
   this month queue (M10-S20), the farm LLP rows on Farms (M11-S01/S02), the Add investor button
   (M09-S09) and the test sign-in audit on System (M10-S23). */

import type { MouseEvent, ReactNode } from "react";
import {
  I, allotOf, auditText, mayPayouts, fmtAt, fmtDate, inr, llpName, may, mayAddInvestor, mayMatch,
  matchWhy, money, nowFull, payoutsDue, testLinkState, testLinks, thisMonth,
} from "@/lib/im";
import type { ImTxn } from "@/lib/im";
import { ImPname, type ImPageProps } from "../common";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { receiptMatch } from "@/lib/data/endpoints/receipts";
import { farmList } from "@/lib/data/endpoints/farms";

const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;

/* ---- Payments: the second hand on a not-reconciled row (M10-S02) ---- */
export function MatchCell({ s, me, dispatch, t }: ImPageProps & { t: ImTxn }) {
  /* M10-S02-W1: the match is POST /api/receipts/[id]/match (lib/data/endpoints/receipts); a refusal or a 409
     lands in the page note. Whether to offer it is still the book's second-hand rule until M10-S01-W1 wires the rows. */
  const match = useApiWrite(receiptMatch, { s, me }, dispatch);
  if (t.rec !== "pending") return null;
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (mayMatch(s, me, t)) return (
    <div className="chips" style={{ marginTop: 5 }} onClick={stop}>
      <button className="chip on" onClick={e => { e.stopPropagation(); void match({ id: t.id, expectedModifiedTime: t.version ?? null }); }}>Match it</button></div>
  );
  const why = matchWhy(s, me, t);
  return why ? <div className="sm" style={{ marginTop: 4 }}>{why}</div> : null;
}

/* ---- Payments: payouts due this month (M10-S20) ---- */
export function PayoutsDue({ s, me, dispatch }: ImPageProps) {
  if (!mayPayouts(s, me)) return null;
  const rows = payoutsDue(s, me);
  const mo = fmtDate(thisMonth(s.data.NOW));
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Payouts due this month</h3><div className="sp" />
      <span className="sm">{rows.length} scheduled in {mo} · {inr(rows.reduce((n, p) => n + p.Net_Amount, 0))} net</span></div>
      <div className="tw"><table>
        <thead><tr><th>Payout</th><th>Investor</th><th>Farm</th><th>Due</th><th className="n">Gross</th><th className="n">TDS</th><th className="n">Net</th><th></th></tr></thead>
        <tbody>{rows.length ? rows.map(p => {
          const a = allotOf(s, p.Allotment)!, x = I(s, me, a.Customer);
          return (
            <tr key={p.id} className="k" tabIndex={0} onClick={() => dispatch({ type: "go", v: "inv", id: a.Customer })}
              onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: a.Customer }); }}>
              <td className="mono sm">{p.id}<div className="sm">{p.Instalment_No} of 60</div></td>
              <td>{x ? x.n : a.Customer}<div className="sm mono">{a.Customer}</div></td>
              <td className="sm">{llpName(s, a)}</td>
              <td className="sm mono">{fmtDate(p.Due_On)}</td>
              <td className="n mono">{inr(p.Gross_Amount)}</td>
              <td className="n mono sm">{p.TDS_Amount ? inr(p.TDS_Amount) : "—"}</td>
              <td className="n mono"><b>{inr(p.Net_Amount)}</b></td>
              <td style={{ textAlign: "right" }}>{may(s, me, "pay")
                ? <button className="chip" onClick={e => { e.stopPropagation(); dispatch({ type: "openDrawer", k: "payout", id: p.id }); }}>Mark paid</button> : null}</td>
            </tr>
          );
        }) : <tr><td colSpan={8}><div className="empty">Nothing scheduled for {mo}.</div></td></tr>}</tbody></table></div>
    </div>
  );
}

/* ---- Farms: one row per farm LLP (M11-S01) ---- */
export function FarmLlps({ s, me, dispatch }: ImPageProps) {
  /* M11-S01-W1: the rows are GET /api/farms (lib/data/endpoints/farms) — never the store's LLP records */
  const r = useApiRead(farmList, { s, me }, undefined);
  if (r.state === "idle" || r.state === "loading") return <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading the farm LLPs…</p></div></div>;
  if (r.state === "error") return r.err.status === 403 ? null
    : <div className="card" style={{ marginTop: 8 }}><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>Farm LLPs: {r.err.error}</p></div></div>;
  const { rows, superUser } = r.data;
  if (!rows.length) return null;
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Farm LLPs</h3><div className="sp" />
      <span className="sm">{superUser ? "super user — every LLP, PAN masked" : "one record per farm, as Zoho holds it"}</span></div>
      <div className="tw"><table>
        <thead><tr><th>LLP</th><th className="n">Acres</th><th className="n">Total</th><th className="n">Reserved</th><th className="n">Issued</th>
          <th className="n">Free</th><th className="n">Unit price</th><th>Status</th></tr></thead>
        <tbody>{rows.map(l => {
          const open = () => dispatch({ type: "openDrawer", k: "llp", id: l.id });
          return (
            <tr key={l.id} className="k" tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === "Enter") open(); }}>
              <td><b>{l.name}</b><div className="sm mono">{l.id}</div></td>
              <td className="n">{l.acres ?? "—"}</td>
              <td className="n">{l.totalUnits ?? "—"}</td>
              <td className="n">{l.reservedUnits}</td>
              <td className="n">{l.issuedUnits}</td>
              <td className="n"><b>{l.freeUnits ?? "—"}</b></td>
              <td className="n mono">{l.unitPrice == null ? "—" : money(l.unitPrice)}</td>
              <td><TagDot c={l.onSale ? "go" : l.status === "Draft" ? "due" : "br"}>{l.status}</TagDot>
                {l.status === "Draft" ? <div className="sm">not on sale</div> : null}</td>
            </tr>
          );
        })}</tbody></table></div>
      <div className="cb"><p className="sm" style={{ margin: 0 }}>Reserved and issued are counted off the allotments; a cancelled allotment counts for nothing. Open a farm for its PAN and GST (masked), SPOCs, insurance and who holds units on it.</p></div>
    </div>
  );
}

/* ---- Investors: Add investor (M09-S09) ---- */
export function AddInvestorButton({ s, me, dispatch }: ImPageProps) {
  if (!mayAddInvestor(s, me)) return null;
  return <button className="chip" id="add-inv" onClick={() => dispatch({ type: "openDrawer", k: "addinv", id: null })}>＋ Add investor</button>;
}

/* ---- System: who made a test sign-in link, for whom, when, why, and whether it was used (M10-S23) ---- */
export function TestLinkAudit({ s, me }: ImPageProps) {
  const rows = testLinks(s);
  if (!rows.length) return null;
  const now = nowFull(s.data.NOW);
  return (
    <div className="card" style={{ marginTop: 8 }}><div className="ch"><h3>Test sign-in links</h3><div className="sp" />
      <span className="sm">one use, {10} minutes · nothing emailed</span></div>
      <div className="tw"><table>
        <thead><tr><th>Link</th><th>Who</th><th>For</th><th>When</th><th>Why</th><th>Used</th></tr></thead>
        <tbody>{rows.map(l => {
          const st = testLinkState(l, now);
          return (
            <tr key={l.id}><td className="mono sm">{l.id}</td><td><ImPname s={s} k={l.by} first /></td>
              <td className="sm">{auditText(s, me, l.inv)}</td><td className="sm mono">{fmtAt(l.at)}</td><td className="sm">{l.why}</td>
              <td>{st === "used" ? <span className="sm mono">{fmtAt(l.usedAt!)}</span> : <TagDot c={st === "live" ? "br" : ""}>{st === "live" ? "not yet — live" : "expired unused"}</TagDot>}</td></tr>
          );
        })}</tbody></table></div></div>
  );
}
