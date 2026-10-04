"use client";

/* AVAILABILITY EDITOR — DRAWERS.absence, redesigned prototype ~12843–12864.

   One screen for the current window, a fresh draft, or (once it has passed) the record of the last
   one — a select for the reason rather than a chip row, and the two dates beside each other, so the
   editor reads the same whether it is being opened for a correction or for the first time.

   M08-S05-NOTE-6: every save goes through POST / DELETE /api/availability (endpoints/availability) — fixture mode runs the
   reducer action it replaced. A refusal is the route's own message, shown in the drawer. The reason is private and never
   leaves the browser: live it is not asked (the route takes none); the demo book still records it. */

import { OUTWHY } from "@/domain";
import type { PersonKey } from "@/domain";
import { dAdd, dISOtoDisp, dOf, dayOf, iso } from "@/lib/format";
import { availabilityStatus, availabilityCover } from "../availability";
import { canRosterFor, gone, outFor, planFor, P } from "@/lib/selectors";
import { useConsole, type ConsoleState } from "@/lib/store";
import { useApiMode, useApiWrite, type ApiResult } from "@/lib/data/api";
import { availabilityClear, availabilitySet, type AvailWritten } from "@/lib/data/endpoints/availability";
import { registerDrawer, type DrawerProps } from "./registry";

/* the roster never offers "Left the company" — leaving is not an absence. 03-app.js:6958 */
const WHYS = (OUTWHY as unknown as readonly string[]).filter((w) => w !== "Left the company");

/* availabilityDraftWhy(k) — 03-app.js:10399. What stops the draft from saving, said once and read
   both by the Save button's disabled state and its title. */
function draftWhy(state: ConsoleState, k: PersonKey, live = false): string {
  if (!state.PEOPLE[k] || !canRosterFor(state, k) || gone(state, k)) return "You do not have permission to change this availability.";
  const { ABWHY, ABFROM, ABTO } = state.ui;
  if (!live && (!ABWHY || !WHYS.includes(ABWHY))) return "Choose an absence reason.";
  const from = ABFROM || iso(state.NOW), to = ABTO || iso(dAdd(state.NOW, 1));
  const f = dOf(from), t = dOf(to);
  if (!f || !t || iso(f) !== from || iso(t) !== to || f < dayOf(state.NOW) || t <= f) {
    return "Choose a start date from today and a later return date.";
  }
  return "";
}

/* What a press answered, said in the drawer: a refusal (role="alert") or, after "Mark back in", the covers it ended (D44). */
export function said(dispatch: (a: import("@/lib/store").Action) => unknown, r: ApiResult<AvailWritten>): void {
  if (!r.ok) { dispatch({ type: "setUi", patch: { AVERR: r.error, AVNOTE: null } }); return; }
  const c = r.data.covers;
  const note = !c ? null
    : c.pending === null ? "Marked back in. Their lead covers could not be read — any still running end on their own date."
    : c.pending > 0 ? `Marked back in. ${c.cleared} cover${c.cleared === 1 ? "" : "s"} ended; ${c.pending} could not be ended and end on ${c.pending === 1 ? "its" : "their"} own date.`
    : c.cleared > 0 ? `Marked back in. ${c.cleared} lead cover${c.cleared === 1 ? "" : "s"} ended.` : null;
  dispatch({ type: "setUi", patch: { AVERR: null, AVNOTE: note } });
}

function Body({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const live = useApiMode() === "live";
  const set = useApiWrite(availabilitySet, state, dispatch);
  const k = id as PersonKey;
  const err = typeof state.ui.AVERR === "string" ? state.ui.AVERR : null;
  const note = typeof state.ui.AVNOTE === "string" ? state.ui.AVNOTE : null;
  const s = availabilityStatus(state, k);
  const a = s.out || s.soon ? state.AVAIL[k] : null;
  const previous = !a ? state.AVAIL[k] : null;
  const cover = availabilityCover(state, k);
  const record = a || previous || null;
  const { ABWHY, ABFROM, ABTO } = state.ui;
  const started = !!a && !!dOf(a.from) && dOf(a.from)! < dayOf(state.NOW);

  return (
    <div className="ux-availability ux-av-editor">
      <div className="ux-av-window-summary">
        <span className={`tag ${s.out ? "cov" : "go"}`}>
          <span className="dot" />
          {s.t}
        </span>
        <b>{s.detail}</b>
        {cover ? <span>{cover}</span> : null}
      </div>

      {live ? null : (
      <label className="fi">
        <span>Absence reason · private</span>
        <select
          className="selw"
          id="availability-reason"
          value={a ? a.why : ABWHY || ""}
          disabled={!!a}
          onChange={(e) => {
            if (a) dispatch({ type: "setOutWhy", k, why: e.target.value });
            else dispatch({ type: "setUi", patch: { ABWHY: e.target.value || null } });
          }}
        >
          <option value="" disabled={!!a}>
            Choose a reason…
          </option>
          {WHYS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </label>
      )}

      <div className="ux-av-dates">
        <label className="fi">
          <span>Out from</span>
          <input
            className="di2"
            id="availability-from"
            type="date"
            value={a ? a.from : ABFROM || iso(state.NOW)}
            aria-label="Out from"
            {...(started
              ? { disabled: true, title: "This absence has started" }
              : {
                  min: iso(state.NOW),
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                    const from = e.target.value;
                    if (!a) { dispatch({ type: "setUi", patch: { ABFROM: from } }); return; }
                    /* the reducer's rule: a return on or before the new start moves to the day after it */
                    const to = dOf(a.to) && dOf(from) && dOf(a.to)! <= dOf(from)! ? iso(dAdd(dOf(from)!, 1)) : a.to;
                    void set({ k, from, to, change: "from" }).then((r) => said(dispatch, r));
                  },
                })}
          />
        </label>
        <label className="fi">
          <span>Back on</span>
          <input
            className="di2"
            id="availability-to"
            type="date"
            value={a ? a.to : ABTO || iso(dAdd(state.NOW, 1))}
            min={iso(dAdd(dOf(a ? a.from : ABFROM) ?? state.NOW, 1))}
            aria-label="Back on"
            onChange={(e) => {
              const to = e.target.value;
              if (!a) { dispatch({ type: "setUi", patch: { ABTO: to } }); return; }
              /* a started window is re-filed from today (the route takes no past day; the roster only answers today onwards) */
              const today = iso(state.NOW);
              void set({ k, from: a.from < today ? today : a.from, to, change: "to" }).then((r) => said(dispatch, r));
            }}
          />
        </label>
      </div>

      {err ? <p className="note bad" role="alert" id="availability-error">{err}</p> : null}
      {note ? <p className="note" role="status" id="availability-note">{note}</p> : null}

      <p className="ux-av-footnote">
        {a ? "Changes save when selected. " : ""}
        The return date marks this person In automatically. Named secondaries cover while they are Out; ownership stays in place.
      </p>

      {record && record.by ? (
        <details className="ux-disclosure">
          <summary>{previous ? "Previous absence" : "Record details"}</summary>
          <div className="ux-section">
            <p className="sm">
              {record.why} · {dISOtoDisp(record.from, state.NOW)} to {dISOtoDisp(record.to, state.NOW)}
            </p>
            <p className="sm">
              Recorded by {P(state.PEOPLE, record.by as PersonKey).n} · {record.at}
            </p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Foot({ id }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const live = useApiMode() === "live";
  const set = useApiWrite(availabilitySet, state, dispatch);
  const clear = useApiWrite(availabilityClear, state, dispatch);
  const k = id as PersonKey;
  const out = outFor(state, k), soon = planFor(state, k);

  if (out || soon) {
    return (
      <button
        type="button"
        className="act"
        onClick={() => {
          if (canRosterFor(state, k) && !gone(state, k)) void clear({ k }).then((r) => said(dispatch, r));
        }}
      >
        {out ? "Mark back in" : "Cancel planned absence"}
      </button>
    );
  }
  const why = draftWhy(state, k, live);
  const { ABFROM } = state.ui;
  return (
    <>
      <button
        type="button"
        className="act"
        disabled={!!why}
        title={why || undefined}
        onClick={
          why
            ? undefined
            : () => void set({ k, why: state.ui.ABWHY ?? undefined, from: state.ui.ABFROM || iso(state.NOW), to: state.ui.ABTO || iso(dAdd(state.NOW, 1)) })
                .then((r) => said(dispatch, r))
        }
      >
        {ABFROM && ABFROM !== iso(state.NOW) ? "Book absence" : "Save availability"}
      </button>
      {why ? <span className="sm">{why}</span> : null}
    </>
  );
}

registerDrawer("absence", {
  w: 440,
  /* a drawer about anything else says when it is stale — 03-app.js:12843 */
  ok: (state, id) => !!id && !!state.PEOPLE[id as PersonKey] && !gone(state, id as PersonKey) && canRosterFor(state, id as PersonKey),
  title: () => "Availability",
  sub: (state, a) => P(state.PEOPLE, a.id as PersonKey).n,
  Body,
  Foot,
});
