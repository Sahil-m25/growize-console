"use client";

/* M12-S05 — a document row's Zoho Sign status, and the two things Finance can do while a request
   is with the investor: send a reminder, or recall it (with an in-page confirmation and a reason —
   never the browser's confirm). Not in the merged prototype; drawn at the end of the row's last
   cell so every line the prototype prints stays as it is. Phase 1: nothing reaches Zoho Sign; the
   reminder and the recall are recorded on the demo book. */

import { useState, type MouseEvent } from "react";
import { lastReminder, may, RECALLWHY, signChip, signOpen, who } from "@/lib/im";
import type { ImDoc } from "@/lib/im";
import type { ImPageProps } from "../common";

export function SignCell({ s, me, dispatch, d }: ImPageProps & { d: ImDoc }) {
  const [ask, setAsk] = useState(false);
  const [why, setWhy] = useState("");
  const c = signChip(s, d);
  /* a signed row already says so in its State tag; the chip adds only what that tag cannot */
  if (!c || c.st === "signed") return null;
  const rem = lastReminder(s, d.id);
  const acts = may(s, me, "doc") && signOpen(s, d);
  const stop = (run: () => void) => (e: MouseEvent) => { e.stopPropagation(); run(); };
  const rec = ((s.data.SIGN || {})[d.id] || { recalled: undefined }).recalled;
  return (
    <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <span className={`tag ${c.c}`} title="Zoho Sign status"><span className="dot" />{c.t}</span>
      {rem ? <div className="sm">{"Reminder sent " + rem.at + " by " + who(s, rem.by).n.split(" ")[0]}</div> : null}
      {rec ? <div className="sm">{"Recalled " + rec.at + " by " + who(s, rec.by).n.split(" ")[0]}</div> : null}
      {acts && !ask ? (
        <div style={{ marginTop: 4 }}>
          <button type="button" className="chip" onClick={stop(() => dispatch({ type: "remindSign", did: d.id }))}>Send a reminder</button>{" "}
          <button type="button" className="chip" onClick={stop(() => { setAsk(true); setWhy(""); })}>Recall</button>
        </div>) : null}
      {acts && ask ? (
        <div className="note" role="alertdialog" aria-label={"Recall the " + d.t} style={{ marginTop: 6, textAlign: "left" }}>
          <b>{"Recall the " + d.t + "?"}</b> The investor&apos;s signing link stops working and the round reads blocked
          until a fresh copy is sent. Why is it being recalled?
          <div className="chips" style={{ marginTop: 7 }}>
            {RECALLWHY.map(r => <button key={r} type="button" className={`chip ${why === r ? "on" : ""}`} aria-pressed={why === r}
              onClick={stop(() => setWhy(r))}>{r}</button>)}</div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="act" disabled={!why}
              onClick={stop(() => { dispatch({ type: "recallSign", did: d.id, why }); setAsk(false); })}>Yes, recall it</button>{" "}
            <button type="button" className="btn" onClick={stop(() => setAsk(false))}>No, leave it out</button>
          </div>
        </div>) : null}
    </div>
  );
}
