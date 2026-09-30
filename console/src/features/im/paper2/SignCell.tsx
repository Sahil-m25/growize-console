"use client";

/* M12-S05 — a document row's Zoho Sign status, and the two things Finance can do while a request
   is with the investor: send a reminder, or recall it (with an in-page confirmation and a reason —
   never the browser's confirm). Not in the merged prototype; drawn at the end of the row's last
   cell so every line the prototype prints stays as it is.
   W1 (D104): the status is the Documents list's own `sign` (label, status) and the two buttons call
   POST /api/documents/sign/remind and /recall through the adapter; fixture mode runs the reducer's
   remindSign / recallSign. The route's SignStatus carries no reminder history, so a row says only
   what this press just did ("Reminder sent"). */

import { useState, type MouseEvent } from "react";
import { lastReminder, may, RECALLWHY, who, type ImDoc } from "@/lib/im";
import { useApiRead, useApiWrite } from "@/lib/data/api";
import { documentsList } from "@/lib/data/endpoints/documents";
import { signRecall, signRemind } from "@/lib/data/endpoints/sign";
import type { DocRow } from "@/server/documents/list";
import type { ImPageProps } from "../common";

const CLOSED = /^(declined|recalled|expired)$/i;
const tone = (st: string): string => (/^viewed/i.test(st) ? "due" : CLOSED.test(st) ? "late" : /^(completed|signed)$/i.test(st) ? "go" : "");
const words = (st: string): string => (st === "completed" ? "Signed" : st.charAt(0).toUpperCase() + st.slice(1));
/** a request still with the investor: it can be reminded or recalled */
const isOpen = (r: DocRow): boolean => r.state === "sent" && !!r.sign && /^(sent|viewed|inprogress|in progress)$/i.test(r.sign.status);

/* In a register row only the status is drawn (so the row keeps the prototype's controls); the reminder
   and the recall live in the document's own drawer (`actions`). */
export function SignRowCell({ s, me, dispatch, row, actions }: ImPageProps & { row: DocRow; actions?: boolean }) {
  const [ask, setAsk] = useState(false);
  const [why, setWhy] = useState("");
  const [did, setDid] = useState<string | null>(null);
  const remind = useApiWrite(signRemind, { s, me }, dispatch);
  const recall = useApiWrite(signRecall, { s, me }, dispatch);
  const sg = row.sign;
  /* a signed row already says so in its State tag; the chip adds only what that tag cannot */
  if (!sg || row.state !== "sent") return null;
  const acts = !!actions && may(s, me, "doc") && isOpen(row);
  const stop = (run: () => void) => (e: MouseEvent) => { e.stopPropagation(); run(); };
  const ref = { paper: row.paper, recordId: row.recordId, did: row.recordId };
  return (
    <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <span className={`tag ${tone(sg.status)}`} title="Zoho Sign status"><span className="dot" />{sg.label || words(sg.status)}</span>
      {did ? <div className="sm">{did}</div> : null}
      {row.yourMove ? <div className="sm">{row.yourMove}</div> : null}
      {acts && !ask ? (
        <div style={{ marginTop: 4 }}>
          <button type="button" className="chip" onClick={stop(() => { void remind(ref).then(r => { if (r.ok) setDid("Reminder sent"); }); })}>Send a reminder</button>{" "}
          <button type="button" className="chip" onClick={stop(() => { setAsk(true); setWhy(""); })}>Recall</button>
        </div>) : null}
      {acts && ask ? (
        <div className="note" role="alertdialog" aria-label={"Recall the " + row.label} style={{ marginTop: 6, textAlign: "left" }}>
          <b>{"Recall the " + row.label + "?"}</b> The investor&apos;s signing link stops working and the round reads blocked
          until a fresh copy is sent. Why is it being recalled?
          <div className="chips" style={{ marginTop: 7 }}>
            {RECALLWHY.map(r => <button key={r} type="button" className={`chip ${why === r ? "on" : ""}`} aria-pressed={why === r}
              onClick={stop(() => setWhy(r))}>{r}</button>)}</div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="act" disabled={!why}
              onClick={stop(() => { void recall({ ...ref, reason: why }).then(r => { if (r.ok) { setDid("Recalled"); setAsk(false); } }); })}>Yes, recall it</button>{" "}
            <button type="button" className="btn" onClick={stop(() => setAsk(false))}>No, leave it out</button>
          </div>
        </div>) : null}
    </div>
  );
}

/** The same cell for a row that is a book document (the investor record's Paper list, the prototype's own rows): its route row
 *  is looked up by id, and the reminder this book kept is said under it. */
export function SignCell({ s, me, dispatch, d, actions }: ImPageProps & { d: ImDoc; actions?: boolean }) {
  const r = useApiRead(documentsList, { s, me }, "all");
  const row = r.state === "ok" ? r.data.rows.find(x => x.recordId === d.id) : null;
  const rem = lastReminder(s, d.id);
  return row ? (
    <>
      <SignRowCell s={s} me={me} dispatch={dispatch} row={row} actions={actions} />
      {rem ? <div className="sm">{"Reminder sent " + rem.at + " by " + who(s, rem.by).n.split(" ")[0]}</div> : null}
    </>
  ) : null;
}
