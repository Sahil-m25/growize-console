/* ── features/add/reducer.ts — the writes behind Add, Events, Updates and Activity ───────────
   Ports `ref/03-app.js` (redesigned) 927–933 (`addEvent`), 1222–1224 (`log`), 7823–7836
   (`flagDupe`), 7898–7921 (`putLead`, `addLead`), 8071–8095 (`csvImport`) and 3552–3583
   (`loadSheet`). `markRead` (3383) now lives in `src/lib/store.tsx`'s own switch — see the note
   at the end of this file.

   `src/lib/store.tsx` belongs to the shell, so these cases cannot live in its `switch`. Instead
   this is one function with the same signature the reducer's default branch wants. It returns the
   new state for the actions the store declares as `TODO(pages-b)` and `null` for everything else.

   THE RULE THESE WRITES EXIST FOR: a lead created here — by hand or by the file — must be
   indistinguishable from a fixture lead to every selector. Same shape, same stamp, same `at[0]`,
   the source recorded at the point of capture, and consent recorded per channel.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { ASSIGNRULE, SRCNEEDS } from "@/domain";
import type {
  ActKind, Channel, EventId, EventRec, Lead, LeadId, LogEntry, Note, PersonKey, Source,
} from "@/domain";
import { iso, nowT, stamp } from "@/lib/format";
import { canOperateLeads, isMgr, may, mgrOf, P, tempOn } from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";
import { csvGood, dealTo, evIRs, splitNames } from "./csv";
import type { CsvRow } from "./csv";
import {
  ADD0, addDraft, addGaps, addUnits, addWho, CONHOW, conOK, dupeOf, last10, nextLeadId,
} from "./state";
import type { AddFlag } from "./state";

/* ---- log() — 03-app.js:1222 -----------------------------------------------------------------
   Everything written while a grant is switched on carries the grant, not only the writes that
   happen to be on the borrowed page. */
function logged(
  state: ConsoleState,
  what: string,
  lead: LeadId | null,
  note: string,
  kind: ActKind,
  at: string,
): Pick<ConsoleState, "LOG" | "TEMP"> {
  const g = tempOn(state);
  const row: LogEntry = {
    d: iso(state.TODAY), at, who: state.WHO, what, lead, note: note || "",
    kind: kind || "admin", temp: g ? g.id : null,
  };
  return {
    LOG: [row, ...state.LOG],
    TEMP: g ? state.TEMP.map(x => (x.id === g.id ? { ...x, acts: (x.acts || 0) + 1 } : x)) : state.TEMP,
  };
}

/* the one writer for a new name, whether typed or lifted off a row — the record, the note if the
   capture carried one, and the log line, in that order. `putLead()`, 03-app.js:7891-7920
   (redesigned). Consent keeps its own provenance — which channels, how it was given, when and by
   whose hand — the same as the prototype's row. */
function putLead(
  state: ConsoleState,
  spec: {
    n: string; ph: string; em: string; city: string; own: PersonKey | null; src: Source;
    ev: EventId | null; channelPartnerId: PersonKey | null; introducedBy: string | null;
    units: number; consent: boolean; con: Partial<Record<Channel, boolean>>; how: string | null;
    at: string;
  },
): { lead: Lead; NOTES: ConsoleState["NOTES"] } | null {
  if (!may(state, "add", "capture")) return null;
  const id = nextLeadId(state.LEADS);
  const lead: Lead = {
    id, n: spec.n, ph: spec.ph, em: spec.em, city: spec.city,
    own: spec.own, sec: null, src: spec.src, ev: spec.ev,
    channelPartnerId: spec.channelPartnerId, introducedBy: spec.introducedBy, by: state.WHO,
    units: spec.units, unitsKnown: !!spec.units, done: 1, at: [spec.at], late: 0, nx: null, fc: null,
    touch: { msg: [], email: [], call: [], visit: [] }, consent: spec.consent, con: spec.con, nri: false,
    conHow: spec.how, conAt: spec.consent ? spec.at : null, conBy: spec.consent ? state.WHO : null,
  };
  return { lead, NOTES: state.NOTES };
}

export function pagesBReducer(state: ConsoleState, a: Action): ConsoleState | null {
  switch (a.type) {
    /* setAddF(k) — 03-app.js:7910 (redesigned, ex-3188). One question open at a time; clicking
       the open one shuts it. `who`/`src`/`owner` no longer fold (see AddPage), so in practice this
       now only ever toggles `want`, `consent` or `bulk`. */
    case "setAddF":
      return {
        ...state,
        ui: { ...state.ui, ADDF: addDraft(state.ui).ADDF === a.k ? null : a.k },
      };

    /* setCon(k) — 03-app.js:7909. Per channel, never one checkbox. */
    case "setCon": {
      const con = addDraft(state.ui).ADDCON;
      return { ...state, ui: { ...state.ui, ADDCON: { ...con, [a.k]: !con[a.k] } } };
    }

    /* flagDupe(id) — 03-app.js:7829 (redesigned). The same idiom as an extension request or a
       payment claim: a state on the record, written to the log, answered by whoever can act on
       it. Nothing is merged and nothing is opened. */
    case "flagDupe": {
      if (!may(state, "add", "capture")) return state;
      const lead = state.LEADS.find(l => l.id === a.id);
      const to = mgrOf(state.PEOPLE, state.WHO)
        ?? Object.keys(state.PEOPLE).find(k => state.PEOPLE[k]?.on && isMgr(state.PEOPLE, k)) ?? null;
      if (!lead || !to || state.ui.ADDFLAG?.[a.id]) return state;
      const at = stamp(nowT(state.NOW));
      const flag: AddFlag = { to, at };
      return {
        ...state,
        ...logged(state, "Flagged a possible duplicate", a.id,
          "Offered again at capture by " + P(state.PEOPLE, state.WHO).n + " · held by "
          + (lead.own ? P(state.PEOPLE, lead.own).n : "nobody") + " · flagged to " + P(state.PEOPLE, to).n,
          "admin", at),
        ui: { ...state.ui, ADDFLAG: { ...state.ui.ADDFLAG, [a.id]: flag } },
      };
    }

    /* addLead() — 03-app.js:7920 (redesigned). The navigation this used to do is the page's own
       decision now — the redesign no longer opens the new record for you (PORT-GUIDE: "Opening
       the new lead is offered, never done for you"), so the write only ever sets `ADDDONE` and
       clears the draft; AddPage reads `ADDDONE` back to draw the confirmation. */
    case "addLead": {
      if (!may(state, "add", "capture")) return state;
      const d = addDraft(state.ui, state);
      if (addGaps(state, d).length) return state;
      if (dupeOf(state.LEADS, d.ADDPH)) return state; /* checked again here, not only in the form */

      const own = addWho(state, d), at = stamp(nowT(state.NOW));
      const built = putLead(state, {
        n: d.ADDN.trim(), ph: d.ADDPH.trim(), em: d.ADDEM.trim(), city: d.ADDCITY.trim(), own,
        src: d.ADDSRC as Source, ev: d.ADDSRC === "Events" ? d.ADDEV : null,
        channelPartnerId: d.ADDSRC === "Channel partner" ? d.ADDCP : null,
        introducedBy: d.ADDSRC !== "Channel partner" && d.ADDSRC && SRCNEEDS[d.ADDSRC] === "person"
          ? d.ADDBY : null,
        units: addUnits(d), consent: conOK(d), con: { ...d.ADDCON }, how: d.ADDHOW, at,
      });
      if (!built) return state;
      const { lead } = built;
      const NOTES = d.ADDNOTE.trim()
        ? { ...state.NOTES, [lead.id]: [{ who: state.WHO, at, d: iso(state.TODAY), t: d.ADDNOTE.trim() }] as Note[] }
        : state.NOTES;

      return {
        ...state,
        LEADS: [lead, ...state.LEADS],
        NOTES,
        ...logged(state, "Added lead", lead.id,
          (own ? "owner " + P(state.PEOPLE, own).n : "Left unassigned") + " · "
          + (lead.consent
            ? "consent " + (d.ADDHOW && CONHOW[d.ADDHOW] ? CONHOW[d.ADDHOW].toLowerCase() : "— how it was given was not said")
            : "no consent recorded — outbound stays blocked"),
          "admin", at),
        /* the form is cleared, so it has to be repainted first — 03-app.js:7921. `ADDFLAG` rides
           through untouched: a duplicate already offered to a manager stays offered. */
        ui: { ...state.ui, ...ADD0, ADDSEEN: {}, ADDDONE: { id: lead.id, n: d.ADDN.trim(), own } },
      };
    }

    /* csvImport() — 03-app.js:8071 (redesigned). One press, one commit: every good row is written
       inside this one case, in the order the preview showed them, dealt round the event's own IRs
       exactly as the preview line promised. */
    case "csvImport": {
      if (!may(state, "add", "capture")) return state;
      const good = csvGood(state.ui.CSV);
      const csvEv = state.ui.CSVEV;
      if (!good.length || !csvEv) return state;
      const e = state.EVENTS.find(x => x.id === csvEv);
      if (!e) return state;
      const own = addWho(state, addDraft(state.ui, state));
      const dealt = evIRs(state, e).length > 0;
      const to = (i: number): PersonKey | null => (dealt ? dealTo(state, e, i) : own);
      const at = stamp(nowT(state.NOW));
      const file = state.ui.CSV?.file ?? "";

      let LEADS = state.LEADS;
      let NOTES = state.NOTES;
      let LOG = state.LOG;
      const assigned: { id: LeadId; owner: PersonKey }[] = [];
      good.forEach((r: CsvRow, i: number) => {
        const o = to(i);
        const built = putLead({ ...state, LEADS }, {
          n: r.n, ph: r.ph, em: r.em, city: r.city || e.city, own: o, src: "Events", ev: csvEv,
          channelPartnerId: null, introducedBy: null, units: r.units, consent: false,
          con: { msg: false, call: false, email: false, visit: false }, how: null, at,
        });
        if (!built) return;
        LEADS = [built.lead, ...LEADS];
        if (r.note) NOTES = { ...NOTES, [built.lead.id]: [{ who: state.WHO, at, d: iso(state.TODAY), t: r.note }] as Note[] };
        if (dealt && o) assigned.push({ id: built.lead.id, owner: o });
      });
      assigned.forEach(({ id, owner }) => {
        LOG = [{ d: iso(state.TODAY), at, who: state.WHO, what: "Assigned owner", lead: id, note: P(state.PEOPLE, owner).n + " carries it", kind: "admin", temp: null }, ...LOG];
      });
      LOG = [{
        d: iso(state.TODAY), at, who: state.WHO, what: "Imported a lead file", lead: null,
        note: good.length + " lead" + (good.length === 1 ? "" : "s") + " from " + file
          + " — tagged to " + e.n + ", no consent recorded"
          + (dealt ? " · " + splitNames(state, good.length, to) : ""),
        kind: "admin", temp: null,
      }, ...LOG];

      return {
        ...state, LEADS, NOTES, LOG,
        ui: { ...state.ui, CSV: null, CSVEV: null, CSVDONE: { n: good.length, ev: csvEv, file } },
      };
    }

    /* addEvent() — 03-app.js:927. EVID moves; the route itself is the page's. */
    case "addEvent": {
      if (!may(state, "events", "edit")) return state;
      const id = ("E-0" + (state.EVENTS.length + 1)) as EventId;
      const ev: EventRec = {
        id, n: "New field event", type: "Society", ch: "MyGate", date: "10–11 Oct",
        city: "Bengaluru", cost: 70000, staff: [], state: "planned", off: 0,
      };
      return {
        ...state,
        EVENTS: [ev, ...state.EVENTS],
        ...logged(state, "Added event", null, id, "admin", stamp(nowT(state.NOW))),
        EVID: id,
      };
    }

    /* loadSheet(ev) — 03-app.js:3552. One sheet, one pass, and honest about what it did not load:
       a row whose number is already on the book is refused and counted, never merged. */
    case "loadSheet": {
      if (!canOperateLeads(state)) return state;
      const sh = state.SHEET[a.ev];
      if (!sh || sh.state !== "ready") return state;
      if (!may(state, "events", "load")) return state;
      const AR = state.ui.AR ?? "roster", ARWHO = state.ui.ARWHO ?? null;
      if (AR === "one" && !ARWHO) return state;

      const e = state.EVENTS.find(x => x.id === a.ev);
      if (!e) return state;
      const roster = (e.staff || []).filter(k => canOperateLeads(state, k));
      if (AR === "one" && (!ARWHO || !canOperateLeads(state, ARWHO))) return state;
      const pick = (i: number): PersonKey | null =>
        AR === "self" ? state.WHO
          : AR === "one" ? ARWHO
            : AR === "none" ? null
              : (roster.length ? roster[i % roster.length] : null);

      const at = stamp(nowT(state.NOW));
      let skipped = 0;
      const LEADS = [...state.LEADS];
      const NOTES = { ...state.NOTES };
      for (let i = 0; i < sh.ok; i++) {
        const own = pick(i);
        const id = ("S" + a.ev.replace("E-", "") + "-" + String(i + 1).padStart(2, "0")) as LeadId;
        const phone = "+91 9" + String(400000000 + i * 7919).slice(0, 9);
        if (LEADS.some(l => l.id === id)) continue;
        /* the same rule the add form uses: one person, one lead, matched on the number and never merged */
        if (LEADS.some(l => last10(l.ph) === last10(phone))) { skipped++; continue; }
        LEADS.push({
          id, n: state.SHEETNAMES[i % state.SHEETNAMES.length] ?? "", ph: phone,
          em: "", city: e.city, own, sec: null, src: "Events", ev: a.ev as EventId, by: sh.by,
          units: 1, done: 1, at: [at], late: 0, nx: null, fc: null, nri: false,
          /* the intake form asks for WhatsApp and Call; a row without both is one the loader
             refuses, which is what the "missing a required field" count is */
          consent: true, con: { msg: true, call: true, email: false },
          touch: { msg: [], email: [], call: [], visit: [] },
        });
        if (i % 5 === 0) {
          NOTES[id] = [{ who: sh.by, at, d: iso(state.TODAY), t: state.SHEETNOTES[i % state.SHEETNOTES.length] ?? "" }];
        }
      }

      const rule = ASSIGNRULE[AR];
      return {
        ...state,
        LEADS,
        NOTES,
        SHEET: {
          ...state.SHEET,
          [a.ev]: { ...sh, state: "loaded", loadedBy: state.WHO, loadedAt: at, rule, skipped },
        },
        ...logged(state, "Loaded the event sheet", null,
          e.n + " — " + (sh.ok - skipped) + " leads"
          + (skipped ? ", " + skipped + " refused as duplicates" : "") + ", "
          + rule.toLowerCase() + (AR === "one" ? " (" + P(state.PEOPLE, ARWHO as PersonKey).n + ")" : ""),
          "admin", at),
      };
    }

    /* markRead(k) is handled directly in store.tsx's own switch, which pre-empts this reducer
       entirely — it needs the `k` parameter and NSEEN's per-person-per-group shape, neither of
       which this generic pages-b reducer has. See src/lib/store.tsx's "markRead" case. */

    default:
      return null;
  }
}
