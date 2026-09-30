/* ── the Add/Edit Event draft — pure, local helpers ──────────────────────────────────────────
   Ports the redesigned prototype's `EVD` draft plumbing: `evISODate`, `evDateRange`, `evDateText`,
   `evDraft`, `evGaps` (ir-console-redesigned.html ~3780–3823), and the `EVTYPES`/`EVCH` option
   lists (line 3780–3781).

   `EventRec` in this port has no separate `from`/`to` fields — only the printed `date` span — so
   `evDateRange` always parses the text, which is exactly what the prototype's own function does
   for a record that predates the calendar fields. Round-tripping through `evDateText` keeps the
   printed span's format (the en dash) byte-identical to the prototype's.

   THE SAVE THIS DRIVES: `saveEvent`/`dropEvent` (src/lib/store.tsx) read this same draft off
   `ui.EVD` and validate it with `evGaps`, so what this module gets right about the fields is what
   the write gets right too. */

import type { EventChannel, EventId, EventRec, EventState, EventType, PersonKey } from "@/domain";
import type { UiState } from "@/lib/store";

export const EVTYPES: readonly EventType[] = ["Society", "Club", "Partner"];
export const EVCH: readonly EventChannel[] = ["MyGate", "Direct", "Partner"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A `YYYY-MM-DD` string that is a real calendar date, or `null`. */
export function evISODate(value: string): Date | null {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/** The event's span as `{from,to}` ISO dates, parsed off its printed `date` text. */
/** `year` is the book's own year (state.NOW) for a date text that names none. */
export function evDateRange(dateText: string, year: number): { from: string; to: string } {
  const text = String(dateText || "").trim();
  const month = (x: string) => MONTHS.findIndex((m) => m.toLowerCase() === String(x).slice(0, 3).toLowerCase());
  const make = (y: number, m: number, d: number): string => {
    const s = String(y).padStart(4, "0") + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    return evISODate(s) ? s : "";
  };
  if (evISODate(text)) return { from: text, to: text };
  let m = /^(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const mo = month(m[3]!), y = +(m[4] || year);
    return mo < 0 ? { from: "", to: "" } : { from: make(y, mo, +m[1]!), to: make(y, mo, +(m[2] || m[1])!) };
  }
  m = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*[–—-]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/.exec(text);
  if (m) {
    const fm = month(m[2]!), tm = month(m[5]!);
    const fy = +(m[3] || m[6] || year);
    const ty = +(m[6] || (fm > tm ? fy + 1 : fy));
    return fm < 0 || tm < 0 ? { from: "", to: "" } : { from: make(fy, fm, +m[1]!), to: make(ty, tm, +m[4]!) };
  }
  return { from: "", to: "" };
}

/** The printed span for a validated `from`/`to` pair — same shape as the fixtures', en dash and all. */
export function evDateText(from: string, to: string): string {
  const f = evISODate(from), t = evISODate(to);
  if (!f || !t || f > t) return "";
  const one = (d: Date) => d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  if (from === to) return one(f);
  return f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()
    ? f.getDate() + "–" + t.getDate() + " " + MONTHS[f.getMonth()] + " " + f.getFullYear()
    : one(f) + " – " + one(t);
}

export type EventDraft = {
  id: EventId | null;
  n: string;
  type: EventType;
  ch: EventChannel;
  date: string;
  from: string;
  to: string;
  city: string;
  cost: number;
  state: EventState;
  off: number;
  staff: PersonKey[];
};

/** evDraft(e) — a blank form for "Add event", or a copy of the record for "Edit event". */
export function evDraft(e: EventRec | null, year: number): EventDraft {
  if (!e) {
    return {
      id: null, n: "", type: EVTYPES[0]!, ch: EVCH[0]!, date: "", from: "", to: "",
      city: "Bengaluru", cost: 70000, state: "planned", off: 0, staff: [],
    };
  }
  const range = evDateRange(e.date, year);
  return {
    id: e.id, n: e.n, type: e.type, ch: e.ch, date: e.date, from: range.from, to: range.to,
    city: e.city, cost: e.cost, state: e.state, off: e.off || 0, staff: e.staff.slice(),
  };
}

/** evGaps(d,e,eligibleStaff) — every reason the form is not ready to save, in the prototype's order. */
export function evGaps(d: EventDraft, existing: EventRec | null, eligibleStaff: (k: PersonKey) => boolean): string[] {
  const g: string[] = [];
  const f = evISODate(d.from), t = evISODate(d.to);
  if (String(d.n || "").trim().length < 2) g.push("event name");
  if (!f) g.push("valid start date");
  if (!t) g.push("valid end date");
  if (f && t && f > t) g.push("end date on or after start");
  if (!String(d.city || "").trim()) g.push("city");
  if (!EVTYPES.includes(d.type)) g.push("event kind");
  if (!EVCH.includes(d.ch)) g.push("event channel");
  if (!["planned", "done"].includes(d.state) || (existing?.state === "done" && d.state !== "done")) {
    g.push("valid run status");
  }
  if (!Number.isInteger(d.cost) || d.cost < 0) g.push("non-negative cost");
  if (!Number.isInteger(d.off) || d.off < 0) g.push("non-negative tablet count");
  if (
    new Set(d.staff).size !== d.staff.length
    || d.staff.some((k) => !eligibleStaff(k) && !existing?.staff.includes(k))
  ) g.push("eligible staff");
  return g;
}

/** evNextId(key) — "E-" + the zero-padded counter, the prototype's `EVKEY` scheme
    (ir-console-redesigned.html 3778-3779): `let EVKEY=EVENTS.length` then
    `"E-"+String(++EVKEY).padStart(2,"0")`. A monotonic counter, never the live event count, so
    removing an event and adding another never reissues the id a still-live record holds, and the
    id keeps padding past nine ("E-10", "E-100", ...) instead of degrading into "E-010". The
    counter itself lives in `ConsoleState.EVKEY` (seeded to `EVENTS.length`, same as the
    prototype's module global); callers pass `state.EVKEY + 1` — the pre-increment the prototype's
    `++EVKEY` performs — so `saveEvent` and `EventEditorFoot`'s read-only prediction run the exact
    same arithmetic. */
export function evNextId(key: number): EventId {
  return ("E-" + String(key).padStart(2, "0")) as EventId;
}

/** EVD, read off the ui bag — the same module-level-global-turned-ui-key idiom
    `src/features/leads/ui.ts` uses for NXD/TD. Seeded by `openDrawer`'s `seed` when the drawer
    opens (see EventsPage/EventPage); `setUi` (already generic in the store) patches it field by
    field, which is how EventEditorBody and EventEditorFoot — separate components under the
    drawer registry — read and write the one draft between them. */
export function uiEVD(ui: UiState): EventDraft {
  const v = ui.EVD as Partial<EventDraft> | undefined;
  return v ? { ...evDraft(null, 0), ...v } : evDraft(null, 0);
}

/** EVENTVIEW — the prototype's module-level global (ir-console-redesigned.html:8628), kept in the
    ui bag instead of component state so it survives navigating away and back, same as the
    prototype's own. */
export type EventsView = "upcoming" | "completed";
export const uiEventsView = (ui: UiState): EventsView => (ui.EVENTVIEW === "completed" ? "completed" : "upcoming");

/** evDraft for a record read from GET /api/events/[id] (the route's row, not the book's). */
export function evDraftOf(r: import("@/server/events/events").EventRow): EventDraft {
  const from = r.startsOn ?? "", to = r.endsOn ?? "";
  return {
    id: r.id as EventId, n: r.name, type: (r.type ?? "Society") as EventType, ch: (r.channel ?? "Direct") as EventChannel,
    date: from && to ? evDateText(from, to) : "", from, to, city: r.city ?? "", cost: r.cost ?? 0,
    state: r.state === "done" ? "done" : "planned", off: r.stats.captured ?? 0, staff: r.staff.map((s) => s.id),
  };
}

/** The dates as the event's own page heads them: the whole span with its year ("3–4 Oct 2026"). */
export const evTitleDates = (r: Pick<import("@/server/events/events").EventRow, "startsOn" | "endsOn">): string =>
  r.startsOn && r.endsOn ? evDateText(r.startsOn, r.endsOn) : "";
