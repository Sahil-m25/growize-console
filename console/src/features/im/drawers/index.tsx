"use client";

/* THE INVESTORS DRAWERS — imx.js section 15 (DRAWERS, lines 2592–2893) and section 16's vDrawer()
   frame (2918–2933). Detail and every write that needs more than a click, in one place, so a screen
   never has to grow a form.

   The prototype's form globals (PUTR, DREF, DTPL, DSIG, PKIND, PMODE, DET, KSEL, TK, CT, UP, FD) are
   s.ui.drafts; every input writes them with {type:"setDraft"}. Stashing and activating a draft per
   person/drawer/record (stashDrawerDraft / activateDrawerDraft) is done by the core on openDrawer
   and closeDrawer, so a drawer here only reads the active draft. drawerReadable gates the whole
   frame, exactly as the prototype wrapped every body/sub/foot in it. */

import { SignCell } from "../paper2/SignCell";
import { useState, type ReactNode } from "react";
import {
  CHANS, FSTATE, I, KAMS, MOODS, PMODES, primaryDoer, SIGS, TIERS, TKCATS, TKPRI, TPL, UNIT, UPCATS, UPTO,
  aged, ansOf, bookOf, cadence, drawerReadable, dueBy, freeUnits, gotBy, isSuper, may, mayCare,
  mayDetails, money, nOpen, nState, notFin, plusDays, quiet, readBook, roundOf, safeNote, tierOf, who,
} from "@/lib/im";
import type { ImDrafts, ImDrawerKey, ImInvestor } from "@/lib/im";
import { Icon } from "@/components/ui/Icon";
import { ImPname, KycTag, Pii, type ImPageProps } from "../common";
import { AllotPick, MONEY_DRAWER_DEFS, pickedAllot } from "../money/drawers";
import { newIdempotencyKey, useApiMode, useApiWrite } from "@/lib/data/api";
import { receiptPrepare, receiptRecord } from "@/lib/data/endpoints/claims";
import { useReload } from "@/lib/store";

type Ctx = ImPageProps & { id: string | null };
type Part = (c: Ctx) => ReactNode;
interface DrawerDef { w: number; t: string; sub: Part; body: Part; foot: Part }

const nameOf = ({ s, me, id }: Ctx): string => (I(s, me, id) || { n: "" }).n || "";
const draft = (c: Ctx): ImDrafts => c.s.ui.drafts;
const set = (c: Ctx, patch: Partial<ImDrafts>) => c.dispatch({ type: "setDraft", patch });
const TagDot = ({ c, children }: { c: string; children: ReactNode }) =>
  <span className={`tag ${c}`}><span className="dot" />{children}</span>;

/* ---- kam — imx.js 2597–2637 ---- */
function kamBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x) return null;
  const { KSEL } = draft(c);
  const T = tierOf(x) || TIERS[TIERS.length - 1];
  const carried = KSEL ? TIERS.map(t => {
    const n = bookOf(s, me, KSEL).filter(y => (tierOf(y) || { k: "" }).k === t.k).length;
    return n ? (
      <div className="led" key={t.k}><span className={`tag ${t.k === "A" ? "br" : ""}`}>{t.t}</span>
        <span style={{ minWidth: 0 }}><span className="sm">{t.t2}</span></span>
        <span className="amt">{n}</span></div>
    ) : null;
  }).filter(Boolean) : [];
  const loadLine = (() => {
    if (!KSEL) return "";
    const b = bookOf(s, me, KSEL);
    const load = b.reduce((a, y) => a + 30 / cadence(y), 0);
    return "About " + (Math.round(load * 10) / 10) + " conversation" + (Math.round(load) === 1 ? "" : "s")
      + " a month at the cadences they are already promised"
      + (x.kam === KSEL ? "" : ", before this one.");
  })();
  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>A {T.t} holding gets {T.t2}. Naming
        somebody is a promise about how often this investor hears from us, so it is worth checking the
        load before making it.</p>
      <p className="lbl">The manager</p>
      <select className="selw" aria-label="The manager" value={KSEL || ""} onChange={e => set(c, { KSEL: e.target.value || null })}>
        <option value="">The shared pool — no named manager</option>
        {KAMS(s).map(k => {
          const n = bookOf(s, me, k).length, q = bookOf(s, me, k).filter(y => quiet(s, me, y)).length;
          return <option key={k} value={k}>{who(s, k).n} — {n} account{n === 1 ? "" : "s"}{q ? ", " + q + " gone quiet" : ""}</option>;
        })}
      </select>
      {KSEL ? (
        <div className="drwsec"><p className="lbl">What {who(s, KSEL).n.split(" ")[0]} carries today</p>
          {carried.length ? carried : <p className="sm" style={{ margin: 0 }}>Nothing yet — this would be their first.</p>}
          <p className="sm" style={{ margin: "9px 0 0" }}>{loadLine}</p>
        </div>
      ) : (
        <div className="drwsec"><p className="sm" style={{ margin: 0 }}>{T.pool
          ? "Single-unit holdings sit in the pool by design — three people cannot name themselves against two hundred accounts and mean it."
          : "Returning a " + T.t + " holding to the pool means nobody is answerable for it by name. Do it deliberately."}</p></div>
      )}
      {x.kam && x.kam !== KSEL ? (
        <div className="note warn" style={{ marginTop: 12 }}><b>Moving an account is a
          new introduction.</b> {who(s, x.kam).n} holds it now. Whoever takes it should call within
          the week — a handover nobody mentions reads to the investor as being forgotten.</div>
      ) : null}
    </>
  );
}
function kamFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c; const x = I(s, me, id); const { KSEL } = draft(c);
  if (!may(s, me, "assign") || !x || !id) return null;
  const same = KSEL === (x.kam || null);
  return (
    <button className="act" disabled={same} title={same ? "That is who holds it already" : undefined}
      onClick={same ? undefined : () => dispatch({ type: "assignKam", id, k: KSEL })}>
      {KSEL ? "Hand it to them" : "Return it to the pool"}</button>
  );
}

/* ---- talk — imx.js 2639–2672 ---- */
const NEXTS: [string, string][] = [["", "On the cadence"], ["14", "In a fortnight"], ["30", "In a month"], ["90", "In three months"]];
function talkBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x) return null;
  const { CT } = draft(c);
  const first = !x.intro && x.kam === me;
  const T = tierOf(x) || TIERS[TIERS.length - 1];
  return (
    <>
      {first ? (
        <div className="note"><b>This is the introduction.</b> They were brought in by
          {" "}{who(s, x.ir).n} and handed over at allotment. Both names stay on the record afterwards, so nobody
          is passed to a stranger and then forgotten.</div>
      ) : null}
      <p className="lbl" style={{ marginTop: first ? "14px" : "0" }}>How</p>
      <div className="chips" style={{ marginBottom: 14 }}>{(Object.entries(CHANS) as [keyof typeof CHANS, string][]).map(([k, t]) =>
        <button key={k} className={`chip ${CT.ch === k ? "on" : ""}`} onClick={() => set(c, { CT: { ...CT, ch: k } })}>{t}</button>)}</div>
      <p className="lbl">How it felt</p>
      <div className="chips" style={{ marginBottom: 14 }}>{(Object.entries(MOODS) as [keyof typeof MOODS, string][]).map(([k, t]) =>
        <button key={k} className={`chip ${CT.mood === k ? "on" : ""}`} onClick={() => set(c, { CT: { ...CT, mood: k } })}>{t}</button>)}</div>
      <label className="fi"><span>What was actually said</span>
        <textarea className="nta" id="ct-note" rows={4} placeholder="Their words where you have them. This is the part somebody reads a year from now."
          value={CT.note} onChange={e => set(c, { CT: { ...CT, note: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Three words for how it felt, not a score out of ten. A
        number would be averaged, and an average of feelings is a figure nobody can act on — whereas
        “a concern” on a Tier A account is a phone call tomorrow.</p>
      <div className="drwsec"><p className="lbl">The next one</p>
        <p className="sm" style={{ margin: "0 0 8px" }}>The {T.t} cadence puts it
          {" "}{T.every} days out on its own. Override it only if they asked you to{x.nextOn
            ? <>, and note that &quot;on the cadence&quot; clears the {x.nextOn} standing now</> : null}.</p>
        <div className="chips">{NEXTS.map(([v, t]) =>
          <button key={v} className={`chip ${String(CT.next) === v ? "on" : ""}`} onClick={() => set(c, { CT: { ...CT, next: v } })}>{t}</button>)}</div>
      </div>
    </>
  );
}
function talkFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c; const { CT } = draft(c);
  return mayCare(s, me, I(s, me, id)) && id ? (
    <button className="act" onClick={() => dispatch({ type: "logContact", id, ch: CT.ch, mood: CT.mood, note: CT.note, nextDays: CT.next })}>
      Record it</button>
  ) : null;
}

/* ---- claim — imx.js 2674–2710 ---- */
function claimBody(c: Ctx): ReactNode {
  const { s, me, id } = c;
  const n = s.data.INBOX.find(y => y.id === id); if (!n) return null;
  const x = I(s, me, n.inv);
  if (!x) return (
    <div className="note bad"><b>No investor on this side matches
      {" "}<span className="mono">{n.inv}</span>.</b> The claim came over the link against an ARL ID
      the Investors side does not hold, which means the two books have drifted. Nothing can be recorded
      against it until that is sorted out.</div>
  );
  const a = ansOf(s, n.id) || { by: "", at: "", why: undefined };
  return (
    <>
      <div className="note ir"><b>{who(s, n.ir).n || n.ir} wrote this on the lead side</b>
        {" "}<span className="mono">{n.at}</span>.<br />{safeNote(s, me, n.d)}</div>
      <p className="sm" style={{ margin: "12px 0 0" }}>It is not a receipt and it has moved nothing. You are the
        only person who can say whether the money is actually in the account, and saying so here is
        what writes the receipt — the IR never types one and never will.</p>
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Investor</dt><dd><b>{x ? x.n : n.inv}</b> <span className="mono sm">{n.inv}</span></dd>
        <dt>Holding</dt><dd>{x ? x.units + " unit" + (x.units > 1 ? "s" : "") + " · " + money(x.units * UNIT) : "—"}</dd>
        <dt>Already in</dt><dd className="mono">{money(gotBy(s, me, n.inv))}</dd>
        <dt>Outstanding</dt><dd className="mono"><b>{money(dueBy(s, me, n.inv))}</b></dd>
        {x && x.hold ? <><dt>Hold ends</dt><dd className="mono">{x.hold}</dd></> : null}
      </dl></div>
      {!nOpen(s, n) ? (
        <div className="drwsec"><span className={`tag ${nState(s, n) === "confirmed" ? "go" : "late"}`}>
          {nState(s, n)}</span> <span className="sm">{a.by ? <ImPname s={s} k={a.by} first /> : null}
          {" "}<span className="mono">{a.at || ""}</span>{a.why ? " · " + safeNote(s, me, a.why) : ""}</span></div>
      ) : null}
    </>
  );
}
function claimFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c;
  const n = s.data.INBOX.find(y => y.id === id);
  if (!n || !nOpen(s, n) || !may(s, me, "pay")) return null;
  return (
    <>
      <button className="act" onClick={() => dispatch({ type: "confirmClaim", nid: n.id })}>Confirm and record it</button>{" "}
      <button className="act ghost" onClick={() => dispatch({ type: "rejectClaim", nid: n.id, why: "Not in the account yet" })}>Not there yet</button>
    </>
  );
}

/* ---- pay — imx.js 2712–2746 ---- */
function payBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x || !id) return null;
  const { PKIND, PMODE, PUTR } = draft(c);
  const adv = Math.round(x.units * UNIT * 0.1), due = dueBy(s, me, id), got = gotBy(s, me, id);
  const supp = roundOf(s, me, id, "supp");
  return (
    <>
      <p className="lbl">What has landed</p>
      <div className="chips" style={{ marginBottom: 14 }}>
        {got === 0 ? (
          <button className={`chip ${PKIND === "advance" ? "on" : ""}`} onClick={() => set(c, { PKIND: "advance" })}>
            The 10% advance <span className="u">{money(adv)}</span></button>
        ) : null}{" "}
        <button className={`chip ${PKIND !== "advance" ? "on" : ""}`} onClick={() => set(c, { PKIND: "balance" })}>
          {got ? "The balance" : "Paid in full"} <span className="u">{money(due)}</span></button>
      </div>
      <p className="lbl">How</p>
      <div className="chips" style={{ marginBottom: 14 }}>{PMODES.map(m =>
        <button key={m} className={`chip ${PMODE === m ? "on" : ""}`} onClick={() => set(c, { PMODE: m })}>{m}</button>)}</div>
      <label className="fi"><span>Reference</span>
        <input className="inp mono" id="p-utr" placeholder="UTR or cheque number" value={PUTR}
          onChange={e => set(c, { PUTR: e.target.value })} /></label>
      <AllotPick s={s} me={me} dispatch={c.dispatch} id={id} />
      <div className="drwsec"><dl className="kv" style={{ marginTop: 0 }}>
        <dt>Agreement</dt><dd>{supp.state === "done"
          ? <TagDot c="go">signed and verified</TagDot>
          : <TagDot c="late">{supp.t}</TagDot>}</dd>
        <dt>Land</dt><dd>{Object.entries(x.blocks).map(([k, n]) => "Block " + k + " ×" + n).join(", ") || "—"}
          {" "}<span className="sm">· {freeUnits(s)} free on the shelf</span></dd>
        <dt>After this</dt><dd>{PKIND === "advance"
          ? `Reserved, with a 30-day clock to ${plusDays(s.data.NOW, 30)}`
          : "Paid in full — allotment is the next step"}</dd>
      </dl>
        <p className="sm" style={{ margin: "10px 0 0" }}>The receipt is written here and appears on the IR&apos;s lead
          within the minute. They do not record it and cannot.</p></div>
    </>
  );
}
/* M08-S03-W1: Record it is POST /api/receipts/prepare, then POST /api/receipts with one Idempotency-Key per press
   (lib/data/endpoints/claims). Recording is never refused for unsigned paper — the answer says matching waits (D21). */
function PayFoot(c: Ctx) {
  const { s, me, id, dispatch } = c; const { PKIND, PMODE, PUTR } = draft(c);
  const prepare = useApiWrite(receiptPrepare, { s, me }, dispatch), record = useApiWrite(receiptRecord, { s, me }, dispatch);
  const reloadData = useReload();
  const live = useApiMode() === "live";
  const [busy, setBusy] = useState(false);
  if (!may(s, me, "pay") || !id) return null;
  const press = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const allot = pickedAllot(s, me, id) || null, key = newIdempotencyKey();
      const p = await prepare({ allotmentId: allot });
      if (!p.ok) return;
      const r = await record({ inv: id, allotmentId: allot, kind: PKIND, mode: PMODE, ref: PUTR, prepared: p.data }, { idempotencyKey: key });
      if (!r.ok) return;
      /* fixture: the reducer's recordPay has closed the drawer and cleared the draft; live: the page does */
      if (live) { dispatch({ type: "setDraft", patch: { PUTR: "" } }); dispatch({ type: "closeDrawer" }); reloadData(); }
      if (r.data.matchNote) dispatch({ type: "note", msg: r.data.matchNote });
    } finally { setBusy(false); }
  };
  return <button className="act" disabled={busy} onClick={() => void press()}>Record it</button>;
}
const payFoot = (c: Ctx): ReactNode => <PayFoot {...c} />;

/* ---- send — imx.js 2748–2776 ---- */
const sendBlocked = (x: ImInvestor | null, DSIG: string): boolean => !!x && x.nri && DSIG === "Aadhaar OTP";
function sendBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x || !id) return null;
  const { DTPL, DSIG } = draft(c);
  const t = TPL.find(y => y.t === DTPL), blocked = sendBlocked(x, DSIG);
  return (
    <>
      <p className="lbl">Template</p>
      <div className="chips" style={{ marginBottom: 14 }}>{TPL.map(y => {
        const out = s.data.DOCS.some(d => d.inv === id && d.t === y.t && d.state !== "blocked");
        return (
          <button key={y.t} className={`chip ${DTPL === y.t ? "on" : ""}`} disabled={out} title={out ? "Already out or signed" : undefined}
            onClick={out ? undefined : () => set(c, { DTPL: y.t })}>{y.t}{out ? <span className="u">on file</span>
              : y.wet ? <span className="u">wet sign</span> : null}</button>
        );
      })}</div>
      {t && t.noSign ? <p className="sm" style={{ margin: "0 0 12px" }}>A receipt is issued, not signed.</p>
        : <><p className="lbl">Signing</p><div className="chips" style={{ marginBottom: 14 }}>{SIGS.map(sg =>
          <button key={sg} className={`chip ${DSIG === sg ? "on" : ""}`} onClick={() => set(c, { DSIG: sg })}>{sg}</button>)}</div></>}
      {blocked ? (
        <div className="note bad"><b>{x.n} is an NRI.</b> Aadhaar OTP needs an Aadhaar
          linked to a live Indian mobile. Use a Class 3 DSC or a wet signature.</div>
      ) : null}
      <div className="drwsec"><p className="sm" style={{ margin: 0 }}>It goes from the finance mailbox as a link
        that expires in a fortnight, filed under <span className="mono">{id}</span>. The IR sees
        that it went and it becomes their job to tell the investor and chase the signature — that
        half is theirs and is never typed on this side.</p></div>
    </>
  );
}
function sendFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c; const x = I(s, me, id); const { DTPL, DSIG } = draft(c);
  const blocked = sendBlocked(x, DSIG);
  if (!may(s, me, "doc") || !id) return null;
  const ok = !!DTPL && !blocked;
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "Pick a template"}
      onClick={ok ? () => dispatch({ type: "sendDocNow", id, tpl: DTPL || "", sig: DSIG }) : undefined}>Send it</button>
  );
}

/* ---- verify — imx.js 2778–2805 ---- */
function verifyBody(c: Ctx): ReactNode {
  const { s, me, id } = c;
  const d = s.data.DOCS.find(y => y.id === id); if (!d) return null;
  const { DREF } = draft(c);
  const said = s.data.INBOX.find(n => n.inv === d.inv && n.kind === "signed");
  const age = aged(s.data.NOW, d.sent);
  return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>Document</dt><dd><b>{d.t}</b> <span className="sm">{d.cls}</span></dd>
        <dt>Sent</dt><dd><ImPname s={s} k={d.by} first /> <span className="mono">{d.sent}</span></dd>
        <dt>Signing</dt><dd>{d.sig || "—"}</dd>
        <dt>Out for</dt><dd>{age} day{age === 1 ? "" : "s"}{d.exp ? ` · link expires ${d.exp}` : ""}</dd>
      </dl>
      {/* M12-S05 — the request's Zoho Sign status, a reminder and a recall (not in the prototype) */}
      <SignCell s={s} me={me} dispatch={c.dispatch} d={d} actions />
      {said ? (
        <div className="note ir" style={{ marginTop: 12 }}><b>{who(s, said.ir).n || said.ir} says the
          investor has signed and sent it</b> <span className="mono">{said.at}</span>. {said.d || ""}
          <br />That is what they were told, not a signature. This is where it becomes one.</div>
      ) : (
        <p className="sm" style={{ margin: "12px 0 0" }}>No word from the IR yet. Verifying now is fine if the
          signed copy is in front of you — the relay does not require their beat first.</p>
      )}
      <label className="fi" style={{ marginTop: 14 }}><span>e-Mudhra reference</span>
        <input className="inp mono" id="d-ref" placeholder="EMU-…" value={DREF}
          onChange={e => set(c, { DREF: e.target.value })} /></label>
      <p className="sm" style={{ margin: "8px 0 0" }}>Leave it blank and one is generated from today&apos;s date —
        but the reference is what makes the signature provable, so it is worth pasting.</p>
    </>
  );
}
function verifyFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c; const { DREF } = draft(c);
  return may(s, me, "doc") && id ? (
    <>
      <button className="act" onClick={() => dispatch({ type: "verifyDoc", did: id, ref: DREF })}>The signed copy is here</button>{" "}
      <button className="act ghost" onClick={() => dispatch({ type: "blockDoc", did: id, why: "Nothing has come back signed" })}>Nothing has come back</button>
    </>
  ) : null;
}

/* ---- kyc — imx.js 2807–2834 ---- */
function kycBody(c: Ctx): ReactNode {
  const { s, me, dispatch, id } = c; const x = I(s, me, id); if (!x) return null;
  if (notFin(s, me)) return <p className="sm" style={{ margin: 0 }}>Identity is Finance&apos;s. There is nothing on
    this drawer you can see.</p>;
  const bank = x.bank || { ifsc: "", name: "", drop: "" };
  return (
    <>
      <dl className="kv" style={{ marginTop: 0 }}>
        <dt>PAN</dt><dd><Pii s={s} me={me} dispatch={dispatch} x={x} f="pan" /></dd>
        <dt>Aadhaar</dt><dd>{x.aadh ? <><span className="mono">•••• •••• {x.aadh}</span>
          <div className="sm mono">{x.aref}</div></>
          : x.nri ? <span className="sm">Non-resident — passport and visa route, no Aadhaar</span>
            : <span className="tag late">no verification on file</span>}</dd>
        <dt>Bank</dt><dd><Pii s={s} me={me} dispatch={dispatch} x={x} f="acct" /><div className="sm">{may(s, me, "bank")
          ? (bank.ifsc || "—") + " · " + (bank.name || "—") + " · " : ""}name match {bank.drop || "—"}</div></dd>
        <dt>Residency</dt><dd>{x.nri ? "Non-resident — FEMA applies" : "Resident"}</dd>
        <dt>Now</dt><dd><KycTag x={x} />{x.kycWhy ? <> <span className="sm">{x.kycWhy}</span></> : null}</dd>
      </dl>
      <div className={`note ${x.nri ? "warn" : ""}`} style={{ marginTop: 12 }}>{x.nri
        ? `An NRI holding cannot be allotted without a signed FEMA declaration, however much money has
         arrived. Passing KYC does not clear that — it is a separate document and a separate check.`
        : `Passing KYC unblocks allotment. It does not unblock money: the agreement does that, and the
         agreement is checked separately when a receipt is recorded.`}</div>
    </>
  );
}
function kycFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c;
  return may(s, me, "kyc") && id ? (
    <>
      <button className="act" onClick={() => dispatch({ type: "passKyc", id })}>Pass it</button>{" "}
      <button className="act ghost" onClick={() => dispatch({ type: "failKyc", id, why: "Documents do not match" })}>Fail it</button>
    </>
  ) : null;
}

/* ---- tkt — imx.js 2836–2861 ---- */
function tktBody(c: Ctx): ReactNode {
  const { s, me } = c; const { TK } = draft(c);
  return (
    <>
      <label className="fi"><span>Investor</span>
        <select className="selw" value={TK.inv || ""} onChange={e => set(c, { TK: { ...TK, inv: e.target.value } })}>
          {readBook(s, me).map(x => <option key={x.id} value={x.id}>{x.n} — {x.id}</option>)}
        </select></label>
      <label className="fi" style={{ marginTop: 12 }}><span>What they want</span>
        <input className="inp" id="tk-t" placeholder="e.g. change the bank account for payouts"
          value={TK.t} onChange={e => set(c, { TK: { ...TK, t: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Kind</p>
      <div className="chips">{TKCATS.map(k =>
        <button key={k} className={`chip ${TK.cat === k ? "on" : ""}`} onClick={() => set(c, { TK: { ...TK, cat: k } })}>{k}</button>)}</div>
      <p className="lbl" style={{ marginTop: 14 }}>Priority</p>
      <div className="chips">{TKPRI.map(([k, t]) =>
        <button key={k} className={`chip ${TK.pri === k ? "on" : ""}`} onClick={() => set(c, { TK: { ...TK, pri: k } })}>{t}</button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>Detail</span>
        <textarea className="nta" id="tk-d" rows={3} placeholder="What they actually asked for, in their words"
          value={TK.d} onChange={e => set(c, { TK: { ...TK, d: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>A bank change is a compliance job — it needs a fresh name
        match before any payout uses it. That is why the kind is asked for before the detail.</p>
    </>
  );
}
function tktFoot(c: Ctx): ReactNode {
  const { s, me, dispatch } = c; const { TK } = draft(c);
  if (!may(s, me, "tkt")) return null;
  const ok = !!I(s, me, TK.inv) && !!TK.t.trim();
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "An investor and a line saying what they want"}
      onClick={ok && TK.inv ? () => dispatch({ type: "newTicket", inv: TK.inv as string, cat: TK.cat, t: TK.t, d: TK.d, own: me, pri: TK.pri }) : undefined}>
      Open it</button>
  );
}

/* ---- upd — imx.js 2863–2885 ---- */
function updBody(c: Ctx): ReactNode {
  const { s } = c; const { UP } = draft(c); const INV = s.data.INV;
  return (
    <>
      <label className="fi"><span>Headline</span>
        <input className="inp" id="up-t" placeholder="e.g. Block A — year-3 flowering ahead of schedule"
          value={UP.t} onChange={e => set(c, { UP: { ...UP, t: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Kind</p>
      <div className="chips">{UPCATS.map(k =>
        <button key={k} className={`chip ${UP.cat === k ? "on" : ""}`} onClick={() => set(c, { UP: { ...UP, cat: k } })}>{k}</button>)}</div>
      <p className="lbl" style={{ marginTop: 14 }}>Who sees it</p>
      <div className="chips">{UPTO.map(([k, t]) =>
        <button key={k} className={`chip ${UP.to === k ? "on" : ""}`} onClick={() => set(c, { UP: { ...UP, to: k } })}>{t} <span className="u">{
          k === "all" ? INV.length : k === "nri" ? INV.filter(x => x.nri).length : INV.filter(x => x.st === "allocated").length}</span></button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>The update</span>
        <textarea className="nta" id="up-d" rows={4} placeholder="Plain words. This is what the investor reads."
          value={UP.d} onChange={e => set(c, { UP: { ...UP, d: e.target.value } })} /></label>
      <p className="sm" style={{ margin: "9px 0 0" }}>Every segment here can be reconstructed from the book, so
        six months from now it is still possible to say exactly who was told what.</p>
    </>
  );
}
function updFoot(c: Ctx): ReactNode {
  const { dispatch } = c; const { UP } = draft(c);
  const ok = !!UP.t.trim();
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "A headline at least"}
      onClick={ok ? () => dispatch({ type: "publish", t: UP.t, cat: UP.cat, d: UP.d, to: UP.to }) : undefined}>Publish it</button>
  );
}

/* ---- field — imx.js 2887–2912 ---- */
function fieldBody(c: Ctx): ReactNode {
  const { s } = c; const { FD } = draft(c);
  return (
    <>
      <p className="lbl">Which block</p>
      <div className="chips">{s.data.FARMS.map(f =>
        <button key={f.k} className={`chip ${FD.blk === f.k ? "on" : ""}`} onClick={() => set(c, { FD: { ...FD, blk: f.k } })}>
          Block {f.k} <span className="u">{f.crop}</span></button>)}</div>
      <label className="fi" style={{ marginTop: 14 }}><span>What happened</span>
        <input className="inp" id="fd-h" placeholder="e.g. flowering nine days early on the north half"
          value={FD.head} onChange={e => set(c, { FD: { ...FD, head: e.target.value } })} /></label>
      <p className="lbl" style={{ marginTop: 14 }}>Where the block is now</p>
      <div className="chips">{FSTATE.map(st =>
        <button key={st} className={`chip ${FD.st === st ? "on" : ""}`} onClick={() => set(c, { FD: { ...FD, st } })}>{st}</button>)}</div>
      <p className="sm" style={{ margin: "7px 0 0" }}>Leave this alone unless the block has actually moved on —
        it changes what every screen says the block is doing, and it is on the record when it does.
        Currently <b>{(s.data.FARMS.find(f => f.k === FD.blk) || { crop: "" }).crop || "—"}</b>.</p>
      <label className="fi" style={{ marginTop: 14 }}><span>The detail</span>
        <textarea className="nta" id="fd-d" rows={4} placeholder="Plain words, and no number you would not repeat to an investor standing in the row."
          value={FD.d} onChange={e => set(c, { FD: { ...FD, d: e.target.value } })} /></label>
      <div className="note" style={{ marginTop: 12 }}><b>This is not a release.</b> Recording progress says
        what is growing; it does not put a single unit on the shelf, and it cannot. Releasing land is
        Finance&apos;s, on the same page, and the two are separate rights precisely because one of them
        is a promise to sell something.</div>
    </>
  );
}
function fieldFoot(c: Ctx): ReactNode {
  const { s, me, dispatch } = c; const { FD } = draft(c);
  if (!may(s, me, "field")) return null;
  const ok = !!FD.head.trim();
  return (
    <button className="act" disabled={!ok} title={ok ? undefined : "Say what happened"}
      onClick={ok ? () => dispatch({ type: "logField", blk: FD.blk, st: FD.st, head: FD.head, d: FD.d }) : undefined}>Record it</button>
  );
}

/* ---- details — imx.js 2914–2931 ---- */
const DETFIELDS: [keyof ImDrafts["DET"], string][] = [["n", "Name"], ["ph", "Phone"], ["em", "Email"], ["city", "City"],
  ["addr", "Address"], ["nominee", "Nominee"]];
function detailsBody(c: Ctx): ReactNode {
  const { s, me, id } = c; const x = I(s, me, id); if (!x) return null;
  const { DET } = draft(c);
  return (
    <>
      <p className="sm" style={{ margin: "0 0 13px" }}>What the investor asked to change about themselves.
        Not their PAN, not their Aadhaar, not the account money leaves — those are identity and they
        are Finance&apos;s, on this same record, behind the same wall as always.</p>
      {DETFIELDS.map(([k, t]) => (
        <label key={k} className="fi" style={{ marginBottom: 11 }}><span>{t}</span>
          <input className="inp" value={DET[k] != null ? DET[k] : x[k] || ""}
            onChange={e => set(c, { DET: { ...DET, [k]: e.target.value } })} /></label>
      ))}
      <div className="note" style={{ marginTop: 2 }}><b>A name change is not free.</b> If the name on the
        record stops matching the name on the bank account, the next payout fails and Finance has to
        re-run the match — so a name edit opens a compliance ticket by itself rather than quietly
        breaking something a month from now.</div>
    </>
  );
}
function detailsFoot(c: Ctx): ReactNode {
  const { s, me, id, dispatch } = c;
  return mayDetails(s, me, I(s, me, id)) && id
    ? <button className="act" onClick={() => dispatch({ type: "saveDetails", id })}>Save the changes</button> : null;
}

/* ---- the registry — imx.js 2592 `const DRAWERS = {…}` ---- */
export const DRAWERS: Record<ImDrawerKey, DrawerDef> = {
  kam: { w: 430, t: "Who looks after this account", sub: nameOf, body: kamBody, foot: kamFoot },
  talk: { w: 450, t: "Log a conversation", sub: nameOf, body: talkBody, foot: talkFoot },
  claim: {
    w: 450, t: "An IR says the money has arrived",
    sub: ({ s, me, id }) => { const n = s.data.INBOX.find(y => y.id === id); return n ? (I(s, me, n.inv) || { n: "" }).n || n.inv : ""; },
    body: claimBody, foot: claimFoot,
  },
  pay: { w: 430, t: "Record a receipt", sub: nameOf, body: payBody, foot: payFoot },
  send: { w: 440, t: "Send for signature", sub: nameOf, body: sendBody, foot: sendFoot },
  verify: {
    w: 430, t: "Verify the signed copy",
    sub: ({ s, me, id }) => { const d = s.data.DOCS.find(y => y.id === id); return d ? (I(s, me, d.inv) || { n: "" }).n || d.inv : ""; },
    body: verifyBody, foot: verifyFoot,
  },
  kyc: { w: 430, t: "KYC", sub: nameOf, body: kycBody, foot: kycFoot },
  tkt: { w: 440, t: "Open a ticket", sub: () => "raised on behalf of an investor", body: tktBody, foot: tktFoot },
  upd: { w: 440, t: "Publish an update", sub: () => "it appears in the investor's app", body: updBody, foot: updFoot },
  field: { w: 450, t: "Record farm progress", sub: () => "what the investors will be told", body: fieldBody, foot: fieldFoot },
  details: { w: 450, t: "Change their details", sub: nameOf, body: detailsBody, foot: detailsFoot },
  ...MONEY_DRAWER_DEFS,                /* later decisions: Mark paid, LLP, Add investor, app access (../money) */
};

/* superNote(k) — imx.js 79 */
function SuperNote({ s, me, k }: { s: ImPageProps["s"]; me: string; k: ImDrawerKey }) {
  return isSuper(s, me) && primaryDoer(s.data, k) ? (
    <div className="note su" style={{ marginBottom: 12 }}><b>Super user.</b> The primary doer of this
      step is {primaryDoer(s.data, k)}. You can do it here to test it; it is recorded as yours.</div>
  ) : null;
}

/** the open drawer's title, or null when no readable drawer is open (for the console's focus handling) */
export function imDrawerTitle(s: ImPageProps["s"], me: string): string | null {
  const D = s.ui.DRW;
  if (!D || !DRAWERS[D.k] || !drawerReadable(s, me, D.k, D.id)) return null;
  return DRAWERS[D.k].t;
}

/* vDrawer() — imx.js 2918–2933 */
export function ImDrawer({ s, me, dispatch, docked }: ImPageProps & { docked: boolean }) {
  const D = s.ui.DRW;
  if (!D) return null;
  const d = DRAWERS[D.k];
  if (!d || !drawerReadable(s, me, D.k, D.id)) return null;
  const c: Ctx = { s, me, dispatch, id: D.id };
  const t = d.t;
  const sub = d.sub(c), ft = d.foot(c);
  const close = () => dispatch({ type: "closeDrawer" });
  return (
    <>
      {docked ? null : <div className="scrim" onClick={close} />}
      <aside className="drw" id="drw" role="dialog" aria-modal={docked ? "false" : "true"}
        aria-label={t} style={{ ["--dw" as string]: `${d.w || 440}px` }}>
        <header className="drwh"><div className="drw-heading"><h2>{t}</h2>{sub ? <div className="sub">{sub}</div> : null}</div>
          <div className="drw-header-actions"><button className="drwx" id="drwx" onClick={close} aria-label={`Close “${t}”`}
            title={`Close “${t}” (Esc)`}><Icon name="x" /></button></div></header>
        <div className="drwb"><SuperNote s={s} me={me} k={D.k} />{d.body(c)}</div>
        {ft ? <footer className="drwf">{ft}</footer> : null}
      </aside>
    </>
  );
}
