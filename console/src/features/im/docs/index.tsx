"use client";

/* 12. DOCUMENTS — imx.js 1959–1993 (vDocs) and 1994–2027 (vSendPanel). */

import { ago, day6, I, may, pageReadable, readBook, safeNote, secOf, SIGS, TPL } from "@/lib/im";
import { DocTag, ImPname, ImSecBar, type ImPageProps, type ImSec } from "../common";
import { SignCell } from "../paper2/SignCell";
import { UploadList, UploadPanel } from "../paper2/Upload";

export function ImDocs({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "docs")) return null;
  const book = s.data.DOCS.filter(d => I(s, me, d.inv));
  const SECS: ImSec[] = [{ k: "out", t: "Out for signature", n: book.filter(d => d.state === "awaiting").length, warn: true },
    { k: "all", t: "Everything on file", n: book.length },
    { k: "send", t: "Send one" },
    { k: "up", t: "Upload one" }];   /* M12-S02 */
  const S = secOf(s.ui.SEC, "docs", SECS);
  const rows = S === "out" ? book.filter(d => d.state === "awaiting") : book;
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
          : <div className="card fill"><div className="tw"><table>
          <thead><tr><th>Document</th><th>Investor</th><th>Sent</th><th>Signing</th><th>State</th>
            <th>Reference</th><th></th></tr></thead>
          <tbody>{rows.length ? rows.map(d => {
            const x = I(s, me, d.inv);
            return (
              <tr className="k" key={d.id} onClick={() => dispatch({ type: "go", v: "inv", id: d.inv })} tabIndex={0}>
                <td><b>{d.t}</b><div className="sm">{d.cls} · {d.id}</div></td>
                <td>{x ? x.n : d.inv}<div className="sm mono">{d.inv}</div></td>
                <td className="sm"><ImPname s={s} k={d.by} first /> <span className="mono">{day6(d.sent)}</span></td>
                <td className="sm">{d.sig || "—"}</td>
                <td><DocTag d={d} />{d.state === "awaiting"
                  ? <div className="sm">{ago(s.data.NOW, d.sent)}{d.exp ? " · expires " + d.exp : ""}</div>
                  : d.on ? <div className="sm mono">{day6(d.on)}</div> : null}</td>
                <td className="sm mono">{d.ref || "—"}</td>
                <td style={{ textAlign: "right" }}>{may(s, me, "doc") && d.state === "awaiting"
                  ? <button className="chip" onClick={e => { e.stopPropagation();
                    dispatch({ type: "openDrawer", k: "verify", id: d.id, seed: { DREF: "" } }); }}>Verify</button>
                  : d.state === "blocked" ? <span className="sm">{safeNote(s, me, d.why)}</span> : null}
                  <SignCell s={s} me={me} dispatch={dispatch} d={d} /></td></tr>
            );
          }) : <tr><td colSpan={7}><div className="empty">Nothing out for signature.</div></td></tr>}
          </tbody></table></div></div>}
      </div>
    </>
  );
}

/** vSendPanel — imx.js 1994–2027 */
export function SendPanel({ s, me, dispatch }: ImPageProps) {
  if (!pageReadable(s, me, "docs")) return null;
  if (!may(s, me, "doc")) return <div className="card"><div className="empty">Sending belongs to Finance
    Operations, Compliance and the Head of Finance.</div></div>;
  const { SEL } = s.ui, { DTPL, DSIG } = s.ui.drafts;
  const cands = readBook(s, me).filter(x => x.st !== "lapsed");
  /* read, never write: the pane picks the first candidate without reassigning SEL */
  const pick = (SEL && I(s, me, SEL)) ? SEL : (cands[0] ? cands[0].id : null);
  const x = I(s, me, pick), t = TPL.find(y => y.t === DTPL);
  const blocked = x && x.nri && DSIG === "Aadhaar OTP";
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
      {x && DTPL && !blocked
        ? <button className="act" onClick={() => dispatch({ type: "sendDocNow", id: pick!, tpl: DTPL, sig: DSIG })}>Send through Zoho Sign</button>
        : <button className="act" disabled title="Pick the investor, the template and how it is signed">Send through Zoho Sign</button>}
      <p className="sm" style={{ margin: "10px 0 0" }}>Goes from the finance mailbox as an expiring link. The IR
        sees that it went — never what is in it — and it is their job from there to tell the investor
        and chase the signature.</p>
      {blocked ? <div className="note bad" style={{ marginTop: 12 }}><b>{x.n} is an NRI.</b>{" "}
        Aadhaar OTP needs an Aadhaar linked to a live Indian mobile. Use a Class 3 DSC or a wet
        signature.</div> : null}
    </div></div>
  );
}
