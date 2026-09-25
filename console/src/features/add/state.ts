/* ── features/add/state.ts — the Add form's draft, and the rules that gate it ────────────────
   Ports `ref/03-app.js` (redesigned) 7817–7859 (`CONHOW`, `clearCapture`, `phoneOK`, `emailOK`,
   `phoneKey`, `phOK`, `emOK`, `conOK`, `addWho`, `dupeOf`), 7862–7883 (`addGaps`), 7823–7836
   (`adMgr`, `flagDupe`'s gate), 3135–3152 (`UNITS`, `SOURCES`, `SRCNEEDS`), 1324–1325 (`ADDU`/
   `ADDC`, `customOK`), 7974–7976 (`CSV`/`CSVEV`/`CSVDONE`).

   The prototype kept the half-typed form as module-level `let`s, split across two objects: the
   fields themselves (`ADDN`…`ADDCON`) and `ADRAFT` — `{done, seen, how, flag}` — the capture
   door's own small bits of session memory that a fresh draft does NOT all reset the same way:
   `seen` and `how` go back to nothing on every new name, `done` is set BY the write itself, and
   `flag` outlives every draft in the tab, because a duplicate offered to a manager stays offered
   after the next name is typed. Here they ride in the store's `ui` bag under their own names.

   Nothing in this file writes. `addGaps()` is the whole of the save gate and it is a pure function
   of the draft plus the book: the form never fails silently, it names what is still missing.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { EventId, Lead, LeadId, PersonKey, Source } from "@/domain";
import { SRCNEEDS } from "@/domain";
import { isIR, roleOf } from "@/lib/selectors";
import type { Ctx } from "@/lib/selectors";
import type { UiState } from "@/lib/store";
import { dupeOf as csvDupeOf, emailOK, phoneOK } from "./csv";
import type { CsvState } from "./csv";

/* `Lead` (owned by the domain agent) has no field yet for who introduced a name or for consent's
   own provenance — see crossOwnerRequests: add `introducedBy`, `conHow`, `conAt`, `conBy` and
   `unitsKnown` to `Lead` in src/domain/types.ts directly, the way every other field on the row
   lives there, and delete this augmentation once that lands. Declaration merging (the same idiom
   already used below for `UiState`, which belongs to the shell) lets `putLead` (./reducer.ts) set
   them today without touching a file this agent does not own. 03-app.js:7891-7896 (redesigned). */
declare module "@/domain/types" {
  interface Lead {
    introducedBy?: PersonKey | null;
    conHow?: string | null;
    conAt?: string | null;
    conBy?: PersonKey | null;
    unitsKnown?: boolean;
  }
}

/* the four channels consent is asked for, one at a time — 03-app.js:7817 (redesigned) added
   "visit" to the three the port already had, and `Channel` in `src/domain/types.ts` now carries
   it too. The store's `Action` union still types `setCon`'s `k` as the old three (see AddPage's
   `toggleCon` and crossOwnerRequests). */
export type AddCon = { msg: boolean; call: boolean; email: boolean; visit: boolean };
const TOUCHCHANNELS: readonly (keyof AddCon)[] = ["msg", "email", "call", "visit"];

/* "Three ticks say which channels are allowed. This says where the person gave them." 7816 */
export const CONHOW: Record<string, string> = {
  person: "In person", call: "On a call", msg: "In a WhatsApp reply",
  form: "On a web form", event: "On the event sheet",
};

/* who a duplicate outside your own book gets flagged to, and what capture leaves behind once it
   is offered — a state on the record, not a merge and not an open. 03-app.js:7833 (redesigned) */
export type AddFlag = { to: PersonKey; at: string };

/* ---- the draft, in the ui bag under the prototype's names ---------------------------------- */
declare module "@/lib/store" {
  interface UiState {
    /* 03-app.js:3164 / 7838 (redesigned) */
    ADDN?: string;
    ADDPH?: string;
    ADDEM?: string;
    ADDCITY?: string;
    ADDOWN?: string;
    ADDNOTE?: string;
    ADDCON?: AddCon;
    /** which fold is open — one at a time. 03-app.js:3166 */
    ADDF?: string | null;
    /** units: a pick, or a typed custom count. 03-app.js:1324 */
    ADDU?: string;
    ADDC?: string;
    /** the add form's source, its event, its introducer. 03-app.js:449 */
    ADDSRC?: Source | null;
    ADDEV?: EventId | null;
    ADDBY?: string | null;
    ADDCP?: PersonKey | null;
    /** ADRAFT.how — how permission was given. Reset with every new draft. */
    ADDHOW?: string | null;
    /** ADRAFT.seen — which fields have been left once, so an error shows after the blur that
     *  found it, never while the caret is still there. Reset with every new draft. */
    ADDSEEN?: Record<string, boolean>;
    /** ADRAFT.done — set by addLead itself once it writes, not by the draft being edited. What
     *  the confirmation note reads, and what "Open <name>" opens. */
    ADDDONE?: { id: LeadId; n: string; own: PersonKey | null } | null;
    /** ADRAFT.flag — a duplicate already offered to a manager. Outlives every draft in the tab,
     *  keyed by the lead it was raised against. */
    ADDFLAG?: Record<LeadId, AddFlag>;
    /** the file read for a bulk import, the event every row will be tagged to, and what the last
     *  import wrote — said in the page, never in a browser box. 03-app.js:7974 (redesigned) */
    CSV?: CsvState | null;
    CSVEV?: EventId | null;
    CSVDONE?: { n: number; ev: EventId; file: string } | null;
    /** which Updates group is expanded — collapsed by default. 03-app.js:1343 */
    NOPEN?: string | null;
    /** the event sheet's assignment rule, and who it hands them to. 03-app.js:3541 */
    AR?: string;
    ARWHO?: PersonKey | null;
    /** Activity: whose, which day, which month, which table. 03-app.js:936, 938 */
    ACTWHO?: PersonKey | null;
    ACTDAY?: string | null;
    ACTM?: Date;
    ACTTAB?: string;
  }
}

export type AddDraft = {
  ADDN: string; ADDPH: string; ADDEM: string; ADDCITY: string; ADDOWN: string; ADDNOTE: string;
  ADDCON: AddCon; ADDF: string | null; ADDU: string; ADDC: string;
  ADDSRC: Source | null; ADDEV: EventId | null; ADDBY: string | null; ADDCP: PersonKey | null;
  ADDHOW: string | null;
};

/* the form as it opens, and as `addLead` leaves it — `clearCapture()`, 03-app.js:7898
   (redesigned). `ADDFLAG` is deliberately absent: a new draft clears the name, not the offer a
   past duplicate already made to a manager. */
export const ADD0: AddDraft = {
  ADDN: "", ADDPH: "", ADDEM: "", ADDCITY: "", ADDOWN: "", ADDNOTE: "",
  ADDCON: { msg: false, call: false, email: false, visit: false },
  ADDF: "who", ADDU: "", ADDC: "",
  ADDSRC: null, ADDEV: null, ADDBY: null, ADDCP: null, ADDHOW: null,
};

export const addDraft = (ui: UiState, ctx?: Ctx): AddDraft => ({
  ADDN: ui.ADDN ?? ADD0.ADDN,
  ADDPH: ui.ADDPH ?? ADD0.ADDPH,
  ADDEM: ui.ADDEM ?? ADD0.ADDEM,
  ADDCITY: ui.ADDCITY ?? ADD0.ADDCITY,
  ADDOWN: ui.ADDOWN ?? ADD0.ADDOWN,
  ADDNOTE: ui.ADDNOTE ?? ADD0.ADDNOTE,
  ADDCON: ui.ADDCON ?? ADD0.ADDCON,
  ADDF: ui.ADDF === undefined ? ADD0.ADDF : ui.ADDF,
  ADDU: ui.ADDU ?? ADD0.ADDU,
  ADDC: ui.ADDC ?? ADD0.ADDC,
  ADDSRC: ctx && roleOf(ctx.PEOPLE, ctx.WHO) === "cp" ? "Channel partner" : ui.ADDSRC ?? ADD0.ADDSRC,
  ADDEV: ui.ADDEV ?? ADD0.ADDEV,
  ADDBY: ui.ADDBY ?? ADD0.ADDBY,
  ADDCP: ctx && roleOf(ctx.PEOPLE, ctx.WHO) === "cp" ? ctx.WHO : ui.ADDCP ?? ADD0.ADDCP,
  ADDHOW: ui.ADDHOW === undefined ? ADD0.ADDHOW : ui.ADDHOW,
});

/* ---- the rules ------------------------------------------------------------------------------ */

/* 03-app.js:1325 */
export const customOK = (d: AddDraft): boolean =>
  Number.isInteger(Number(d.ADDC)) && Number(d.ADDC) >= 11;

/* 03-app.js:3167 */
export const addUnits = (d: AddDraft): number =>
  d.ADDU === "custom" ? (customOK(d) ? Number(d.ADDC) : 0) : Number(d.ADDU) || 0;

/* the same grammar a file's own cell is judged by. 03-app.js:7841/7849 (redesigned) */
export const phOK = (d: AddDraft): boolean => phoneOK(d.ADDPH);
export const emOK = (d: AddDraft): boolean => emailOK(d.ADDEM);
export const conOK = (d: AddDraft): boolean => TOUCHCHANNELS.some(k => d.ADDCON[k]);

/* 03-app.js:450 — a source is not enough on its own; "Events" carries a second question */
export const addSrcOK = (d: AddDraft): boolean =>
  !!d.ADDSRC && (SRCNEEDS[d.ADDSRC] !== "event" || !!d.ADDEV);

/* 03-app.js:3171 — an IR (and a Channel Partner, who is one too here — see crossOwnerRequests on
   `IR` in `src/domain/people.ts`) keeps what they add; anybody else has to say who carries it */
export const addWho = (ctx: Ctx, d: AddDraft): PersonKey | null =>
  isIR(ctx.ROLE) || roleOf(ctx.PEOPLE, ctx.WHO) === "cp" ? ctx.WHO : ((d.ADDOWN as PersonKey) || null);

/* the digits of a number, which is the only part of it that identifies anybody. 03-app.js:7856 */
export const last10 = (t: unknown): string => String(t ?? "").replace(/\D/g, "").slice(-10);

export const dupeOf = (LEADS: Lead[], t: string): Lead | null => csvDupeOf(LEADS, t);

/* "Who introduced them" — the prototype's own `everyone()`, ir-console-redesigned.html:4068
   (`role!=='mkt'?…`), not `selectors.everyone()` (`consoleAccount()`), which also excludes
   Finance. A capture screen wants "everybody who could plausibly have introduced someone",
   which is broader than "everybody who has a console screen of their own". */
export const addIntroducers = (ctx: Ctx): PersonKey[] =>
  roleOf(ctx.PEOPLE, ctx.WHO) === "cp"
    ? [ctx.WHO]
    : Object.keys(ctx.PEOPLE).filter((k) => ctx.PEOPLE[k]?.on && roleOf(ctx.PEOPLE, k) !== "mkt");

/* ---- every reason the form cannot be saved, in the order somebody would fix them.
   03-app.js:7862 (redesigned). Each gap carries the control that answers it, same as the
   prototype's `addGo(f,id)` — three of these chips name something inside a fold that is already
   open, so opening the fold is the whole of what setting it does; the id is what gets focused. */
export type AddGap = [fold: string, what: string, controlId: string];

export function addGaps(ctx: Ctx, d: AddDraft): AddGap[] {
  const g: AddGap[] = [];
  if ((d.ADDN || "").trim().length < 2) g.push(["who", "a name", "an"]);
  if (!phOK(d)) g.push(["who", "a mobile number", "aph"]);
  else if (dupeOf(ctx.LEADS, d.ADDPH)) g.push(["who", "a number that is not already on the book", "aph"]);
  if (!emOK(d)) g.push(["who", "a valid email, or none at all", "aem"]);
  if (!addSrcOK(d)) g.push(["src", d.ADDSRC ? "which event it came from" : "where it came from", d.ADDSRC === "Events" ? "aev" : "asrc"]);
  if (d.ADDU === "custom" && !customOK(d)) g.push(["want", "whole units, eleven or more", "ac"]);
  if (conOK(d) && !d.ADDHOW) g.push(["consent", "how contact permission was given", "ahow"]);
  if (d.ADDCON.email && !d.ADDEM.trim()) g.push(["who", "an email for email permission", "aem"]);
  return g;
}

/* the id the next added lead gets. 03-app.js:3195 — the first "N<n>" the book does not hold. */
export function nextLeadId(LEADS: Lead[]): LeadId {
  let n = 1;
  while (LEADS.some(l => l.id === "N" + n)) n++;
  return ("N" + n) as LeadId;
}
