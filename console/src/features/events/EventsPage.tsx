"use client";

/* ── EVENTS — compact upcoming agenda, planning reference below it ──────────────────────────────
   Ports `ir-console-redesigned.html` 8628–8691 (`vEvents`).

   The redesign turned this from one "what each one produced" table into two views: a short,
   date-ordered agenda for what is still to happen (what an IR opens every morning) and the old
   scorecard table, now called up only when Completed is picked. The plan's targets — the number
   nobody was told, per the prototype's own comment on `short` — moved out of the main view and
   into a closed-by-default disclosure, so the read is the agenda first and the arithmetic behind
   it only when asked for.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useRouter } from "next/navigation";
import type { EventRec } from "@/domain";
import {
  P, evLeads, evStats, eventCount, may, perEventNeed,
} from "@/lib/selectors";
import { GOALS } from "@/domain";
import { useConsole } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { Icon } from "@/components/ui";
import { evDateRange, evDraft, evISODate, uiEventsView } from "./eventDraft";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ICONS.plus/ICONS.events — ir-console-redesigned.html:2440. Not yet in the shell's `Icon` set
   (only what the shell itself draws lives there) — see crossOwnerRequests. Drawn locally, same
   viewBox/stroke/`.i` class as `Icon`, so it is pixel-identical once it moves. */
function PlusIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function EventsIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

export function EventsPage() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const view = uiEventsView(state.ui);
  const setView = (v: "upcoming" | "completed") => dispatch({ type: "setUi", patch: { EVENTVIEW: v } });
  const openAdd = () => dispatch({ type: "openDrawer", k: "p:event.edit", id: null, seed: { EVD: evDraft(null) } });

  const need = perEventNeed(state.PLAN);
  const ran = state.EVENTS.filter((e) => e.state === "done");
  const planned = [...state.EVENTS.filter((e) => e.state === "planned")]
    .sort((a, b) => (evDateRange(a.date).from || "9999").localeCompare(evDateRange(b.date).from || "9999"));
  /* short — the shortfall the plan's budget carries and the diary does not. eventCount() is the
     same divisor the Plan uses, so moving the event share moves this without re-typing it. */
  const short = Math.max(0, eventCount(state.PLAN) - state.EVENTS.length);
  const tot = ran.reduce((a, e) => a + evStats(state, e).captured, 0);
  const taggedTotal = ran.reduce((a, e) => a + evLeads(state, e.id).length, 0);
  const canEdit = may(state, "events", "edit");

  const ready = state.EVENTS.filter((e) => state.SHEET[e.id]?.state === "ready");

  const go = (id: string) => router.push(pathOf("event", id));

  const Row = ({ e }: { e: EventRec }) => {
    const st = evStats(state, e);
    return (
      <tr className="k" onClick={() => go(e.id)} tabIndex={0}
        onKeyDown={(ev) => { if (ev.key === "Enter") go(e.id); }}>
        <th scope="row"><b>{e.n}</b><div className="sm">{e.type} · {e.ch}</div></th>
        <td className="sm mono">{e.date}</td>
        <td className="sm">{e.staff.map((k) => P(state.PEOPLE, k).i).join(" ")}</td>
        <td className="n">{st.captured}</td>
        <td style={{ width: "110px" }}>
          <div className="bar">
            <i style={{ width: `${Math.round(st.captured / need * 100)}%`, background: "var(--late)" }} />
          </div>
          <span className="sm mono">{Math.round(st.captured / Math.max(1, need) * 100)}% of {need}</span>
        </td>
        <td className="n">{st.qual}</td>
        <td className="n">{st.res}</td>
        <td className="n">
          {st.tagged < st.captured
            ? <span className="sm">untagged</span>
            : <b>₹{Math.round(e.cost / Math.max(1, st.qual)).toLocaleString("en-IN")}</b>}
        </td>
      </tr>
    );
  };

  return (
    <div className="rd-page rd-events">
      <div className="ph rd-page-heading">
        <div>
          <span className="rd-eyebrow">Investor connections</span>
          <h1>Events</h1>
          <p className="sub">Plan the next event. Bring its leads into the right hands.</p>
        </div>
        <div className="sp" />
        {canEdit && (
          <button type="button" className="act" onClick={openAdd}><PlusIcon /> Add event</button>
        )}
      </div>

      <section className="ux-events ux-section">
        <div className="ux-toolbar rd-events-viewbar">
          <div className="ux-primary rd-segments" role="group" aria-label="Event view">
            <button type="button" className={`chip ${view === "upcoming" ? "on" : ""}`}
              aria-pressed={view === "upcoming"} onClick={() => setView("upcoming")}>
              Upcoming <span className="rd-count">{planned.length}</span>
            </button>
            <button type="button" className={`chip ${view === "completed" ? "on" : ""}`}
              aria-pressed={view === "completed"} onClick={() => setView("completed")}>
              Completed <span className="rd-count">{ran.length}</span>
            </button>
          </div>
          <span className="sm rd-events-total">{tot} leads captured · {taggedTotal} tagged</span>
        </div>

        {ready.length > 0 && (
          <div className="note due">
            <b>{ready.length} event sheet{ready.length === 1 ? "" : "s"} ready to load</b>
            <div className="chips" style={{ marginTop: "8px" }}>
              {ready.map((e) => (
                <button key={e.id} type="button" className="chip" onClick={() => go(e.id)}>
                  {e.n} · {state.SHEET[e.id]!.ok} leads
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="secw rd-events-list">
          {view === "completed" ? (
            <div className="card fill">
              <div className="ch"><h3>Completed events</h3></div>
              <div className="tw"><table>
                <thead><tr>
                  <th scope="col">Event</th><th scope="col">Dates</th><th scope="col">Staff</th>
                  <th scope="col">Leads</th><th scope="col">vs need</th>
                  <th scope="col">Qualified</th><th scope="col">Reserved</th><th scope="col">Cost / qual</th>
                </tr></thead>
                <tbody>
                  {ran.length
                    ? ran.map((e) => <Row key={e.id} e={e} />)
                    : (
                      <tr><td colSpan={8} className="empty">
                        No event in the diary has run yet. This table fills in with what each one
                        produced on the night, against what the plan needs one to produce.
                      </td></tr>
                    )}
                </tbody>
              </table></div>
            </div>
          ) : (
            <div className="card rd-event-agenda">
              <div className="ch">
                <h3>Upcoming events</h3><div className="sp" />
                <span className="sm">{planned.length} planned</span>
              </div>
              <div className="rd-agenda-list">
                {planned.length ? planned.map((e) => {
                  const date = evISODate(evDateRange(e.date).from);
                  return (
                    <button key={e.id} type="button" className="rd-agenda-row" onClick={() => go(e.id)}
                      aria-label={`Open ${e.n}`}>
                      <span className="rd-event-date" aria-hidden="true">
                        <span>{date ? MONTHS[date.getMonth()] : "Date"}</span>
                        <b>{date ? date.getDate() : "—"}</b>
                      </span>
                      <span className="rd-agenda-main">
                        <b>{e.n}</b>
                        <span>{e.date} · {e.city}</span>
                        <span className="sm">{e.type} · {e.ch}</span>
                      </span>
                      <span className="rd-agenda-team">
                        <span className="sm">Team</span>
                        <span>{e.staff.length ? e.staff.map((k) => P(state.PEOPLE, k).n.split(" ")[0]).join(", ") : "Not assigned"}</span>
                      </span>
                      <span className="tag">Planned</span>
                      <span className="rd-row-next" aria-hidden="true"><Icon name="next" /></span>
                    </button>
                  );
                }) : (
                  <div className="empty rd-event-empty">
                    <EventsIcon />
                    <h3>Your next event starts here</h3>
                    <p>No upcoming events.{canEdit ? " Add the date, location and team to start planning." : " Only somebody who may edit events can put one in the diary."}</p>
                    {canEdit && <button type="button" className="act" onClick={openAdd}>Add event</button>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <details className="ux-disclosure rd-events-plan" data-ux-key="events-plan">
          <summary>Plan targets{short ? ` · ${short} events still to book` : ""}</summary>
          <div className="stats" style={{ marginBottom: "8px", gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="stat"><b>{need}</b><span>leads the plan needs per event</span></div>
            <div className={`stat ${short ? "bad" : ""}`}>
              <b>{state.EVENTS.length} of {eventCount(state.PLAN)}</b>
              <span>{short ? `in the diary — ${short} short of the plan` : "in the diary, the whole budget"}</span>
            </div>
            <div className={`stat ${tot / Math.max(1, ran.length) < need ? "bad" : ""}`}>
              <b>{Math.round(tot / Math.max(1, ran.length))}</b><span>these {ran.length} averaged</span>
            </div>
            <div className="stat"><b>{GOALS(state.PLAN).eventShare}%</b><span>share of the plan carried by events</span></div>
          </div>
          <div className={`note ${tot / Math.max(1, ran.length) < need ? "bad" : ""}`} style={{ marginBottom: "8px" }}>
            The need is derived from the Plan and never typed here: move the event share or the
            funnel rates and it moves in front of you. At the goals set today the plan
            needs <b>≈{need} leads an event</b>, and these {ran.length} averaged{" "}
            <b>{Math.round(tot / Math.max(1, ran.length))}</b>.
            {short ? (
              <>
                {" "}The same Plan budgets <b>{eventCount(state.PLAN)} events</b> and the diary
                holds {state.EVENTS.length}, so <b>{short}</b> {short === 1 ? "is" : "are"} still
                to be booked — about <b>{short * need} names</b> the plan is counting on that
                nobody has a date for.
                {canEdit
                  ? <>{" "}<button type="button" className="chip" onClick={openAdd}>Add event</button></>
                  : " Only somebody who may edit events can put one in the diary."}
              </>
            ) : null}
          </div>
        </details>
      </section>
    </div>
  );
}
