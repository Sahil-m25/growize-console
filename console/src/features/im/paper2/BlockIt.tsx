"use client";

/* M12-S07 — "Block it" on a paper that already came back signed (D77: blocked or superseded, signed ones too). It asks
   for a reason in the page (never the browser's confirm) and calls POST /api/documents/sign/block through the adapter:
   the route recalls a request still out, clears the slot's request id, method and verified stamp, and keeps the reason as a
   Zoho Note. Fixture mode runs the reducer's blockDoc. Offered to the seats that verify (may "doc"). */

import { useState } from "react";
import { may, type ImDoc } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { documentsList, paperOfDoc } from "@/lib/data/endpoints/documents";
import { signBlock, signPrefill } from "@/lib/data/endpoints/sign";
import type { ImPageProps } from "../common";

export function BlockIt({ s, me, dispatch, d }: ImPageProps & { d: ImDoc }) {
  const [ask, setAsk] = useState(false);
  const [why, setWhy] = useState("");
  const paper = paperOfDoc(d);
  const list = useApiRead(documentsList, { s, me }, "all");
  const row = list.state === "ok" ? list.data.rows.find(r => r.recordId === d.id) ?? null : null;
  const pre = useApiRead(signPrefill, { s, me }, { paper: (paper ?? "nda"), id: ask && row ? row.recordId : null });
  const block = useApiWrite(signBlock, { s, me }, dispatch);
  if (!may(s, me, "doc") || d.state !== "signed" || !paper || paper === "nda") return null;
  if (!ask) return <button type="button" className="chip" onClick={() => { setAsk(true); setWhy(""); }}>Block it</button>;
  const go = () => {
    if (!row || !why.trim()) return;
    void block({ paper, recordId: row.recordId, reason: why.trim(), expectedModifiedTime: pre.state === "ok" ? pre.data.modifiedTime ?? "" : "", did: d.id })
      .then(r => { if (r.ok) setAsk(false); });
  };
  return (
    <div className="note" role="alertdialog" aria-label={"Block the " + d.t} style={{ marginTop: 6, textAlign: "left" }}>
      <b>{"Block the " + d.t + "?"}</b> It stops counting as signed until a fresh copy is sent and verified. Why is it being blocked?
      <label className="fi" style={{ marginTop: 7 }}><span>Reason</span>
        <input className="inp" value={why} onChange={e => setWhy(e.target.value)} placeholder="e.g. wrong version signed" /></label>
      <div style={{ marginTop: 8 }}>
        <button type="button" className="act" disabled={!why.trim() || !row} onClick={go}>Yes, block it</button>{" "}
        <button type="button" className="btn" onClick={() => setAsk(false)}>No, leave it</button>
      </div>
    </div>
  );
}
