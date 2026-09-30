"use client";

/* The Investors side's small shared pieces — imx.js section 8 "small shared pieces" and the
   people helpers of section 1 (pav, pname). Every Investors page and drawer imports from here;
   page files never reach into another page's folder.

   Every Investors-side component takes ImPageProps: the Investors state, who is signed in, and a
   dispatch for Investors actions. The store wires them (useIm in ./useIm.ts). */

import { useState, type ReactNode } from "react";
import { StepUp } from "./stepup";
import { I, may, maskAcct, maskPan, REVWHY, secOf, shown, who } from "@/lib/im";
import type { ImAction, ImInvestor, ImState } from "@/lib/im";

export type ImDispatch = (a: ImAction) => void;
export interface ImPageProps { s: ImState; me: string; dispatch: ImDispatch }

/* pcol/pav/pname — imx.js 121-129 */
const pcol = (s: ImState, k: string): string => {
  const w = who(s, k);
  return w.x ? "var(--ir)" : w.c ? "var(--c" + w.c + ")" : "var(--ink-3)";
};
export function ImPav({ s, k, cls }: { s: ImState; k: string; cls?: string }) {
  const xs = cls === "xs";
  return (
    <span className={`av ${cls || ""}`} style={{ ["--pc" as string]: pcol(s, k), width: xs ? "18px" : "24px",
      height: xs ? "18px" : "24px", fontSize: xs ? "8.5px" : "10px", display: "inline-grid", verticalAlign: "-4px" }}>
      {who(s, k).i}
    </span>
  );
}
export function ImPname({ s, k, b, first }: { s: ImState; k: string; b?: boolean; first?: boolean }) {
  const n = first ? who(s, k).n.split(" ")[0] : who(s, k).n;
  return <span className="nw"><ImPav s={s} k={k} cls="xs" /> {b ? <b>{n}</b> : n}</span>;
}

const Tag = ({ c, children }: { c?: string; children: ReactNode }) =>
  <span className={`tag${c ? " " + c : ""}`}><span className="dot" />{children}</span>;

export const KycTag = ({ x }: { x: ImInvestor }) =>
  x.kyc === "passed" ? <Tag c="go">KYC passed</Tag> : x.kyc === "failed" ? <Tag c="late">KYC failed</Tag> : <Tag c="due">KYC pending</Tag>;
export function StTag({ x }: { x: ImInvestor }) {
  switch (x.st) {
    case "allocated": return <Tag c="go">allocated</Tag>;
    case "paid": return <Tag c="br">paid, awaiting allotment</Tag>;
    case "reserved": return <Tag c="hold">reserved</Tag>;
    case "lapsed": return <Tag c="late">lapsed</Tag>;
    default: return null;
  }
}
export function DocTag({ d }: { d: { state: string } }) {
  switch (d.state) {
    case "signed": return <Tag c="go">signed</Tag>;
    case "awaiting": return <Tag c="due">awaiting signature</Tag>;
    case "issued": return <Tag>issued</Tag>;
    case "blocked": return <Tag c="late">blocked</Tag>;
    default: return null;
  }
}
export const ProvIR = ({ t }: { t?: string | null }) =>
  <span className="prov ir" title="Written on the lead side by the investor's IR — the Investors side only displays it">{t || "lead side"}</span>;

/* pii(x,f) — imx.js 1341-1365: the masked field, the one control that unmasks it, and the note
   that unmasking it is logged */
export function Pii({ s, me, dispatch, x, f }: ImPageProps & { x: ImInvestor | null; f: "pan" | "acct" }) {
  /* M01-S10-W1: the reason chosen, waiting on a step-up (the reveal runs only once one is open) */
  const [why, setWhy] = useState<string | null>(null);
  if (!x || !I(s, me, x.id)) return null;
  const isPan = f === "pan";
  const raw = isPan ? x.pan : (x.bank || {} as { acct?: string }).acct;
  const right = isPan ? may(s, me, "pii") : may(s, me, "bank");
  if (!raw) return <span className="sm">not on file</span>;
  if (shown(s, me, x.id, f)) return (
    <span className="pii"><span className="v">{raw}</span>
      <button className="eye" onClick={() => dispatch({ type: "hideAll" })} title="Hide it again">hide</button>
      <span className="sm">revealed — this is in the activity log</span></span>
  );
  const ask = s.ui.REVASK && s.ui.REVASK.id === x.id && s.ui.REVASK.f === f;
  return (
    <>
      <span className="pii"><span className="v hid">{isPan ? maskPan(raw) : maskAcct(raw)}</span>
        {right ? <button className="eye" onClick={() => dispatch({ type: "reveal", id: x.id, f })}
          title="Revealing it is recorded against your name">reveal</button> : null}</span>
      {ask && !why ? (
        <div className="note" style={{ marginTop: 7 }}>
          <b>Why do you need it?</b> This goes in the log with your name against it.
          <div className="chips" style={{ marginTop: 7 }}>
            {REVWHY[f].map(r => <button key={r} className="chip" onClick={() => setWhy(r)}>{r}</button>)}
            <button className="chip" onClick={() => dispatch({ type: "revCancel" })}>Cancel</button>
          </div>
        </div>
      ) : null}
      {/* M01-S10-W1: the reason first, then a fresh Zoho sign-in (GET /api/auth/step-up/status decides) */}
      <StepUp action={ask && why ? "reveal" : null}
        onOpen={() => { const w = why; setWhy(null); if (w) dispatch({ type: "reveal", id: x.id, f, why: w }); }}
        onCancel={() => { setWhy(null); dispatch({ type: "revCancel" }); }} />
      {right ? null : <span className="sm" style={{ display: "block" }}>{isPan
        ? "Compliance and the Head of Finance may reveal a PAN"
        : "Finance Operations and above may see a bank account"} — not this seat</span>}
    </>
  );
}

/* secBar(v,list) — imx.js 1314-1319 */
export interface ImSec { k: string; t: string; n?: number; warn?: boolean }
export function ImSecBar({ s, dispatch, v, list }: { s: ImState; dispatch: ImDispatch; v: string; list: ImSec[] }) {
  const cur = secOf(s.ui.SEC, v, list);
  return (
    <div className="secbar" role="tablist">
      {list.map(x => (
        <button key={x.k} className={`sc ${cur === x.k ? "on" : ""}`} role="tab" aria-selected={cur === x.k ? "true" : "false"}
          id={`sec-${v}-${x.k}`} onClick={() => dispatch({ type: "setSec", v, k: x.k })}>
          {x.t}{x.n ? <i className={x.warn ? "warn" : ""}>{x.n}</i> : null}
        </button>
      ))}
    </div>
  );
}
