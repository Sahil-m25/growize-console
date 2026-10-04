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

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ASSIGNRULE, UNIT } from "@/domain";
import { money } from "@/lib/format";
import {
  P, assignees, canAssign, isIR, may,
} from "@/lib/selectors";
import { dealTo, splitLineBy } from "@/features/add";
import { useConsole } from "@/lib/store";
import type { UiState } from "@/lib/store";
import { useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { eventOne, eventRecOf, ruleOf, sheetLoad, sheetState } from "@/lib/data/endpoints/events";
import { pathOf } from "@/components/shell";
import { evDraftOf, evTitleDates } from "./eventDraft";
import { intakeRows, parseIntake, sheetRows } from "./sheet";
import { loadingLine, runningCounts, runningOf, sheetTag, type Running } from "./sheet-progress";
import { UxDetails } from "./UxDetails";
import { EventsPage } from "./EventsPage";

/* Zoho's Lead_Status → whether the lead has reached a reservation (the card's "go" tag) */
const REACHED = /^(Reserved|Fully paid|Allocated|Onboarded|Converted)/;

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** a stamp as the card prints it: the route's naive IST "2026-09-28T11:30" as "28 Sep 11:30"; the demo book's own stamp is already text */
const stampText = (t: string | null | undefined): string => {
  const m = t ? /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(t) : null;
  return m ? `${+m[2]!} ${MON[+m[1]! - 1]} ${m[3]}` : t ?? "";
};

export function EventPage({ id }: { id: string }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const mode = useApiMode();
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });
  /* M14-S01-W1: the event and the leads the viewer may open are GET /api/events/[id] (lib/data/endpoints/events) */
  const one = useApiRead(eventOne, state, id);
  /* M14-S03-W1: 'Load N leads' is POST /api/events/[id]/sheet {rule, rows}; a refusal reads under the button */
  const load = useApiWrite(sheetLoad, state, dispatch);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /* M18-S09-NOTE-3: a big sheet loads over several requests; how far it has got while it continues */
  const [cont, setCont] = useState<Running | null>(null);
  /* M14-S03-W2: the sheet card is GET /api/events/[id]/sheet (Lead_Events' Load_State, the counts the loader wrote back, who loaded it,
     the staff in named order, the load log), never state.SHEET. Live, the rows to load are the intake sheet pasted below (PROVISIONAL). */
  const sheet = useApiRead(sheetState, state, id);
  const [paste, setPaste] = useState("");

  /* dropEvent() sets VIEW='events' the moment the record is gone (ir-console-redesigned.html:3910)
     — you cannot stand on a URL naming a record that no longer exists. This port has no VIEW to
     flip; the id is the URL, so a route that answers 404 redirects here instead of silently falling back
     to some other event, which is what showed Prestige Falcon City under a removed event's address. */
  const gone = one.state === "error" && one.err.status === 404;
  /* the route has landed: a press EventsPage was drawing ahead of it is done with */
  const pathname = usePathname();
  const landed = !!pathname && pathname.startsWith("/events/");
  useEffect(() => {
    if (landed && state.ui.EVPEND) dispatch({ type: "setUi", patch: { EVPEND: null } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  useEffect(() => {
    if (gone) router.replace(pathOf("events"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone]);
  /* a record that is gone while its route still stands (dropEvent, or a stale link): the
     prototype's dropEvent puts you on the list at once, so draw the list until the redirect lands */
  if (gone) return <EventsPage />;
  if (one.state === "idle" || one.state === "loading") return <div className="empty">Reading the event…</div>;
  if (one.state === "error") {
    return (
      <div>
        <div className="ph"><button type="button" className="btn" onClick={() => router.push(pathOf("events"))}>← Events</button><h1>Event unavailable</h1></div>
        <div className="empty" role="alert">{one.err.status === 403 ? "Choose an event from the event list." : one.err.error}</div>
      </div>
    );
  }
  const row = one.data.event;
  const e = eventRecOf(row);
  const st = row.stats;
  const ran = row.state === "done";
  /* the counts are the event's; the NAMES below are only ever the ones you may already open */
  const L = one.data.leads;
  const hid = one.data.othersCount ?? 0;
  const captured = st.captured ?? 0;
  /* D59 · Captured and Qualified always; a later stage only once something reached it */
  const steps = ([
    ["Captured", captured], ["Qualified", st.qualified], ["Reserved", st.reserved],
    ["Fully paid", st.paid], ["Investor", st.investor],
  ] as [string, number][]).filter(([, v], i) => i < 2 || v > 0);
  /* the DIVISOR is floored, never the value — a zero must never paint a bar */
  const max = Math.max(1, captured);
  const untagged = Math.max(0, captured - st.tagged);
  const canEdit = may(state, "events", "edit");
  const canCapture = may(state, "add", "capture");
  const openEditor = () => dispatch({ type: "openDrawer", k: "p:event.edit", id: e.id, seed: { EVD: evDraftOf(row) } });
  /* evIRs(e) — the staff on this event who still carry a book */
  const evIRs = e.staff.filter((k) => assignees(state).includes(k));
  const first = (k: string) => P(state.PEOPLE, k).n.split(" ")[0];
  const staffName = (k: string) => row.staff.find((x) => x.id === k)?.name ?? P(state.PEOPLE, k).n;

  const sv = sheet.state === "ok" ? sheet.data : null;
  const ready = !!sv && sv.state === "ready";
  const mayLoad = ready && sv.mayLoad;
  /* the route's counts when it has them (the demo book); else (live) the rows pasted below */
  const fromRoute = !!sv && sv.willLoad !== null;
  const pasted = parseIntake(paste);
  const nLoad = !sv ? 0 : fromRoute ? sv.willLoad! : pasted.rows.length;
  const AR = state.ui.AR ?? "roster";
  const ARWHO = state.ui.ARWHO ?? null;
  /* who a round-robin deals to, in the order they are named: the staff who still carry a book (the demo book) or the route's staff (live) */
  const dealers = !sv ? [] : mode === "live" ? sv.staff.map((x) => x.id) : e.staff.filter((k) => assignees(state).includes(k));
  const owners = !sv ? [] : mode === "live" ? sv.staff.map((x) => x.id) : assignees(state);
  const nameOf = (k: string) => sv?.staff.find((x) => x.id === k)?.name ?? staffName(k);
  /* sheetOwner(e,i) — who carries row i under the rule the chips are on */
  const sheetOwner = (i: number): string | null =>
    AR === "self" ? state.WHO : AR === "one" ? ARWHO : AR === "none" ? null : mode === "live" ? (dealers.length ? dealers[i % dealers.length]! : null) : dealTo(state, e, i);
  const goLead = (lid: string) => router.push(pathOf("lead", lid));
  /* back to the list — also drops a pending press, which is what is drawing this page if the
     /events/[id] route has not landed yet (EventsPage) */
  const back = () => { set({ EVPEND: null }); router.push(pathOf("events")); };
  const doLoad = async () => {
    if (!sv) return;
    setLoadErr(null);
    const rows = fromRoute ? intakeRows(state, e.id, { ok: sv.willLoad! }, e.city) : pasted.rows;
    const args = { eventId: e.id, rule: ruleOf(AR, ARWHO), rows };
    let r = await load(args);
    /* a load that ran out of request time keeps its place on the server: post the same sheet again until it is done */
    for (let n = 0; r.ok && r.data.continuing && n < 50; n++) { setCont(runningOf(r.data)); r = await load(args); }
    setCont(null);
    /* a live load re-reads the sheet card by itself (the adapter's tick); the demo book's reducer wrote its own line */
    if (!r.ok) setLoadErr(r.error);
  };

  return (
    <div className="rd-page rd-event-detail">
      <button type="button" className="btn rd-back" aria-label="Back to events" title="Back to events"
        onClick={back}>← Events</button>
      <div className="ph rd-page-heading">
        <div>
          <span className="rd-eyebrow">{e.type} · {ran ? "Completed event" : "Planned event"}</span>
          <h1>{row.name}</h1>
          <p className="sub">{evTitleDates(row)} · {e.city}</p>
        </div>
        <div className="sp" />
        {canEdit && <button type="button" className="act" onClick={openEditor}>Edit event</button>}
      </div>

      <section className="ux-event ux-section">
        <div className="ux-section">
          {sheet.state === "idle" || sheet.state === "loading" ? (
            <div className="card"><div className="cb"><p className="sm" style={{ margin: 0 }}>Reading the sheet…</p></div></div>
          ) : !sv ? (
            sheet.state === "error" ? <div className="card"><div className="cb"><p className="sm" role="alert" style={{ margin: 0 }}>{sheet.err.error}</p></div></div> : null
          ) : sv.state === "none" ? (
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
            <div className="card" style={ready || cont ? { borderColor: "var(--due)" } : undefined}>
              <div className="ch">
                <h3>Event leads sheet</h3><div className="sp" />
                <span className={`tag ${sheetTag(ready, cont).cls}`}>
                  <span className="dot" />{sheetTag(ready, cont).text}
                </span>
              </div>
              <div className="cb">
                {cont ? (
                  <p className="sm" role="status" style={{ margin: 0 }}>
                    <b>{loadingLine(cont)}</b> · {runningCounts(cont)}; continuing…
                  </p>
                ) : ready ? (
                  <>
                    {fromRoute ? (
                      <p className="sm g4-sheet-sum">
                        <b>{sv.willLoad} of {sv.inFile ?? sv.willLoad} rows will load</b> · {sv.duplicates ?? 0} already here ·{" "}
                        <span className={sv.refused ? "g4-bad" : undefined}>{sv.refused ?? 0} missing a required field</span>
                        {sv.filledBy ? <><br />Filled by {(sv.filledBy.name ?? "").split(" ")[0]} · {stampText(sv.filledAt)}</> : null}
                      </p>
                    ) : mayLoad ? (
                      <>
                        <label className="fi" style={{ marginBottom: "8px" }}>
                          <span>Paste the tablet sheet</span>
                          <textarea className="nta" id="sheet-paste" rows={4} value={paste} onChange={(ev) => setPaste(ev.target.value)}
                            placeholder={"Name, Mobile, WhatsApp, Call, Email, City, Units\nAsha Kulkarni, 9876501234, yes, yes, , Bengaluru, 1"} />
                        </label>
                        <p className="sm g4-sheet-sum">
                          <b>{pasted.rows.length} rows pasted</b>
                          {sv.inFile !== null ? ` · ${sv.inFile} on the sheet` : ""}
                          {pasted.skipped ? <> · <span className="g4-bad">{pasted.skipped} without a name or mobile</span></> : null}
                          {pasted.err ? <><br /><span className="g4-bad" role="alert">{pasted.err}</span></> : null}
                        </p>
                      </>
                    ) : null}
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
                              {owners.map((k) => <option key={k} value={k}>{nameOf(k)}</option>)}
                            </select>
                          </label>
                        )}
                        <p className="sm" id="shsplit" style={{ margin: "0 0 10px" }}>
                          <b>{splitLineBy(fromRoute ? sheetRows(e.id, { ok: sv.willLoad! }, state.LEADS).length : nLoad, sheetOwner, nameOf)}</b>
                          {AR === "roster" && dealers.length > 1
                            ? " — in the order they are named on the event, so a remainder goes to the first named."
                            : ""}
                        </p>
                        <div className="g4-load">
                          <button type="button" className="act"
                            disabled={(AR === "one" && !ARWHO) || nLoad === 0}
                            title={AR === "one" && !ARWHO ? "Pick who carries them first" : nLoad === 0 ? "There are no rows to load yet" : undefined}
                            onClick={() => { void doLoad(); }}>
                            Load {nLoad} leads
                          </button>
                          <span className="sm">They keep this event as their source. Contact permission comes from the intake form; email permission is not assumed.</span>
                        </div>
                        {loadErr ? <p className="sm" role="alert" style={{ margin: "8px 0 0" }}>{loadErr}</p> : null}
                      </>
                    ) : (
                      <p className="sm" style={{ margin: 0 }}>Your seat does not load event sheets; the IR team or Marketing do.</p>
                    )}
                  </>
                ) : (
                  <p className="sm" style={{ margin: 0 }}>
                    {sv.loaded ?? 0} of {sv.inFile ?? sv.loaded ?? 0} rows loaded
                    {sv.loadedBy ? " by " + (sv.loadedBy.name ?? "someone") + " · " + stampText(sv.loadedAt) : ""}
                    {sv.rule ? " · " + sv.rule.toLowerCase() : ""}, {sv.duplicates ?? 0} skipped as duplicates
                    {sv.refused ? ", " + sv.refused + " left on the sheet" : ""}. A sheet loads once — corrections go through the
                    lead, so the console stays the record.
                  </p>
                )}
                {!ready && loadErr ? <p className="sm" role="alert" style={{ margin: "8px 0 0" }}>{loadErr}</p> : null}
                {sv.log.map((l, i) => (
                  <p key={i} className="sm" style={{ margin: "8px 0 0", color: "var(--ink-3)" }}>
                    {stampText(l.at)} · {l.what} — {l.note.startsWith(row.name + " — ") ? l.note.slice(row.name.length + 3) : l.note}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: "8px" }}>
            <div className="ch">
              <h3>Leads from this event</h3><div className="sp" />
              <span className="sm mono">{ran && untagged ? `${st.tagged} of ${captured} tagged` : st.tagged}</span>
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
                      <button type="button" className="g4-name" onClick={(ev) => { ev.stopPropagation(); goLead(l.id); }}><b>{l.name}</b></button>
                      <div className="sm">{l.ownerName ?? "no owner"}</div>
                    </th>
                    <td>
                      <span className={`tag ${REACHED.test(l.status ?? "") ? "go" : ""}`}>
                        {l.status ?? "—"}
                      </span>
                    </td>
                    {/* PROVISIONAL: Units_Interested × the unit price; the allotment's own value is an investor-side read (D69) */}
                    <td className="n">{l.units ? money(l.units * UNIT) : "—"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="empty">
                    {st.tagged
                      ? `None of this event's ${st.tagged} lead${st.tagged === 1 ? "" : "s"} ${st.tagged === 1 ? "is" : "are"} in your book. ${st.tagged === 1 ? "It is" : "They are"} counted in the event's results — a lead is named only to the person who may open it.`
                      : "No lead has been tagged to this event yet. A lead joins this list when this event is chosen as its source at capture, or when the event's sheet is loaded above."}
                    {!st.tagged && canCapture && (
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
                    title={evIRs.includes(k) ? undefined : `${staffName(k)} no longer carries a book, so nothing is dealt to them`}>
                    {staffName(k)}
                  </span>
                )) : <span className="sm">Nobody is named on this one yet.</span>}
              </div>
              {sv?.state === "none" && (
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
                    <dd className="mono">₹{Math.round(e.cost / Math.max(1, captured)).toLocaleString("en-IN")}</dd>
                    <dt>Per qualified</dt>
                    <dd>
                      {untagged
                        ? <><span className="tag due">not yet</span> <span className="sm">tag the other {untagged} captured leads</span></>
                        : <b className="mono">₹{(st.costPerQualified ?? Math.round(e.cost / Math.max(1, st.qualified))).toLocaleString("en-IN")}</b>}
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
