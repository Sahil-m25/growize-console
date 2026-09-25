"use client";

/* ── DRAWERS.material and DRAWERS.pack. 03-app.js 6400–6427 ─────────────────────────────────
   The console sends nothing. The IR sends it however they normally do; these record that it went,
   and when. A tick can be taken back for eight hours, and after that it stands.

   Three refusals here were `alert()`s — the NDA is not back signed, consent has not been recorded,
   the take-back window has closed. Each one renders as the `.note.bad` under the list.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { EDIT_H, GOALS, SENDABLE } from "@/domain";
import type { Sendable } from "@/domain";
import { agoStr } from "@/lib/format";
import { canWork, fresh, ndaOK, whyLocked } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

const NDAFIRST =
  "The NDA is not back signed yet.\n\nNothing goes out to somebody who has not signed one — that is what the first round is for. Open Paperwork on this lead to see whose move it is.";
const NOCONSENT = "Consent has to be recorded before anything is sent.";

function MaterialBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const sent = state.SENT[l.id] || {};
  const can = canWork(state, l);
  const [refusal, setRefusal] = useState<string | null>(null);

  const mat = (d: Sendable) => {
    const at = sent[d];
    if (!at && !ndaOK(state, l)) return setRefusal(NDAFIRST);
    if (!can) return;
    if (!at && !l.consent) return setRefusal(NOCONSENT);
    if (at && !fresh(at, state.NOW))
      return setRefusal(
        "“" +
          d +
          "” was ticked " +
          agoStr(at, state.NOW) +
          ". A tick can be taken back for " +
          EDIT_H +
          " hours; after that it stands.",
      );
    setRefusal(null);
    dispatch({ type: "mat", id: l.id, d });
  };

  return (
    <>
      {/* ir-console-redesigned.html:12280: the upfront gate note, said before the ticks rather than
         only after a click is refused. */}
      {!ndaOK(state, l) ? (
        <>
          <div className="note due" style={{ margin: "0 0 12px" }}>The signed NDA is required before sending material.</div>
          <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}>Open paperwork</button>
        </>
      ) : !l.consent ? (
        <>
          <div className="note due" style={{ margin: "0 0 12px" }}>Record contact permission before sending material.</div>
          <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}>Record permission</button>
        </>
      ) : null}
      <div className="ticks">
        {SENDABLE.map((d) => {
          const at = sent[d];
          return (
            <div
              className={`tk ${at ? "on" : ""}`}
              key={d}
              role="checkbox"
              aria-checked={at ? "true" : "false"}
              {...(can
                ? {
                    tabIndex: 0,
                    style: { cursor: "pointer" },
                    onClick: () => mat(d),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        mat(d);
                      }
                    },
                  }
                : {})}
            >
              <span className="box">✓</span>
              <span className="t">{d}</span>
              <time>{at ? at.slice(0, 6) : "not sent"}</time>
            </div>
          );
        })}
      </div>
      <p className="sm" style={{ margin: "11px 0 0" }}>
        {can
          ? "Record material only after sending it. Corrections are available for " + EDIT_H + " hours."
          : "Read only — " + whyLocked(state, l)}
      </p>
      {refusal ? (
        <div className="note bad" style={{ marginTop: "10px", whiteSpace: "pre-line" }} role="alert">
          {refusal}
        </div>
      ) : null}
      {ndaOK(state, l) ? (
        <details className="ux-disclosure">
          <summary>Agreements</summary>
          <div className="ux-section">
            <button
              type="button"
              className="chip"
              onClick={() => dispatch({ type: "openDrawer", k: "paper", id: l.id })}
            >
              Open paperwork
            </button>
          </div>
        </details>
      ) : null}
    </>
  );
}

function PackBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const can = canWork(state, l);
  const n = state.PACK[l.id] || 0;
  const [refusal, setRefusal] = useState<string | null>(null);

  const pack = (w: number, enabled: boolean) => {
    if (!can || !enabled) return;
    const down = n === w;
    if (!down && !l.consent) return setRefusal(NOCONSENT);
    if (down && !fresh(state.PACKAT[l.id] || "", state.NOW))
      return setRefusal(
        "Week " +
          w +
          " was recorded " +
          agoStr(state.PACKAT[l.id], state.NOW) +
          ". A send can be taken back for " +
          EDIT_H +
          " hours; after that it stands.",
      );
    setRefusal(null);
    dispatch({ type: "pack", id: l.id, w });
  };

  const weeks: number[] = [];
  for (let w = 1; w <= GOALS(state.PLAN).packWeeks; w++) weeks.push(w);

  return (
    <>
      {/* ir-console-redesigned.html:12296: the upfront gate note, said before the ticks. */}
      {!l.consent ? (
        <>
          <div className="note due" style={{ margin: "0 0 12px" }}>Record contact permission before sending a produce pack.</div>
          <button type="button" className="act" onClick={() => dispatch({ type: "openDrawer", k: "details", id: l.id, seed: { DTAB: "permission" } })}>Record permission</button>
        </>
      ) : null}
      <div className="ticks">
        {weeks.map((w) => {
          const on = n >= w;
          /* only the current week (to take a fresh send back) or the very next one (to advance)
             is ever clickable — ir-console-redesigned.html:12298's `w===n?fresh(...):w===n+1&&l.consent`. */
          const enabled = can && (w === n ? fresh(state.PACKAT[l.id] || "", state.NOW) : w === n + 1 && !!l.consent);
          return (
            <div
              className={`tk ${on ? "on" : ""}`}
              key={w}
              role="checkbox"
              aria-checked={on ? "true" : "false"}
              aria-disabled={!enabled}
              {...(enabled
                ? {
                    tabIndex: 0,
                    style: { cursor: "pointer" },
                    onClick: () => pack(w, enabled),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        pack(w, enabled);
                      }
                    },
                  }
                : {})}
            >
              <span className="box">✓</span>
              <span className="t">Week {w}</span>
              <time>{on ? "sent" : "due"}</time>
            </div>
          );
        })}
      </div>
      <p className="sm" style={{ margin: "11px 0 0" }}>
        For field-event investors, record weeks 1–4 in order after each send. The latest send can be corrected for {EDIT_H} hours.
      </p>
      {refusal ? (
        <div className="note bad" style={{ marginTop: "10px" }} role="alert">
          {refusal}
        </div>
      ) : null}
    </>
  );
}

registerDrawer("material", {
  lead: true,
  w: 400,
  title: () => "Material sent",
  sub: (_s, a) => a.lead!.n,
  Body: MaterialBody,
});

registerDrawer("pack", {
  lead: true,
  w: 380,
  title: () => "Produce pack",
  sub: (_s, a) => a.lead!.n,
  Body: PackBody,
});
