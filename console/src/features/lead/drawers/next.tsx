"use client";

/* ── DRAWERS.next — the dated next step. 03-app.js 6219–6249 ────────────────────────────────
   TIME, NOT JUST A DAY. "Call me after six" is a promise with an hour in it. A next step that
   carries only a date turns that into a whole day of guessing, and the call-back is the cheapest
   lead there is to lose. So the step carries a date AND a time, both picked from a real calendar
   and clock.

   C1: Save the step is PUT /api/leads/[id]/next (lib/data/endpoints/followup). Remove next step is not wired
   (it waits on an owner ruling), so it is offered only on the fixture book.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { CHAN, NEXTS } from "@/domain";
import type { Channel, Lead } from "@/domain";
import { dISOtoDisp, iso, nowT, plusD } from "@/lib/format";
import { chanOf, conFor, hasNext, P } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { uiNXD } from "@/features/leads/ui";
import { useState } from "react";
import { useApiMode, useApiWrite } from "@/lib/data/api";
import { NO_MT, nextSave } from "@/lib/data/endpoints/followup";

const QUICK: readonly (readonly [string, number])[] = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
];

/* the follow-up channel — ir-console-redesigned.html 12078-12080. `NextDraft` (leads/ui.ts) now
   carries its own `ch` field, and `saveNext` persists it onto `l.nx.ch` — so this reads and writes
   `NXD.ch` directly via `{type:"setNXD",k:"ch",v}` rather than the page-local `ui.NXDCH` key this
   file used before that field existed. */
const CHOICES = ["msg", "email", "call", "visit", "other"] as const;
function draftChannel(state: ReturnType<typeof useConsole>["state"], l: Lead, ch: string): Channel | "other" {
  return (CHOICES as readonly string[]).includes(ch) ? (ch as Channel | "other") : (chanOf(state, l) as Channel | "other");
}

function Body({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const NXD = uiNXD(state.ui);
  const ch = draftChannel(state, l, NXD.ch);
  const set = (k: "t" | "d" | "tm", v: string) => dispatch({ type: "setNXD", k, v });

  return (
    <>
      <p className="lbl">What happens next</p>
      <select
        className="selw"
        id="nxsel"
        aria-label="What happens next"
        value={NXD.t}
        onChange={(e) => set("t", e.target.value)}
      >
        <option value="">Choose the step…</option>
        {NXD.t && !(NEXTS as readonly string[]).includes(NXD.t) ? (
          <option value={NXD.t}>{NXD.t} — as it stands</option>
        ) : null}
        {NEXTS.map((t) => (
          <option value={t} key={t}>
            {t}
          </option>
        ))}
      </select>
      <label className="fi" style={{ marginTop: "12px" }}>
        <span>Follow-up channel</span>
        <select
          className="selw"
          id="nxch"
          aria-label="Follow-up channel"
          value={ch}
          onChange={(e) => dispatch({ type: "setNXD", k: "ch", v: e.target.value })}
        >
          {(Object.entries(CHAN) as [Channel | "other", string][]).map(([k, t]) => (
            <option value={k} key={k} disabled={k !== "other" && !conFor(l, k as Channel)}>
              {t}
              {k !== "other" && !conFor(l, k as Channel) ? " — permission needed" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="lbl" style={{ marginTop: "14px" }}>
        When
      </p>
      <div className="dtrow">
        <input
          className="di2"
          id="nxd"
          type="date"
          min={iso(state.NOW)}
          value={NXD.d}
          aria-label="Next step date"
          onChange={(e) => set("d", e.target.value)}
        />
        <input
          className="di2"
          id="nxtm"
          type="time"
          value={NXD.tm}
          step="900"
          aria-label="Time"
          onChange={(e) => set("tm", e.target.value)}
        />
      </div>
      <div className="chips" style={{ marginTop: "8px" }}>
        {QUICK.map(([t, n]) => {
          const on = NXD.d === iso(plusD(nowT(state.NOW), n));
          return (
            <button
              type="button"
              key={t}
              className={`chip ${on ? "on" : ""}`}
              aria-pressed={on}
              onClick={() => dispatch({ type: "quickDate", n })}
            >
              {t}
            </button>
          );
        })}
      </div>
      <p className="sm" style={{ margin: "10px 0 0" }}>
        {NXD.d ? (
          <>
            It will read{" "}
            <b>
              {dISOtoDisp(NXD.d, state.NOW)}
              {NXD.tm ? " · " + NXD.tm : ""}
            </b>{" "}
            on the lead, and appear on{" "}
            {P(state.PEOPLE, l.own || state.WHO).n.split(" ")[0]}'s day when it comes round.
          </>
        ) : (
          "Choose an action and a date so this investor appears in the right work list."
        )}
      </p>
      <p className="sm" style={{ marginTop: "12px" }}>
        Add a time when you agreed a specific appointment. Contact actions require permission for
        their channel.
      </p>
    </>
  );
}

function Foot({ lead }: DrawerProps) {
  const { state, dispatch, reloadData } = useConsole();
  const l = lead!;
  const NXD = uiNXD(state.ui);
  const save = useApiWrite(nextSave, state, dispatch);
  const live = useApiMode() === "live";
  const [refusal, setRefusal] = useState<string | null>(null);
  /* B-25: Save waits for a channel the lead allows ("other" always is); the server refuses the rest with no-consent */
  const chNow = draftChannel(state, l, NXD.ch);
  const ok = !!NXD.t && /^\d{4}-\d{2}-\d{2}$/.test(NXD.d || "") && (chNow === "other" || conFor(l, chNow));
  const press = () => {
    setRefusal(null);
    if (live && !l.mt) { setRefusal(NO_MT().error); return; }
    void save({ id: l.id, mt: l.mt, text: NXD.t, d: NXD.d, tm: NXD.tm, ch: draftChannel(state, l, NXD.ch) }).then((r) => {
      if (!r.ok) { setRefusal(r.error); return; }
      if (!live) return; /* the reducer has already saved the step and closed the drawer */
      dispatch({ type: "setUi", patch: { NXASK: null } });
      dispatch({ type: "closeDrawer" });
      reloadData();
    });
  };
  return (
    <>
      <button type="button" className="act" disabled={!ok} onClick={ok ? press : undefined}>
        {hasNext(l) ? "Save the change" : "Save the step"}
      </button>
      {hasNext(l) && !live ? (
        <button
          type="button"
          className="chip"
          onClick={() => {
            dispatch({ type: "clearNext", id: l.id });
            dispatch({ type: "closeDrawer" });
          }}
        >
          Remove next step
        </button>
      ) : null}
      {refusal ? (
        <div className="note bad" style={{ marginTop: "8px", width: "100%" }} role="alert">
          {refusal}
        </div>
      ) : null}
    </>
  );
}

registerDrawer("next", { lead: true, w: 420, title: () => "Next step", sub: (_s, a) => a.lead!.n, Body, Foot });
