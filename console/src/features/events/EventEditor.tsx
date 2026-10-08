"use client";

/* ── ADD / EDIT EVENT — the drawer body ───────────────────────────────────────────────────────
   Ports the redesigned prototype's `DRAWERS["event.edit"]` body/foot (ir-console-redesigned.html
   ~12855–12876) and its door, `evOpen`/`addEvent`/`saveEvent`/`dropEvent` (~3826–3910).

   Registered as the panel `"p:event.edit"` (see `./drawer.tsx`) — a panel IS a drawer, so the
   shared registry/frame handles the scrim, `.drwh`, `.drw-heading`/`.drw-header-actions`,
   `#drw`/`#drwx`, the "Close "…"" labels, Escape and focus trap; nothing about the frame is
   reimplemented here. `openDrawer`'s own toggle (same id closes, a different id swaps, 03-app.js's
   `evOpen`) is the store's, already generic — the caller only ever dispatches `openDrawer`.

   THE DRAFT lives in `state.ui.EVD`, seeded by `openDrawer`'s `seed` at the moment the drawer opens
   (see `EventsPage`/`EventPage`) and patched with the store's own generic `setUi` — the same
   module-level-global-turned-ui-bag-key idiom `src/features/leads/ui.ts` uses for `NXD`/`TD`, so
   the Body and the Foot (separate components under the registry) read and write the same draft
   without either one owning the other.

   THE SAVE dispatches the store's `saveEvent`/`dropEvent` (`src/lib/store.tsx`), which read the
   draft straight off `ui.EVD` themselves — this component carries no payload, only the disabled
   state the shared `evGaps` computes. `saveEvent` diffs against the existing record and logs
   "Changed the event" / "Added event"; `dropEvent` clears `l.ev` off every tagged lead and logs
   "Removed event". Both close the drawer on success. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PersonKey } from "@/domain";
import { eventCount, P, assignees, may } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { askedOf, changedNote, eventChange, eventCreate, eventList, eventOne, eventRecOf, eventRemove, type EventArgs } from "@/lib/data/endpoints/events";
import type { DrawerProps } from "@/components/shell/drawers/registry";
import { pathOf } from "@/components/shell/routes";
import { Icon, Pav } from "@/components/ui";
import { EVCH, EVTYPES, evDateText, evGaps, evISODate, uiEVD, type EventDraft } from "./eventDraft";

/** The drawer's draft as the endpoints' args (the same fields the reducer reads off ui.EVD). */
const argsOf = (d: EventDraft): EventArgs => ({ id: d.id, n: d.n, type: d.type, ch: d.ch, from: d.from, to: d.to, city: d.city, cost: d.cost, state: d.state, off: d.off, staff: d.staff });

export function EventEditorBody(props: DrawerProps) {
  const { state, dispatch } = useConsole();
  /* M14-S02-W1: the record under edit is GET /api/events/[id], and the city suggestions come off GET /api/events */
  const one = useApiRead(eventOne, state, props.id);
  const list = useApiRead(eventList, state, undefined);
  const row = one.state === "ok" ? one.data.event : null;
  const event = row ? eventRecOf(row) : null;
  const edit = may(state, "events", "edit");
  const d = uiEVD(state.ui);
  const ran = !!event && event.state === "done";
  const tag = row ? row.stats.tagged : 0;
  const nameOf = (k: string) => row?.staff.find((x) => x.id === k)?.name ?? P(state.PEOPLE, k).n;
  /* irsOf(d.staff) — 03-app.js ~3789: only the drafted staff who still carry a book get dealt to. */
  const irs = d.staff.filter((k) => assignees(state).includes(k));
  const cities = [...new Set((list.state === "ok" ? [...list.data.upcoming, ...list.data.completed] : []).map((x) => x.city).filter(Boolean) as string[])].sort();
  const eligible = (k: PersonKey) => assignees(state).includes(k);
  /* EVWHO() — everyone who may be named: who carries a book, plus anyone already on this event
     who no longer does, so a name can come off a past night as well as go on a coming one. ~3812 */
  const staffPool = [...new Set(assignees(state).concat(event?.staff ?? []))];

  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => dispatch({ type: "setUi", patch: { EVD: { ...d, [k]: v } } });
  const toggleStaff = (k: PersonKey) => {
    if (!edit) return;
    set("staff", d.staff.includes(k) ? d.staff.filter((x) => x !== k) : [...d.staff, k]);
  };

  if (!edit) return <p className="sm">This drawer is unavailable.</p>;
  if (props.id && one.state === "loading") return <p className="sm">Reading the event…</p>;
  if (props.id && one.state === "error") return <p className="sm" role="alert">{one.err.error}</p>;

  const f = evISODate(d.from), t = evISODate(d.to);
  const dateError = d.from && !f ? "Choose a valid start date."
    : d.to && !t ? "Choose a valid end date."
    : f && t && f > t ? "The end date must be on or after the start date." : "";

  return (
    <section className="ux-event-editor">
      <div className="frow">
        <label className="fi ux-event-span">
          <span>Event name</span>
          <input className="inp" id="evn" value={d.n} placeholder="Prestige Falcon City"
            onChange={(e) => set("n", e.target.value)} />
        </label>
        <label className="fi ux-event-span">
          <span>City</span>
          <input className="inp" id="evcity" list="evcities" value={d.city} placeholder="Bengaluru"
            onChange={(e) => set("city", e.target.value)} />
          <datalist id="evcities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="fi">
          <span>Event kind</span>
          <select className="selw" id="evtype" value={d.type}
            onChange={(e) => set("type", e.target.value as EventDraft["type"])}>
            {EVTYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="fi">
          <span>Channel</span>
          <select className="selw" id="evch" value={d.ch}
            onChange={(e) => set("ch", e.target.value as EventDraft["ch"])}>
            {EVCH.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="fi">
          <span>Start date</span>
          <input className="di2" id="evfrom" type="date" value={d.from} aria-invalid={!!d.from && !f}
            onChange={(e) => { const from = e.target.value; dispatch({ type: "setUi", patch: { EVD: { ...d, from, date: evDateText(from, d.to) } } }); }} />
        </label>
        <label className="fi">
          <span>End date</span>
          <input className="di2" id="evto" type="date" value={d.to} min={f ? d.from : undefined}
            aria-invalid={(!!d.to && !t) || (!!f && !!t && f > t)}
            onChange={(e) => { const to = e.target.value; dispatch({ type: "setUi", patch: { EVD: { ...d, to, date: evDateText(d.from, to) } } }); }} />
        </label>
        {dateError
          ? <p className="ux-event-span ux-event-error" role="alert">{dateError}</p>
          : !f && !t && d.date
            ? <p className="sm ux-event-span">Previous dates: {d.date}. Choose calendar dates to continue.</p>
            : null}
        <label className="fi">
          <span>Cost <i>rupees</i></span>
          <input className="inp mono" id="evcost" type="number" min={0} step={1} inputMode="numeric" value={d.cost}
            onChange={(e) => set("cost", e.target.value === "" ? NaN : Number(e.target.value))} />
        </label>
        <label className="fi">
          <span>Status</span>
          <select className="selw" id="evstate" value={d.state}
            onChange={(e) => set("state", e.target.value as EventDraft["state"])}>
            <option value="planned" disabled={ran}>Planned</option>
            <option value="done">Has run</option>
          </select>
        </label>
        {d.state === "done" && (
          <>
            <label className="fi ux-event-span">
              <span>Names taken at the event</span>
              <input className="inp mono" id="evoff" type="number" min={tag} step={1} inputMode="numeric" value={d.off}
                onChange={(e) => set("off", e.target.value === "" ? NaN : Number(e.target.value))} />
            </label>
            <p className="sm ux-event-span">Tablet count{tag ? `; at least ${tag} leads are already tagged` : "; use 0 to count the tagged leads"}.</p>
          </>
        )}
      </div>
      <div className="drwsec">
        <label className="fi">
          <span>Staff working this event</span>
          <select className="selw" id="evstaff-add" value=""
            onChange={(e) => { if (e.target.value) toggleStaff(e.target.value as PersonKey); }}>
            <option value="">Choose an IR team member…</option>
            {staffPool.filter((k) => !d.staff.includes(k)).map((k) => (
              <option key={k} value={k}>{nameOf(k)}{eligible(k) ? "" : " · no active book"}</option>
            ))}
          </select>
        </label>
        {d.staff.length
          ? (
            <div className="ux-event-staff" id="evstaff">
              {d.staff.map((k) => (
                <button key={k} type="button" className="chip" aria-label={`Remove ${nameOf(k)} from event staff`}
                  onClick={() => toggleStaff(k)}>
                  <Pav k={k} size="xs" /><span>{nameOf(k)}</span><Icon name="x" />
                </button>
              ))}
            </div>
          )
          : <p className="sm">No staff selected. Imported leads will wait for an owner.</p>}
        {irs.length > 0 && (
          <p className="sm ux-event-help">
            Leads are shared evenly in this order: {irs.map(nameOf).join(", ")}. The first member receives any remainder.
          </p>
        )}
      </div>
      {ran && (
        <p className="sm ux-event-help">
          This event’s ID and completed status stay fixed. {tag ? `${tag} tagged lead${tag === 1 ? " stays" : "s stay"} linked to it.` : ""}
        </p>
      )}
    </section>
  );
}

export function EventEditorFoot(props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const mode = useApiMode();
  const one = useApiRead(eventOne, state, props.id);
  /* M14-S02-W1: 'Add event' is POST /api/events, 'Save event' is PATCH /api/events/[id]; a refusal reads beside the button */
  const create = useApiWrite(eventCreate, state, dispatch);
  const change = useApiWrite(eventChange, state, dispatch);
  const remove = useApiWrite(eventRemove, state, dispatch);
  const [err, setErr] = useState<string | null>(null);
  const row = one.state === "ok" ? one.data.event : null;
  const event = row ? eventRecOf(row) : null;
  const edit = may(state, "events", "edit");
  if (!edit) return null;
  const d = uiEVD(state.ui);
  const eligible = (k: PersonKey) => assignees(state).includes(k);
  const gaps = evGaps(d, event, eligible);
  const nameOf = (k: string) => row?.staff.find((x) => x.id === k)?.name ?? P(state.PEOPLE, k).n;

  /* The reducer wrote its own activity line in the demo book; a live write words the line from the route's answer
     ("Changed the event": what moved, and how many leads stay tagged) and closes the drawer itself. */
  const save = async () => {
    if (gaps.length) return;
    setErr(null);
    if (event) {
      const r = await change({ ...argsOf(d), id: event.id, modifiedTime: row?.modifiedTime ?? null });
      if (!r.ok) { setErr(r.error); return; }
      if (mode === "live") {
        dispatch({ type: "log", what: "Changed the event", lead: null, kind: "admin", note: changedNote(r.data.name, r.data.moved, r.data.taggedStay, nameOf) });
        dispatch({ type: "closeDrawer" });
      }
      return;
    }
    const r = await create(argsOf(d));
    if (!r.ok) { setErr(r.error); return; }
    if (mode === "live") {
      const irs = r.data.staffIds.filter(eligible);
      dispatch({ type: "log", what: "Added event", lead: null, kind: "admin",
        note: r.data.name + " · " + evDateText(r.data.startsOn, r.data.endsOn) + " · " + r.data.city + " · "
          + (irs.length ? irs.map((k) => nameOf(k).split(" ")[0]).join(", ") + " working it" : "nobody named to work it") });
      dispatch({ type: "closeDrawer" });
    }
    /* drawn at once, ahead of its route — EventsPage's pending press (EVPEND) */
    dispatch({ type: "setUi", patch: { EVPEND: { id: r.data.eventId, seq: state.ui.NAVSEQ ?? 0 } } });
    router.push(pathOf("event", r.data.eventId));
  };
  /* Remove is the one write here with no way back, so it stops at a confirmation first — and what the confirmation says
     (how many leads lose the tag) is the route's own 428 answer, nothing written yet: DELETE without ?confirm=1. */
  const drop = async () => {
    if (!event) return;
    setErr(null);
    const r = await remove({ id: event.id, confirm: false });
    if (r.ok) return;
    const ask = askedOf(r);
    if (!ask) { setErr(r.error); return; }
    dispatch({ type: "setUi", patch: { EVASK: { id: event.id, ...ask } } });
    dispatch({ type: "openDrawer", k: "p:event.drop", id: event.id });
  };

  return (
    <>
      <button type="button" className="act" id="evsave"
        disabled={gaps.length > 0}
        title={gaps.length ? "Complete: " + gaps.join(", ") : undefined}
        onClick={() => { void save(); }}>
        {event ? "Save event" : "Add event"}
      </button>
      {event && (
        <button type="button" className="act ghost" id="evdrop" onClick={() => { void drop(); }}>
          Remove event
        </button>
      )}
      {err ? <p className="sm" role="alert" style={{ margin: "8px 0 0" }}>{err}</p> : null}
    </>
  );
}

/* ── "Remove <name> from the diary" — the port's stand-in for the prototype's shared `askFirst` ──
   Ports `DRAWERS.ask` (ir-console-redesigned.html ~12712) for this one caller only: the shell has
   no generic "ask" drawer yet (see crossOwnerRequests), so `dropEvent` gets its confirm door here,
   registered as the panel `p:event.drop` (./drawer.tsx). Body and Foot read the event straight off
   `props.id` — nothing rides in a draft, because nothing here is edited, only confirmed or not. */
type Ask = { id: string; taggedLeads: number; eventName: string };
const askOf = (ui: unknown, id: string | null): Ask | null => { const a = (ui as { EVASK?: Ask }).EVASK; return a && a.id === id ? a : null; };

export function EventDropBody(props: DrawerProps) {
  const { state } = useConsole();
  const list = useApiRead(eventList, state, undefined);
  const ask = askOf(state.ui, props.id);
  if (!ask) return <p className="sm">This drawer is unavailable.</p>;
  const tag = ask.taggedLeads;
  const inDiary = list.state === "ok" ? list.data.upcoming.length + list.data.completed.length : 0;
  return (
    <>
      <p className="lbl">What this does</p>
      <p className="sm" style={{ margin: "0 0 12px" }}>
        {tag ? (
          <>
            Its <b>{tag} lead{tag === 1 ? "" : "s"}</b> stay on the book with their owners, their
            stages and every line of their history. What {tag === 1 ? "it loses" : "they lose"} is
            the night: {tag === 1 ? "it stops" : "they stop"} naming this event, so{" "}
            {tag === 1 ? "it is" : "they are"} counted in no event&apos;s leads again and costed
            against no event&apos;s spend. Nothing here puts that back — the record{" "}
            {tag === 1 ? "it" : "they"} pointed at will not exist.
          </>
        ) : (
          <>
            The date comes out of the diary, and out of the {inDiary} the plan counts against the{" "}
            {eventCount(state.PLAN)} it budgets — so the shortfall on this page goes up
            by one.
          </>
        )}
      </p>
      <div className="drwsec">
        <p className="lbl">What it does not do</p>
        <p className="sm" style={{ margin: 0 }}>
          {tag ? (
            <>
              It does not delete a lead, move one, change a stage, or touch a payment or a
              document. Each one keeps Events as its source; what goes is which event. The log
              keeps every line ever written against {tag === 1 ? "it" : "them"}, and this one.
            </>
          ) : (
            <>Nothing is tagged to it, so no lead changes in any way.</>
          )}
        </p>
      </div>
    </>
  );
}

export function EventDropFoot(props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const mode = useApiMode();
  const remove = useApiWrite(eventRemove, state, dispatch);
  const [err, setErr] = useState<string | null>(null);
  const ask = askOf(state.ui, props.id);
  if (!ask) return null;
  /* askGo() — ir-console-redesigned.html:4204 — clears ASK and closes before running the write; the reducer closes the
     drawer itself in the demo book, a live removal closes it here and words the activity line from the route's answer.
     VIEW='events' becomes this push, because standing on the URL of a record that no longer exists is not a state this port keeps. */
  const run = async () => {
    setErr(null);
    const r = await remove({ id: ask.id, confirm: true });
    if (!r.ok) { setErr(r.error); return; }
    if (mode === "live") {
      const n = r.data.leadsUntagged;
      dispatch({ type: "log", what: "Removed event", lead: null, kind: "admin",
        note: r.data.name + " — " + (n ? n + " lead" + (n === 1 ? "" : "s") + " left with no event named" : "nothing was tagged to it") });
      dispatch({ type: "closeDrawer" });
    }
    /* the prototype's VIEW='events' is synchronous; Next 15 folds a native pushState into
       usePathname at once, so the shell draws the list now rather than when a route fetch lands */
    window.history.pushState(null, "", pathOf("events"));
  };
  return (
    <>
      <button type="button" className="act" onClick={() => { void run(); }}>Remove {ask.eventName}</button>
      <button type="button" className="act ghost" onClick={() => dispatch({ type: "closeDrawer" })}>
        Leave it as it is
      </button>
      {err ? <p className="sm" role="alert" style={{ margin: "8px 0 0" }}>{err}</p> : null}
    </>
  );
}
