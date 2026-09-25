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

import { useRouter } from "next/navigation";
import type { PersonKey } from "@/domain";
import { eventCount, P, assignees, evLeads, may } from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { DrawerProps } from "@/components/shell";
import { pathOf } from "@/components/shell";
import { Icon, Pav } from "@/components/ui";
import { EVCH, EVTYPES, evDateText, evGaps, evISODate, evNextId, uiEVD, type EventDraft } from "./eventDraft";

export function EventEditorBody(props: DrawerProps) {
  const { state, dispatch } = useConsole();
  const event = props.id ? state.EVENTS.find((x) => x.id === props.id) ?? null : null;
  const edit = may(state, "events", "edit");
  const d = uiEVD(state.ui);
  const ran = !!event && event.state === "done";
  const tag = event ? evLeads(state, event.id).length : 0;
  /* irsOf(d.staff) — 03-app.js ~3789: only the drafted staff who still carry a book get dealt to. */
  const irs = d.staff.filter((k) => assignees(state).includes(k));
  const cities = [...new Set(state.EVENTS.map((x) => x.city).filter(Boolean))].sort();
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
              <option key={k} value={k}>{P(state.PEOPLE, k).n}{eligible(k) ? "" : " · no active book"}</option>
            ))}
          </select>
        </label>
        {d.staff.length
          ? (
            <div className="ux-event-staff" id="evstaff">
              {d.staff.map((k) => (
                <button key={k} type="button" className="chip" aria-label={`Remove ${P(state.PEOPLE, k).n} from event staff`}
                  onClick={() => toggleStaff(k)}>
                  <Pav k={k} size="xs" /><span>{P(state.PEOPLE, k).n}</span><Icon name="x" />
                </button>
              ))}
            </div>
          )
          : <p className="sm">No staff selected. Imported leads will wait for an owner.</p>}
        {irs.length > 0 && (
          <p className="sm ux-event-help">
            Leads are shared evenly in this order: {irs.map((k) => P(state.PEOPLE, k).n).join(", ")}. The first member receives any remainder.
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
  const event = props.id ? state.EVENTS.find((x) => x.id === props.id) ?? null : null;
  const edit = may(state, "events", "edit");
  if (!edit) return null;
  const d = uiEVD(state.ui);
  const eligible = (k: PersonKey) => assignees(state).includes(k);
  const gaps = evGaps(d, event, eligible);

  /* saveEvent() reads the draft off ui.EVD itself (same idiom as saveNext/saveTouch) and closes
     the drawer on success. saveEvent() — ir-console-redesigned.html:3835 — sets `EVID=id;
     VIEW='event'` only for a brand-new event, so this is the one place that opens the record it
     just created; an edit of an existing one stays put, same as the prototype. `evNextId` is read
     before dispatch because the reducer computes the very same id off the very same EVENTS list —
     not a guess, the write's own arithmetic run once more, read-only. */
  const save = () => {
    if (gaps.length) return;
    const newId = event ? null : evNextId(state.EVKEY + 1);
    dispatch({ type: "saveEvent" });
    if (newId) router.push(pathOf("event", newId));
  };
  /* drop() no longer removes the event itself — that is the one write in this drawer with no way
     back, so it stops at `askFirst`'s door instead: ir-console-redesigned.html:3881's dropEvent()
     opens DRAWERS.ask before it ever touches EVENTS. Here that door is `p:event.drop` (./drawer),
     which reads the same `evLeads` count and dispatches the same `dropEvent` once confirmed. */
  const drop = () => {
    if (!event) return;
    dispatch({ type: "openDrawer", k: "p:event.drop", id: event.id });
  };

  return (
    <>
      <button type="button" className="act" id="evsave"
        disabled={gaps.length > 0}
        title={gaps.length ? "Complete: " + gaps.join(", ") : undefined}
        onClick={save}>
        {event ? "Save event" : "Add event"}
      </button>
      {event && (
        <button type="button" className="act ghost" id="evdrop" onClick={drop}>
          Remove event
        </button>
      )}
    </>
  );
}

/* ── "Remove <name> from the diary" — the port's stand-in for the prototype's shared `askFirst` ──
   Ports `DRAWERS.ask` (ir-console-redesigned.html ~12712) for this one caller only: the shell has
   no generic "ask" drawer yet (see crossOwnerRequests), so `dropEvent` gets its confirm door here,
   registered as the panel `p:event.drop` (./drawer.tsx). Body and Foot read the event straight off
   `props.id` — nothing rides in a draft, because nothing here is edited, only confirmed or not. */
export function EventDropBody(props: DrawerProps) {
  const { state } = useConsole();
  const event = props.id ? state.EVENTS.find((x) => x.id === props.id) ?? null : null;
  if (!event) return <p className="sm">This drawer is unavailable.</p>;
  const tag = evLeads(state, event.id).length;
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
            The date comes out of the diary, and out of the {state.EVENTS.length} the plan counts
            against the {eventCount(state.PLAN)} it budgets — so the shortfall on this page goes up
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
  const router = useRouter();
  const event = props.id ? state.EVENTS.find((x) => x.id === props.id) ?? null : null;
  if (!event) return null;
  /* askGo() — ir-console-redesigned.html:4204 — clears ASK and closes before running the write;
     `dropEvent` here closes the drawer itself (store.tsx), and VIEW='events' becomes this push,
     because standing on the URL of a record that no longer exists is not a state this port keeps. */
  const run = () => {
    dispatch({ type: "dropEvent", id: event.id });
    router.push(pathOf("events"));
  };
  return (
    <>
      <button type="button" className="act" onClick={run}>Remove {event.n}</button>
      <button type="button" className="act ghost" onClick={() => dispatch({ type: "closeDrawer" })}>
        Leave it as it is
      </button>
    </>
  );
}
