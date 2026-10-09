"use client";

/* GC-1527 / D137 — two drawers on the Investors side:
     convert   (id = the Lead id) Finance's Money view of a lead that is not an investor yet: the receipts recorded on the lead with
               the 10% trail (IST date-time, amount, masked reference, who matched it, running total), a receipt to record, and the
               terms (farm, units). "Save" sends what is filled in: the receipt is recorded (matched — Finance's own, D113) and, with
               the terms, the investor is created the moment the matched sum reaches 10% (POST /api/leads/[id]/conversion).
               Digital Infrastructure reads it; only Finance Operations and the Head of Finance write (the route decides).
     fullpaid  (id = the Contact id; MX "fp:allot" = the allotment) D137 ruling 3: mark a Reserved allotment fully paid by hand,
               with a reason that goes on the record under the person's name (POST /api/investors/[id]/full-paid). The automatic
               path needs no drawer: Finance matching the remainder stamps it.
   No native dialogs (M18-S11). Live only: the fixture answers "live-only". */

import type { ReactNode } from "react";
import { who } from "@/lib/im";
import type { ImPageProps } from "../common";
import { newIdempotencyKey, useApiRead, useApiWrite } from "@/lib/data/api";
import { farmList } from "@/lib/data/endpoints/farms";
import { leadConfirm, leadConversion, markFullPaid } from "@/lib/data/endpoints/conversion";
import { RECEIPT_MODES } from "@/lib/money/receipt-modes";
import { TenTrail } from "@/components/money/TenTrail";

type Ctx = ImPageProps & { id: string | null };
const mx = (c: Ctx, k: string): string => (c.s.ui.MX || {})[k] || "";
const setMx = (c: Ctx, k: string, v: string) => c.dispatch({ type: "mset", k, v });
const KINDS = [["Advance", "Advance"], ["Part", "Part payment"], ["Full", "Paid in full"]] as const;
const MANUAL_MIN = 10;

function useTerms(c: Ctx) {
  const llpId = mx(c, "cv:llp:" + c.id) || null;
  const u = Number(mx(c, "cv:units:" + c.id));
  return { llpId, units: Number.isSafeInteger(u) && u > 0 ? u : null };
}

function ConvertBody(c: Ctx) {
  const t = useTerms(c);
  const r = useApiRead(leadConversion, { s: c.s, me: c.me }, c.id ? { leadId: c.id, llpId: t.llpId, units: t.units } : null);
  const farms = useApiRead(farmList, { s: c.s, me: c.me }, undefined);
  if (!c.id) return null;
  const m = r.state === "ok" ? r.data.money : null;
  const open = farms.state === "ok" ? farms.data.rows.filter((f) => f.onSale) : [];
  const nameOf = (id: string) => who(c.s, id).n || "Finance";
  return (
    <>
      {r.state === "error" ? <p className="note bad" role="alert" style={{ marginTop: 0 }}>{r.err.error}</p> : null}
      {r.state === "loading" ? <p className="sm">Reading the lead&apos;s money…</p> : null}
      {m?.investor ? <p className="note" role="status" style={{ marginTop: 0 }}>Already an investor{m.investor.code ? " · " + m.investor.code : ""}. Saving again links any receipt still on the lead to their allotment.</p>
        : <p className="sm" style={{ marginTop: 0 }}>The investor record is created only when Finance-matched money on this lead reaches 10% of what they commit (GC-1527). Part payments count.</p>}
      <div className="drwsec"><p className="lbl">What they commit to</p>
        <label className="fi"><span>Farm</span>
          <select className="inp" value={t.llpId ?? ""} onChange={(e) => setMx(c, "cv:llp:" + c.id, e.target.value)}>
            <option value="">Pick the farm…</option>
            {open.map((f) => <option key={f.id} value={f.id}>{f.name}{f.block ? " · Block " + f.block : ""}{f.freeUnits != null ? " · " + f.freeUnits + " free" : ""}</option>)}
          </select></label>
        <label className="fi"><span>Units{m?.unitsInterested ? ` (the lead says ${m.unitsInterested})` : ""}</span>
          <input className="inp" inputMode="numeric" value={mx(c, "cv:units:" + c.id)} placeholder={m?.unitsInterested ? String(m.unitsInterested) : ""}
            onChange={(e) => setMx(c, "cv:units:" + c.id, e.target.value.replace(/\D/g, "").slice(0, 5))} /></label>
      </div>
      {m ? <TenTrail trail={m.trail} nameOf={nameOf} title={m.farm ? "The 10% on this lead" : "Matched on this lead (pick the farm to see the 10%)"} /> : null}
      <div className="drwsec"><p className="lbl">Record money received (it is matched as yours)</p>
        <div className="chips">{KINDS.map(([k, label]) => (
          <button key={k} type="button" className={`chip ${mx(c, "cv:kind:" + c.id) === k ? "on" : ""}`} aria-pressed={mx(c, "cv:kind:" + c.id) === k}
            onClick={() => setMx(c, "cv:kind:" + c.id, k)}>{label}</button>))}</div>
        <label className="fi"><span>Amount (₹, whole rupees)</span>
          <input className="inp" inputMode="numeric" value={mx(c, "cv:amt:" + c.id)} onChange={(e) => setMx(c, "cv:amt:" + c.id, e.target.value.replace(/\D/g, "").slice(0, 12))} /></label>
        <label className="fi"><span>Mode</span>
          <select className="inp" value={mx(c, "cv:mode:" + c.id)} onChange={(e) => setMx(c, "cv:mode:" + c.id, e.target.value)}>
            <option value="">Pick…</option>{RECEIPT_MODES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        <label className="fi"><span>Bank reference (UTR)</span>
          <input className="inp mono" autoComplete="off" value={mx(c, "cv:utr:" + c.id)} onChange={(e) => setMx(c, "cv:utr:" + c.id, e.target.value.toUpperCase().slice(0, 80))} /></label>
        <label className="fi"><span>Received on</span>
          <input className="inp" type="date" value={mx(c, "cv:on:" + c.id)} onChange={(e) => setMx(c, "cv:on:" + c.id, e.target.value)} /></label>
      </div>
      {mx(c, "cv:done:" + c.id) ? <p className="note" role="status">{mx(c, "cv:done:" + c.id)}</p> : null}
    </>
  );
}

function ConvertFoot(c: Ctx) {
  const t = useTerms(c);
  const write = useApiWrite(leadConfirm, { s: c.s, me: c.me }, c.dispatch);
  if (!c.id) return null;
  const amt = Number(mx(c, "cv:amt:" + c.id));
  const receipt = amt > 0 ? { kind: mx(c, "cv:kind:" + c.id), amount: amt, mode: mx(c, "cv:mode:" + c.id), utr: mx(c, "cv:utr:" + c.id), receivedOn: mx(c, "cv:on:" + c.id) } : null;
  const terms = t.llpId ? { llpId: t.llpId, ...(t.units ? { units: t.units } : {}) } : null;
  const ready = !!receipt || !!terms;
  const press = () => void write({ leadId: c.id!, receipt, terms }, { idempotencyKey: newIdempotencyKey() }).then((r) => {
    if (!r.ok) { setMx(c, "cv:done:" + c.id, r.error); return; }
    for (const k of ["amt", "utr", "kind", "mode", "on"]) setMx(c, `cv:${k}:${c.id}`, "");
    const v = r.data.converted;
    setMx(c, "cv:done:" + c.id, v
      ? (v.already ? "Already an investor" : "Investor created") + (v.code ? " · " + v.code : "") + " — Reserved, balance due by " + v.holdUntil
        + (v.relinkLeft.length ? ` · ${v.relinkLeft.length} receipt(s) still to link — press Save again` : "")
        + (v.originatingIr === "not-written" ? " · the originating IR is filled by Zoho's workflow" : "")
      : r.data.recorded ? "Recorded and matched · " + r.data.recorded.refMasked + (r.data.money.trail.reached ? "" : " — the 10% is not reached yet") : "Saved.");
  });
  return <button className="act" disabled={!ready} title={ready ? undefined : "Fill in a receipt or pick the farm"} onClick={ready ? press : undefined}>
    {terms ? "Save and confirm the 10%" : "Record it"}</button>;
}

function FullPaidBody(c: Ctx): ReactNode {
  if (!c.id) return null;
  return (
    <>
      <p className="sm" style={{ marginTop: 0 }}>Normally this happens by itself: when Finance matches the remaining money the allotment converts in full,
        stamped with who and when. Mark it by hand only when the money is in some other way. Your reason goes on the investor&apos;s record under your name.</p>
      <label className="fi"><span>Why mark it fully paid by hand</span>
        <textarea className="nta" rows={3} value={mx(c, "fp:why:" + c.id)} onChange={(e) => setMx(c, "fp:why:" + c.id, e.target.value)} /></label>
      <p className="sm">At least {MANUAL_MIN} characters.</p>
      {mx(c, "fp:done:" + c.id) ? <p className="note" role="status">{mx(c, "fp:done:" + c.id)}</p> : null}
    </>
  );
}
function FullPaidFoot(c: Ctx): ReactNode {
  const write = useApiWrite(markFullPaid, { s: c.s, me: c.me }, c.dispatch);
  if (!c.id) return null;
  const why = mx(c, "fp:why:" + c.id).trim(), allot = mx(c, "fp:allot:" + c.id);
  const ok = why.length >= MANUAL_MIN && !!allot;
  const press = () => void write({ contactId: c.id!, allotmentId: allot, reason: why }).then((r) => {
    setMx(c, "fp:done:" + c.id, r.ok ? "Marked fully paid" + (r.data.stamped.already ? " (it already was)" : "") : r.error);
    if (r.ok) setMx(c, "fp:why:" + c.id, "");
  });
  return <button className="act" disabled={!ok} onClick={ok ? press : undefined}>Mark fully paid</button>;
}

export const CONVERT_DRAWER_DEFS = {
  convert: { w: 520, t: "Money on this lead", sub: () => "the investor is created at the 10%", body: (c: Ctx) => <ConvertBody {...c} />, foot: (c: Ctx) => <ConvertFoot {...c} /> },
  fullpaid: { w: 430, t: "Mark fully paid by hand", sub: () => "logged under your name", body: (c: Ctx) => <FullPaidBody {...c} />, foot: (c: Ctx) => <FullPaidFoot {...c} /> },
};
