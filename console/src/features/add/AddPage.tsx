"use client";

/* ── ADD LEAD — entered once, here, and nowhere else ─────────────────────────────────────────
   Ports `ref/03-app.js` (redesigned) 7898–8199 (`putLead`/`addLead`, `vAdd`), with its gate in
   `./state.ts`, its write in `./reducer.ts`, and the bulk-import fold in `./AddBulk.tsx`.

   "Six questions, none of them optional, none of them on one screen at once" is the ORIGINAL
   prototype's shape. The redesign cuts it further: only two of the six ever fold now — "who",
   "where it came from" and "who carries it" sit open on the page as plain cards, because they are
   what a capture always answers, in the order it always answers them. Only "what they want" and
   "consent" still close, because either may honestly be "not yet".

   THE DOOR THIS SCREEN OPENS: capture takes no line off the record until it is pressed. Adding
   does not open the record either — "Opening the new lead is offered, never done for you" — so a
   successful save leaves this same, empty form with a note above it, not a different screen.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { KINDS, SOURCES, SRCNEEDS, UNIT, UNITS } from "@/domain";
import type { EventId, LeadId, PersonKey, Source } from "@/domain";
import { money } from "@/lib/format";
import {
  active, assignees, canReach, channelPartners, isIR, isMgr, may, mgrOf,
  openable, P, roleOf,
} from "@/lib/selectors";
import { useConsole } from "@/lib/store";
import type { UiState } from "@/lib/store";
import { pathOf } from "@/components/shell";
import { Chip, Field } from "@/components/ui";
import { newIdempotencyKey, useApiMode, useApiRead, useApiWrite } from "@/lib/data/api";
import { eventDates, eventPicker } from "@/lib/data/endpoints/events";
import { addArgsOf, leadAdd, useDuplicateHint } from "@/lib/data/endpoints/intake";
import { AddBulk } from "./AddBulk";
import {
  ADD0, addDraft, addGaps, addIntroducers, addUnits, addWho, CONHOW, conOK, customOK, dupeOf, emOK, phOK,
} from "./state";
import type { AddCon } from "./state";

/* the fold on the capture door — `want` and `consent` only. 03-app.js:8199 (redesigned) */
function Fld({
  k, t, val, open, onToggle, children,
}: {
  k: string; t: string; val: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <details className="ux-disclosure" data-ux-key={`capture-${k}`} open={open} id={`fld-${k}`}>
      <summary onClick={(e) => { e.preventDefault(); onToggle(); }}>
        {t}<span className="ux-secondary"> · {val || "optional"}</span>
      </summary>
      <div className="cb">{children}</div>
    </details>
  );
}

/* `who`/`src`/`owner` — plain cards, always open. 03-app.js:8199's `fld()`, the `section` branch */
function Sec({ k, t, children }: { k: string; t: string; children: ReactNode }) {
  return (
    <section className="card ux-section" id={`fld-${k}`}>
      <div className="ch"><h3>{t}</h3></div>
      <div className="cb">{children}</div>
    </section>
  );
}

const CONCH: readonly (readonly [keyof AddCon, string])[] = [
  ["msg", "WhatsApp"], ["call", "Call"], ["email", "Email"], ["visit", "Visit"],
];

export function AddPage({ bare = false }: { bare?: boolean } = {}) {
  const { state, dispatch, reloadData } = useConsole();
  const router = useRouter();
  const d = addDraft(state.ui, state);
  const live = useApiMode() === "live";
  /* C3: the number is asked of the route as it is typed (POST /api/leads/duplicate), and Add is POST /api/leads with one
     Idempotency-Key per press (the same key, the same form: a retry after a dropped reply never adds twice) */
  const hint = useDuplicateHint(state, d.ADDPH);
  const add = useApiWrite(leadAdd, state, dispatch);
  const press = useRef<{ sig: string; key: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [lostNote, setLostNote] = useState<string | null>(null);
  /* M14-S03-W1: the events a lead can be captured from are GET /api/events (the ones that have run) */
  const events = useApiRead(eventPicker, state, d.ADDSRC === "Events");
  const set = (patch: Partial<UiState>) => dispatch({ type: "setUi", patch });

  /* ADRAFT.seen and the caret's field — kept locally: they decide only when an error is worth
     showing, never what is written. 03-app.js:7861/8203 (redesigned) */
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const bad = (f: string, id: string) => !!seen[f] && focused !== id;
  const markSeen = (f: string) => setSeen((s) => ({ ...s, [f]: true }));

  const gaps = addGaps(state, d), ok = !gaps.length;
  const own = addWho(state, d);
  const cap = may(state, "add", "capture"); /* the grid, not the seat alone — 03-app.js:7920 (redesigned) */
  const cp = roleOf(state.PEOPLE, state.WHO) === "cp";
  const ir = isIR(state.ROLE) || cp; /* see crossOwnerRequests: `IR` in domain/people.ts */
  const units = addUnits(d);
  const dupe = dupeOf(state.LEADS, d.ADDPH);
  const toLeads = canReach(state, "leads");
  const dupeOpen = !!dupe && toLeads && openable(state).some((x) => x.id === dupe.id);
  const flag = dupe ? state.ui.ADDFLAG?.[dupe.id] : null;
  const mgr = mgrOf(state.PEOPLE, state.WHO)
    ?? Object.keys(state.PEOPLE).find((k) => state.PEOPLE[k]?.on && isMgr(state.PEOPLE, k)) ?? null;
  const done = state.ui.ADDDONE ?? null;

  const conVal = (Object.keys(d.ADDCON) as (keyof AddCon)[])
    .filter((k) => d.ADDCON[k])
    .map((k) => KINDS[k])
    .join(", ") + (conOK(d) && d.ADDHOW ? " · " + CONHOW[d.ADDHOW]!.toLowerCase() : "");

  const flagDupe = (id: LeadId) => dispatch({ type: "flagDupe", id });
  const doAdd = async () => {
    const args = addArgsOf(d, units, own);
    if (!live) { void add(args); return; }
    /* one key per distinct form: pressing again after a dropped reply replays the first press; a corrected form is a new press */
    const sig = JSON.stringify(args);
    if (!press.current || press.current.sig !== sig) press.current = { sig, key: newIdempotencyKey() };
    setSaving(true);
    setAddErr(null);
    const r = await add(args, { idempotencyKey: press.current.key });
    setSaving(false);
    if (!r.ok) { setAddErr(r.error); return; }
    press.current = null;
    /* the form is cleared exactly as the reducer clears it; the note has no live home yet (capture writes the lead only) */
    setLostNote(d.ADDNOTE.trim() || null);
    dispatch({ type: "setUi", patch: { ...ADD0, ADDSEEN: {}, ADDDONE: { id: r.data.leadId as LeadId, n: d.ADDN.trim(), own: r.data.ownerId as PersonKey | null } } });
    reloadData();
  };
  /* go('lead', id) — closes the drawer, remembers where it was opened from, opens the lead page */
  const openLead = (id: LeadId) => {
    const onLead = typeof window !== "undefined" && window.location.pathname.startsWith("/leads/");
    const from = onLead ? state.ui.FROM || "leads" : state.VIEW;
    dispatch({ type: "go", v: "leads", id });
    dispatch({ type: "setUi", patch: { FROM: from } });
    router.push(pathOf("lead", id));
  };
  const toggleCon = (k: keyof AddCon) => dispatch({ type: "setCon", k });

  /* addGo(f,id) — 03-app.js:7880 (redesigned). Opening the fold is half of taking somebody to the
     answer they are missing; the control is focused once the fold it lives in has drawn. Sets
     ADDF directly (never toggles it off) — a gap chip always opens its fold, unlike the summary
     click that toggles it shut. */
  const goTo = (f: string, id: string) => {
    set({ ADDF: f });
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  return (
    <>
      {!bare && (
        <div className="ph">
          <h1>Add lead</h1>
          <div className="sp" />
          {done && !d.ADDN.trim() && !d.ADDPH.trim()
            ? <span className="tag go"><span className="dot" />{done.n.split(" ")[0]} added</span>
            : ok
              ? <span className="tag go"><span className="dot" />ready</span>
              : <span className="tag late"><span className="dot" />{gaps.length} still to answer</span>}
        </div>
      )}

      <div className="secw">
        {done && (
          <div className="note" style={{ margin: "0 0 12px" }}>
            <b>{done.n}</b> was added{done.own ? <> — {P(state.PEOPLE, done.own).n} carries it</> : " and joined the unassigned queue"}.
            {live && lostNote ? (
              <p className="sm" style={{ margin: "8px 0 0" }}>
                Your note was not saved with the lead — add it from the lead page: <i>{lostNote}</i>
              </p>
            ) : null}
            <div className="chips" style={{ marginTop: 9 }}>
              <Chip on onClick={() => { set({ ADDDONE: null }); setLostNote(null); }}>Add another name</Chip>
              {toLeads && openable(state).some((x) => x.id === done.id)
                ? <Chip onClick={() => openLead(done.id)}>Open {done.n.split(" ")[0]}</Chip>
                : null}
            </div>
          </div>
        )}

        <Sec k="who" t="The person">
          <div className="frow">
            <Field label="Full name">
              <input className="inp" id="an" value={d.ADDN} placeholder="Anjali Deshmukh"
                onChange={(e) => set({ ADDN: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <input className="inp mono" id="aph" value={d.ADDPH} placeholder="+91 98861 40277"
                onChange={(e) => set({ ADDPH: e.target.value })}
                onFocus={() => setFocused("aph")}
                onBlur={() => { setFocused((f) => (f === "aph" ? null : f)); markSeen("ph"); }} />
            </Field>
            <Field label="Email " hint="optional">
              <input className="inp mono" id="aem" value={d.ADDEM} placeholder="anjali@example.com"
                onChange={(e) => set({ ADDEM: e.target.value })}
                onFocus={() => setFocused("aem")}
                onBlur={() => { setFocused((f) => (f === "aem" ? null : f)); markSeen("em"); }} />
            </Field>
            <Field label="City · optional">
              <input className="inp" id="acity" value={d.ADDCITY} placeholder="Not known yet"
                onChange={(e) => set({ ADDCITY: e.target.value })} />
            </Field>
          </div>
          {d.ADDPH && !phOK(d) && bad("ph", "aph")
            ? (
              <p className="sm" style={{ margin: "8px 0 0", color: "var(--late)" }}>
                Use ten Indian mobile digits, or + and the country code for an international number.
              </p>
            )
            : live
              ? (
                hint.state === "ok" && hint.answer.status !== "none"
                  ? (
                    <div className="note bad" style={{ margin: "8px 0 0" }}>
                      <b>{hint.answer.firstName || "A lead"}</b>{" "}
                      {hint.answer.status === "own" ? "is already in your book with this number" : "already has this number, in a book you can see"}
                      . Duplicates are refused, never merged.
                      {toLeads
                        ? (
                          <div className="chips" style={{ marginTop: 7 }}>
                            <Chip onClick={() => hint.answer.status !== "none" && openLead(hint.answer.leadId as LeadId)}>
                              Open {(hint.answer.firstName || "the lead")}
                            </Chip>
                          </div>
                        )
                        : null}
                    </div>
                  )
                  : hint.state === "ok" ? <p className="sm g2-ok" style={{ margin: "8px 0 0" }}>No existing record with this number in your book.</p>
                    : hint.state === "error" ? <p className="sm" style={{ margin: "8px 0 0" }}>Could not check this number just now. Saving checks it again, and Zoho refuses a duplicate.</p>
                      : <p className="sm" style={{ margin: "8px 0 0" }}>Checking the number…</p>
              )
            : dupe
              ? (
                <div className="note bad" style={{ margin: "8px 0 0" }}>
                  {dupeOpen
                    ? <><b>{dupe.n}</b> already has this number{dupe.own ? " — " + P(state.PEOPLE, dupe.own).n + " carries it" : " and is waiting for an owner"}. Duplicates are refused, never merged.</>
                    : "This number is already on the book, in a record you cannot open. Duplicates are refused, never merged."}
                  {dupeOpen
                    ? (
                      <div className="chips" style={{ marginTop: 7 }}>
                        <Chip onClick={() => openLead(dupe.id)}>Open {dupe.n.split(" ")[0]}</Chip>
                      </div>
                    )
                    : flag
                      ? (
                        <div className="sm" style={{ marginTop: 6 }}>
                          Flagged to <b>{P(state.PEOPLE, flag.to).n}</b> <span className="mono">{flag.at}</span>. Carry on with the next name.
                        </div>
                      )
                      : mgr
                        ? (
                          <div className="chips" style={{ marginTop: 7 }}>
                            <Chip onClick={() => flagDupe(dupe.id)}>Flag the duplicate to {P(state.PEOPLE, mgr).n.split(" ")[0]}</Chip>
                          </div>
                        )
                        : <div className="sm" style={{ marginTop: 6 }}>Tell whoever carries the book.</div>}
                </div>
              )
              : phOK(d) ? <p className="sm g2-ok" style={{ margin: "8px 0 0" }}>No existing record with this number.</p> : null}
          {!emOK(d) && bad("em", "aem") && (
            <p className="sm" style={{ margin: "4px 0 0", color: "var(--late)" }}>That address will not send.</p>
          )}
        </Sec>

        <Sec k="src" t="Where it came from">
          <div className="frow">
            <Field label="Source">
              <select className="selw" id="asrc" value={d.ADDSRC ?? ""}
                onChange={(e) => set({
                  ADDSRC: (e.target.value || null) as Source | null, ADDEV: null, ADDBY: null,
                })}>
                <option value="">Choose one…</option>
                {(cp ? (["Channel partner"] as const) : SOURCES).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            {d.ADDSRC === "Events"
              ? (
                <Field label="Which event">
                  <select className="selw" id="aev" value={d.ADDEV ?? ""}
                    onChange={(e) => set({ ADDEV: (e.target.value || null) as EventId | null })}>
                    <option value="">Choose the event…</option>
                    {(events.state === "ok" ? events.data.completed : []).map((e) => (
                      <option key={e.id} value={e.id}>{e.name} — {eventDates(e, state.NOW.getFullYear())}</option>
                    ))}
                  </select>
                </Field>
              )
              : d.ADDSRC === "Channel partner"
                ? (
                  <Field label="Channel partner">
                    <select className="selw" id="aby" value={d.ADDCP ?? ""} disabled={cp}
                      onChange={(e) => set({ ADDCP: e.target.value || null })}>
                      <option value="">Partner not recorded</option>
                      {channelPartners(state).map((k) => <option key={k} value={k}>{P(state.PEOPLE, k).n}</option>)}
                    </select>
                  </Field>
                )
                : d.ADDSRC && SRCNEEDS[d.ADDSRC] === "person"
                  ? (
                    <Field label="Who introduced them">
                      <select className="selw" id="aby" value={d.ADDBY ?? ""}
                        onChange={(e) => set({ ADDBY: e.target.value || null })}>
                        <option value="">Not said</option>
                        {addIntroducers(state).map((k) => <option key={k} value={k}>{P(state.PEOPLE, k).n}</option>)}
                        <option value="ext">Somebody outside ARL</option>
                      </select>
                    </Field>
                  )
                  : null}
          </div>
        </Sec>

        {ir
          ? null
          : (
            <Sec k="owner" t="Who carries it">
              <Field label="Owner" style={{ maxWidth: "340px" }}>
                <select className="selw" id="aown" value={d.ADDOWN}
                  onChange={(e) => set({ ADDOWN: e.target.value })}>
                  <option value="">Leave unassigned</option>
                  {assignees(state).map((k) => (
                    <option key={k} value={k}>
                      {P(state.PEOPLE, k).n} — {state.LEADS.filter((l) => l.own === k && active(l)).length} active
                    </option>
                  ))}
                </select>
              </Field>
              {d.ADDOWN ? null : <p className="sm" style={{ margin: "8px 0 0" }}>Left unassigned, it waits on Leads for an owner.</p>}
            </Sec>
          )}

        <Fld
          k="want" t="Investment intent · optional"
          val={units ? `${units} unit${units === 1 ? "" : "s"} · ${money(units * UNIT)}` : "Not known yet"}
          open={d.ADDF === "want"} onToggle={() => dispatch({ type: "setAddF", k: "want" })}
        >
          <div className="frow">
            <Field label="Units">
              <select className="selw" id="au" value={d.ADDU}
                onChange={(e) => set({ ADDU: e.target.value })}>
                <option value="">Not known yet</option>
                {UNITS.map((u) => (
                  <option key={u} value={u}>{u} unit{u > 1 ? "s" : ""} · {money(u * UNIT)}</option>
                ))}
                <option value="custom">More than ten…</option>
              </select>
            </Field>
            {d.ADDU === "custom" && (
              <Field label="How many">
                <input className="inp mono" id="ac" type="number" min={11} step={1}
                  placeholder="11 or more" value={d.ADDC}
                  onChange={(e) => set({ ADDC: e.target.value })} />
              </Field>
            )}
          </div>
          <label className="fi" style={{ marginTop: 9 }}>
            <span>Anything they said</span>
            <textarea className="nta" id="anote" rows={2}
              placeholder="Wants the block walked before he commits." value={d.ADDNOTE}
              onChange={(e) => set({ ADDNOTE: e.target.value })} />
          </label>
          {d.ADDU === "custom" && !customOK(d) ? <p className="sm" style={{ margin: "8px 0 0", color: "var(--late)" }}>Whole units, eleven or more.</p> : null}
        </Fld>

        <Fld
          k="consent" t="Contact permission · optional at capture"
          val={conVal || "Not recorded · contact blocked"}
          open={d.ADDF === "consent"} onToggle={() => dispatch({ type: "setAddF", k: "consent" })}
        >
          <div className="chips">
            {CONCH.map(([k, t]) => (
              <button
                key={k} type="button" className={`tgl ${d.ADDCON[k] ? "on" : ""}`}
                id={`acon-${k}`} aria-pressed={!!d.ADDCON[k]} onClick={() => toggleCon(k)}
              >
                {d.ADDCON[k] ? "✓" : ""} {t}
              </button>
            ))}
          </div>
          {conOK(d) ? (
            <label className="fi" style={{ marginTop: 11, maxWidth: 340 }}>
              <span>How it was given</span>
              <select className="selw" id="ahow" value={d.ADDHOW ?? ""}
                onChange={(e) => set({ ADDHOW: e.target.value || null })}>
                <option value="">Not said</option>
                {Object.keys(CONHOW).map((k) => <option key={k} value={k}>{CONHOW[k]}</option>)}
              </select>
            </label>
          ) : null}
        </Fld>

        <AddBulk open={d.ADDF === "bulk"} onToggle={() => dispatch({ type: "setAddF", k: "bulk" })} />

        <div className="card"><div className="cb">
          {!cap
            ? (
              <p className="sm" style={{ margin: "0 0 10px" }}>
                Your seat cannot add leads. Pass the name to {mgrOf(state.PEOPLE, state.WHO) ? P(state.PEOPLE, mgrOf(state.PEOPLE, state.WHO)!).n : "an IR"}.
              </p>
            )
            : ok
              ? <p className="sm" style={{ margin: "0 0 10px" }}>Ready — saving creates the record.</p>
              : (
                <p className="sm" style={{ margin: "0 0 10px" }}>
                  Still to answer:{" "}
                  {gaps.map(([f, t, id], i) => (
                    <span key={f + t}>
                      {i ? " " : ""}
                      <Chip style={{ padding: "2px 8px", fontSize: "var(--text-small)" }} onClick={() => goTo(f, id)}>{t}</Chip>
                    </span>
                  ))}
                </p>
              )}
          <button type="button" className="act" style={{ width: "100%", textAlign: "center", padding: "13px" }}
            disabled={!(cap && ok) || saving} onClick={() => void doAdd()}>
            {saving
              ? "Adding…"
              : <>Add {d.ADDN.trim() ? d.ADDN.trim().split(/\s+/)[0] : "lead"}
                {own ? " · " + P(state.PEOPLE, own).n.split(" ")[0] + " carries it" : ""}</>}
          </button>
          {addErr ? <p className="ux-date-error" role="alert" style={{ margin: "9px 0 0" }}>{addErr}</p> : null}
        </div></div>
      </div>
    </>
  );
}
