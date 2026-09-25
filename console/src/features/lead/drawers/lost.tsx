"use client";

/* ── DRAWERS.lost — close it as lost. 03-app.js 6536–6560 ───────────────────────────────────
   A lead that is going nowhere is worth more closed than left rotting in the queue: the reason is
   the only thing that tells anybody what to change. The close is kept when it is re-opened — it
   stays in the history and in Why we lose, so a lead that was closed and re-opened does not read as
   a new one.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { LADDER, LOSTWHY } from "@/domain";
import type { LeadId } from "@/domain";
import { canLose, canReopen, lost, P, reopenHandoff } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { ConsoleState } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";

/* the lost-close draft, keyed per lead — ir-console-redesigned.html DRAFTS/dKey/sayLost 3248-3276.
   `LOSTW`/`LOSTN` (leads/ui.ts, not owned by this agent) are one shared pair for every lead, so a
   reason picked on one investor was still sitting there — and submittable — on the next one this
   drawer opened against. Keying the draft by lead id in its own `ui.LOSTDRAFT` bag (the `UiState`
   index signature, same escape as this file's siblings) means a draft for lead A simply is not
   read while lead B's drawer is open, with no reset-on-open needed. */
type LostDraft = { why: string | null; note: string };
const emptyDraft: LostDraft = { why: null, note: "" };

function draftOf(state: ConsoleState, id: LeadId): LostDraft {
  const bag = state.ui.LOSTDRAFT as Record<string, LostDraft> | undefined;
  return bag?.[id] ?? emptyDraft;
}

function useSetDraft() {
  const { state, dispatch } = useConsole();
  return (id: LeadId, patch: Partial<LostDraft>) => {
    const bag = (state.ui.LOSTDRAFT as Record<string, LostDraft> | undefined) || {};
    dispatch({ type: "setUi", patch: { LOSTDRAFT: { ...bag, [id]: { ...draftOf(state, id), ...patch } } } });
  };
}

function clearDraft(state: ConsoleState, id: LeadId): Record<string, LostDraft> {
  const bag = { ...((state.ui.LOSTDRAFT as Record<string, LostDraft> | undefined) || {}) };
  delete bag[id];
  return bag;
}

function Body({ lead }: DrawerProps) {
  const { state } = useConsole();
  const setDraft = useSetDraft();
  const l = lead!;
  const { why: LOSTW, note: LOSTN } = draftOf(state, l.id);

  if (lost(l))
    return (
      <>
        <p className="sm" style={{ margin: 0 }}>
          Closed as <b>{l.lost!.why}</b> by {P(state.PEOPLE, l.lost!.by).n}{" "}
          <span className="mono">{l.lost!.at}</span>.
        </p>
        {l.lost!.note ? (
          <p className="sm" style={{ margin: "8px 0 0" }}>
            “{l.lost!.note}”
          </p>
        ) : null}
        <p className="sm" style={{ margin: "10px 0 0" }}>
          Re-opening restores “{LADDER[Math.max(0, (l.lost!.stage || 1) - 1)].t}” and any future next
          step. The closure stays in history and loss reporting.
        </p>
      </>
    );

  return (
    <>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        Remove this investor from your active queue and record why. You can re-open the record
        later.
      </p>
      <p className="lbl">Why it is lost</p>
      <div className="chips" style={{ marginBottom: "14px" }}>
        {LOSTWHY.map((w) => (
          <button
            type="button"
            key={w}
            className={`chip ${LOSTW === w ? "on" : ""}`}
            aria-pressed={LOSTW === w}
            onClick={() => setDraft(l.id, { why: w })}
          >
            {w}
          </button>
        ))}
      </div>
      <label className="fi">
        <span>Anything worth knowing (optional)</span>
        <textarea
          className="nta"
          rows={3}
          placeholder="What they actually said, in their words"
          value={LOSTN}
          onChange={(e) => setDraft(l.id, { note: e.target.value })}
        />
      </label>
      <p className="sm" style={{ margin: "9px 0 0" }}>
        {LOSTW
          ? "Counted under “" + LOSTW + "” on Numbers, against the source and the event it came from."
          : "Choose a reason to enable closing."}
      </p>
    </>
  );
}

function Foot({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const l = lead!;
  const { why: LOSTW, note: LOSTN } = draftOf(state, l.id);
  if (lost(l)) {
    if (canReopen(state, l))
      return (
        <button
          type="button"
          className="act"
          onClick={() => dispatch({ type: "reopenLost", id: l.id })}
        >
          Re-open it
        </button>
      );
    const handoff = reopenHandoff(state, l);
    return handoff ? <p className="sm" style={{ margin: 0 }}>{handoff}</p> : null;
  }
  return (
    <button
      type="button"
      className="act"
      disabled={!LOSTW}
      title={LOSTW ? undefined : "Pick a reason first"}
      onClick={
        LOSTW
          ? () => {
              /* closeLost() refuses silently once money is in (canLose), same as every other
                 close-the-window write in this console. The old code cleared the draft on every
                 click regardless — a refused close still lost the reason and note the person had
                 just typed. Only clear it once the close actually happened. */
              if (!canLose(state, l)) return;
              dispatch({ type: "closeLost", id: l.id, why: LOSTW, note: LOSTN });
              dispatch({ type: "setUi", patch: { LOSTDRAFT: clearDraft(state, l.id) } });
            }
          : undefined
      }
    >
      Close it as lost
    </button>
  );
}

registerDrawer("lost", {
  lead: true,
  w: 440,
  title: () => "Close it as lost",
  sub: (_s, a) => a.lead!.n,
  Body,
  Foot,
});
