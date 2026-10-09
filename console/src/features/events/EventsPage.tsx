"use client";

/* ── EVENTS — compact upcoming agenda, planning reference below it ──────────────────────────────
   Ports the merged prototype's `vEvents` (ir-merged.js "===== 6. EVENTS").

   The redesign turned this from one "what each one produced" table into two views: a short,
   date-ordered agenda for what is still to happen (what an IR opens every morning) and the old
   scorecard table, now called up only when Completed is picked. The plan's targets — the number
   nobody was told, per the prototype's own comment on `short` — moved out of the main view and
   into a closed-by-default disclosure, so the read is the agenda first and the arithmetic behind
   it only when asked for.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { Tw } from "@/components/ui";
import { useRouter } from "next/navigation";
import type { EventRow } from "@/server/events/events";
import {
  P, eventCount, may, perEventNeed,
} from "@/lib/selectors";
import { GOALS } from "@/domain";
import { useConsole } from "@/lib/store";
import { useApiRead } from "@/lib/data/api";
import { eventDates, eventList, eventMonth } from "@/lib/data/endpoints/events";
import { pathOf } from "@/components/shell/routes";
import { Icon } from "@/components/ui";
import { evDraft, evISODate, uiEventsView } from "./eventDraft";
import { EventPage } from "./EventPage";
import { UxDetails } from "./UxDetails";

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

/** initials for a staff chip: the book's own when the person is on it, else the name's */
const initials = (state: Parameters<typeof P>[0], id: string, name: string | null): string => {
  const p = state[id];
  return p ? p.i : (name ?? id).split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
};

export function EventsPage() {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  /* M14-S01-W1: the two lists are GET /api/events (lib/data/endpoints/events) — never the store's EVENTS */
  const list = useApiRead(eventList, state, undefined);
  const view = uiEventsView(state.ui);
  const setView = (v: "upcoming" | "completed") => dispatch({ type: "setUi", patch: { EVENTVIEW: v } });
  const openAdd = () => dispatch({ type: "openDrawer", k: "p:event.edit", id: null, seed: { EVD: evDraft(null, state.NOW.getFullYear()) } });

  const need = perEventNeed(state.PLAN);
  const ran: EventRow[] = list.state === "ok" ? list.data.completed : [];
  const planned: EventRow[] = list.state === "ok" ? list.data.upcoming : [];
  const year = state.NOW.getFullYear();
  /* short — the shortfall the plan's budget carries and the diary does not. eventCount() is the
     same divisor the Plan uses, so moving the event share moves this without re-typing it. */
  const short = Math.max(0, eventCount(state.PLAN) - (ran.length + planned.length));
  const tot = ran.reduce((a, e) => a + (e.stats.captured ?? 0), 0);
  const taggedTotal = ran.reduce((a, e) => a + e.stats.tagged, 0);
  const canEdit = may(state, "events", "edit");

  const ready = [...planned, ...ran].filter((e) => state.SHEET[e.id]?.state === "ready");

  /* go('event',null,id) is synchronous in the prototype; a dev-server route to /events/[id] is not.
     The press is remembered against this NAVSEQ (any later go() bumps it, so it can never go stale)
     and the event is drawn at once, ahead of its route — the shell's own idiom for a lead. */
  const go = (id: string) => {
    dispatch({ type: "setUi", patch: { EVPEND: { id, seq: state.ui.NAVSEQ ?? 0 } } });
    router.push(pathOf("event", id));
  };
  const pend = state.ui.EVPEND as { id: string; seq: unknown } | null | undefined;
  if (pend && pend.seq === (state.ui.NAVSEQ ?? 0)) {
    return <EventPage id={pend.id} />;
  }
  if (list.state === "idle" || list.state === "loading") return <div className="empty">Reading the events…</div>;
  if (list.state === "error") return <div className="note bad" role="alert">{list.err.error}</div>;

  /* D59 · cost per qualified shown only when at least one event can actually be costed */
  const costable = (e: EventRow) => e.stats.costHiddenWhy === null;
  const costCol = ran.some(costable);
  const avg = Math.round(tot / Math.max(1, ran.length));

  const Row = ({ e }: { e: EventRow }) => {
    const st = e.stats, captured = st.captured ?? 0;
    const pct = Math.round(captured / Math.max(1, need) * 100);
    return (
      <tr className="g4-row" onClick={() => go(e.id)}>
        <th scope="row">
          <button type="button" className="g4-name" onClick={(ev) => { ev.stopPropagation(); go(e.id); }}><b>{e.name}</b></button>
          <div className="sm">{e.type} · {e.channel}</div>
        </th>
        <td className="sm mono">{eventDates(e, year)}</td>
        <td className="sm">{e.staff.map((k) => initials(state.PEOPLE, k.id, k.name)).join(" ")}</td>
        <td className="n">{captured}</td>
        <td style={{ width: "110px" }}>
          <div className="bar">
            <i style={{ width: `${Math.min(100, pct)}%`, background: `var(${pct < 100 ? "--late" : "--go"})` }} />
          </div>
          <span className="sm mono">{pct}%</span>
        </td>
        <td className="n">{st.qualified}</td>
        <td className="n">{st.reserved}</td>
        {costCol && (
          <td className="n">
            {costable(e)
              ? <b>₹{(st.costPerQualified ?? 0).toLocaleString("en-IN")}</b>
              : <span className="sm" title={st.costHiddenWhy === "untagged" ? `${captured - st.tagged} captured leads still untagged` : undefined}>—</span>}
          </td>
        )}
      </tr>
    );
  };

  return (
    <div className="rd-page rd-events">
      <div className="ph rd-page-heading">
        <div><h1>Events</h1></div>
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
        </div>

        {ready.length > 0 && (
          <div className="note due">
            <b>{ready.length} event sheet{ready.length === 1 ? "" : "s"} ready to load</b>
            <div className="chips" style={{ marginTop: "8px" }}>
              {ready.map((e) => (
                <button key={e.id} type="button" className="chip" onClick={() => go(e.id)}>
                  {e.name} · {state.SHEET[e.id]!.ok} leads
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="secw rd-events-list">
          {view === "completed" ? (
            <div className="card fill">
              <div className="ch"><h3>Completed events</h3></div>
              <Tw><table>
                <thead><tr>
                  <th scope="col">Event</th><th scope="col">Dates</th><th scope="col">Staff</th>
                  <th scope="col">Leads</th><th scope="col">vs need {need}</th>
                  <th scope="col">Qualified</th><th scope="col">Reserved</th>
                  {costCol && <th scope="col">Cost / qual</th>}
                </tr></thead>
                <tbody>
                  {ran.length
                    ? ran.map((e) => <Row key={e.id} e={e} />)
                    : (
                      <tr><td colSpan={7} className="empty">
                        No event in the diary has run yet. This table fills in with
                        what each one produced, against what the plan needs one to produce.
                      </td></tr>
                    )}
                </tbody>
              </table></Tw>
              {ran.length > 0 && (
                <p className="sm g4-foot">
                  {tot} leads captured · {taggedTotal} tagged{costCol ? "" : ". Cost per qualified appears once an event's captured leads are all tagged."}
                </p>
              )}
            </div>
          ) : (
            <div className="card rd-event-agenda">
              <div className="ch"><h3>Upcoming events</h3></div>
              <div className="rd-agenda-list">
                {planned.length ? planned.map((e) => {
                  const date = e.startsOn ? evISODate(e.startsOn) : null;
                  return (
                    <button key={e.id} type="button" className="rd-agenda-row" onClick={() => go(e.id)}
                      aria-label={`Open ${e.name}`}>
                      <span className="rd-event-date" aria-hidden="true">
                        <span>{eventMonth(e.startsOn)}</span>
                        <b>{date ? date.getDate() : "—"}</b>
                      </span>
                      <span className="rd-agenda-main">
                        <b>{e.name}</b>
                        <span>{eventDates(e, year)} · {e.city}</span>
                        <span className="sm">{e.type} · {e.channel}</span>
                      </span>
                      <span className="rd-agenda-team">
                        <span className="sm">Team</span>
                        <span>{e.staff.length ? e.staff.map((k) => (k.name ?? P(state.PEOPLE, k.id).n).split(" ")[0]).join(", ") : "Not assigned"}</span>
                      </span>
                      <span className="rd-row-next" aria-hidden="true"><Icon name="next" /></span>
                    </button>
                  );
                }) : (
                  <div className="empty rd-event-empty">
                    <EventsIcon />
                    <h3>No upcoming events</h3>
                    <p>{canEdit ? "Use Add event to put the next one in the diary." : "Only somebody who may edit events can put one in the diary."}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <UxDetails k="events-plan" className="rd-events-plan" summary={`Plan targets${short ? ` · ${short} events still to book` : ""}`}>
          <div className="stats" style={{ marginBottom: "8px", gridTemplateColumns: "repeat(4,1fr)" }}>
            <div className="stat"><b>{need}</b><span>leads the plan needs per event</span></div>
            <div className={`stat ${short ? "bad" : ""}`}>
              <b>{ran.length + planned.length} of {eventCount(state.PLAN)}</b>
              <span>{short ? "events in the diary" : "in the diary, the whole budget"}</span>
            </div>
            <div className={`stat ${avg < need ? "bad" : ""}`}>
              <b>{avg}</b><span>average from {ran.length} run</span>
            </div>
            <div className="stat"><b>{GOALS(state.PLAN).eventShare}%</b><span>share of the plan carried by events</span></div>
          </div>
          {short > 0 && (
            <div className="note bad" style={{ marginBottom: "8px" }}>
              About <b>{short * need} names</b> the plan counts on have no event date yet.
            </div>
          )}
        </UxDetails>
      </section>
    </div>
  );
}
