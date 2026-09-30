"use client";

/* The drawers the later owner decisions added (not in the prototype): Mark paid (M10-S20), a farm
   LLP (M11-S01/S02), Add investor (M09-S09), Lock app access (M10-S21), Test sign-in link (M10-S23)
   and the app preview (M10-S22). Same frame, classes and gates as the prototype's drawers; their
   form fields live in ui.MX, written with {type:"mset"}. */

import type { ReactNode } from "react";
import {
  I, PAYOUT_MODES, TESTLINK_MIN, addInvestorGate, allotDue, allotAmount, allotOf, allotPayStatus, allotTxns, allotUnits,
  allotsOnLlp, dupEmail, fmtAt, fmtDate, inr, llpCounts, llpName, llpOf, llps, may,
  money, nowDay, onSale, openAllots, payoutNet, payoutOf, prePick, qrCells, testLinkState, testLinks, who, ymd, nowFull, notFin,
} from "@/lib/im";
import type { ImMoneyDrawerKey, ImPayoutMode } from "@/lib/im";
import type { ImPageProps } from "../common";
import { AppPreview } from "./preview";
import { useApiRead } from "@/lib/data/api";
import { farmOne } from "@/lib/data/endpoints/farms";

type Ctx = ImPageProps & { id: string | null };
type Part = (c: Ctx) => ReactNode;
interface DrawerDef { w: number; t: string; sub: Part; body: Part; foot: Part }

const mx = (c: Ctx, k: string): string => (c.s.ui.MX || {})[k] || "";
const setMx = (c: Ctx, k: string, v: string) => c.dispatch({ type: "mset", k, v });
const nameOf = ({ s, me, id }: Ctx): string => (I(s, me, id) || { n: "" }).n || "";
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;
export const payTagClass = (st: string) => (st === "Full" ? "go" : st === "Partial" ? "due" : "");
export const poTagClass = (st: string) =>
  st === "Paid" ? "go" : st === "Failed" ? "late" : st === "Held" ? "due" : st === "Cancelled" ? "" : "br";

/* ---- payout: Mark paid (M10-S20) ---- */
function payoutSub(c: Ctx): string {
  const p = payoutOf(c.s, c.id), a = p && allotOf(c.s, p.Allotment);
  return a ? (I(c.s, c.me, a.Customer) || { n: a.Customer }).n + " · " + llpName(c.s, a) : "";
}
function payoutBody(c: Ctx): ReactNode {
  const { s } = c; const p = payoutOf(s, c.id); if (!p) return null;
  const tds = mx(c, "po:tds") === "" ? p.TDS_Amount : Math.max(0, +mx(c, "po:tds") || 0);
  const mode = (mx(c, "po:mode") || "NEFT") as ImPayoutMode;
  const on = mx(c, "po:on") || ymd(nowDay(s.data.NOW));
  if (p.Payout_State === "Paid") return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Instalment</dt><dd>{p.Instalment_No} of 60 · {fmtDate(p.Period_Month)}</dd>
        <dt>State</dt><dd><TagDot c="go">Paid</TagDot></dd>
        <dt>Paid on</dt><dd className="mono">{fmtDate(p.Paid_On)}</dd>
        <dt>How</dt><dd>{p.Payout_Mode} <span className="mono">{p.Payout_UTR}</span></dd>
        <dt>Paid by</dt><dd>{who(s, p.Paid_By).n}</dd>
        <dt>Gross · TDS · net</dt><dd className="mono">{inr(p.Gross_Amount)} · {inr(p.TDS_Amount)} · <b>{inr(p.Net_Amount)}</b></dd>
      </dl>
      <p className="sm" style={{ margin: "12px 0 0" }}>A payout is paid once. This one is on the record and cannot be marked again.</p>
    </>
  );
  return (
    <>
      <dl className="kv" style={{ marginTop: 0, marginBottom: 12 }}>
        <dt>Instalment</dt><dd>{p.Instalment_No} of 60 · {fmtDate(p.Period_Month)}</dd>
        <dt>Due on</dt><dd className="mono">{fmtDate(p.Due_On)}</dd>
        <dt>State</dt><dd><TagDot c={poTagClass(p.Payout_State)}>{p.Payout_State}</TagDot>{p.Payout_Note ? <div className="sm">{p.Payout_Note}</div> : null}</dd>
        <dt>Gross</dt><dd className="mono">{inr(p.Gross_Amount)}</dd>
      </dl>
      <label className="fi"><span>Paid on</span>
        <input className="inp" type="date" id="po-on" value={on} max={ymd(nowDay(s.data.NOW))}
          onChange={e => setMx(c, "po:on", e.target.value)} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>How it went</p>
      <div className="chips">{PAYOUT_MODES.map(m =>
        <button key={m} className={`chip ${mode === m ? "on" : ""}`} onClick={() => setMx(c, "po:mode", m)}>{m}</button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>UTR</span>
        <input className="inp" id="po-utr" placeholder="the bank's reference for the transfer" value={mx(c, "po:utr")}
          onChange={e => setMx(c, "po:utr", e.target.value)} /></label>
      <label className="fi" style={{ marginTop: 14 }}><span>TDS deducted (₹)</span>
        <input className="inp" id="po-tds" inputMode="numeric" value={mx(c, "po:tds") === "" ? String(p.TDS_Amount) : mx(c, "po:tds")}
          onChange={e => setMx(c, "po:tds", e.target.value.replace(/[^\d]/g, ""))} /></label>
      <p className="sm" style={{ margin: "7px 0 0" }}>Typed by Finance, ₹0 unless something was deducted. The console never works TDS out.</p>
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Net to the investor</dt><dd className="mono"><b>{inr(payoutNet(p.Gross_Amount, tds))}</b> <span className="sm">= {inr(p.Gross_Amount)} − {inr(tds)}</span></dd>
      </dl></div>
    </>
  );
}
function payoutFoot(c: Ctx): ReactNode {
  const { s, me, dispatch } = c; const p = payoutOf(s, c.id);
  if (!p || !may(s, me, "pay") || p.Payout_State === "Paid" || p.Payout_State === "Cancelled") return null;
  const utr = mx(c, "po:utr").trim();
  const tds = mx(c, "po:tds") === "" ? p.TDS_Amount : +mx(c, "po:tds") || 0;
  return (
    <button className="act" disabled={!utr} title={utr ? undefined : "The bank's UTR first"}
      onClick={utr ? () => dispatch({ type: "markPayoutPaid", id: p.id, utr, tds, mode: (mx(c, "po:mode") || "NEFT") as ImPayoutMode,
        paidOn: mx(c, "po:on") || ymd(nowDay(s.data.NOW)) }) : undefined}>Mark paid</button>
  );
}

/* ---- llp: one farm LLP (M11-S01, M11-S02, M10-S07) ----
   M11-S01-W1: the LLP itself is GET /api/farms/[id] (lib/data/endpoints/farms). "Who holds units here" is still
   the book's allotments until M11-S02-W1 wires GET /api/farms/[id]/allotments. */
function LlpName({ s, me, id }: Ctx) {
  const r = useApiRead(farmOne, { s, me }, id);
  return <>{r.state === "ok" ? r.data.farm.name : ""}</>;
}
function LlpBody(c: Ctx) {
  const { s, me, dispatch } = c;
  const r = useApiRead(farmOne, { s, me }, c.id);
  if (r.state === "idle") return null;
  if (r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the farm…</p>;
  if (r.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{r.err.error}</p>;
  const { farm: l, superUser } = r.data;
  const rows = allotsOnLlp(s, me, l.id), fin = !notFin(s, me);
  const matched = rows.flatMap(a => allotTxns(s, me, a)).filter(t => t.rec === "matched" && t.kind !== "refund" && t.kind !== "forfeit")
    .reduce((a, t) => a + t.amt, 0);
  return (
    <>
      {superUser ? <div className="note su" style={{ marginBottom: 12 }}><b>Super user.</b> You see every LLP. PAN and GST stay masked here too.</div> : null}
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Status</dt><dd><TagDot c={l.onSale ? "go" : l.status === "Draft" ? "due" : "br"}>{l.status}</TagDot>
          {l.status === "Draft" ? <span className="sm"> not on sale — takes no reservation</span> : null}</dd>
        <dt>Acreage</dt><dd>{l.acres ?? "—"} acres</dd>
        <dt>Units</dt><dd>{l.issuedUnits} issued · {l.reservedUnits} reserved · <b>{l.freeUnits ?? "—"}</b> free</dd>
        <dt>Unit price</dt><dd className="mono">{l.unitPrice == null ? "—" : money(l.unitPrice)}</dd>
        <dt>Yield</dt><dd>{l.yieldPct == null ? "—" : l.yieldPct + "% a year, paid monthly"}</dd>
        <dt>PAN</dt><dd><span className="pii"><span className="v hid">{l.pan ?? "not visible"}</span></span></dd>
        <dt>GST</dt><dd><span className="pii"><span className="v hid">{l.gst ?? "not visible"}</span></span></dd>
      </dl>
      <div className="drwsec"><p className="lbl">SPOCs</p>
        {l.spocs.length ? l.spocs.map((p, i) => (
          <div className="led" key={p.name + i}><span className="tag">SPOC {i + 1}</span>
            <span style={{ minWidth: 0 }}><b>{p.name}</b><div className="sm mono">{p.phone ?? "—"}</div></span></div>
        )) : <p className="sm" style={{ margin: 0 }}>Nobody named yet.</p>}</div>
      <div className="drwsec"><p className="lbl">Insurance</p>
        {l.insurance.provider ? <p className="sm" style={{ margin: 0 }}>{l.insurance.provider} · <span className="mono">{l.insurance.policyNo ?? "—"}</span> · insured till {fmtDate(l.insurance.till)}</p>
          : <p className="sm" style={{ margin: 0 }}>No policy on file.</p>}</div>
      <div className="drwsec"><p className="lbl">Who holds units here</p>
        {rows.length ? rows.map(a => {
          const x = I(s, me, a.Customer);
          return (
            <div className="led" key={a.id}>
              <span className={`tag ${a.Allocation_Status === "Issued" ? "go" : a.Allocation_Status === "Cancelled" ? "late" : "hold"}`}>{a.Allocation_Status}</span>
              <span style={{ minWidth: 0 }}><a className="lnk" role="button" tabIndex={0}
                onClick={() => dispatch({ type: "go", v: "inv", id: a.Customer })}
                onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: a.Customer }); }}>{x ? x.n : a.Customer}</a>
                <div className="sm">{allotUnits(a)} unit{allotUnits(a) === 1 ? "" : "s"}{fin ? " · " + money(allotAmount(a)) + " · " + allotPayStatus(s, a) : ""}</div></span>
            </div>
          );
        }) : <p className="sm" style={{ margin: 0 }}>Nobody holds units on this farm{superUser || fin ? "" : " that you look after"}.</p>}
        {fin && rows.length ? <p className="sm" style={{ margin: "9px 0 0" }}>Matched receipts on this farm: <b>{money(matched)}</b> — the same total Payments shows for {l.name.split(" — ")[0]}.</p> : null}
      </div>
    </>
  );
}

/* ---- addinv: an investor who already paid (M09-S09) ---- */
const AI: [string, string, string][] = [["n", "Name", "as on their PAN"], ["em", "Email", "name@example.com"], ["ph", "Mobile", "+91 …"]];
function addBody(c: Ctx): ReactNode {
  const { s, dispatch } = c;
  const dup = dupEmail(s, mx(c, "ai:em"));
  const sale = llps(s).filter(onSale);
  const l = llpOf(s, mx(c, "ai:llp"));
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>For someone who paid before the console. They get a record, one allotment
        and their receipt — and no email: their app opens <b>on hold</b> until Finance sends the welcome.</p>
      {AI.map(([k, t, ph]) => (
        <label key={k} className="fi" style={{ marginBottom: 11 }}><span>{t}</span>
          <input className="inp" id={"ai-" + k} placeholder={ph} value={mx(c, "ai:" + k)} onChange={e => setMx(c, "ai:" + k, e.target.value)} /></label>
      ))}
      {dup ? <div className="note bad" style={{ margin: "0 0 11px" }}><b>{dup.em} is already on the book.</b> It belongs to{" "}
        <a className="lnk" role="button" tabIndex={0} onClick={() => dispatch({ type: "go", v: "inv", id: dup.id })}
          onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: dup.id }); }}>{dup.n} ({dup.id})</a>
        {" "}— open their record instead of adding them twice.</div> : null}
      <label className="fi" style={{ marginBottom: 11 }}><span>Farm (LLP)</span>
        <select className="selw" id="ai-llp" value={mx(c, "ai:llp")} onChange={e => setMx(c, "ai:llp", e.target.value)}>
          <option value="">Pick the farm</option>
          {sale.map(x => <option key={x.id} value={x.id}>{x.Name} — {llpCounts(s, x).free} free · {money(x.Unit_Price)} a unit</option>)}
        </select></label>
      <div className="frow">
        <label className="fi" style={{ marginBottom: 11 }}><span>Units</span>
          <input className="inp" id="ai-units" inputMode="numeric" value={mx(c, "ai:units")} onChange={e => setMx(c, "ai:units", e.target.value.replace(/[^\d]/g, ""))} /></label>
        <label className="fi" style={{ marginBottom: 11 }}><span>Amount paid (₹)</span>
          <input className="inp" id="ai-paid" inputMode="numeric" value={mx(c, "ai:paid")} onChange={e => setMx(c, "ai:paid", e.target.value.replace(/[^\d]/g, ""))} /></label>
      </div>
      <label className="fi" style={{ marginBottom: 11 }}><span>Investment date</span>
        <input className="inp" type="date" id="ai-on" max={ymd(nowDay(s.data.NOW))} value={mx(c, "ai:on")} onChange={e => setMx(c, "ai:on", e.target.value)} /></label>
      {l && +mx(c, "ai:units") > 0 ? <p className="sm" style={{ margin: 0 }}>{mx(c, "ai:units")} unit{+mx(c, "ai:units") === 1 ? "" : "s"} on {l.Name} is{" "}
        {inr(+mx(c, "ai:units") * l.Unit_Price)}{+mx(c, "ai:paid") ? " · " + inr(Math.max(0, +mx(c, "ai:units") * l.Unit_Price - +mx(c, "ai:paid"))) + " still due" : ""}.</p> : null}
      <p className="sm" style={{ margin: "9px 0 0" }}>The receipt goes in as <b>pending</b>: the Head of Finance matches it, as with any other.</p>
    </>
  );
}
function addFoot(c: Ctx): ReactNode {
  const { s, me, dispatch } = c;
  const f = { n: mx(c, "ai:n"), em: mx(c, "ai:em"), ph: mx(c, "ai:ph"), llp: mx(c, "ai:llp"), units: +mx(c, "ai:units") || 0,
    paid: +mx(c, "ai:paid") || 0, on: mx(c, "ai:on") };
  const dup = !!dupEmail(s, f.em);
  const g = addInvestorGate(s, me, f);
  return (
    <button className="act" disabled={dup} title={dup ? "That email is already on the book" : g.ok ? undefined : g.msg || undefined}
      onClick={dup ? undefined : () => dispatch({ type: "addInvestor", ...f })}>Add the investor</button>
  );
}

/* ---- applock: Lock app access (M10-S21) ---- */
function lockBody(c: Ctx): ReactNode {
  const x = I(c.s, c.me, c.id); if (!x) return null;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>Sign-in is blocked from the moment you confirm. {x.n}&apos;s data stays in the app and nothing is emailed.
        The reason goes on the record with your name, and on their Activity.</p>
      <label className="fi"><span>Why</span>
        <textarea className="nta" id="lock-why" rows={3} placeholder="e.g. the investor asked us to pause access"
          value={mx(c, "lock:" + c.id)} onChange={e => setMx(c, "lock:" + c.id, e.target.value)} /></label>
    </>
  );
}
function lockFoot(c: Ctx): ReactNode {
  const why = mx(c, "lock:" + c.id).trim();
  return c.id ? <button className="act" disabled={!why} title={why ? undefined : "Say why first"}
    onClick={why ? () => c.dispatch({ type: "lockApp", id: c.id!, why }) : undefined}>Lock app access</button> : null;
}

/* ---- testlink: a one-time test sign-in link (M10-S23) ---- */
function Qr({ text }: { text: string }) {
  const q = qrCells(text), n = q.length, u = 6;
  return (
    <svg width={n * u + 16} height={n * u + 16} viewBox={`-8 -8 ${n * u + 16} ${n * u + 16}`} role="img"
      aria-label="QR code for the test sign-in link (placeholder)" style={{ background: "#fff", borderRadius: 6, display: "block" }}>
      {q.flatMap((r, y) => r.map((on, x) => on ? <rect key={x + "-" + y} x={x * u} y={y * u} width={u} height={u} fill="#111" /> : null))}
    </svg>
  );
}
function linkBody(c: Ctx): ReactNode {
  const { s } = c; const x = I(s, c.me, c.id); if (!x) return null;
  const l = testLinks(s).find(t => t.id === mx(c, "tl:" + x.id));
  if (l) {
    const st = testLinkState(l, nowFull(s.data.NOW));
    return (
      <>
        <div className="note warn" style={{ marginBottom: 12 }}><b>This is the full app as {x.n}.</b> It works once, until {fmtAt(l.expires)}. Nothing was emailed to them.</div>
        <p className="lbl">One-time link</p>
        <p className="mono" style={{ margin: "0 0 12px", wordBreak: "break-all" }}>{l.url}</p>
        <Qr text={l.url} />
        <p className="sm" style={{ margin: "7px 0 12px" }}>Placeholder QR — phase 1 draws it from the link; the app mints the real one.</p>
        <dl className="kv" style={{ marginTop: 0 }}>
          <dt>State</dt><dd><TagDot c={st === "live" ? "go" : "late"}>{st === "live" ? "live — one use" : st}</TagDot></dd>
          <dt>Made</dt><dd className="mono">{fmtAt(l.at)}</dd>
          <dt>Expires</dt><dd className="mono">{fmtAt(l.expires)} <span className="sm">or at first use</span></dd>
          <dt>Why</dt><dd>{l.why}</dd>
        </dl>
      </>
    );
  }
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>A one-time sign-in to the real investor app on another device, to check what {x.n} sees.
        It lasts {TESTLINK_MIN} minutes or one use, whichever comes first. Nothing is emailed to them; the link and a QR code show here.</p>
      <label className="fi"><span>Why you need it</span>
        <textarea className="nta" id="tl-why" rows={3} placeholder="e.g. check the payouts screen after the schedule changed"
          value={mx(c, "tlwhy:" + x.id)} onChange={e => setMx(c, "tlwhy:" + x.id, e.target.value)} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Who, whom, when and why go on System and on {x.n}&apos;s Activity.</p>
    </>
  );
}
function linkFoot(c: Ctx): ReactNode {
  const x = I(c.s, c.me, c.id); if (!x || mx(c, "tl:" + x.id)) return null;
  const why = mx(c, "tlwhy:" + x.id).trim();
  return <button className="act" disabled={!why} title={why ? undefined : "Say why first"}
    onClick={why ? () => c.dispatch({ type: "createTestLink", id: x.id, why }) : undefined}>Create test sign-in link</button>;
}

/* ---- the registry, spread into DRAWERS ---- */
export const MONEY_DRAWER_DEFS: Record<ImMoneyDrawerKey, DrawerDef> = {
  payout: { w: 430, t: "Mark a payout paid", sub: payoutSub, body: payoutBody, foot: payoutFoot },
  llp: { w: 450, t: "Farm LLP", sub: c => <LlpName {...c} />, body: c => <LlpBody {...c} />, foot: () => null },
  addinv: { w: 450, t: "Add an investor who already paid", sub: () => "no email goes to them", body: addBody, foot: addFoot },
  applock: { w: 430, t: "Lock app access", sub: nameOf, body: lockBody, foot: lockFoot },
  testlink: { w: 430, t: "Test sign-in link", sub: nameOf, body: linkBody, foot: linkFoot },
  preview: { w: 420, t: "App preview", sub: nameOf, body: c => (c.id ? <AppPreview s={c.s} me={c.me} dispatch={c.dispatch} id={c.id} /> : null), foot: () => null },
};

/* ---- the receipt drawer's allotment picker (M10-S07): pre-picked when there is one, required when several ---- */
export const pickedAllot = (s: ImPageProps["s"], me: string, id: string): string | null =>
  (s.ui.MX || {})["pick:" + id] || prePick(s, me, id);
export function AllotPick({ s, me, dispatch, id }: ImPageProps & { id: string }) {
  const rows = openAllots(s, me, id);
  if (!rows.length) return null;
  const cur = pickedAllot(s, me, id);
  return (
    <>
      <p className="lbl" style={{ marginTop: 14 }}>Which farm{rows.length > 1 ? " — pick one" : ""}</p>
      <div className="chips">{rows.map(a => (
        <button key={a.id} className={`chip ${cur === a.id ? "on" : ""}`} disabled={rows.length === 1}
          onClick={() => dispatch({ type: "mset", k: "pick:" + id, v: a.id })}>
          {llpName(s, a)} <span className="u">{allotUnits(a)} unit{allotUnits(a) === 1 ? "" : "s"} · {money(allotAmount(a))}{rows.length > 1 ? " · " + money(allotDue(s, me, a)) + " due" : ""}</span></button>
      ))}</div>
      <p className="sm" style={{ margin: "7px 0 0" }}>{rows.length > 1
        ? "A receipt belongs to one allotment. It is not saved until a farm is picked."
        : "Their only allotment — the receipt is linked to it."}</p>
    </>
  );
}
