"use client";

/* 12. DOCUMENTS — imx.js 1959–1993 (vDocs) and 1994–2027 (vSendPanel).
   Phase 2b (D104): the list is GET /api/documents/list?cut=out|all (M12-S03-W1) — one row per paper with a Zoho Sign
   request, cut to the seat — and Send one reads GET /api/documents/sign/prefill and POSTs /api/documents/sign/send
   with an Idempotency-Key per press (M12-S04-W1). A 503 draws the last good read's time, never old rows. */

import { useRef } from "react";
import { ago, I, may, pageReadable, readBook, safeNote, secOf, SIGS, TPL } from "@/lib/im";
import { newIdempotencyKey, useApiRead, useApiWrite } from "@/lib/data/api";
import { dayOf, documentsList } from "@/lib/data/endpoints/documents";
import { NOT_A_SIGNATURE, paperworkQueue } from "@/lib/data/endpoints/paperwork";
import { allotmentOf, METHOD_OF, PAPER_OF_TEMPLATE, signPrefill, signSend } from "@/lib/data/endpoints/sign";
import type { DocRow, Paper } from "@/server/documents/list";
import { DocTag, ImPname, ImSecBar, type ImPageProps, type ImSec } from "../common";
import { AgreedDraftOffer, SUPP_TEMPLATE, useAgreedDraft } from "../paper2/AgreedDraft";
import { ReadNote } from "../paper2/ReadNote";
import { SignRowCell } from "../paper2/SignCell";
import { TemplatePick, useTemplatePick } from "../paper2/TemplatePick";
import { TestSigningMark } from "../paper2/TestSigningMark";
import { UploadList, UploadPanel } from "../paper2/Upload";

const first = (n: string | null | undefined): string => String(n || "—").split(" ")[0]!;
export function ImDocs({ s, me, dispatch }: ImPageProps) {
  const book = { s, me };
  const out = useApiRead(documentsList, book, "out");
  const all = useApiRead(documentsList, book, "all");
  /* M12-S11-NOTE-3: Finance works "Out for signature" in the order the queue route gives — the IR's word first, then age.
     A seat that does not verify (IR side, Auditor, viewer) reads the plain list. */
  const queue = useApiRead(paperworkQueue, book, pageReadable(s, me, "docs") && may(s, me, "doc"));
  if (!pageReadable(s, me, "docs")) return null;
  const ranked = queue.state === "ok";
  const outRows: readonly DocRow[] = ranked ? queue.data.rows : out.state === "ok" ? out.data.rows : [], allRows = all.state === "ok" ? all.data.rows : [];
  const hintOf = (d: DocRow) => (ranked ? (d as DocRow & { hint?: { words: string; by: { name: string | null } | null } | null }).hint ?? null : null);
  const SECS: ImSec[] = [{ k: "out", t: "Out for signature", n: out.state === "ok" ? out.data.outCount : 0, warn: true },
    { k: "all", t: "Everything on file", n: allRows.length },
    { k: "send", t: "Send one" },
    { k: "up", t: "Upload one" }];   /* M12-S02 */
  const S = secOf(s.ui.SEC, "docs", SECS);
  const shown = S === "out" ? (ranked ? queue : out) : all;
  const rows = S === "out" ? outRows : allRows;
  return (
    <>
      <div className="ph"><h1>Documents</h1>
        <span className="sub">uploaded, sent through Zoho Sign, and verified here — nowhere else</span></div>
      <div className="note" style={{ marginBottom: 8 }}>This is the only place a document for a Growize
        investor is held. The lead side never has a copy: it shows that one went and that one came back
        signed, and both of those facts were written on this screen. Every file is keyed to an ARL ID
        from the moment it exists.</div>
      <ImSecBar s={s} dispatch={dispatch} v="docs" list={SECS} />
      <div className="secw">
        {S === "send" ? <SendPanel s={s} me={me} dispatch={dispatch} />
          : S === "up" ? <><UploadPanel s={s} me={me} dispatch={dispatch} /><div style={{ marginTop: 12 }}><UploadList s={s} me={me} /></div></>
          : <><ReadNote r={shown} what="the documents" />
          {S === "out" && ranked && queue.data.note ? <div className="note" role="status" style={{ marginBottom: 8 }}>{queue.data.note}</div> : null}<div className="card fill"><div className="tw"><table>
          <thead><tr><th>Document</th><th>Investor</th><th>Sent</th><th>Signing</th><th>State</th>
            <th>Verified</th><th></th></tr></thead>
          <tbody>{rows.length ? rows.map((d: DocRow) => (
            <tr className="k" key={d.key} onClick={() => dispatch({ type: "go", v: "inv", id: d.contactId || "" })} tabIndex={0}>
              <td><b>{d.label}</b><div className="sm">{(d.module === "Contacts" ? "Personal" : "Allotment") + " · " + d.recordId}</div></td>
              <td>{d.party || d.contactId}<div className="sm mono">{d.contactId}</div>
                {S === "out" && hintOf(d) ? <div className="sm" data-hint>{hintOf(d)!.words}{hintOf(d)!.by?.name ? " — " + hintOf(d)!.by!.name : ""}. {NOT_A_SIGNATURE}</div> : null}</td>
              <td className="sm">{d.sign?.sentBy ? first(d.sign.sentBy) : d.sign?.sentById ? <ImPname s={s} k={d.sign.sentById} first /> : "—"} <span className="mono">{dayOf(d.sign && d.sign.sentAt)}</span></td>
              <td className="sm">{d.method || "—"}</td>
              <td><DocTag d={{ state: d.state === "verified" ? "signed" : d.key.startsWith("blocked:") ? "blocked" : "awaiting" }} />
                {d.state === "sent" && !d.key.startsWith("blocked:") && d.sign
                  ? <div className="sm">{(ago(s.data.NOW, d.sign.sentAt) !== "—" ? ago(s.data.NOW, d.sign.sentAt) : "")
                    + (d.sign.expiresAt ? " · expires " + dayOf(d.sign.expiresAt) : "")}</div>
                  : d.verifiedAt ? <div className="sm mono">{dayOf(d.verifiedAt)}</div> : null}
                <SignRowCell s={s} me={me} dispatch={dispatch} row={d} /></td>
              <td className="sm mono">{d.state === "verified" ? dayOf(d.verifiedAt) : "—"}</td>
              <td style={{ textAlign: "right" }}>{d.key.startsWith("blocked:")
                ? <span className="sm">{safeNote(s, me, (s.data.DOCS.find(x => x.id === d.recordId) || { why: "" }).why)}</span>
                : may(s, me, "doc") && d.state !== "verified"
                ? <button className="chip" onClick={e => { e.stopPropagation();
                  dispatch({ type: "openDrawer", k: "verify", id: d.recordId, seed: { DREF: "" } }); }}>Verify</button> : null}</td></tr>
          )) : <tr><td colSpan={7}><div className="empty">{shown.state === "loading" ? "Reading…" : S === "out" ? "Nothing out for signature." : "Nothing on file."}</div></td></tr>}
          </tbody></table></div></div></>}
      </div>
    </>
  );
}

/** the record id the send routes take for a paper of this investor (fixture: the book's own ids) */
function recordFor(paper: Paper | null, x: { id: string; lead?: string } | null, alot: string | null): string | null {
  if (!paper || !x) return null;
  return paper === "fema" ? x.id : paper === "nda" ? x.lead ?? x.id : alot ?? x.id;
}

/** vSendPanel — imx.js 1994–2027 */
export function SendPanel({ s, me, dispatch }: ImPageProps) {
  const { SEL } = s.ui, { DSIG, DTID } = s.ui.drafts;
  const cands = readBook(s, me).filter(x => x.st !== "lapsed");
  /* read, never write: the pane picks the first candidate without reassigning SEL */
  const pick = (SEL && I(s, me, SEL)) ? SEL : (cands[0] ? cands[0].id : null);
  /* M12-S12-NOTE-2: an agreed supplementary draft makes the Supplementary agreement the default document of the send */
  const ag = useAgreedDraft(s, me, pick);
  const DTPL = s.ui.drafts.DTPL || (ag.offered ? SUPP_TEMPLATE : s.ui.drafts.DTPL);
  const x = I(s, me, pick), t = TPL.find(y => y.t === DTPL);
  const paper = t ? PAPER_OF_TEMPLATE[t.t] ?? null : null;
  const pre = useApiRead(signPrefill, { s, me }, { paper: paper as Paper, id: paper && x ? recordFor(paper, x, allotmentOf({ s, me }, x.id)) : null });
  const send = useApiWrite(signSend, { s, me }, dispatch);
  const pickT = useTemplatePick(s, me, paper, DTID);
  const press = useRef<string | null>(null);
  if (!pageReadable(s, me, "docs")) return null;
  if (!may(s, me, "doc")) return <div className="card"><div className="empty">Sending belongs to Finance
    Operations, Compliance and the Head of Finance.</div></div>;
  const aadhaarOff = paper ? pre.state === "ok" && !pre.data.methods.includes("aadhaar") : !!(x && x.nri);
  const blocked = !!x && aadhaarOff && DSIG === "Aadhaar OTP";
  const can = !!x && !!DTPL && !blocked && pickT.ready && (!paper || (pre.state === "ok" && pre.data.maySend));
  const go = () => {
    if (!x || !DTPL || !pick) return;
    press.current ??= newIdempotencyKey();
    void send({ paper: paper ?? "other", recordId: (paper && recordFor(paper, x, allotmentOf({ s, me }, x.id))) || x.id, method: METHOD_OF[DSIG] ?? "email-otp",
      templateId: pickT.tid, expectedModifiedTime: pre.state === "ok" ? pre.data.modifiedTime ?? "" : "", book: { inv: pick, tpl: DTPL, sig: DSIG } },
    { idempotencyKey: press.current }).then(r => { if (r.ok) press.current = null; });
  };
  return (
    <div className="card"><div className="ch"><h3>Send a document</h3></div><div className="cb">
      <label className="fi" style={{ marginBottom: 12 }}><span>Investor</span>
        <select className="selw" id="dsel" value={pick || ""} onChange={e => dispatch({ type: "setSel", id: e.target.value })}>
          {cands.map(c => <option key={c.id} value={c.id}>{c.n} — {c.id}{c.nri ? " · NRI" : ""}</option>)}</select></label>
      <p className="lbl">Template</p>
      <div className="chips" style={{ marginBottom: 12 }}>{TPL.map(y => {
        const off = !!y.wet && DSIG !== "Wet signature";
        return (
          <button key={y.t} className={`chip ${DTPL === y.t ? "on" : ""}`}
            disabled={off} title={off ? "Wet signature only" : undefined}
            onClick={off ? undefined : () => dispatch({ type: "setDraft", patch: { DTPL: y.t } })}>{y.t}{
              y.wet ? <span className="u">wet sign</span> : y.noSign ? <span className="u">no signature</span> : null}</button>
        );
      })}</div>
      {t && t.noSign ? null : <>
        <p className="lbl">Signing</p>
        <div className="chips" style={{ marginBottom: 14 }}>{SIGS.map(sg => <button key={sg} className={`chip ${DSIG === sg ? "on" : ""}`}
          onClick={() => dispatch({ type: "setDraft", patch: { DSIG: sg } })}>{sg}</button>)}</div></>}
      <TestSigningMark on={!!paper && pre.state === "ok" && pre.data.testSigning} />
      {paper === "supplementary" && ag.draft ? <AgreedDraftOffer draft={ag.draft} /> : null}
      <TemplatePick paper={paper} pick={pickT} DTID={DTID} onPick={v => dispatch({ type: "setDraft", patch: { DTID: v } })} />
      {paper && pre.state === "error" ? <div className="note bad" role="alert" style={{ marginBottom: 12 }}>{pre.err.error}</div> : null}
      {paper && pre.state === "ok" && pre.data.recipient
        ? <p className="sm" style={{ margin: "0 0 10px" }}>{"To " + pre.data.recipient.name + " · " + pre.data.recipient.email}</p> : null}
      {can
        ? <button className="act" onClick={go}>Send through Zoho Sign</button>
        : <button className="act" disabled title={paper && pre.state === "ok" && !pre.data.maySend ? "Already out or on file for this investor" : "Pick the investor, the template and how it is signed"}>Send through Zoho Sign</button>}
      <p className="sm" style={{ margin: "10px 0 0" }}>Goes from the finance mailbox as an expiring link. The IR
        sees that it went — never what is in it — and it is their job from there to tell the investor
        and chase the signature.</p>
      {blocked && x ? <div className="note bad" style={{ marginTop: 12 }}><b>{x.n} is an NRI.</b>{" "}
        Aadhaar OTP needs an Aadhaar linked to a live Indian mobile. Use a Class 3 DSC or a wet
        signature.</div> : null}
    </div></div>
  );
}
