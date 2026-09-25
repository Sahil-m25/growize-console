"use client";

/* ── DRAWERS.followup — the combined outcome-and-next-step record.
   ir-console-redesigned.html 6002-6141 (fuDraft/openFollowup/setFU/saveFollowup), 6151-6183
   (followupBody), 12922-12926 (DRAWERS.followup) ──────────────────────────────────────────────
   ONE FORM FOR WHAT HAPPENED AND WHAT HAPPENS NEXT. The old `touch` drawer only ever recorded that
   a channel was tried; it had nowhere to put the outcome, an objection, a note, or the next step in
   the same save. This is the prototype's replacement: a single conversation record — channel,
   outcome, objections, a note — that in the same write either keeps the appointment it had or
   leaves behind the one it does not.

   The store's `saveFollowup`/`discardFollowup` (src/lib/store.tsx) hold every real gate (channel
   permission, a contact time that is not in the future, the next-step fields when one is left
   behind); this file's own `followupWhy` mirrors just enough of them to tell the person WHY a
   disabled Save is disabled, the same division touch.tsx already draws between its `saveWhy` and
   the reducer's own re-check.

   ponytail: the prototype's `fuDraft` freezes a copy of the scheduled task on open and refuses to
   save if `l.nx` has since changed underneath the open drawer ("The scheduled task changed while
   this form was open"). `FollowupDraft` (store.tsx) carries no such snapshot, and this port has no
   second actor racing the same drawer to make that check earn its keep — skipped; read `l.nx` live
   instead. Add the snapshot-and-diff if a real multi-tab/multi-actor race turns up. */

import { useState } from "react";
import { NEXTS, OBJS, ST } from "@/domain";
import type { Channel, Lead } from "@/domain";
import { dISOtoDisp, hhmm, iso, nowT, plusD } from "@/lib/format";
import { active, canPlan, canWork, conFor, conWhy, hasNext, lost, whyLocked } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { ConsoleState, DrawerKind, FollowupDraft } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { FollowupContext } from "../followupContext";

/* FUCHANNELS/FUOUTCOMES — ir-console-redesigned.html:5990-5996. Followup-drawer-only presentation
   data; not a domain constant (nothing outside this drawer reads it), so it lives here rather than
   widening a shared file this agent does not own. */
export const FUCHANNELS: Record<string, string> = {
  call: "Call", msg: "WhatsApp", email: "Email", visit: "Visit", reply: "Inbound reply", other: "Task completed",
};
const FUOUTCOMES: Record<string, readonly string[]> = {
  call: ["Connected", "Interested", "Call back", "Not now", "Not interested", "No answer", "Wrong number"],
  msg: ["Message sent", "Reply received", "Interested", "Not now"],
  email: ["Email sent", "Reply received", "Interested", "Not now"],
  visit: ["Visit completed", "Interested", "Not now", "Not interested", "Investor unavailable"],
  reply: ["Reply received", "Interested", "Call back", "Not now", "Not interested"],
  other: ["Completed"],
};
const fuChannelAllowed = (l: Lead, k: string): boolean =>
  k === "reply" || k === "other" || conFor(l, k as Channel);

const uiFU = (ui: ConsoleState["ui"]): FollowupDraft | undefined => ui.FU as FollowupDraft | undefined;

/* fuDraft(l) — ir-console-redesigned.html:6002-6008, minus the module-level cache: `ui.FU` is one
   slot, seeded fresh each time the drawer opens (see `openFollowup` below). */
export function freshFollowup(l: Lead, NOW: Date): FollowupDraft {
  const k = (["call", "msg", "email", "visit"] as const).find((c) => conFor(l, c)) || "reply";
  return {
    channel: k, outcome: "", obj: [], note: "", d: iso(NOW), tm: hhmm(NOW),
    keep: false, complete: hasNext(l), noNext: false,
    t: k === "call" ? "Call back" : k === "visit" ? "Farm visit" : "Nurture — check back",
    nd: iso(plusD(NOW, 1)), ntm: "10:00", nch: k === "reply" ? "other" : k,
  };
}

/* openFollowup(id,channel) — ir-console-redesigned.html:6011-6019. Seeds `ui.FU` and opens the
   drawer; a channel argument (a contact-actions button, or the ladder's ＋ Record contact) starts
   the draft on that channel instead of the lead's own default. */
export function openFollowup(
  dispatch: ReturnType<typeof useConsole>["dispatch"],
  l: Lead,
  NOW: Date,
  channel?: string | null,
): void {
  const base = freshFollowup(l, NOW);
  const seeded: FollowupDraft = channel && FUCHANNELS[channel] && channel !== base.channel
    ? { ...base, channel: channel as FollowupDraft["channel"], outcome: "" }
    : base;
  dispatch({ type: "setUi", patch: { FU: seeded } });
  dispatch({ type: "openDrawer", k: "followup" as DrawerKind, id: l.id });
}

/* followupWhy — the save-time refusals `saveFollowup` (store.tsx) enforces, said in words before
   the write is attempted; mirrors touch.tsx's own saveWhy/FUTURE split. */
function followupWhy(state: ConsoleState, l: Lead, d: FollowupDraft): string | null {
  if (d.channel !== "reply" && d.channel !== "other" && !conFor(l, d.channel as Channel)) return conWhy(l, d.channel as Channel);
  if (!(FUOUTCOMES[d.channel] || []).includes(d.outcome)) return "Choose what happened.";
  const dt = new Date(d.d + "T" + (d.tm || "00:00") + ":00");
  if (isNaN(dt.getTime()) || iso(dt) !== d.d) return "Choose a valid contact date and time.";
  if (dt > nowT(state.NOW)) return "Record contact after it happens. The contact time cannot be in the future.";
  if (d.keep && !hasNext(l)) return "The appointment is no longer on this investor.";
  if (!d.keep && !d.noNext) {
    const nd = new Date((d.nd || "") + "T" + (d.ntm || "23:59") + ":00");
    if (!d.t || !d.t.trim() || isNaN(nd.getTime())) return "Choose a next step and a valid date.";
    if (nd < nowT(state.NOW)) return "The next step needs a time that is still ahead.";
    if (d.nch && d.nch !== "other" && !conFor(l, d.nch as Channel)) return conWhy(l, d.nch as Channel) + " Choose another channel for the next step.";
  }
  if (d.noNext && active(l) && !lost(l) && l.done < ST.ONBOARDED) return "Active investors need a dated next step. Keep the appointment or set the next step.";
  return null;
}

function Body({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const d = uiFU(state.ui) ?? freshFollowup(l, state.NOW);
  const options = FUOUTCOMES[d.channel] || [];
  const permitted = fuChannelAllowed(l, d.channel);
  const set = (patch: Partial<FollowupDraft>) => dispatch({ type: "setUi", patch: { FU: { ...d, ...patch } } });

  return (
    <div className="ux-followup">
      <FollowupContext l={l} />
      {!permitted ? (
        <div className="note bad">{conWhy(l, d.channel as Channel)} Choose an inbound reply or a permitted channel.</div>
      ) : null}
      <div className="drwsec">
        <p className="lbl">Record what happened</p>
        <div className="ux-filter-fields">
          <label className="fi">
            <span>Channel</span>
            <select
              className="selw"
              aria-label="Channel"
              value={d.channel}
              onChange={(e) => set({ channel: e.target.value as FollowupDraft["channel"], outcome: "", obj: [] })}
            >
              {Object.entries(FUCHANNELS).map(([k, t]) => (
                <option value={k} key={k} disabled={!fuChannelAllowed(l, k)}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="fi">
            <span>Outcome</span>
            <select className="selw" aria-label="Outcome" value={d.outcome} onChange={(e) => set({ outcome: e.target.value })}>
              <option value="">Choose what happened…</option>
              {options.map((o) => (
                <option value={o} key={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="ux-disclosure">
          <summary>Contact time · {dISOtoDisp(d.d, state.NOW) || d.d} {d.tm}</summary>
          <div className="ux-filter-fields">
            <label className="fi">
              <span>Contact date</span>
              <input className="di2" type="date" max={iso(state.NOW)} value={d.d} onChange={(e) => set({ d: e.target.value })} />
            </label>
            <label className="fi">
              <span>Contact time</span>
              <input className="di2" type="time" value={d.tm} onChange={(e) => set({ tm: e.target.value })} />
            </label>
          </div>
        </details>
        <label className="fi">
          <span>
            Conversation note <i>optional</i>
          </span>
          <textarea
            className="inp"
            rows={3}
            placeholder="What matters for the next conversation?"
            value={d.note || ""}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        {d.channel !== "other" ? (
          <details className="ux-disclosure">
            <summary>Objections{d.obj?.length ? " · " + d.obj.length : ""}</summary>
            <div className="chips">
              {OBJS.map((o) => (
                <button
                  type="button"
                  key={o}
                  className={`chip ${d.obj?.includes(o) ? "on" : ""}`}
                  aria-pressed={!!d.obj?.includes(o)}
                  onClick={() => set({ obj: d.obj?.includes(o) ? d.obj.filter((x) => x !== o) : [...(d.obj || []), o] })}
                >
                  {o}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="drwsec">
        <p className="lbl">Finish this follow-up</p>
        {hasNext(l) ? (
          <>
            <div className="note" style={{ marginTop: 0 }}>
              <b>{l.nx!.t}</b>
              <div className="sm">
                {l.nx!.by}
                {l.nx!.tm ? " · " + l.nx!.tm : ""}
              </div>
            </div>
            <label className="fi">
              <span>Scheduled task</span>
              <select
                className="selw"
                value={d.complete ? "complete" : d.keep ? "keep" : ""}
                onChange={(e) =>
                  e.target.value === "keep" ? set({ keep: true, complete: false }) : set({ complete: true, keep: false })
                }
              >
                {!d.complete && !d.keep ? (
                  <option value="" disabled>
                    Choose how this contact relates to the task…
                  </option>
                ) : null}
                <option value="complete">This completes the task</option>
                <option value="keep">Separate contact — keep scheduled task</option>
              </select>
            </label>
          </>
        ) : (
          <p className="sm">The contact and next step will be saved together.</p>
        )}
        {!d.keep ? (
          <>
            <div className="ux-filter-fields">
              <label className="fi">
                <span>Next step</span>
                <select className="selw" value={d.t || ""} onChange={(e) => set({ t: e.target.value })}>
                  {NEXTS.map((t) => (
                    <option value={t} key={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fi">
                <span>Next step channel</span>
                <select className="selw" value={d.nch || "other"} onChange={(e) => set({ nch: e.target.value as FollowupDraft["nch"] })}>
                  {(["call", "msg", "email", "visit", "other"] as const).map((k) => (
                    <option value={k} key={k} disabled={!fuChannelAllowed(l, k)}>
                      {k === "other" ? "Internal task" : FUCHANNELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="ux-filter-fields">
              <label className="fi">
                <span>Date</span>
                <input className="di2" type="date" min={iso(nowT(state.NOW))} value={d.nd || ""} onChange={(e) => set({ nd: e.target.value })} />
              </label>
              <label className="fi">
                <span>
                  Time <i>optional</i>
                </span>
                <input className="di2" type="time" value={d.ntm || ""} onChange={(e) => set({ ntm: e.target.value })} />
              </label>
            </div>
            <div className="chips">
              {([["Today", 0], ["Tomorrow", 1], ["Next week", 7]] as const).map(([t, n]) => {
                const on = d.nd === iso(plusD(nowT(state.NOW), n));
                return (
                  <button type="button" key={t} className={`chip ${on ? "on" : ""}`} onClick={() => set({ nd: iso(plusD(nowT(state.NOW), n)) })}>
                    {t}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="sm">The scheduled task will stay in the queue.</p>
        )}
      </div>
    </div>
  );
}

function Foot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const d = uiFU(state.ui) ?? freshFollowup(l, state.NOW);
  const [refusal, setRefusal] = useState<string | null>(null);
  if (!canWork(state, l)) return <span className="sm">{whyLocked(state, l)}</span>;
  const ok = canPlan(state, l) && !!d.outcome && fuChannelAllowed(l, d.channel);
  return (
    <div className="ux-followup-actions">
      <button
        type="button"
        className="act"
        disabled={!ok}
        onClick={
          ok
            ? () => {
                const why = followupWhy(state, l, d);
                setRefusal(why);
                if (why) return;
                dispatch({ type: "saveFollowup", id: l.id });
              }
            : undefined
        }
      >
        Save follow-up
      </button>
      <button type="button" className="chip" onClick={() => dispatch({ type: "discardFollowup", id: l.id })}>
        Discard draft
      </button>
      {refusal ? (
        <div className="note bad" style={{ marginTop: "8px", width: "100%" }} role="alert">
          {refusal}
        </div>
      ) : null}
    </div>
  );
}

registerDrawer("followup" as DrawerKind, {
  lead: true,
  w: 540,
  title: () => "Record follow-up",
  sub: (_s, a) => a.lead!.n,
  Body,
  Foot,
});
