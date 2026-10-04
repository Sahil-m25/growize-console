"use client";

/* The drawers the later owner decisions added (not in the prototype): Mark paid (M10-S20), a farm
   LLP (M11-S01/S02), Add investor (M09-S09), Lock app access (M10-S21), Test sign-in link (M10-S23)
   and the app preview (M10-S22). Same frame, classes and gates as the prototype's drawers; their
   form fields live in ui.MX, written with {type:"mset"}. */

import { useRef, type ReactNode } from "react";
import {
  I, PAYOUT_MODES, TESTLINK_MIN, addInvestorGate, allotDue, allotAmount, allotPayStatus, allotTxns, allotUnits,
  allotsOnLlp, dupEmail, fmtDate, inr, llpCounts, llpName, llpOf, llps, may,
  money, nowDay, onSale, openAllots, payoutNet, prePick, qrCells, ymd, notFin,
} from "@/lib/im";
import type { ImMoneyDrawerKey, ImPayoutMode } from "@/lib/im";
import type { ImPageProps } from "../common";
import { AppPreview } from "./preview";
import { newIdempotencyKey, useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { FarmDocs } from "../paper2/FarmDocs";
import { farmOne } from "@/lib/data/endpoints/farms";
import { farmAllotments } from "@/lib/data/endpoints/allotments";
import { addPaid, investorRecord } from "@/lib/data/endpoints/investors";
import { payoutPaid, payoutQueue, payoutSchedule } from "@/lib/data/endpoints/payouts";
import { appCard, appLock, testLinkList, testLinkMake, type MadeLink } from "@/lib/data/endpoints/app";

type Ctx = ImPageProps & { id: string | null };
type Part = (c: Ctx) => ReactNode;
interface DrawerDef { w: number; t: string; sub: Part; body: Part; foot: Part }

const mx = (c: Ctx, k: string): string => (c.s.ui.MX || {})[k] || "";
const setMx = (c: Ctx, k: string, v: string) => c.dispatch({ type: "mset", k, v });
/** the investor's name is the record's (GET /api/investors/[id]/record), never a lookup in the book */
function InvName({ s, me, id }: Ctx) {
  const r = useApiRead(investorRecord, { s, me }, id);
  return <>{r.state === "ok" ? r.data.record.investor.n : ""}</>;
}
const nameOf = (c: Ctx): ReactNode => <InvName {...c} />;
const useInvName = (c: Ctx): string => { const r = useApiRead(investorRecord, { s: c.s, me: c.me }, c.id); return r.state === "ok" ? r.data.record.investor.n : ""; };
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;
export const payTagClass = (st: string) => (st === "Full" ? "go" : st === "Partial" ? "due" : "");
export const poTagClass = (st: string) =>
  st === "Paid" ? "go" : st === "Failed" ? "late" : st === "Held" ? "due" : st === "Cancelled" ? "" : "br";

/* ---- payout: Mark paid (M10-S20) ----
   M10-S20-W1: the payout is its line on the allotment's schedule (GET /api/payouts/allotments/[id]); the queue and the
   Payouts tab put the allotment id in "po:al" before opening the drawer. Mark paid is POST /api/payouts/[id]/paid with an
   Idempotency-Key per press (kept while the same press is retried). The UTR is only ever shown masked. */
function usePayoutLine(c: Ctx) {
  const al = mx(c, "po:al") || null;
  const r = useApiRead(payoutSchedule, { s: c.s, me: c.me }, al);
  return { r, line: r.state === "ok" ? r.data.payouts.find(p => p.id === c.id) ?? null : null };
}
function PayoutSub(c: Ctx) {
  const q = useApiRead(payoutQueue, { s: c.s, me: c.me }, undefined);
  const l = q.state === "ok" ? q.data.due.concat(q.data.overdue).find(p => p.id === c.id) : null;
  return <>{l ? (l.investor.name ?? l.investor.id) + " · " + (l.farm.name ?? l.farm.id) : mx(c, "po:al")}</>;
}
function PayoutBody(c: Ctx) {
  const { s } = c; const { r, line: p } = usePayoutLine(c);
  if (r.state === "idle") return null;
  if (r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the payout…</p>;
  if (r.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{r.err.error}</p>;
  if (!p) return <p className="sm" role="alert" style={{ margin: 0 }}>Not found, or not yours to open.</p>;
  const tds = mx(c, "po:tds") === "" ? p.tds : Math.max(0, +mx(c, "po:tds") || 0);
  const mode = (mx(c, "po:mode") || "NEFT") as ImPayoutMode;
  const on = mx(c, "po:on") || ymd(nowDay(s.data.NOW));
  if (p.state === "Paid") return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Instalment</dt><dd>{p.instalment} of 60 · {fmtDate(p.month)}</dd>
        <dt>State</dt><dd><TagDot c="go">Paid</TagDot></dd>
        <dt>Paid on</dt><dd className="mono">{fmtDate(p.paidOn)}</dd>
        <dt>How</dt><dd>{p.mode} <span className="mono">{p.utrMasked}</span></dd>
        <dt>Paid by</dt><dd>{p.paidBy?.name ?? "—"}</dd>
        <dt>Gross · TDS · net</dt><dd className="mono">{inr(p.gross)} · {inr(p.tds)} · <b>{inr(p.net)}</b></dd>
      </dl>
      <p className="sm" style={{ margin: "12px 0 0" }}>A payout is paid once. This one is on the record and cannot be marked again.</p>
    </>
  );
  return (
    <>
      <dl className="kv" style={{ marginTop: 0, marginBottom: 12 }}>
        <dt>Instalment</dt><dd>{p.instalment} of 60 · {fmtDate(p.month)}</dd>
        <dt>Due on</dt><dd className="mono">{fmtDate(p.dueOn)}</dd>
        <dt>State</dt><dd><TagDot c={poTagClass(p.state ?? "")}>{p.state}</TagDot></dd>
        <dt>Gross</dt><dd className="mono">{inr(p.gross)}</dd>
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
        <input className="inp" id="po-tds" inputMode="numeric" value={mx(c, "po:tds") === "" ? String(p.tds) : mx(c, "po:tds")}
          onChange={e => setMx(c, "po:tds", e.target.value.replace(/[^\d]/g, ""))} /></label>
      <p className="sm" style={{ margin: "7px 0 0" }}>Typed by Finance, ₹0 unless something was deducted. The console never works TDS out.</p>
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Net to the investor</dt><dd className="mono"><b>{inr(payoutNet(p.gross, tds))}</b> <span className="sm">= {inr(p.gross)} − {inr(tds)}</span></dd>
      </dl></div>
    </>
  );
}
function PayoutFoot(c: Ctx) {
  const { s, me, dispatch } = c; const { line: p } = usePayoutLine(c);
  const write = useApiWrite(payoutPaid, { s, me }, dispatch);
  const key = useRef(newIdempotencyKey());
  if (!p || !may(s, me, "pay") || p.state === "Cancelled") return null;
  if (p.state === "Paid") return <span className="sm">Paid — nothing more to do here.</span>;
  const utr = mx(c, "po:utr").trim();
  const tds = mx(c, "po:tds") === "" ? p.tds : +mx(c, "po:tds") || 0;
  const press = () => {
    void write({ id: p.id, utr, tds, mode: (mx(c, "po:mode") || "NEFT") as ImPayoutMode, paidOn: mx(c, "po:on") || ymd(nowDay(s.data.NOW)),
      modifiedTime: p.modifiedTime }, { idempotencyKey: key.current }).then(r => {
      if (!r.ok) return;                       /* a refusal is already the page note; the same key retries the same press */
      key.current = newIdempotencyKey();
      for (const k of ["po:utr", "po:tds", "po:on", "po:mode"]) setMx(c, k, "");
      dispatch({ type: "closeDrawer" });
    });
  };
  return <button className="act" disabled={!utr} title={utr ? undefined : "The bank's UTR first"} onClick={utr ? press : undefined}>Mark paid</button>;
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
  /* M11-S02-W1: "who holds units here" is GET /api/farms/[id]/allotments */
  const who_ = useApiRead(farmAllotments, { s, me }, c.id);
  if (r.state === "idle") return null;
  if (r.state === "loading") return <p className="sm" style={{ margin: 0 }}>Reading the farm…</p>;
  if (r.state === "error") return <p className="sm" role="alert" style={{ margin: 0 }}>{r.err.error}</p>;
  const { farm: l, superUser } = r.data;
  const held = who_.state === "ok" ? who_.data : null;
  const rows = held ? held.allotments : [], fin = held ? held.money : false;
  const matched = allotsOnLlp(s, me, l.id).flatMap(a => allotTxns(s, me, a)).filter(t => t.rec === "matched" && t.kind !== "refund" && t.kind !== "forfeit")
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
        {who_.state === "loading" ? <p className="sm" style={{ margin: 0 }}>Reading who holds units…</p> : null}
        {who_.state === "error" ? <p className="sm" role="alert" style={{ margin: 0 }}>{who_.err.error}</p> : null}
        {who_.state === "ok" ? (rows.length ? rows.map(a => (
          <div className="led" key={a.id}>
            <span className={`tag ${a.status === "Issued" ? "go" : a.status === "Cancelled" ? "late" : "hold"}`}>{a.status}</span>
            <span style={{ minWidth: 0 }}>{a.investor.id ? <a className="lnk" role="button" tabIndex={0}
              onClick={() => dispatch({ type: "go", v: "inv", id: a.investor.id })}
              onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: a.investor.id }); }}>{a.investor.name ?? a.investor.id}</a>
              : <b>No customer on this allotment</b>}
              {a.linked ? null : <div><span className="tag late" data-testid="needs-link">Needs a link</span> <span className="sm">no {a.investor.id ? "LLP" : "Customer"} — link it in Zoho</span></div>}
              <div className="sm">{a.committedUnits} unit{a.committedUnits === 1 ? "" : "s"}{fin && a.amount != null ? " · " + money(a.amount) + " · " + a.paymentStatus : ""}</div></span>
          </div>
        )) : <p className="sm" style={{ margin: 0 }}>Nobody holds units on this farm{superUser || fin ? "" : " that you look after"}.</p>) : null}
        {fin && rows.length ? <p className="sm" style={{ margin: "9px 0 0" }}>Matched receipts on this farm: <b>{money(matched)}</b> — the same total Payments shows for {l.name.split(" — ")[0]}.</p> : null}
      </div>
      <FarmDocs s={s} me={me} id={l.id} />
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
          <input className="inp" id={"ai-" + k} placeholder={ph} value={mx(c, "ai:" + k)}
          onChange={e => { setMx(c, "ai:" + k, e.target.value); if (k === "em" && mx(c, "ai:dup")) setMx(c, "ai:dup", ""); }} /></label>
      ))}
      {dup ? <div className="note bad" style={{ margin: "0 0 11px" }}><b>{dup.em} is already on the book.</b> It belongs to{" "}
        <a className="lnk" role="button" tabIndex={0} onClick={() => dispatch({ type: "go", v: "inv", id: dup.id })}
          onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: dup.id }); }}>{dup.n} ({dup.id})</a>
        {" "}— open their record instead of adding them twice.</div> : null}
      {mx(c, "ai:dup") && !dup ? <div className="note bad" style={{ margin: "0 0 11px" }} role="alert"><b>{mx(c, "ai:em")} is already on the book.</b> It belongs to{" "}
        <a className="lnk" role="button" tabIndex={0} onClick={() => dispatch({ type: "go", v: "inv", id: mx(c, "ai:dup") })}
          onKeyDown={e => { if (e.key === "Enter") dispatch({ type: "go", v: "inv", id: mx(c, "ai:dup") }); }}>{mx(c, "ai:dup")}</a>
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
/* M09-S09-W1: the button is POST /api/investors/add-paid (lib/data/endpoints/investors) with an Idempotency-Key per press
   (kept for a retry of the same press). A 409 keeps the drawer open and links to the investor the email already belongs to. */
function AddHere({ c }: { c: Ctx }) {
  const { s, me, dispatch } = c;
  const mode = useApiMode();
  const add = useApiWrite(addPaid, { s, me }, dispatch);
  const press1 = useRef<{ sig: string; key: string } | null>(null);
  const f = { name: mx(c, "ai:n"), email: mx(c, "ai:em"), mobile: mx(c, "ai:ph"), llpId: mx(c, "ai:llp"), units: +mx(c, "ai:units") || 0,
    amountPaid: +mx(c, "ai:paid") || 0, investmentDate: mx(c, "ai:on") };
  const dup = !!dupEmail(s, f.email);
  const g = addInvestorGate(s, me, { n: f.name, em: f.email, ph: f.mobile, llp: f.llpId, units: f.units, paid: f.amountPaid, on: f.investmentDate });
  const press = async () => {
    /* one key per press of the same form: a retry after a network error replays, an edited form is a new request */
    const sig = JSON.stringify(f);
    if (!press1.current || press1.current.sig !== sig) press1.current = { sig, key: newIdempotencyKey() };
    const r = await add(f, { idempotencyKey: press1.current.key });
    if (r.ok && mode === "live") dispatch({ type: "closeDrawer" });
    else if (!r.ok && r.status === 409 && r.recordId) setMx(c, "ai:dup", r.recordId);
  };
  return (
    <button className="act" disabled={dup} title={dup ? "That email is already on the book" : g.ok ? undefined : g.msg || undefined}
      onClick={dup ? undefined : () => void press()}>Add the investor</button>
  );
}
function addFoot(c: Ctx): ReactNode { return <AddHere c={c} />; }

/* ---- applock: Lock app access (M10-S21) ----
   M10-S21-W1: DELETE /api/investors/[id]/unlock { reason, expectedModifiedTime } — the card's modifiedTime goes back (D44). */
function LockBody(c: Ctx) {
  const n = useInvName(c);
  if (!c.id) return null;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>Sign-in is blocked from the moment you confirm. {n}&apos;s data stays in the app and nothing is emailed.
        The reason goes on the record with your name, and on their Activity.</p>
      <label className="fi"><span>Why</span>
        <textarea className="nta" id="lock-why" rows={3} placeholder="e.g. the investor asked us to pause access"
          value={mx(c, "lock:" + c.id)} onChange={e => setMx(c, "lock:" + c.id, e.target.value)} /></label>
    </>
  );
}
function LockFoot(c: Ctx) {
  const card = useApiRead(appCard, { s: c.s, me: c.me }, c.id);
  const write = useApiWrite(appLock, { s: c.s, me: c.me }, c.dispatch);
  const why = mx(c, "lock:" + c.id).trim();
  if (!c.id) return null;
  const press = () => void write({ id: c.id!, reason: why, expectedModifiedTime: card.state === "ok" ? card.data.card.modifiedTime : null }).then(r => {
    if (!r.ok) return;
    setMx(c, "lock:" + c.id, "");
    c.dispatch({ type: "closeDrawer" });
  });
  return <button className="act" disabled={!why} title={why ? undefined : "Say why first"} onClick={why ? press : undefined}>Lock app access</button>;
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
/* M10-S23-W1: POST /api/investors/[id]/test-link { why, confirm } — for a real investor the first press is answered 409
   confirm-needed with the warning, which the drawer shows before it asks again with confirm. The link itself (url) exists only
   in the POST's answer, so it is kept in the drawer's own form state ("tlmade:<id>") — GET lists the earlier ones. */
const madeOf = (c: Ctx): MadeLink | null => { try { const v = mx(c, "tlmade:" + c.id); return v ? JSON.parse(v) as MadeLink : null; } catch { return null; } };
const fmtMs = (t: number): string => fmtDate(new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10)).slice(0, 6) + " "
  + new Date(t + 5.5 * 3_600_000).toISOString().slice(11, 16);
function LinkBody(c: Ctx) {
  const n = useInvName(c);
  const old = useApiRead(testLinkList, { s: c.s, me: c.me }, c.id);
  if (!c.id) return null;
  const l = madeOf(c);
  const ask = mx(c, "tlask:" + c.id);
  const earlier = old.state === "ok" ? old.data.links.filter(e => !l || e.id !== l.id) : [];
  const history = earlier.length ? (
    <div className="drwsec"><p className="lbl">Earlier links for {n || "this investor"}</p>
      {earlier.map(e => <div className="led" key={e.id}><span className={`tag ${e.state === "live" ? "go" : ""}`}>{e.state}</span>
        <span style={{ minWidth: 0 }}><span className="sm mono">{fmtMs(e.at)}</span><div className="sm">{e.why}</div></span></div>)}</div>) : null;
  if (l) {
    return (
      <>
        <div className="note warn" style={{ marginBottom: 12 }}><b>This is the full app as {n}.</b> It works once, until {fmtMs(l.expiresAt)}. Nothing was emailed to them.</div>
        <p className="lbl">One-time link</p>
        <p className="mono" style={{ margin: "0 0 12px", wordBreak: "break-all" }}>{l.url}</p>
        <Qr text={l.url} />
        <p className="sm" style={{ margin: "7px 0 12px" }}>Placeholder QR — phase 1 draws it from the link; the app mints the real one.</p>
        <dl className="kv" style={{ marginTop: 0 }}>
          <dt>State</dt><dd><TagDot c={l.state === "live" ? "go" : "late"}>{l.state === "live" ? "live — one use" : l.state}</TagDot></dd>
          <dt>Made</dt><dd className="mono">{fmtMs(l.at)}</dd>
          <dt>Expires</dt><dd className="mono">{fmtMs(l.expiresAt)} <span className="sm">or at first use</span></dd>
          <dt>Why</dt><dd>{l.why}</dd>
        </dl>
        {history}
      </>
    );
  }
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>A one-time sign-in to the real investor app on another device, to check what {n} sees.
        It lasts {TESTLINK_MIN} minutes or one use, whichever comes first. Nothing is emailed to them; the link and a QR code show here.</p>
      <label className="fi"><span>Why you need it</span>
        <textarea className="nta" id="tl-why" rows={3} placeholder="e.g. check the payouts screen after the schedule changed"
          value={mx(c, "tlwhy:" + c.id)} onChange={e => setMx(c, "tlwhy:" + c.id, e.target.value)} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Who, whom, when and why go on System and on {n}&apos;s Activity.</p>
      {ask ? <div className="note warn" role="alert" style={{ marginTop: 12, whiteSpace: "pre-line" }}>{ask}</div> : null}
      {history}
    </>
  );
}
function LinkFoot(c: Ctx) {
  const write = useApiWrite(testLinkMake, { s: c.s, me: c.me }, c.dispatch);
  if (!c.id) return null;
  if (madeOf(c)) return <span className="sm">The link works once.</span>;
  const why = mx(c, "tlwhy:" + c.id).trim(), asked = !!mx(c, "tlask:" + c.id);
  const press = () => void write({ id: c.id!, why, confirm: asked }).then(r => {
    if (r.ok) { setMx(c, "tlask:" + c.id, ""); setMx(c, "tlmade:" + c.id, JSON.stringify(r.data)); setMx(c, "tlwhy:" + c.id, ""); return; }
    if (r.code === "confirm-needed") setMx(c, "tlask:" + c.id, r.ask ?? r.error);   /* the route's warning, before the second press */
  });
  return <button className="act" disabled={!why} title={why ? undefined : "Say why first"} onClick={why ? press : undefined}>
    {asked ? "Make the link" : "Create test sign-in link"}</button>;
}

/* ---- the registry, spread into DRAWERS ---- */
export const MONEY_DRAWER_DEFS: Record<ImMoneyDrawerKey, DrawerDef> = {
  payout: { w: 430, t: "Mark a payout paid", sub: c => <PayoutSub {...c} />, body: c => <PayoutBody {...c} />, foot: c => <PayoutFoot {...c} /> },
  llp: { w: 450, t: "Farm LLP", sub: c => <LlpName {...c} />, body: c => <LlpBody {...c} />, foot: () => null },
  addinv: { w: 450, t: "Add an investor who already paid", sub: () => "no email goes to them", body: addBody, foot: addFoot },
  applock: { w: 430, t: "Lock app access", sub: nameOf, body: c => <LockBody {...c} />, foot: c => <LockFoot {...c} /> },
  testlink: { w: 430, t: "Test sign-in link", sub: nameOf, body: c => <LinkBody {...c} />, foot: c => <LinkFoot {...c} /> },
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
