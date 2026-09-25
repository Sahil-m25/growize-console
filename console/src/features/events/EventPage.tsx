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
import { useRouter } from "next/navigation";
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

export function EventPage({ id }: { id: string }) {
  const { state, dispatch } = useConsole();
  const router = useRouter();
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });

  /* dropEvent() sets VIEW='events' the moment the record is gone (ir-console-redesigned.html:3910)
     — you cannot stand on a URL naming a record that no longer exists. This port has no VIEW to
     flip; the id is the URL, so a stale one redirects here instead of silently falling back to
     some other event, which is what showed Prestige Falcon City under a removed event's address. */
  const e = state.EVENTS.find((x) => x.id === id) ?? null;
  useEffect(() => {
    if (!e && state.EVENTS.length) router.push(pathOf("events"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, state.EVENTS.length]);
  if (!e) {
    return (
      <div>
        <div className="ph"><button type="button" className="btn" onClick={() => router.push(pathOf("events"))}>← Events</button><h1>Event unavailable</h1></div>
        <div className="empty">Choose an event from the event list.</div>
      </div>
    );
  }
  const st = evStats(state, e);
  /* the counts above are the event's; the NAMES below are only ever the ones you may already open */
  const all = evLeads(state, e.id);
  const open = openable(state);
  const L = all.filter((l) => open.some((x) => x.id === l.id));
  const hid = all.length - L.length;
  const steps: [string, number][] = [
    ["Captured", st.captured], ["Qualified", st.qual], ["Reserved", st.res],
    ["Fully paid", st.paid], ["Investor", st.done ?? 0],
  ];
  const max = Math.max(1, st.captured);
  const canEdit = may(state, "events", "edit");
  const canCapture = may(state, "add", "capture");
  const openEditor = () => dispatch({ type: "openDrawer", k: "p:event.edit", id: e.id, seed: { EVD: evDraft(e) } });
  /* evIRs(e) — the staff on this event who still carry a book. 03-app.js ~3789. */
  const evIRs = e.staff.filter((k) => assignees(state).includes(k));

  const sh = state.SHEET[e.id];
  const ready = !!sh && sh.state === "ready";
  const mayLoad = ready && may(state, "events", "load");
  const AR = state.ui.AR ?? "roster";
  const ARWHO = state.ui.ARWHO ?? null;
  /* sheetOwner(e,i) — 03-app.js:8590. Who carries row i under the rule the chips are on; the
     loader's own `pick(i)` (features/add/reducer.ts) runs the same branches over the same AR/ARWHO. */
  const sheetOwner = (i: number): string | null =>
    AR === "self" ? state.WHO : AR === "one" ? ARWHO : AR === "none" ? null : dealTo(state, e, i);

  return (
    <div className="rd-page rd-event-detail">
      <button type="button" className="btn rd-back" aria-label="Back to events" title="Back to events"
        onClick={() => router.push(pathOf("events"))}>← Events</button>
      <div className="ph rd-page-heading">
        <div>
          <span className="rd-eyebrow">{e.type} · {e.state === "planned" ? "Planned event" : "Completed event"}</span>
          <h1>{e.n}</h1>
          <p className="sub">{e.date} · {e.city}</p>
        </div>
        <div className="sp" />
        {canEdit && <button type="button" className="act" onClick={openEditor}>Edit event</button>}
      </div>

      <div className="stats ux-event-metrics" style={{ marginBottom: "8px", gridTemplateColumns: "repeat(5,1fr)" }}>
        {([["Leads", st.captured], ["Qualified", st.qual], ["Reserved", st.res],
          ["Fully paid", st.paid], ["Investors", st.done ?? 0]] as [string, number][])
          .map(([l, v]) => <div className="stat" key={l}><b>{v}</b><span>{l}</span></div>)}
      </div>

      <section className="ux-event ux-section">
        <div className="ux-section">
          {!sh ? (
            <div className="card">
              <div className="ch"><h3>Event leads sheet</h3></div>
              <div className="cb">
                <p className="sm" style={{ margin: 0 }}>
                  No sheet started for this event yet. One tab per event, created before the
                  weekend, so the tablet has somewhere to write.
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
                <div className="grid g2" style={{ marginBottom: "10px" }}>
                  <div className="kpi">
                    <div className="l">Rows on the sheet</div>
                    <div className="v">{sh.rows}</div>
                    <div className="s">by {P(state.PEOPLE, sh.by).n.split(" ")[0]} · {sh.at}</div>
                  </div>
                  <div className={`kpi ${sh.bad ? "bad" : ""}`}>
                    <div className="l">Will load</div>
                    <div className="v">{sh.ok}</div>
                    <div className="s">{sh.dupe} already here · {sh.bad} missing a required field</div>
                  </div>
                </div>
                {ready ? (
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
                      <b>{splitLine(state, sh.ok, sheetOwner)}</b>
                      {AR === "roster" && evIRs.length > 1
                        ? " — in the order they are named on the event, so a remainder goes to the first named."
                        : ""}
                    </p>
                    <button type="button" className="act" style={{ width: "100%", textAlign: "center", padding: "12px" }}
                      disabled={!(mayLoad && !(AR === "one" && !ARWHO))}
                      title={mayLoad && !(AR === "one" && !ARWHO)
                        ? undefined
                        : !may(state, "events", "load")
                          ? "Your seat does not load event sheets — Marketing, the IR team, the Operations Lead or Digital do"
                          : !ready ? "This sheet has already been loaded"
                            : "Pick who carries them first"}
                      onClick={() => dispatch({ type: "loadSheet", ev: e.id })}>
                      Load {sh.ok} leads into the console
                    </button>
                    <p className="sm" style={{ margin: "9px 0 0" }}>
                      {sh.ok} leads will keep this event as their source. {sh.dupe} duplicate
                      mobiles and {sh.bad} incomplete rows are skipped. Contact permission comes
                      from the intake form; email permission is not assumed.
                    </p>
                  </>
                ) : (
                  <p className="sm" style={{ margin: 0 }}>
                    {sh.ok} loaded
                    {sh.loadedBy ? " by " + P(state.PEOPLE, sh.loadedBy).n + " · " + sh.loadedAt : ""}
                    {sh.rule ? " · " + sh.rule.toLowerCase() : ""}, {sh.dupe} skipped as
                    duplicates{sh.bad ? ", " + sh.bad + " left on the sheet" : ""}. A sheet loads
                    once — corrections go through the lead, so the console stays the record.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: "8px" }}>
            <div className="ch">
              <h3>Leads from this event</h3><div className="sp" />
              <span className="sm mono">{L.length}{hid ? " of " + all.length : ""}</span>
            </div>
            <div className="tw scroll"><table>
              <thead><tr>
                <th scope="col">Lead</th><th scope="col">Stage</th>
                <th scope="col" style={{ textAlign: "right" }}>Total</th>
              </tr></thead>
              <tbody>
                {L.length ? L.map((l) => (
                  <tr key={l.id} className="k" tabIndex={0} onClick={() => router.push(pathOf("lead", l.id))}>
                    <th scope="row">
                      <b>{l.n}</b>
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
                      ? `None of this event's ${all.length} lead${all.length === 1 ? "" : "s"} ${all.length === 1 ? "is" : "are"} in your book. ${all.length === 1 ? "It is" : "They are"} counted in the figures above — a lead is named only to the person who may open it, and the count is the event's either way.`
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

        <details className="ux-disclosure" data-ux-key="event-information">
          <summary>Event details and results</summary>
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

          <div className="card">
            <div className="ch">
              <h3>Who was there</h3><div className="sp" />
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
                {canEdit && (
                  <button type="button" className="chip" onClick={openEditor}>＋ Name who works it</button>
                )}
              </div>
              <p className="sm" style={{ margin: "8px 0 0" }}>
                {evIRs.length
                  ? `Anything loaded against this event is dealt round ${evIRs.map((k) => P(state.PEOPLE, k).n.split(" ")[0]).join(", ")} in that order, evenly, and lands already carried.`
                  : "Nothing loaded against this event is dealt to anybody: its leads arrive with no owner and wait on Leads for somebody to pick them up."}
              </p>
              <dl className="kv">
                <dt>Channel</dt><dd>{e.ch}</dd>
                <dt>Cost</dt><dd className="mono">₹{e.cost.toLocaleString("en-IN")}</dd>
                {e.state === "done" && (
                  <>
                    <dt>Per lead</dt>
                    <dd className="mono">₹{Math.round(e.cost / Math.max(1, st.captured)).toLocaleString("en-IN")}</dd>
                    <dt>Per qualified</dt>
                    <dd className="mono">
                      {st.tagged < st.captured
                        ? <span className="tag due">not yet</span>
                        : <b>₹{Math.round(e.cost / Math.max(1, st.qual)).toLocaleString("en-IN")}</b>}
                    </dd>
                  </>
                )}
                <dt>Tagged</dt><dd>{st.tagged} of {st.captured} leads entered</dd>
              </dl>
              {e.state === "done" && st.tagged < st.captured && (
                <div className="note due" style={{ marginTop: "10px" }}>
                  Only {st.tagged} of {st.captured} captured leads carry this event tag, so cost per
                  qualified is not computable yet. Tag the rest and it appears.
                </div>
              )}
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
