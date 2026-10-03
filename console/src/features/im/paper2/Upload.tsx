"use client";

/* M12-S02 — upload a document straight from the console (D71). Not in the merged prototype: built
   from the story in the prototype's own pieces (card, chips, .fi labels, .note refusals, .bar).
   Choose or drop a file, say where it belongs (Personal / Allotment / Farm) and which paper it is,
   and press Upload. The file is checked here before anything moves: over 20 MB or not a PDF, JPG or
   PNG is refused on the page.
   Phase 2b (D104): the bytes go to POST /api/documents/upload (scope, record id, typed slot, the record's
   Modified_Time) with one Idempotency-Key per chosen file, reused on a retry; the file is read in the browser
   (that is the progress shown). Fixture mode runs the reducer's uploadDoc and records only name, size and slot.
   The record ids and versions come from the investor record and the farm list. The list beside it is the
   three scopes of GET /api/documents/investor/[id] (M12-S01-W1). */

import { useRef, useState, type DragEvent } from "react";
import {
  fileKind, fileSize, I, mayUpload, readBook, SCOPES, SLOTS, UPLOAD_ACCEPT, UPLOAD_MAX_MB, UPLOAD_REFUSED, uploadCheck,
  uploadKey, uploadWhere,
} from "@/lib/im";
import type { ImScope } from "@/lib/im";
import { newIdempotencyKey, useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { documentUpload, documentsList, investorDocuments, slotKey } from "@/lib/data/endpoints/documents";
import { farmList } from "@/lib/data/endpoints/farms";
import { investorRecord } from "@/lib/data/endpoints/investors";
import type { AttachmentLine } from "@/server/documents/attachments";
import type { ImPageProps } from "../common";
import { ReadNote } from "./ReadNote";

type Phase = { k: "idle" } | { k: "reading"; pct: number } | { k: "failed"; msg: string };
type Where = { value: string; label: string; id: string; version: string | null };
const SCOPE_KEY = { Personal: "personal", Allotment: "allotment", Project: "project" } as const;
const MIME = { PDF: "application/pdf", JPG: "image/jpeg", PNG: "image/png" } as const;

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
  const [filed, setFiled] = useState<{ name: string; type: string; where: string } | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const idem = useRef<string | null>(null);
  const mode = useApiMode();
  const who = inv || pick;
  const rec = useApiRead(investorRecord, { s, me }, scope === "Project" || !who ? null : who);
  const farms = useApiRead(farmList, { s, me }, undefined);
  const upload = useApiWrite(documentUpload, { s, me }, dispatch);

  if (!mayUpload(s, me)) return <div className="card"><div className="empty">{UPLOAD_REFUSED}</div></div>;
  const x = scope === "Project" ? null : I(s, me, who);
  const wheres: Where[] = scope === "Project"
    ? (farms.state === "ok" ? farms.data.rows.map(f => ({ value: f.block || f.id, label: f.name, id: f.id, version: f.version })) : [])
    : scope === "Allotment" && rec.state === "ok"
      ? rec.data.record.holdings.map(h => ({ value: h.block, label: h.llpName, id: h.id, version: h.version }))
      : [];
  const w = scope === "Personal" ? null : wheres.find(y => y.value === farm) || wheres[0] || null;
  const llp = w ? w.value : null;
  const slots = SLOTS[scope];
  const sl = slots.some(y => y.t === slot) ? slot : "";
  const target = { Scope: scope, Doc_Type: sl, Investor: scope === "Project" ? null : (x ? x.id : who || null), LLP: llp };
  const recordId = scope === "Personal" ? (rec.state === "ok" ? rec.data.record.id : "") : w ? w.id : "";
  const expected = scope === "Personal" ? (rec.state === "ok" ? rec.data.record.version : null) : w ? w.version : null;
  const recorded = sentKey ? (s.data.UPLOADS || []).find(u => u.key === sentKey) || null : null;
  const asking = !!sentKey && !recorded && !filed && !!s.ui.NOTE && s.ui.NOTE.kind === "ask";
  const uid = "up-" + (inv || "docs");

  const choose = (f: File | null) => { setFile(f); setErr(null); setPhase({ k: "idle" }); setSentKey(null); setFiled(null); idem.current = f ? newIdempotencyKey() : null; };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) choose(f); };

  const send = () => {
    if (busy.current || !file) return;
    const c = uploadCheck({ name: file.name, size: file.size, type: file.type });
    if (!c.ok) { setErr(c.msg || "That cannot be uploaded here."); return; }
    if (!sl || !target.Investor && scope !== "Project" || (scope !== "Personal" && !w)) { setErr("Pick where it belongs and which paper it is."); return; }
    const key = uploadKey(file, target);
    busy.current = true; setErr(null); setPhase({ k: "reading", pct: 0 });
    const r = new FileReader();
    r.onprogress = ev => { if (ev.lengthComputable) setPhase({ k: "reading", pct: Math.round((ev.loaded / ev.total) * 100) }); };
    r.onerror = () => { busy.current = false; setPhase({ k: "failed", msg: "The file could not be read, so nothing was sent." }); };
    r.onload = () => {
      const kind = fileKind(file.name, file.type);
      const ct = file.type || (kind ? MIME[kind] : "application/octet-stream");
      void upload({ scope: SCOPE_KEY[scope], recordId, slot: slotKey(sl), name: file.name, expected, bytes: new Uint8Array(r.result as ArrayBuffer), contentType: ct,
        book: { key, Scope: scope, Doc_Type: sl, Investor: target.Investor, LLP: llp, File_Size: file.size, File_Type: file.type } },
      { idempotencyKey: idem.current ?? undefined }).then(res => {
        busy.current = false;
        /* fixture: the reducer answers in its own page note and the list below; live: the route's word, here */
        if (res.ok || mode === "fixture") {
          setSentKey(key); setPhase({ k: "idle" }); setFile(null); idem.current = null;
          if (input.current) input.current.value = "";
          if (res.ok) setFiled({ name: file.name, type: sl, where: scope === "Personal" ? "Personal" : (scope === "Allotment" ? "Allotment · " : "Farm · ") + (w ? w.label : "") });
        } else setPhase({ k: "failed", msg: res.error });
      });
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
      {scope === "Personal" ? null : wheres.length ? (
        <label className="fi" style={{ marginBottom: 12 }}><span>Farm</span>
          <select className="selw" value={llp || ""} onChange={e => setFarm(e.target.value)}>
            {wheres.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
      ) : <p className="sm" style={{ margin: "0 0 12px" }}>{scope === "Project" ? (farms.state === "loading" ? "Reading the farms…" : "No farm to file on.")
        : x ? x.n + " holds nothing on a farm yet, so there is no allotment to file on." : "Pick the investor first."}</p>}
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
        + recorded.Doc_Type + " · " + uploadWhere(s, recorded) + (recorded.Investor ? " · " + recorded.Investor : "") + "."}</div>
        : filed ? <div className="note" role="status" style={{ marginBottom: 12 }}><b>Uploaded.</b>{" " + filed.name + " is on file as " + filed.type + " · " + filed.where + "."}</div> : null}
      {asking ? <p className="sm" role="status" style={{ margin: "0 0 12px" }}>Waiting on your answer at the top of the page.</p> : null}
      <button type="button" className="act" disabled={!file || !sl || (!llp && scope !== "Personal") || phase.k === "reading"}
        title={!file ? "Choose a file first" : !sl ? "Pick which paper this is" : undefined} onClick={send}>
        {phase.k === "reading" ? "Uploading…" : "Upload"}</button>
      <p className="sm" style={{ margin: "10px 0 0" }}>Goes straight to Zoho under your own name — Zoho records who uploaded it, and no
        copy stays anywhere else. Local demo: only the file&apos;s name, size and slot are recorded; the file itself goes nowhere.</p>
    </div></div>
  );
}

/** The files a seat may see, in D70's three scopes — one investor's (with the farm papers of the farms they hold), or every
 *  record the Documents list carries files for. Metadata only: a name, a size, a time. */
export function UploadList({ s, me, inv, title }: { s: ImPageProps["s"]; me: string; inv?: string; title?: string }) {
  const one = useApiRead(investorDocuments, { s, me }, inv ?? null);
  const all = useApiRead(documentsList, { s, me }, inv ? null : "all");
  const farms = useApiRead(farmList, { s, me }, undefined);
  const fname = (id: string): string => (farms.state === "ok" ? farms.data.rows.find(f => f.id === id)?.name : undefined) || id;
  type Line = AttachmentLine & { where: string };
  const put = (where: string, files: readonly AttachmentLine[] | null | undefined): Line[] => (files || []).map(f => ({ ...f, where }));
  const r = inv ? one : all;
  const rows: Line[] = inv
    ? (one.state === "ok" ? [...put("Personal", one.data.personal),
      ...one.data.allotments.flatMap(a => put("Allotment · " + fname(a.llpId), a.files)),
      ...(one.data.farms || []).flatMap(f => put("Farm · " + fname(f.llpId), f.files))] : [])
    : (all.state === "ok" ? (all.data.files || []).flatMap(rf => {
      const row = all.data.rows.find(y => y.recordId === rf.recordId);
      return put(rf.scope === "personal" ? "Personal" : rf.scope === "project" ? "Farm · " + fname(rf.recordId)
        : "Allotment · " + (row && row.llpId ? fname(row.llpId) : rf.recordId), rf.files).map(l => ({ ...l, where: l.where + (row && row.party ? " · " + row.party : "") }));
    }) : []);
  return (
    <>
      <ReadNote r={r} what="the files" />
      <div className="card fill"><div className="ch"><h3>{title || "Uploaded here"}</h3><div className="sp" />
        <span className="sm">{rows.length + " file" + (rows.length === 1 ? "" : "s")}</span></div>
        <div className="tw"><table><thead><tr><th>File</th><th>Filed on</th><th>Added</th></tr></thead>
          <tbody>{rows.length ? rows.map((u, i) => (
            <tr key={u.id + i}>
              <td><b>{u.name}</b><div className="sm">{[u.slot, u.size == null ? null : fileSize(u.size)].filter(Boolean).join(" · ")}</div></td>
              <td className="sm">{u.where}</td>
              <td className="sm mono">{u.at || "—"}{u.by ? <div className="sm">{u.by}</div> : null}</td>
            </tr>
          )) : <tr><td colSpan={3}><div className="empty">{r.state === "loading" ? "Reading…" : "Nothing uploaded yet."}</div></td></tr>}</tbody></table></div></div>
    </>
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
