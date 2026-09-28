"use client";

/* M12-S02 — upload a document straight from the console (D71). Not in the merged prototype: built
   from the story in the prototype's own pieces (card, chips, .fi labels, .note refusals, .bar).
   Choose or drop a file, say where it belongs (Personal / Allotment / Farm) and which paper it is,
   and press Upload. The file is checked here before anything moves: over 20 MB or not a PDF, JPG or
   PNG is refused on the page. Phase 1 has no Zoho: the file is read in the browser (that is the
   progress shown) and only its name, size and slot are recorded — the file goes nowhere. */

import { useRef, useState, type DragEvent } from "react";
import {
  fileSize, I, mayUpload, readBook, SCOPES, SLOTS, UPLOAD_ACCEPT, UPLOAD_MAX_MB, UPLOAD_REFUSED, uploadGate,
  uploadKey, uploadsFor, uploadWhere, who,
} from "@/lib/im";
import type { ImScope, ImUpload } from "@/lib/im";
import type { ImPageProps } from "../common";

type Phase = { k: "idle" } | { k: "reading"; pct: number } | { k: "failed"; msg: string };

export function UploadPanel({ s, me, dispatch, inv }: ImPageProps & { inv?: string }) {
  const book = readBook(s, me).filter(x => x.st !== "lapsed");
  const [pick, setPick] = useState<string>(inv || (book[0] ? book[0].id : ""));
  const [scope, setScope] = useState<ImScope>("Allotment");
  const [slot, setSlot] = useState<string>("");
  const [farm, setFarm] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  if (!mayUpload(s, me)) return <div className="card"><div className="empty">{UPLOAD_REFUSED}</div></div>;
  const x = scope === "Project" ? null : I(s, me, inv || pick);
  const farms = scope === "Project" ? s.data.FARMS.map(f => f.k) : x ? Object.keys(x.blocks) : [];
  const llp = scope === "Personal" ? null : farms.includes(farm) ? farm : farms[0] || null;
  const slots = SLOTS[scope];
  const sl = slots.some(y => y.t === slot) ? slot : "";
  const target = { Scope: scope, Doc_Type: sl, Investor: scope === "Project" ? null : (x ? x.id : null), LLP: llp };
  const recorded = sentKey ? (s.data.UPLOADS || []).find(u => u.key === sentKey) || null : null;
  const asking = !!sentKey && !recorded && !!s.ui.NOTE && s.ui.NOTE.kind === "ask";
  const uid = "up-" + (inv || "docs");

  const choose = (f: File | null) => { setFile(f); setErr(null); setPhase({ k: "idle" }); setSentKey(null); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) choose(f); };

  const send = () => {
    if (busy.current || !file) return;
    const g = uploadGate(s, me, { ...target, File_Name: file.name, File_Size: file.size, File_Type: file.type });
    if (!g.ok) { setErr(g.msg || "That cannot be uploaded here."); return; }
    const key = uploadKey(file, target);
    busy.current = true; setErr(null); setPhase({ k: "reading", pct: 0 });
    const r = new FileReader();
    r.onprogress = ev => { if (ev.lengthComputable) setPhase({ k: "reading", pct: Math.round((ev.loaded / ev.total) * 100) }); };
    r.onerror = () => { busy.current = false; setPhase({ k: "failed", msg: "The file could not be read, so nothing was sent." }); };
    r.onload = () => {
      busy.current = false;
      dispatch({ type: "uploadDoc", key, ...target, File_Name: file.name, File_Size: file.size, File_Type: file.type });
      setSentKey(key); setPhase({ k: "idle" }); setFile(null);
      if (input.current) input.current.value = "";
    };
    r.readAsArrayBuffer(file);
  };

  return (
    <div className="card"><div className="ch"><h3>Upload a document</h3><div className="sp" />
      <span className="sm">{"PDF, JPG or PNG · up to " + UPLOAD_MAX_MB + " MB"}</span></div><div className="cb">
      {inv ? null : scope === "Project" ? null : (
        <label className="fi" style={{ marginBottom: 12 }}><span>Investor</span>
          <select className="selw" value={pick} onChange={e => { setPick(e.target.value); setFarm(""); }}>
            {book.map(c => <option key={c.id} value={c.id}>{c.n} — {c.id}</option>)}</select></label>)}
      <p className="lbl" id={uid + "-scope"}>Where it belongs</p>
      <div className="chips" role="group" aria-labelledby={uid + "-scope"} style={{ marginBottom: 6 }}>
        {SCOPES.map(c => <button key={c.k} type="button" className={`chip ${scope === c.k ? "on" : ""}`} aria-pressed={scope === c.k}
          onClick={() => { setScope(c.k); setSlot(""); setFarm(""); }}>{c.t}</button>)}</div>
      <p className="sm" style={{ margin: "0 0 12px" }}>{(SCOPES.find(c => c.k === scope) || SCOPES[0]).d}</p>
      {scope === "Personal" ? null : farms.length ? (
        <label className="fi" style={{ marginBottom: 12 }}><span>Farm</span>
          <select className="selw" value={llp || ""} onChange={e => setFarm(e.target.value)}>
            {farms.map(k => <option key={k} value={k}>{(s.data.FARMS.find(f => f.k === k) || { n: "Block " + k }).n}</option>)}</select></label>
      ) : <p className="sm" style={{ margin: "0 0 12px" }}>{x ? x.n + " holds nothing on a farm yet, so there is no allotment to file on." : "Pick the investor first."}</p>}
      <p className="lbl" id={uid + "-slot"}>Which paper</p>
      <div className="chips" role="group" aria-labelledby={uid + "-slot"} style={{ marginBottom: 12 }}>
        {slots.map(y => <button key={y.t} type="button" className={`chip ${sl === y.t ? "on" : ""}`} aria-pressed={sl === y.t}
          title={y.field ? "Goes into the record's " + y.t + " slot — it holds one file" : "Attached to the record"}
          onClick={() => setSlot(y.t)}>{y.t}</button>)}</div>
      <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
        style={{ border: "1px dashed var(--line)", borderRadius: "var(--rc)", padding: "12px 14px", marginBottom: 12,
          background: over ? "var(--brand-soft)" : undefined }}>
        <label className="fi"><span>File — choose one, or drop it here</span>
          <input ref={input} type="file" accept={UPLOAD_ACCEPT} onChange={e => choose(e.target.files && e.target.files[0] ? e.target.files[0] : null)} /></label>
        {file ? <p className="sm" style={{ margin: "8px 0 0" }}><b>{file.name}</b>{" · " + fileSize(file.size)}</p> : null}
      </div>
      {err ? <div className="note bad" role="alert" style={{ marginBottom: 12 }}><b>Not sent.</b> {err}</div> : null}
      {phase.k === "failed" ? <div className="note bad" role="alert" style={{ marginBottom: 12 }}><b>Not saved yet.</b> {phase.msg} Press Upload to try again — it will not be attached twice.</div> : null}
      {phase.k === "reading" ? (
        <div style={{ marginBottom: 12 }}>
          <div className="bar" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase.pct}>
            <i style={{ width: phase.pct + "%" }} /></div>
          <p className="sm" style={{ margin: "6px 0 0" }}>{"Reading the file — " + phase.pct + "%"}</p></div>
      ) : null}
      {recorded ? <div className="note" role="status" style={{ marginBottom: 12 }}><b>Uploaded.</b>{" " + recorded.File_Name + " is on file as "
        + recorded.Doc_Type + " · " + uploadWhere(s, recorded) + (recorded.Investor ? " · " + recorded.Investor : "") + "."}</div> : null}
      {asking ? <p className="sm" role="status" style={{ margin: "0 0 12px" }}>Waiting on your answer at the top of the page.</p> : null}
      <button type="button" className="act" disabled={!file || !sl || (!llp && scope !== "Personal") || phase.k === "reading"}
        title={!file ? "Choose a file first" : !sl ? "Pick which paper this is" : undefined} onClick={send}>
        {phase.k === "reading" ? "Uploading…" : "Upload"}</button>
      <p className="sm" style={{ margin: "10px 0 0" }}>Goes straight to Zoho under your own name — Zoho records who uploaded it, and no
        copy stays anywhere else. Local demo: only the file&apos;s name, size and slot are recorded; the file itself goes nowhere.</p>
    </div></div>
  );
}

/** The uploaded files a seat may see — one investor's (with their farms'), or everything. */
export function UploadList({ s, me, inv, title }: { s: ImPageProps["s"]; me: string; inv?: string; title?: string }) {
  const rows: ImUpload[] = uploadsFor(s, me, inv);
  return (
    <div className="card fill"><div className="ch"><h3>{title || "Uploaded here"}</h3><div className="sp" />
      <span className="sm">{rows.length + " file" + (rows.length === 1 ? "" : "s")}</span></div>
      <div className="tw"><table><thead><tr><th>Paper</th><th>File</th><th>Filed on</th><th>Uploaded</th></tr></thead>
        <tbody>{rows.length ? rows.map(u => {
          const x = u.Investor ? I(s, me, u.Investor) : null;
          return (
            <tr key={u.id}>
              <td><b>{u.Doc_Type}</b><div className="sm">{u.id}</div></td>
              <td className="sm">{u.File_Name}<div className="sm">{fileSize(u.File_Size)}</div></td>
              <td className="sm">{uploadWhere(s, u)}{x && !inv ? <div className="sm">{x.n} <span className="mono">{x.id}</span></div> : null}</td>
              <td className="sm">{who(s, u.by).n.split(" ")[0]} <span className="mono">{u.at}</span></td>
            </tr>
          );
        }) : <tr><td colSpan={4}><div className="empty">Nothing uploaded yet.</div></td></tr>}</tbody></table></div></div>
  );
}

/** On the investor record's Paper section: what was uploaded for them, and the upload control. */
export function InvUploads(p: ImPageProps & { inv: string }) {
  const [open, setOpen] = useState(false);
  const { s, me, inv } = p;
  if (!I(s, me, inv)) return null;
  return (
    <>
      {mayUpload(s, me) ? (
        <div style={{ margin: "12px 0" }}>
          <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>＋ Upload a file</button>
        </div>) : null}
      {open ? <UploadPanel {...p} inv={inv} /> : null}
      <div style={{ marginTop: 12 }}><UploadList s={s} me={me} inv={inv} /></div>
    </>
  );
}
