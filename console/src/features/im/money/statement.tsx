"use client";

/* The bank statement card on Payments (M10-S05-W1): "Upload the bank statement", when the last one was reconciled, and
   after an upload the lines that matched and the lines that need an owner. Finance ("pay") seats only. D113: a credit line
   that agrees with a pending receipt matches it automatically; what does not land (paper, a refund's second hand) stays
   "awaiting the match" with the reason. */

import { useRef, useState } from "react";
import { fmtDate, may, money } from "@/lib/im";
import type { OwnerLine, OwnerReason, UploadView } from "@/server/money/statements";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { statementLatest, statementUpload } from "@/lib/data/endpoints/statements";
import type { ImPageProps } from "../common";

const WHY: Record<OwnerReason, string> = {
  "no-receipt": "no receipt records this credit", "debit-no-receipt": "a debit with no refund receipt behind it",
  "amount-differs": "the amount differs from the receipt", "date-differs": "the date differs from the receipt",
  "kind-differs": "the receipt is a different kind", "duplicate-line": "the same line appears twice",
  "receipt-claimed": "only an IR's report so far — not recorded", "receipt-not-found": "the receipt was answered 'not found'",
  "receipt-reversed": "the receipt was reversed",
};
const OWNER: Record<OwnerLine["owner"], string> = { "finance-operations": "Finance Operations", "head-of-finance": "Head of Finance" };
const rupees = (paise: number) => money(Math.round(paise / 100));
/** "2026-09-28T14:05:00+05:30" → "28 Sep 2026" (the day is what the card says) */
const day = (iso: string | null) => (iso ? fmtDate(iso.slice(0, 10)) : "—");

export function StatementCard({ s, me, dispatch }: ImPageProps) {
  const last = useApiRead(statementLatest, { s, me }, undefined);
  const upload = useApiWrite(statementUpload, { s, me }, dispatch);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [got, setGot] = useState<UploadView | null>(null);
  if (!may(s, me, "pay")) return null;

  const send = async (f: File | undefined) => {
    if (!f) return;
    const form = new FormData(); form.append("file", f);
    setBusy(true); setSaid(null);
    const r = await upload({ form });
    setBusy(false);
    if (pick.current) pick.current.value = "";
    if (r.ok) setGot(r.data); else setSaid(r.error);
  };
  const latest = last.state === "ok" ? last.data.latest : null;
  return (
    <div className="card" style={{ marginBottom: 8 }}><div className="ch"><h3>Bank statement</h3><div className="sp" />
      <span className="sm">{last.state === "loading" ? "Reading…" : latest
        ? "Last reconciled " + day(latest.reconciledAt) + " · " + (latest.from ? day(latest.from) + " to " + day(latest.to) : latest.name)
        : "Last reconciled: none yet — no statement has been uploaded"}</span></div>
      <div className="cb">
        <input ref={pick} type="file" accept=".csv,.txt,text/csv" hidden aria-label="Bank statement file" onChange={e => void send(e.target.files?.[0])} />
        <button className="act" disabled={busy} onClick={() => pick.current?.click()}>{busy ? "Reading the statement…" : "Upload the bank statement"}</button>
        <p className="sm" style={{ margin: "8px 0 0" }}>One week's CSV from net banking, up to 2 MB. The statement confirms receipts from the bank: a
          pending receipt it agrees with is matched, and it lists what has no owner.</p>
        {said ? <p className="sm" role="alert" style={{ margin: "8px 0 0" }}>{said}</p> : null}
        {got ? <Reconciled u={got} /> : null}
      </div></div>
  );
}

function Reconciled({ u }: { u: UploadView }) {
  const c = u.counts;
  return (
    <div className="drwsec">
      <p className="lbl">{u.name} · {day(u.from)} to {day(u.to)}</p>
      <p className="sm" style={{ margin: "0 0 8px" }}>{c.lines} lines · {c.matched} matched{c.autoMatched ? " (" + c.autoMatched + " just now)" : ""} · {c.awaitingMatch} awaiting the match · {c.needsOwner} need an owner
        {c.skipped ? " · " + c.skipped + " skipped" : ""}</p>
      <p className="lbl">Matched</p>
      {u.matched.length ? u.matched.map(m => (
        <div className="led" key={m.line + m.receiptId}>
          <span className={`tag ${m.state === "matched" ? "go" : "due"}`}>{m.state === "matched" ? (m.autoMatched ? "matched now" : "matched") : "awaiting match"}</span>
          <span style={{ minWidth: 0 }}><b className="mono">{m.receiptId}</b>
            <div className="sm">line {m.line} · {day(m.date)} · {m.kind} <span className="mono">{m.utr}</span>
              {m.state === "awaiting-match" && m.matchNote ? " · " + m.matchNote : ""}</div></span>
          <span className="amt">{m.direction === "debit" ? "−" : ""}{rupees(m.amountPaise)}</span>
        </div>
      )) : <p className="sm" style={{ margin: 0 }}>No line matched a receipt.</p>}
      <p className="lbl" style={{ marginTop: 12 }}>Needs an owner</p>
      {u.needsOwner.length ? u.needsOwner.map(n => (
        <div className="led" key={n.line}>
          <span className="tag due">{OWNER[n.owner]}</span>
          <span style={{ minWidth: 0 }}><b>line {n.line} · {day(n.date)}</b>
            <div className="sm">{WHY[n.reason]}{n.receiptId ? " · " + n.receiptId : ""}{n.utr ? " · " : ""}<span className="mono">{n.utr ?? ""}</span></div>
            <div className="sm">{n.narration}</div></span>
          <span className="amt">{n.direction === "debit" ? "−" : ""}{rupees(n.amountPaise)}</span>
        </div>
      )) : <p className="sm" style={{ margin: 0 }}>Every line has an owner.</p>}
    </div>
  );
}
