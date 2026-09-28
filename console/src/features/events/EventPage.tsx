"use client";

/* ── ONE EVENT — the night, and the sheet it produced ────────────────────────────────────────
   Ports `ir-console-redesigned.html` 8706–8813 (`vEvent`), whose write half is `loadSheet`
   (~8590–8628 there) in `@/features/add/reducer`.

   The redesign moves "what it produced" and "who was there" out of the main column and into a
   closed-by-default disclosure below the sheet and the lead list — the two things somebody opens
   this page to act on. THE SHEET IS STILL THE POINT: one tab per event, filled in on a tablet on
   the night, loaded into the book in a single pass, honest about how many rows there are, how many
   will load, how many are already here, how many are missing a required field.

   The assignment preview (`splitLine`) below reuses `dealTo`/`splitLine` from `@/features/add` —
   the exact functions `loadSheet` itself deals rows with — rather than a second copy of the same
   arithmetic. It previews over `sh.ok` rows in order, which matches the write for every row the
   reducer does not itself have to skip as an at-write duplicate (the reducer's own loop, not
   `sheetRows`'s pre-filtered one — see crossOwnerRequests: a shared `sheetRows` export would close
   that last, rare gap instead of this page assuming it away). — ponytail: known ceiling, upgrade
   when the reducer exports its own row list. */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ASSIGNRULE, LADDER, ST, UNIT } from "@/domain";
import { money } from "@/lib/format";
import {
  P, assignees, canAssign, evLeads, evStats, isIR, may, openable,
} from "@/lib/selectors";
import { dealTo, splitLine } from "@/features/add";
import { useConsole } from "@/lib/store";
import type { UiState } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { evDraft } from "./eventDraft";
import { sheetRows } from "./sheet";
import { UxDetails } from "./UxDetails";
import { EventsPage } from "./EventsPage";

export function EventPage({ id }: { id: string }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });

  /* dropEvent() sets VIEW='events' the moment the record is gone (ir-console-redesigned.html:3910)
     — you cannot stand on a URL naming a record that no longer exists. This port has no VIEW to
     flip; the id is the URL, so a stale one redirects here instead of silently falling back to
     some other event, which is what showed Prestige Falcon City under a removed event's address. */
  const e = state.EVENTS.find((x) => x.id === id) ?? null;
  /* the route has landed: a press EventsPage was drawing ahead of it is done with */
  const pathname = usePathname();
  const landed = !!pathname && pathname.startsWith("/events/");
  useEffect(() => {
    if (landed && state.ui.EVPEND) dispatch({ type: "setUi", patch: { EVPEND: null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  useEffect(() => {
    if (!e && state.EVENTS.length) router.replace(pathOf("events"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, state.EVENTS.length]);
  /* a record that is gone while its route still stands (dropEvent, or a stale link): the
     prototype's dropEvent puts you on the list at once, so draw the list until the redirect lands */
  if (!e && state.EVENTS.length) return <EventsPage />;
  if (!e) {
    return (
      <div>
        <div className="ph"><button type="button" className="btn" onClick={() => router.push(pathOf("events"))}>← Events</button><h1>Event unavailable</h1></div>
        <div className="empty">Choose an event from the event list.</div>
      </div>
    );
  }
  const st = evStats(state, e);
  const ran = e.state === "done";
  /* the counts are the event's; the NAMES below are only ever the ones you may already open */
  const all = evLeads(state, e.id);
  const open = openable(state);
  const L = all.filter((l) => open.some((x) => x.id === l.id));
  const hid = all.length - L.length;
  /* D59 · Captured and Qualified always; a later stage only once something reached it */
  const steps = ([
    ["Captured", st.captured], ["Qualified", st.qual], ["Reserved", st.res],
    ["Fully paid", st.paid], ["Investor", st.done ?? 0],
  ] as [string, number][]).filter(([, v], i) => i < 2 || v > 0);
  /* the DIVISOR is floored, never the value — a zero must never paint a bar */
  const max = Math.max(1, st.captured);
  const untagged = Math.max(0, st.captured - st.tagged);
  const canEdit = may(state, "events", "edit");
  const canCapture = may(state, "add", "capture");
  const openEditor = () => dispatch({ type: "openDrawer", k: "p:event.edit", id: e.id, seed: { EVD: evDraft(e, state.NOW.getFullYear()) } });
  /* evIRs(e) — the staff on this event who still carry a book */
  const evIRs = e.staff.filter((k) => assignees(state).includes(k));
  const first = (k: string) => P(state.PEOPLE, k).n.split(" ")[0];

  const sh = state.SHEET[e.id];
  const ready = !!sh && sh.state === "ready";
  const mayLoad = ready && may(state, "events", "load");
  const AR = state.ui.AR ?? "roster";
  const ARWHO = state.ui.ARWHO ?? null;
  /* sheetOwner(e,i) — who carries row i under the rule the chips are on */
  const sheetOwner = (i: number): string | null =>
    AR === "self" ? state.WHO : AR === "one" ? ARWHO : AR === "none" ? null : dealTo(state, e, i);
  const goLead = (lid: string) => router.push(pathOf("lead", lid));
  /* back to the list — also drops a pending press, which is what is drawing this page if the
     /events/[id] route has not landed yet (EventsPage) */
  const back = () => { set({ EVPEND: null }); router.push(pathOf("events")); };

  return (
    <div className="rd-page rd-event-detail">
      <button type="button" className="btn rd-back" aria-label="Back to events" title="Back to events"
        onClick={back}>← Events</button>
      <div className="ph rd-page-heading">
        <div>
          <span className="rd-eyebrow">{e.type} · {ran ? "Completed event" : "Planned event"}</span>
          <h1>{e.n}</h1>
          <p className="sub">{e.date} · {e.city}</p>
        </div>
        <div className="sp" />
        {canEdit && <button type="button" className="act" onClick={openEditor}>Edit event</button>}
      </div>

      <section className="ux-event ux-section">
        <div className="ux-section">
          {!sh ? (
            <div className="card">
              <div className="ch"><h3>Event leads sheet</h3></div>
              <div className="cb">
                <p className="sm" style={{ margin: 0 }}>
                  No sheet started for this event yet. One tab per
                  event, created before the weekend, so the tablet has somewhere to write.
                </p>
              </div>
            </div>
          ) : (
            <div className="card" style={ready ? { borderColor: "var(--due)" } : undefined}>
              <div className="ch">
                <h3>Event leads sheet</h3><div className="sp" />
                <span className={`tag ${ready ? "due" : "go"}`}>
                  <span className="dot" />{ready ? "ready to load" : "loaded"}
                </span>
              </div>
              <div className="cb">
                {ready ? (
                  <>
                    <p className="sm g4-sheet-sum">
                      <b>{sh.ok} of {sh.rows} rows will load</b> · {sh.dupe} already here ·{" "}
                      <span className={sh.bad ? "g4-bad" : undefined}>{sh.bad} missing a required field</span><br />
                      Filled by {first(sh.by)} · {sh.at}
                    </p>
                    {mayLoad ? (
                      <>
                        <label className="fi" style={{ marginBottom: "8px" }}>
                          <span>Assign the new leads</span>
                          <select className="selw" id="sheet-assignment" value={AR} onChange={(ev) => set({ AR: ev.target.value })}>
                            {Object.entries(ASSIGNRULE)
                              .filter(([k]) => k !== "self" || isIR(state.ROLE))
                              .filter(([k]) => k !== "none" || canAssign(state))
                              .map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                          </select>
                        </label>
                        {AR === "one" && (
                          <label className="fi" style={{ marginBottom: "8px" }}>
                            <span>Lead owner</span>
                            <select className="selw" id="sheet-owner" value={ARWHO ?? ""} onChange={(ev) => set({ ARWHO: ev.target.value || null })}>
                              <option value="">Choose an owner…</option>
                              {assignees(state).map((k) => <option key={k} value={k}>{P(state.PEOPLE, k).n}</option>)}
                            </select>
                          </label>
                        )}
                        <p className="sm" id="shsplit" style={{ margin: "0 0 10px" }}>
                          <b>{splitLine(state, sheetRows(e.id, sh, state.LEADS).length, sheetOwner)}</b>
                          {AR === "roster" && evIRs.length > 1
                            ? " — in the order they are named on the event, so a remainder goes to the first named."
                            : ""}
                        </p>
                        <div className="g4-load">
                          <button type="button" className="act"
                            disabled={AR === "one" && !ARWHO}
                            title={AR === "one" && !ARWHO ? "Pick who carries them first" : undefined}
                            onClick={() => dispatch({ type: "loadSheet", ev: e.id })}>
                            Load {sh.ok} leads
                          </button>
                          <span className="sm">They keep this event as their source. Contact permission comes from the intake form; email permission is not assumed.</span>
                        </div>
                      </>
                    ) : (
                      <p className="sm" style={{ margin: 0 }}>Your seat does not load event sheets; the IR team or Marketing do.</p>
                    )}
                  </>
                ) : (
                  <p className="sm" style={{ margin: 0 }}>
                    {sh.ok} of {sh.rows} rows loaded
                    {sh.loadedBy ? " by " + P(state.PEOPLE, sh.loadedBy).n + " · " + sh.loadedAt : ""}
                    {sh.rule ? " · " + sh.rule.toLowerCase() : ""}, {sh.dupe} skipped as duplicates
                    {sh.bad ? ", " + sh.bad + " left on the sheet" : ""}. A sheet loads once — corrections go through the
                    lead, so the console stays the record.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: "8px" }}>
            <div className="ch">
              <h3>Leads from this event</h3><div className="sp" />
              <span className="sm mono">{ran && untagged ? `${st.tagged} of ${st.captured} tagged` : all.length}</span>
            </div>
            <div className="tw scroll"><table>
              <thead><tr>
                <th scope="col">Lead</th><th scope="col">Stage</th>
                <th scope="col" style={{ textAlign: "right" }}>Total</th>
              </tr></thead>
              <tbody>
                {L.length ? L.map((l) => (
                  <tr key={l.id} className="g4-row" onClick={() => goLead(l.id)}>
                    <th scope="row">
                      <button type="button" className="g4-name" onClick={(ev) => { ev.stopPropagation(); goLead(l.id); }}><b>{l.n}</b></button>
                      <div className="sm">{l.own ? P(state.PEOPLE, l.own).n : "no owner"}</div>
                    </th>
                    <td>
                      <span className={`tag ${l.done >= ST.RESERVED ? "go" : ""}`}>
                        {LADDER[Math.max(0, l.done - 1)]!.t}
                      </span>
                    </td>
                    <td className="n">{money(l.units * UNIT)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="empty">
                    {all.length
                      ? `None of this event's ${all.length} lead${all.length === 1 ? "" : "s"} ${all.length === 1 ? "is" : "are"} in your book. ${all.length === 1 ? "It is" : "They are"} counted in the event's results — a lead is named only to the person who may open it.`
                      : "No lead has been tagged to this event yet. A lead joins this list when this event is chosen as its source at capture, or when the event's sheet is loaded above."}
                    {!all.length && canCapture && (
                      <>
                        <br />
                        <button type="button" className="chip" style={{ marginTop: "10px" }}
                          onClick={() => dispatch({ type: "openDrawer", k: "p:add.quick" })}>
                          Add a lead
                        </button>
                      </>
                    )}
                  </td></tr>
                )}
                {!!hid && !!L.length && (
                  <tr><td colSpan={3} className="sm" style={{ color: "var(--ink-3)" }}>
                    and {hid} more, in somebody else&apos;s book
                  </td></tr>
                )}
              </tbody>
            </table></div>
          </div>
        </div>

        <UxDetails k="event-information" summary={ran ? "Event details and results" : "Event details"}>
          {ran && (
            <div className="card">
              <div className="ch"><h3>What it produced</h3></div>
              <div className="cb">
                {steps.map(([t, v]) => (
                  <div key={t} style={{
                    display: "grid", gridTemplateColumns: "96px 1fr 34px", gap: "10px",
                    alignItems: "center", marginBottom: "7px",
                  }}>
                    <span className="sm">{t}</span>
                    <div className="bar"><i style={{ width: `${v ? v / max * 100 : 0}%` }} /></div>
                    <span className="sm mono" style={{ textAlign: "right" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="ch">
              <h3>{ran ? "Who was there" : "Who works it"}</h3><div className="sp" />
              <span className="sm">{evIRs.length ? `${evIRs.length} carry a book` : "none with a book"}</span>
            </div>
            <div className="cb">
              <div className="chips">
                {e.staff.length ? e.staff.map((k) => (
                  <span className="chip" key={k}
                    title={evIRs.includes(k) ? undefined : `${P(state.PEOPLE, k).n} no longer carries a book, so nothing is dealt to them`}>
                    {P(state.PEOPLE, k).n}
                  </span>
                )) : <span className="sm">Nobody is named on this one yet.</span>}
              </div>
              {!sh && (
                <p className="sm" style={{ margin: "8px 0 0" }}>
                  {evIRs.length
                    ? `Anything loaded against this event is dealt round ${evIRs.map(first).join(", ")} in that order, evenly, and lands already carried.`
                    : "Nothing loaded against this event is dealt to anybody: its leads arrive with no owner and wait on Leads for somebody to pick them up."}
                </p>
              )}
              <dl className="kv">
                <dt>Channel</dt><dd>{e.ch}</dd>
                <dt>Cost</dt><dd className="mono">₹{e.cost.toLocaleString("en-IN")}</dd>
                {ran && (
                  <>
                    <dt>Per lead</dt>
                    <dd className="mono">₹{Math.round(e.cost / Math.max(1, st.captured)).toLocaleString("en-IN")}</dd>
                    <dt>Per qualified</dt>
                    <dd>
                      {untagged
                        ? <><span className="tag due">not yet</span> <span className="sm">tag the other {untagged} captured leads</span></>
                        : <b className="mono">₹{Math.round(e.cost / Math.max(1, st.qual)).toLocaleString("en-IN")}</b>}
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
        </UxDetails>
      </section>
    </div>
  );
}
