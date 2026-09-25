"use client";

/* ── DRAWERS.touch — log a touch. 03-app.js 6277–6315 ───────────────────────────────────────
   A TOUCH AT A TIME. Three WhatsApps and two calls before they replied is not one event with a
   count on it — it is five things that happened on five days, and the only way to have that in the
   record is to let somebody log one, save, and come back on Thursday and log the next. One attempt
   per save; the drawer stays open for the next one.

   Two refusals here were `alert()`s: the per-channel consent one (`conWhy`) and the future-dated
   one. Both render as the `.note.bad` this drawer already has room for, and neither writes.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { EDIT_H, TOUCHCHANNELS, TOUCHDONE } from "@/domain";
import type { Channel, Lead, Stamp } from "@/domain";
import { agoStr, dISOtoDisp, iso, nowT, whenT } from "@/lib/format";
import { canWork, conFor, conWhy, fresh, noNext, tCount, tList, whyLocked } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { ConsoleState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { uiTD } from "@/features/leads/ui";

type Row = { k: string; at: Stamp; n: number; t: string; last: boolean };

/* the two sentences the prototype popped in an alert() — kept word for word */
const FUTURE =
  "That is in the future. A touch is recorded after it happens — the count only means something because every entry is something that already went out.";
const stale = (t: string, NOW: Date, what: string) =>
  "That " +
  what +
  " was recorded " +
  agoStr(t, NOW) +
  ". Entries can be taken back for " +
  EDIT_H +
  " hours; after that a correction is a new record.";

function Body({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const TD = uiTD(state.ui);
  const [refusal, setRefusal] = useState<string | null>(null);

  const rows: Row[] = [];
  TOUCHCHANNELS.forEach((k) =>
    tList(l, k).forEach((at, i) =>
      rows.push({ k, at, n: i + 1, t: TOUCHDONE[k], last: i === tCount(l, k) - 1 }),
    ),
  );
  if (l.reply) rows.push({ k: "reply", at: l.reply, t: "Reply received", last: true, n: 0 });
  rows.sort(
    (a, b) => (whenT(b.at, state.NOW)?.getTime() || 0) - (whenT(a.at, state.NOW)?.getTime() || 0),
  );

  const drop = (k: string, at: Stamp) => {
    if (!fresh(at, state.NOW)) {
      setRefusal(stale(at, state.NOW, k === "reply" ? "reply" : TOUCHDONE[k as Channel].toLowerCase()));
      return;
    }
    setRefusal(null);
    dispatch({ type: "dropTouch", id: l.id, k, at });
  };

  return (
    <>
      <p className="lbl">What happened</p>
      <select
        className="selw"
        id="tdk"
        aria-label="What happened"
        value={TD.k}
        onChange={(e) => dispatch({ type: "setTD", k: "k", v: e.target.value })}
      >
        {TOUCHCHANNELS.map((k) => (
          <option value={k} key={k}>
            {TOUCHDONE[k]}
            {tCount(l, k) ? " — attempt " + (tCount(l, k) + 1) : ""}
          </option>
        ))}
        <option value="reply">Reply received — they came back</option>
      </select>
      <p className="lbl" style={{ marginTop: "14px" }}>
        When
      </p>
      <div className="dtrow">
        <input
          className="di2"
          id="tdd"
          type="date"
          max={iso(state.NOW)}
          value={TD.d}
          aria-label="Date"
          onChange={(e) => dispatch({ type: "setTD", k: "d", v: e.target.value })}
        />
        <input
          className="di2"
          id="tdtm"
          type="time"
          value={TD.tm}
          step="300"
          aria-label="Time"
          onChange={(e) => dispatch({ type: "setTD", k: "tm", v: e.target.value })}
        />
      </div>
      <p className="sm" style={{ margin: "9px 0 0" }}>
        {TD.k === "reply"
          ? "Everything logged after a reply counts as a fresh run of attempts."
          : "Save one contact after it happens."}
      </p>
      {TD.k !== "reply" && !conFor(l, TD.k as Channel) ? (
        <>
          <div className="note due">{conWhy(l, TD.k as Channel)}</div>
          <button
            type="button"
            className="chip"
            onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id })}
          >
            Review contact permission
          </button>
        </>
      ) : null}
      {refusal ? (
        <div className="note bad" style={{ marginTop: "10px" }} role="alert">
          {refusal}
        </div>
      ) : null}
      <details className="drwsec">
        <summary className="lbl">Previous contact entries · {rows.length}</summary>
        {rows.length ? (
          <p className="sm" style={{ margin: "-2px 0 8px" }}>
            An entry can be taken back for {EDIT_H} hours. After that a correction is a new record,
            not an edit.
          </p>
        ) : null}
        {rows.length ? (
          rows.map((x) => (
            <div className="ur" key={x.k + x.at + x.n}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{x.t}</b>
                {x.n > 1 ? <span className="sm"> attempt {x.n}</span> : null}
                <div className="sm mono">{x.at}</div>
              </div>
              {canWork(state, l) ? (
                fresh(x.at, state.NOW) ? (
                  <button
                    type="button"
                    className="chip"
                    title={`Recorded ${agoStr(x.at, state.NOW)}`}
                    onClick={() => drop(x.k, x.at)}
                  >
                    {x.k === "reply" ? "Remove the reply" : "Remove this touch"}
                  </button>
                ) : (
                  <span
                    className="lock"
                    title={`Recorded ${agoStr(x.at, state.NOW)} — a take-back lasts ${EDIT_H} hours`}
                  >
                    🔒
                  </span>
                )
              ) : null}
            </div>
          ))
        ) : (
          <p className="sm" style={{ margin: 0 }}>
            No contact entries yet.
          </p>
        )}
      </details>
    </>
  );
}

/* saveTouch's two refusals, decided before anything is written — 03-app.js:2213, 2218 */
function saveWhy(state: ConsoleState, l: Lead, TD: { k: string; d: string; tm: string }): string | null {
  /* a reply is inbound: the one thing you can record on a lead that has given no consent */
  if (TD.k !== "reply" && !conFor(l, TD.k as Channel)) return conWhy(l, TD.k as Channel);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(TD.d || "")) return null;
  const at = dISOtoDisp(TD.d, state.NOW) + " " + (/^\d{2}:\d{2}$/.test(TD.tm || "") ? TD.tm : "09:00");
  const atD = whenT(at, state.NOW);
  if (!atD || atD > nowT(state.NOW)) return FUTURE;
  return null;
}

function Foot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const TD = uiTD(state.ui);
  const [refusal, setRefusal] = useState<string | null>(null);
  if (!canWork(state, l))
    return (
      <span className="sm">{whyLocked(state, l)} Recording belongs to whoever holds it.</span>
    );
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(TD.d || "");
  const ok = dateOk && (TD.k === "reply" || conFor(l, TD.k as Channel));
  return (
    <>
      <button
        type="button"
        className="act"
        disabled={!ok}
        title={ok ? undefined : "Record a date and the channel's contact permission first"}
        onClick={
          ok
            ? () => {
                const why = saveWhy(state, l, TD);
                setRefusal(why);
                if (why) return;
                dispatch({ type: "saveTouch", id: l.id });
              }
            : undefined
        }
      >
        Save contact
      </button>
      <span className="sm">
        {noNext(l) ? "Next: schedule a follow-up" : "Saved contact stays on this investor"}
      </span>
      {refusal ? (
        <div className="note bad" style={{ marginTop: "8px", width: "100%" }} role="alert">
          {refusal}
        </div>
      ) : null}
    </>
  );
}

registerDrawer("touch", {
  lead: true,
  w: 430,
  title: () => "Record contact",
  sub: (_s, a) => a.lead!.n,
  Body,
  Foot,
});
