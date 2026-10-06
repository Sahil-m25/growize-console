"use client";

/* ── DRAWERS.history and DRAWERS.notes. 03-app.js 6317–6343 ─────────────────────────────────
   Every write in the console lands in the log, for every user; this is that log, cut to one lead
   and grouped by day. Notes are the other half: nothing computes from them, which is exactly why
   they are allowed to be free text — and why every one carries who wrote it, when, and against
   which lead. Notes are never edited or deleted; a correction is a new note.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Fragment } from "react";
import { SEAT } from "@/domain";
import type { InteractionRec, PersonKey } from "@/domain";
import { dLabel, whenT } from "@/lib/format";
import { canNote, logNote, logReadable, P, roleOf } from "@/lib/selectors";
import { Ag, Pname } from "@/components/ui";
import { useConsole } from "@/lib/store";
import { registerDrawer, type DrawerProps } from "@/components/shell/drawers/registry";
import { uiNdraft } from "@/features/leads/ui";
import { useLeadNote, useLeadNotes } from "@/lib/data/endpoints/record";
import { FUCHANNELS } from "@/features/today/work";

/* ir-console-redesigned.html 12173-12197's "Conversation history" block, ahead of the audit list —
   `state.INTERACTIONS` (store.tsx:277,538) is exactly `INTERACTIONS` there, kept by the same
   `saveFollowup` this port's "p:followup" drawer already dispatches. ponytail: skips the
   prototype's "Completed appointments" block (`TASKHISTORY`) — that store field genuinely does not
   exist on this port (a completed scheduled task just clears `l.nx`, nothing records it stayed
   completed) and adding it needs a new field on `ConsoleState`, outside this agent's owned paths;
   see crossOwnerRequests. */
function ConversationHistory({ l }: { l: import("@/domain").Lead }) {
  const { state } = useConsole();
  const rows = [...(state.INTERACTIONS[l.id] || [])].sort(
    (a, b) => (whenT(b.at, state.NOW)?.getTime() || 0) - (whenT(a.at, state.NOW)?.getTime() || 0),
  );
  if (!rows.length) return null;
  return (
    <>
      <p className="lbl">Conversation history</p>
      {rows.map((e: InteractionRec, i) => (
        <article className="nt" key={e.id || i}>
          <b>{FUCHANNELS[e.channel] || e.channel} · {e.outcome}</b>
          <div className="sm">
            {e.at} · <Pname k={(e.who || state.WHO) as PersonKey} first nw cls="xs" />
          </div>
          {e.obj && e.obj.length ? <p className="sm">Raised: {e.obj.join(", ")}</p> : null}
          {e.note ? <p className="fu-context-note">{e.note}</p> : null}
          {e.completedTask ? <p className="sm">Completed: {e.completedTask.t}</p> : null}
          {e.next ? <p className="sm">Next: {e.next.t} · {e.next.by}{e.next.tm ? " · " + e.next.tm : ""}</p> : null}
        </article>
      ))}
    </>
  );
}

/* Change 4 part 1 — reopenLost's own record: a lead that was closed and later re-opened keeps that
   closure in `lostWas`, written nowhere until now. */
function PastClosures({ l }: { l: import("@/domain").Lead }) {
  const { state } = useConsole();
  const rows = l.lostWas || [];
  if (!rows.length) return null;
  return (
    <>
      <p className="lbl">Past closures</p>
      {rows.map((x, i) => (
        <p className="sm" key={i} style={{ margin: i ? "4px 0 0" : 0 }}>
          Closed as {x.why} on {x.at}, re-opened {x.reopened} by {P(state.PEOPLE, x.reby).n}.
        </p>
      ))}
    </>
  );
}

function HistoryBody({ lead }: DrawerProps) {
  const { state } = useConsole();
  const l = lead!;
  const rows = state.LOG.filter((e) => e.lead === l.id && logReadable(state, e));
  let day = "";
  const audit = !rows.length ? (
    <p className="sm" style={{ margin: 0 }}>
      Nothing logged against this investor yet.
    </p>
  ) : (
    rows.map((e, i) => {
      const note = logNote(state, e);
      const head = e.d !== day ? ((day = e.d), true) : false;
      return (
        <Fragment key={i}>
          {head ? (
            <p className="lbl" style={{ margin: "12px 0 4px" }}>
              {dLabel(new Date(e.d + "T00:00:00"))}
            </p>
          ) : null}
          <div className="ur rd-timeline-row">
            <Ag k={e.kind} t={e.what} />
            <div className="rd-timeline-text">
              <b>{e.what}</b>
              {note ? <span className="sm"> {note}</span> : null}
              <div className="sm">
                <Pname k={e.who} first nw cls="xs" />
                {e.touch ? " · touch " + e.touch + " that week" : ""}
              </div>
            </div>
            <span className="sm mono rd-timeline-time">{e.at.slice(7)}</span>
          </div>
        </Fragment>
      );
    })
  );
  return (
    <>
      <ConversationHistory l={l} />
      <PastClosures l={l} />
      <div className="drwsec">
        <p className="lbl">Record of changes</p>
        {audit}
      </div>
    </>
  );
}

/* addNote is POST /api/leads/[id]/notes (cluster C2, lib/data/endpoints/record): a Zoho Note on the Lead, one
   Idempotency-Key per press. A refusal stays on the drawer (ui.NOTEERR); the draft is kept until the note lands. */
function useSaveNote() {
  const { state, dispatch } = useConsole();
  const add = useLeadNote();
  return (id: string) => {
    const t = uiNdraft(state.ui).trim();
    if (!t) return;
    void add(id, t).then(r => dispatch({ type: "setUi", patch: { NOTEERR: r.ok ? null : r.error } }));
  };
}

function NotesBody({ lead }: DrawerProps) {
  const { state, dispatch } = useConsole();
  const save = useSaveNote();
  const l = lead!;
  const err = typeof state.ui.NOTEERR === "string" ? state.ui.NOTEERR : null;
  /* live: the lead's notes read back from Zoho (GET /api/leads/[id]/notes); fixture: the book's own */
  const { notes } = useLeadNotes(l.id);
  const may = canNote(state, l);
  return (
    <>
      {may ? (
        <>
          <textarea
            className="nta"
            id="ndraft"
            rows={3}
            style={{ width: "100%" }}
            aria-label="Add a note"
            placeholder="Something the next person needs to know…"
            value={uiNdraft(state.ui)}
            onChange={(e) => dispatch({ type: "setUi", patch: { NDRAFT: e.target.value } })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                save(l.id);
            }}
          />
          <p className="sm" style={{ margin: "6px 0 0" }}>
            Draft saved for {l.n} while you navigate. Ctrl/Cmd + Enter saves. Correct a saved note by
            adding another.
          </p>
          {err ? <p className="sm lp-err" role="alert" style={{ margin: "6px 0 0" }}>{err}</p> : null}
        </>
      ) : null}
      <div className="drwsec">
        <div className="notes">
          {notes.length ? (
            notes.map((n, i) => (
              <div className="nt" key={i}>
                <p>{n.t}</p>
                <span className="sm">
                  <Pname k={n.who} cls="xs" nw /> · {SEAT[roleOf(state.PEOPLE, n.who as PersonKey)!] || ""} ·{" "}
                  <span className="mono">{n.at}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="sm" style={{ margin: 0 }}>
              Nothing written yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function NotesFoot({ lead }: DrawerProps) {
  const { state } = useConsole();
  const save = useSaveNote();
  const l = lead!;
  if (!canNote(state, l)) return null;
  const typed = uiNdraft(state.ui).trim().length > 0;
  return (
    <button
      type="button" className="act" disabled={!typed} title={typed ? undefined : "Nothing typed yet"}
      onClick={typed ? () => save(l.id) : undefined}
    >
      Save note for {l.n.split(" ")[0]}
    </button>
  );
}

registerDrawer("history", {
  lead: true,
  w: 520,
  title: () => "Investor timeline",
  sub: (_s, a) => a.lead!.n,
  Body: HistoryBody,
});

registerDrawer("notes", {
  lead: true,
  w: 460,
  title: () => "Notes",
  sub: (_s, a) => a.lead!.n,
  Body: NotesBody,
  Foot: NotesFoot,
});
