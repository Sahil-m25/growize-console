"use client";
import { useLpHere } from "./here";

/* ── DRAWERS.money / .paper / .acct / .claim — the read-only finance mirror, and the one form
   this file adds on top of it: the payment-report draft. ir-console-redesigned.html 8830-8985
   (imBanner/financeDocumentHistoryBlock/financePaymentHistoryBlock), 5391-5540 (the claim relay
   and claimBlock/claimForm), 12352-12432 (DRAWERS.money/.claim; acct/paper sit beside them at
   9-ish hundred lines earlier in the file's own numbering — the ARCHIVED reads, not the redesign's
   dedicated drawers) ─────────────────────────────────────────────────────────────────────────

   D42. A claim's bank reference is exactly as sensitive as a receipt's — it is the investor's own
   bank detail, told over the phone instead of typed by Finance — so it is masked and revealed by
   the same rule (`refAllowed`/`refShown`/`refTxt`, `showRef`/`hideRef`) everywhere it prints, never
   read raw off `Claim.ref`. That mask-and-reveal reading is `ClaimBlock` (`@/features/pay`), so
   the claim drawer imports it rather than keeping a second copy of the same block. */

import { CLAIMKINDS, CLAIMMODES, IMP, UNIT } from "@/domain";
import type { Lead } from "@/domain";
import { iso, maskRef, money } from "@/lib/format";
import {
  canClaim, canReadFinance, canReportPayment, claimArchiveOf,
  claimReceiptMatch, claimReportLabel, claimWhy, financeAccountId, financeDocuments,
  financePaymentHistory, financePaySummary, hasFinanceSource, isFin, knownUnitIntent, may, P,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiWrite } from "@/lib/data/api";
import { leadClaim } from "@/lib/data/endpoints/claims";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { useGo } from "@/features/pay/common";
import { ClaimBlock } from "@/features/pay/ClaimBlock";
import { acctUnits, CAMOUNT, CKIND, CMODE, CNOTE, CREF, CSAIDON } from "@/features/pay/reducer";

/* imBanner() — ir-merged.js 6563, word for word. */
function ImBanner() {
  return <p className="sm g5-ro">Read only · kept by Finance in the {IMP}</p>;
}


const FINANCE_DOC_STATE: Record<string, string> = {
  signed: "Signed", awaiting: "Awaiting signature", issued: "Issued", sent: "Sent",
  blocked: "Blocked", filed: "Filed", expired: "Expired",
};
function FinanceDocState({ state: s }: { state: string }) {
  const tone = s === "signed" ? "go" : s === "blocked" ? "late" : "";
  return <span className={`tag ${tone}`}>{FINANCE_DOC_STATE[s] || s || "Not supplied"}</span>;
}

/* financeDocumentHistoryBlock(l) — ir-console-redesigned.html:8966-8971. Shared by the acct and
   paper drawers, which read the same Finance document list. */
export function DocumentHistoryBlock({ l }: { l: Lead }) {
  const { state } = useConsole();
  const docs = financeDocuments(state, l);
  if (!docs.length) return <p className="sm">No Finance document history has been supplied. Missing source dates are not inferred from lead stages.</p>;
  return (
    <div className="drwsec">
      <p className="lbl">Finance documents</p>
      {docs.map((d, i) => (
        <article className="nt" key={d.id || i}>
          <b>{d.title}</b> <FinanceDocState state={d.state} />
          <div className="sm mono">{d.id || "Source ID not supplied"} · {d.class || "Document"}</div>
          <dl className="kv">
            <dt>Sent / issued</dt><dd>{d.sentOn || "Not supplied"}{d.sentByName ? " · " + d.sentByName : ""}</dd>
            {d.completedOn ? <><dt>Completed</dt><dd>{d.completedOn}{d.verifiedByName ? " · " + d.verifiedByName : ""}</dd></> : null}
            {d.signatureMethod ? <><dt>Signing method</dt><dd>{d.signatureMethod}</dd></> : null}
            {d.signatureReference ? <><dt>Signature reference</dt><dd className="mono">{d.signatureReference}</dd></> : null}
            {d.expiresOn ? <><dt>Expires</dt><dd>{d.expiresOn}</dd></> : null}
          </dl>
          {d.reason ? <p className="sm">{d.reason}</p> : null}
        </article>
      ))}
    </div>
  );
}

const PAY_KIND_LABEL: Record<string, string> = {
  advance: "Advance received", balance: "Balance received", full: "Full payment received",
  refund: "Refund", forfeit: "Forfeit",
};
/* financePaymentHistoryBlock(l) — ir-console-redesigned.html:8977-8985. `r.reference` already
   comes out of `financePaymentHistory` as `maskRef(r.reference)` for every role, so this never
   re-masks or offers a reveal — that is `pay:<id>`'s own control, on the payments page, never
   this drawer's. */
function PaymentHistoryBlock({ l }: { l: Lead }) {
  const { state } = useConsole();
  const rows = financePaymentHistory(state, l);
  if (!rows.length) return <p className="sm">Individual receipt history has not been supplied by Finance. A payment total is not an individual receipt.</p>;
  return (
    <div className="drwsec">
      <p className="lbl">Receipt and payment history</p>
      {rows.map((r, i) => (
        <article className="nt" key={r.id || i}>
          <b>{PAY_KIND_LABEL[r.kind] || r.kind || "Payment"}</b> <span className="mono">{money(r.amount)}</span>
          <div className="sm mono">{r.id || "Source ID not supplied"} · {r.on || "Date not supplied"}</div>
          <div className="sm">{r.mode || "Method not supplied"} · {r.reference}</div>
          {r.recordedByName ? <div className="sm">Recorded by {r.recordedByName}{r.confirmedOn ? " · " + r.confirmedOn : ""}</div> : null}
          {r.reconciliation ? <div className="sm">{r.reconciliation}</div> : null}
          {r.note ? <p className="sm">{r.note}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function MoneyBody({ lead }: DrawerProps) {
  const { state } = useConsole();
  if (!canReadFinance(state, lead, "pay")) return <p className="sm">Payment history is unavailable for this investor.</p>;
  const l = lead!, p = financePaySummary(state, l), account = financeAccountId(state, l);
  /* D42: no `ClaimBlock` here — a payment REPORT is a different fact than a confirmed RECEIPT, and
     the redesign's own money drawer (12352-12360) never mixes the two; "Report an investor
     payment"/"Tell Finance" live on the `claim` drawer below. */
  return (
    <>
      <ImBanner />
      {account ? <p className="sm mono">Account {account}</p> : null}
      {p ? (
        <dl className="kv">
          <dt>Confirmed received</dt><dd className="mono">{money(p.got)} of {money(l.units * UNIT)}</dd>
          <dt>Payment state</dt><dd>{p.state === "full" ? "Fully paid" : "Part paid"}</dd>
          {p.hold ? <><dt>Hold ends</dt><dd className="mono">{p.hold}</dd></> : null}
        </dl>
      ) : (
        <p className="sm">No confirmed payment summary yet.</p>
      )}
      <PaymentHistoryBlock l={l} />
    </>
  );
}

export function PaperBody({ lead }: DrawerProps) {
  const { state } = useConsole();
  if (!canReadFinance(state, lead, "docs")) return <p className="sm">Document history is unavailable for this investor.</p>;
  const l = lead!;
  return <><ImBanner /><DocumentHistoryBlock l={l} /></>;
}

export function AccountBody({ lead }: DrawerProps) {
  const { state } = useConsole();
  if (!(canReadFinance(state, lead, "pay") || canReadFinance(state, lead, "docs")))
    return <p className="sm">Account history is unavailable for this investor.</p>;
  const l = lead!, hasSource = hasFinanceSource(state, l), a = hasSource ? null : state.ACCT[l.id];
  const code = financeAccountId(state, l), p = financePaySummary(state, l);
  if (!a && !code) return <p className="sm">No source account has been supplied yet.</p>;
  return (
    <>
      <ImBanner />
      <dl className="kv">
        <dt>ARL ID</dt><dd className="mono"><b>{code || a!.code}</b></dd>
        {a && !hasSource ? <><dt>Created</dt><dd className="mono">{a.at}</dd><dt>Account state</dt><dd>{a.state}</dd></> : null}
        <dt>Units</dt><dd>{l.units} {acctUnits(l)}</dd>
        {p ? <><dt>Money received</dt><dd className="mono">{money(p.got)} of {money(l.units * UNIT)}</dd></> : null}
      </dl>
      {canReadFinance(state, l, "docs") ? <DocumentHistoryBlock l={l} /> : null}
    </>
  );
}

function ClaimHistory({ l }: { l: Lead }) {
  const { state } = useConsole();
  const c = state.CLAIM[l.id];
  if (!c) return null;
  return (
    <div className="drwsec">
      <p className="lbl">Report history</p>
      {c.history.map((h, i) => (
        <div className="mini" key={i}><span><b>{h.note}</b><span className="sm">{P(state.PEOPLE, h.by).n} · {h.at}</span></span></div>
      ))}
    </div>
  );
}

function ClaimArchive({ l }: { l: Lead }) {
  const { state } = useConsole();
  const list = claimArchiveOf(state, l.id);
  if (!list.length) return null;
  return (
    <details className="ux-disclosure">
      <summary>Earlier payment reports · {list.length}</summary>
      {list.map((c, i) => (
        <details className="ux-disclosure" key={c.id || i}>
          <summary>{c.id} · {claimReportLabel(state, c)}</summary>
          <p className="sm">{P(state.PEOPLE, c.by).n} · {c.at} · {c.mode} · {maskRef(c.ref || "—")}</p>
          {c.note ? <p className="sm">{c.note}</p> : null}
          <p className="sm">{c.state === "confirmed" ? "Matched to receipt " + (c.receipt?.id || "not recorded") : c.state}</p>
          {(c.history || []).map((h, j) => (
            <div className="mini" key={j}><span><b>{h.note}</b><span className="sm">{P(state.PEOPLE, h.by).n} · {h.at}</span></span></div>
          ))}
        </details>
      ))}
    </details>
  );
}

/* claimForm(l) — ir-console-redesigned.html:5541-5548. "Report an investor payment"/"Tell Finance"
   reach this: the claim drawer used to be read-only (`actions={false}` everywhere), which is why
   neither could be reached. The draft rides `ui.CKIND/CMODE/CAMOUNT/CSAIDON/CREF/CNOTE`
   (`@/features/pay/reducer`, already implementing `setClaim`/`claimPaid` — not owned by this
   agent); this is the form that was missing on top of them. */
function ClaimForm({ l }: { l: Lead }) {
  const { state, dispatch } = useConsole();
  const kind = CKIND(state), mode = CMODE(state), amount = CAMOUNT(state), said_on = CSAIDON(state) || iso(state.NOW);
  const err = (state.ui.CLAIMERR as string | null | undefined) || null;
  return (
    <>
      <p className="sm" style={{ margin: "0 0 14px" }}>Record exactly what the investor reported. Finance matches it to a bank receipt separately.</p>
      <div className="frow">
        <label className="fi">
          <span>Payment for</span>
          <select className="selw" value={kind} onChange={(e) => dispatch({ type: "setClaim", f: "kind", v: e.target.value })}>
            {Object.entries(CLAIMKINDS).map(([k, t]) => <option value={k} key={k}>{t}</option>)}
          </select>
        </label>
        <label className="fi">
          <span>Payment method</span>
          <select className="selw" value={mode} onChange={(e) => dispatch({ type: "setClaim", f: "mode", v: e.target.value })}>
            {CLAIMMODES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <div className="frow">
        <label className="fi">
          <span>Reported amount · ₹</span>
          <input
            className="inp" type="number" min="0.01" max="10000000000" step="0.01" inputMode="decimal"
            value={amount} placeholder="Enter reported amount" required
            onChange={(e) => dispatch({ type: "setClaim", f: "amount", v: e.target.value })}
          />
        </label>
        <label className="fi">
          <span>Payment date</span>
          <input
            className="inp" type="date" max={iso(state.NOW)} value={said_on} required
            onChange={(e) => dispatch({ type: "setClaim", f: "said_on", v: e.target.value })}
          />
        </label>
      </div>
      <label className="fi">
        <span>Reference · optional</span>
        <input className="inp mono" maxLength={64} value={CREF(state)} placeholder="UTR or cheque number"
          onChange={(e) => dispatch({ type: "setClaim", f: "ref", v: e.target.value })} />
      </label>
      <label className="fi">
        <span>Note · optional</span>
        <textarea className="nta" rows={2} maxLength={1000} value={CNOTE(state)}
          onChange={(e) => dispatch({ type: "setClaim", f: "note", v: e.target.value })} />
      </label>
      {err ? <p className="ux-date-error" role="alert">{err}</p> : null}
      <p className="sm">A report changes no stage, forecast or payment total.</p>
    </>
  );
}

export function ClaimBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  if (!canReadFinance(state, lead, "pay")) return <p className="sm">Investor payment reports are unavailable for this investor.</p>;
  const l = lead!, c = state.CLAIM[l.id];
  if (c) {
    return (
      <>
        <ClaimBlock l={l} actions={false} />
        <p className="sm" style={{ margin: 0 }}>Finance records the bank receipt in the {IMP}. Matching this report creates no receipt and changes no stage, forecast or payment total.</p>
        <button type="button" className="btn" style={{ marginTop: "12px" }} onClick={() => dispatch({ type: "openDrawer", k: "money", id: l.id })}>
          Review recorded payments
        </button>
        <ClaimHistory l={l} />
        <ClaimArchive l={l} />
      </>
    );
  }
  if (!knownUnitIntent(l))
    return (
      <>
        <div className="note due" style={{ marginTop: 0 }}>Record the investor&apos;s unit count before reporting a payment.</div>
        <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id })}>Record unit count</button>
      </>
    );
  return <><ClaimForm l={l} /><ClaimArchive l={l} /></>;
}

function FinanceFoot({ lead }: DrawerProps) {
  const { state } = useConsole();
  const go = useGo();
  const here = useLpHere(lead?.id);
  if (!lead || here || !(canReadFinance(state, lead, "pay") || canReadFinance(state, lead, "docs"))) return null;
  return <button type="button" className="act" onClick={() => go("lead", lead.id)}>Open lead</button>;
}

function ClaimFoot({ lead }: DrawerProps) {
  const { state, dispatch, reloadData } = useConsole();
  /* M08-S03-W1: Tell Finance is POST /api/leads/[id]/claim (lib/data/endpoints/claims) */
  const report = useApiWrite(leadClaim, state, dispatch);
  const live = useApiMode() === "live";
  if (!lead || !canReadFinance(state, lead, "pay")) return null;
  /* claimPaid / reopenClaim / startPaymentReport / confirmClaim / rejectClaim: the claim redesign (ir-write-map.md, owner
     ruling 6 Oct — the IR never touches Receipts, D69) is not built and its Lead fields are MISSING, so live offers no press */
  if (live) return <span className="sm" title="Payment reports are still to be built">Not available yet</span>;
  const l = lead!, c = state.CLAIM[l.id];
  if (!c) {
    const can = canClaim(state, l);
    return (
      <button
        type="button" className="act" disabled={!can} title={can ? undefined : claimWhy(state, l)}
        onClick={can ? () => {
          if (!knownUnitIntent(l)) { dispatch({ type: "openDrawer", k: "details", id: l.id }); return; }
          const draft = { kind: CKIND(state), mode: CMODE(state), amount: CAMOUNT(state) || "0", said_on: CSAIDON(state) || iso(state.NOW), ref: CREF(state), note: CNOTE(state) };
          /* the route (fixture: its twin) judges the fields and answers in claimFieldsError's own words; the page shows them */
          void report({ id: l.id, ...draft, amount: Number(draft.amount) }).then(r => {
            dispatch({ type: "setUi", patch: { CLAIMERR: r.ok ? null : r.error } });
            if (r.ok && live) { dispatch({ type: "closeDrawer" }); reloadData(); }
          });
        } : undefined}
      >
        Tell Finance
      </button>
    );
  }
  if (c.state === "waiting" && isFin(state.ROLE) && may(state, "pay", "record")) {
    const m = claimReceiptMatch(state, l.id);
    return (
      <>
        <button type="button" className="btn" onClick={() => dispatch({ type: "rejectClaim", id: l.id, why: "Not in the account yet" })}>Not found yet</button>
        <button type="button" className="act" disabled={!m.ok} title={m.ok ? undefined : m.why} onClick={m.ok ? () => dispatch({ type: "confirmClaim", id: l.id }) : undefined}>
          Match recorded receipt
        </button>
      </>
    );
  }
  if (c.state === "notfound" && canReportPayment(state, l))
    return <button type="button" className="act" onClick={() => dispatch({ type: "reopenClaim", id: l.id })}>Ask Finance to look again</button>;
  if (c.state === "confirmed" && canClaim(state, l))
    return <button type="button" className="act" onClick={() => dispatch({ type: "startPaymentReport", id: l.id })}>Report another payment</button>;
  return null;
}

registerDrawer("money", { lead: true, w: 470, title: () => "Payment history", sub: (_s, a) => a.lead!.n, Body: MoneyBody, Foot: FinanceFoot });
registerDrawer("paper", { lead: true, w: 470, title: () => "Document history", sub: (_s, a) => a.lead!.n, Body: PaperBody, Foot: FinanceFoot });
registerDrawer("acct", { lead: true, w: 450, title: () => "Growize account", sub: (_s, a) => a.lead!.n, Body: AccountBody });
registerDrawer("claim", {
  lead: true, w: 480,
  title: (s, a) => (a.lead && s.CLAIM[a.lead.id] ? "Payment reported — Finance status" : "Report an investor payment"),
  sub: (_s, a) => a.lead!.n,
  Body: ClaimBody, Foot: ClaimFoot,
});
