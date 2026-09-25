"use client";

/* ── DRAWERS.followup — the combined outcome-and-next-step drawer. ir-console-redesigned.html
   5985–6165 (openFollowup/setFU/saveFollowup/followupBody) and 12918-12926 (DRAWERS.followup
   itself). "Record follow-up" and "Record visit" open this instead of the plain "touch" drawer: one
   save records what happened (channel, outcome, objections, a note) AND, in the same breath, either
   the next step it leaves behind or the fact that the one it had is now done.

   Registered as `"p:followup"` rather than a new top-level `DrawerKind` literal — that union lives
   in `src/lib/store.tsx`, outside this feature's owned paths. `registerDrawer(..., {lead:true})`
   still gets the record-access gate for free: `Drawer.tsx`'s own staleness check
   (`d.lead && !openable(state).some(...)`) runs for ANY `lead:true` def regardless of whether its
   key happens to start with `"p:"` — the `"p:"` fast-path inside `canOpenDrawer` only shortcuts the
   base "may this key be opened at all" question, never the per-record D37–D44 gate. See
   `src/components/shell/Drawer.tsx:120-128`.

   The store's `saveFollowup`/`discardFollowup` (src/lib/store.tsx) already do every write and every
   hard refusal off `ui.FU`; this file only has to seed a sensible draft and collect it.
   ponytail: skips the prototype's own "the scheduled task changed while this form was open"
   re-validation and its full next-step-channel cross-check (`fuValidate`'s last few branches) —
   the Foot button is simply disabled until the fields line up with what `saveFollowup` requires.
   Add the richer message if somebody actually hits the silent no-op.

   FUDRAFTS (module-scoped, below) — the prototype's own global `FUDRAFTS` keyed by
   `FUSESSION+me()+id` (6003). A half-written draft survives closing and reopening the drawer for the
   same lead; only a save or an explicit discard clears it. This port has one operator per running
   client, so the lead id alone is key enough — no session/actor prefix to carry. ─────────────── */

import { NEXTS, OBJS, TOUCHCHANNELS } from "@/domain";
import type { Channel, Lead } from "@/domain";
import { dISOtoDisp, dOf, hhmm, iso, nowT, plusD } from "@/lib/format";
import { canPlan, canWork, channelForAction, conFor, conWhy, hasNext, whyLocked } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { ConsoleState, FollowupDraft, UiState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { FUCHANNELS, FUOUTCOMES, fuHeard, fuLatest, latestNote } from "@/features/today/work";

const readFU = (ui: UiState): FollowupDraft | null => (ui.FU as FollowupDraft | undefined) ?? null;

const fuChannelAllowed = (l: Lead, k: string): boolean => k === "reply" || k === "other" || conFor(l, k as Channel);

/* fuDraft(l) — 6006's own permitted-channel order, verbatim (not `TOUCHCHANNELS`'s array order,
   which is msg/email/call/visit and would pick a different default channel on a lead permitted for
   more than one). */
const FUFALLBACK_ORDER: readonly Channel[] = ["call", "msg", "email", "visit"];

/* keyed by actor too, not just lead id — an account switch inside one running session (no reload)
   must never hand the next signed-in person a draft, outcome or note the previous one typed but
   never saved. A full page reload already clears this (a fresh module instance), matching the
   prototype's own per-load `FUSESSION` half of `fuKey`; only the `me()` half needs replicating. */
const FUDRAFTS = new Map<string, FollowupDraft>();
const fuKey = (state: ConsoleState, id: string): string => state.WHO + "|" + id;

function freshFollowupDraft(state: ConsoleState, l: Lead): FollowupDraft {
  const now = nowT(state.NOW);
  const k = (FUFALLBACK_ORDER.find((c) => conFor(l, c)) || "reply") as FollowupDraft["channel"];
  const next = hasNext(l) ? l.nx : null;
  return {
    channel: k,
    outcome: "",
    obj: [],
    note: "",
    d: iso(now),
    tm: hhmm(now),
    keep: false,
    complete: !!next,
    t: k === "call" ? "Call back" : k === "visit" ? "Farm visit" : "Nurture — check back",
    nd: iso(plusD(now, 1)),
    ntm: "10:00",
    nch: (k === "reply" ? "other" : k) as Channel | "other",
    noNext: false,
  };
}

/* buildFollowupDraft(state,l,hint) — openFollowup, 6016. Returns the lead's existing draft
   untouched when one is already open (`FUDRAFTS`); only a FRESH draft takes `hint` (the channel the
   caller already knows it wants — `chanOf`/the row or panel's primary contact channel), and even
   then only to steer which channel starts selected, never the next-step fields derived off the
   lead's own first permitted channel. */
export function buildFollowupDraft(state: ConsoleState, l: Lead, hint?: string | null): FollowupDraft {
  const key = fuKey(state, l.id);
  const existing = FUDRAFTS.get(key);
  if (existing) return existing;
  const d = freshFollowupDraft(state, l);
  if (hint && FUCHANNELS[hint] && hint !== d.channel) {
    d.channel = hint as FollowupDraft["channel"];
    d.outcome = "";
  }
  FUDRAFTS.set(key, d);
  return d;
}

/** discardFollowup/saveFollowup both end the draft's life — called alongside the matching dispatch. */
function clearFollowupDraft(state: ConsoleState, id: string): void {
  FUDRAFTS.delete(fuKey(state, id));
}

function Body({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const FU = readFU(state.ui) ?? buildFollowupDraft(state, l);
  const set = (patch: Partial<FollowupDraft>) => {
    const next = { ...FU, ...patch };
    FUDRAFTS.set(fuKey(state, l.id), next);
    dispatch({ type: "setUi", patch: { FU: next } });
  };
  const setT = (v: string) => {
    const mapped = channelForAction(v);
    set({ t: v, ...((TOUCHCHANNELS as readonly string[]).includes(mapped) ? { nch: mapped } : {}) });
  };
  const options = FUOUTCOMES[FU.channel] || [];
  const permitted = fuChannelAllowed(l, FU.channel);
  const last = fuLatest(state, l);
  const heard = fuHeard(state, l);
  const note = latestNote(state, l);

  return (
    <div className="ux-followup">
      <div className="fucontext" style={{ marginBottom: "12px" }}>
        <div className="sm">
          <b>Last interaction</b>{" "}
          {last ? `${FUCHANNELS[last.channel] || last.channel} · ${last.outcome || "Recorded"} · ${last.at || ""}` : "No contact recorded"}
        </div>
        {heard ? (
          <div className="sm" style={{ marginTop: "7px" }}>
            <b>Previously raised</b> {heard.obj!.join(", ")} · {heard.at || ""}
          </div>
        ) : null}
        <div className="sm" style={{ marginTop: "7px" }}>
          <b>Latest note</b> {note || "No conversation note yet"}
        </div>
        {/* fuPreference(l) — 6041. No `contactPreference` field exists anywhere in `src/domain`'s
           `Lead` yet (a cross-owner data-model gap; see crossOwnerRequests), so — same as
           `@/features/today/TodayPage.tsx`'s own `FollowupContext` — this always reads the empty
           fallback string rather than an actual recorded preference. */}
        <div className="sm" style={{ marginTop: "7px" }}>
          <b>Contact preference</b> No preferred contact time recorded
        </div>
      </div>

      {!permitted ? <div className="note bad">{conWhy(l, FU.channel as Channel)} Choose an inbound reply or a permitted channel.</div> : null}

      <div className="drwsec">
        <p className="lbl">Record what happened</p>
        <div className="ux-filter-fields">
          <label className="fi">
            <span>Channel</span>
            <select
              className="selw"
              id="fuchannel"
              value={FU.channel}
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
            <select className="selw" id="fuoutcome" value={FU.outcome} onChange={(e) => set({ outcome: e.target.value })}>
              <option value="">Choose what happened…</option>
              {options.map((o) => (
                <option value={o} key={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <details className="ux-disclosure" data-ux-key={`followup-contact-time-${l.id}`}>
          <summary>
            Contact time · {dISOtoDisp(FU.d, state.NOW) || FU.d} {FU.tm}
          </summary>
          <div className="ux-filter-fields">
            <label className="fi">
              <span>Contact date</span>
              <input className="di2" id="fudate" type="date" max={iso(state.NOW)} value={FU.d} onChange={(e) => set({ d: e.target.value })} />
            </label>
            <label className="fi">
              <span>Contact time</span>
              <input className="di2" id="futime" type="time" value={FU.tm} onChange={(e) => set({ tm: e.target.value })} />
            </label>
          </div>
        </details>
        <label className="fi">
          <span>
            Conversation note <i>optional</i>
          </span>
          <textarea
            className="inp"
            id="funote"
            rows={3}
            placeholder="What matters for the next conversation?"
            value={FU.note || ""}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
        {FU.channel !== "other" ? (
          <details className="ux-disclosure" data-ux-key={`followup-objections-${l.id}`}>
            <summary>Objections{FU.obj?.length ? " · " + FU.obj.length : ""}</summary>
            <div className="chips">
              {OBJS.map((o) => {
                const on = !!FU.obj?.includes(o);
                return (
                  <button
                    type="button"
                    key={o}
                    className={`chip ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() => set({ obj: on ? (FU.obj || []).filter((x) => x !== o) : [...(FU.obj || []), o] })}
                  >
                    {o}
                  </button>
                );
              })}
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
                value={FU.complete ? "complete" : FU.keep ? "keep" : ""}
                onChange={(e) =>
                  e.target.value === "keep" ? set({ keep: true, complete: false }) : set({ complete: true, keep: false })
                }
              >
                {!FU.complete && !FU.keep ? (
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
        {!FU.keep ? (
          <>
            <div className="ux-filter-fields">
              <label className="fi">
                <span>Next step</span>
                <select className="selw" id="funext" value={FU.t || ""} onChange={(e) => setT(e.target.value)}>
                  {NEXTS.map((t) => (
                    <option value={t} key={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fi">
                <span>Next step channel</span>
                <select
                  className="selw"
                  id="funchannel"
                  value={FU.nch || "other"}
                  onChange={(e) => set({ nch: e.target.value as Channel | "other" })}
                >
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
                <input className="di2" id="fundate" type="date" min={iso(state.NOW)} value={FU.nd || ""} onChange={(e) => set({ nd: e.target.value })} />
              </label>
              <label className="fi">
                <span>
                  Time <i>optional</i>
                </span>
                <input className="di2" id="funtime" type="time" value={FU.ntm || ""} onChange={(e) => set({ ntm: e.target.value })} />
              </label>
            </div>
            <div className="chips">
              {([["Today", 0], ["Tomorrow", 1], ["Next week", 7]] as const).map(([t, n]) => {
                const on = FU.nd === iso(plusD(nowT(state.NOW), n));
                return (
                  <button
                    type="button"
                    key={t}
                    className={`chip ${on ? "on" : ""}`}
                    onClick={() => set({ nd: iso(plusD(nowT(state.NOW), n)) })}
                  >
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

/* foot(l) — 12921-12924. Two saves (plain, and "…and next investor") plus a discard, in one
   `ux-followup-actions` row — not the two-button footer a plain drawer gets. The visible feedback
   (the queue's `.work-notice`, and — for "and next" — moving the panel on) is Today's own concern:
   this dispatches the record write and a generic `ui.WORKNOTICE`/`ui.WORKADVANCE` signal for
   whichever page is listening (`@/features/today/TodayPage.tsx`'s `WorkToday`, today); Leads/
   WorkAction/LeadPage simply leave the signal unread, same as the prototype's own `setWorkNotice`/
   `selectNextInvestorAfterFollowup`, which only ever mattered on the Today queue. */
function Foot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const FU = readFU(state.ui) ?? buildFollowupDraft(state, l);
  if (!canWork(state, l) || !canPlan(state, l))
    return <span className="sm">{whyLocked(state, l)} Recording belongs to whoever holds it.</span>;
  const permitted = fuChannelAllowed(l, FU.channel);
  const dt = FU.d ? new Date(FU.d + "T" + (FU.tm || "00:00") + ":00") : null;
  const dateOk = !!dt && !isNaN(dt.getTime()) && iso(dt) === FU.d && dt <= nowT(state.NOW);
  const nextOk = !!FU.keep || !!(FU.t && FU.t.trim() && dOf(FU.nd || ""));
  const ok = permitted && !!FU.outcome && dateOk && nextOk;
  const save = (advance: boolean) => {
    dispatch({ type: "saveFollowup", id: l.id });
    clearFollowupDraft(state, l.id);
    dispatch({
      type: "setUi",
      patch: { WORKNOTICE: "Follow-up saved for " + l.n + ".", WORKADVANCE: advance ? l.id : null },
    });
  };
  return (
    <div className="ux-followup-actions">
      <button type="button" className="act ghost" id="fusave" disabled={!ok} onClick={ok ? () => save(false) : undefined}>
        Save follow-up
      </button>
      <button type="button" className="act" id="fusavenext" disabled={!ok} onClick={ok ? () => save(true) : undefined}>
        Save and next investor
      </button>
      <button
        type="button"
        className="chip"
        onClick={() => {
          dispatch({ type: "discardFollowup", id: l.id });
          clearFollowupDraft(state, l.id);
        }}
      >
        Discard draft
      </button>
    </div>
  );
}

registerDrawer("p:followup" as import("@/lib/store").DrawerKind, {
  lead: true,
  w: 540,
  title: () => "Record follow-up",
  sub: (_s, a) => a.lead!.n,
  Body,
  Foot,
});
