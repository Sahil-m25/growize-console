/* M14-S01-W1 / S02-W1 / S03-W1 — Events (phase 2b, D104), the lead side (book = ConsoleState).
     GET    /api/events                list: Upcoming and Completed, each with what it produced
     GET    /api/events/[id]           one event: the leads the viewer may open, and a count of the rest
     POST   /api/events                add     PATCH /api/events/[id]  correct     DELETE /api/events/[id]?confirm=1  remove
                                       (without confirm the route answers 428 { taggedLeads, eventName } and writes nothing)
     GET    /api/events/[id]/sheet     the sheet's state on Lead_Events (counts, who loaded it, staff in named order, the load log)
     POST   /api/events/[id]/sheet     load the tablet sheet once ({rule, rows})
   Live: the routes, on the person's own token. Fixture: the same answers projected from the demo book (EVENTS, SHEET, LEADS),
   and a write runs the reducer action it replaces (saveEvent, dropEvent, loadSheet). The reducer reads its draft from
   state.ui.EVD / AR / ARWHO, which the drawer and the card already keep — the args below are built from the same draft. */

import type { cacheView } from "@/server/cases/http";
import type { EventLead, EventRow } from "@/server/events/events";
import type { Moved } from "@/server/events/writes";
import type { LoadSummary } from "@/server/events/loader";
import type { SheetState } from "@/server/events/sheet-state";
import type { CountBucket } from "@/lib/zoho/cache";
import type { EventRec } from "@/domain";
import { LADDER } from "@/domain";
import { canReach, evLeads, evStats, may, openable, P } from "@/lib/selectors";
import { reducer, type Action, type ConsoleState } from "@/lib/state";
import { evDateRange, evDateText, evGaps, evISODate, evNextId } from "@/features/events/eventDraft";
import { assignees } from "@/lib/selectors";
import { fail, ok, type ApiErr, type ReadEndpoint, type WriteEndpoint } from "../api";

export type LeadDispatch = (a: Action) => unknown;

export type EventList = {
  upcoming: EventRow[]; completed: EventRow[]; truncated: boolean;
  stats: ReturnType<typeof cacheView<readonly CountBucket[]>>;
};
export type EventOne = { event: EventRow; leads: EventLead[]; othersCount: number | null; truncated: boolean };
export type EventAdded = { eventId: string; name: string; startsOn: string; endsOn: string; city: string; staffIds: string[]; state: "planned" | "done" };
export type EventChanged = { eventId: string; name: string; moved: Moved[]; taggedStay: number | null; modifiedTime: string | null };
export type EventRemoved = { eventId: string; name: string; leadsUntagged: number };
export type SheetLoaded = Pick<LoadSummary, "eventId" | "rule" | "inFile" | "loaded" | "duplicates" | "refused" | "split" | "countsSaved">;

const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");
const NO_EDIT = () => fail(403, "capability-missing", "your seat cannot add or change events (it needs edit on Events)");
const GONE = () => fail(404, "not-found", "that event is gone, or not yours to open");

/* ---- one demo event as the route's EventRow ------------------------------------------------- */
const iso = (s: string): string | null => (s && evISODate(s) ? s : null);
export function fixtureEventRow(c: ConsoleState, e: EventRec): EventRow {
  const st = evStats(c, e), r = evDateRange(e.date, c.NOW.getFullYear());
  const why = st.tagged < st.captured ? "untagged" : e.cost <= 0 ? "no-cost" : st.qual === 0 ? "no-qualified" : null;
  return {
    id: e.id, name: e.n, startsOn: iso(r.from), endsOn: iso(r.to), city: e.city, type: e.type, channel: e.ch, state: e.state, cost: e.cost,
    staff: e.staff.map(k => ({ id: k, name: P(c.PEOPLE, k).n })),
    stats: { captured: st.captured, tagged: st.tagged, qualified: st.qual, reserved: st.res, paid: st.paid ?? 0, investor: st.done ?? 0,
      costPerQualified: why === null ? Math.round(e.cost / st.qual) : null, costHiddenWhy: why },
  };
}
/** The book's own record back from a row (the sheet card's split preview deals from it). */
export const eventRecOf = (r: EventRow): EventRec => ({
  id: r.id as EventRec["id"], n: r.name, type: (r.type ?? "Society") as EventRec["type"], ch: (r.channel ?? "Direct") as EventRec["ch"],
  date: r.startsOn && r.endsOn ? evDateText(r.startsOn, r.endsOn) : "", city: r.city ?? "", cost: r.cost ?? 0,
  staff: r.staff.map(s => s.id), state: r.state === "done" ? "done" : "planned", off: r.stats.captured ?? 0,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** The dates as a list prints them: the year only when it is not this year's. */
export function eventDates(r: Pick<EventRow, "startsOn" | "endsOn">, year: number): string {
  const f = r.startsOn ? evISODate(r.startsOn) : null, t = r.endsOn ? evISODate(r.endsOn) : null;
  if (!f || !t) return "";
  const full = evDateText(r.startsOn!, r.endsOn!);
  return f.getFullYear() === year && t.getFullYear() === year ? full.replace(new RegExp(`\\s${year}$`), "").replace(/ (\d{4}) –/, " –") : full;
}
export const eventMonth = (iso_: string | null): string => { const d = iso_ ? evISODate(iso_) : null; return d ? MONTHS[d.getMonth()]! : "Date"; };

const soonest = (a: EventRow, b: EventRow) => (a.startsOn ?? "9999").localeCompare(b.startsOn ?? "9999");

export const eventList: ReadEndpoint<ConsoleState, void, EventList> = {
  path: () => "/api/events",
  pick: j => j as EventList,
  fixture(c) {
    if (!canReach(c, "events")) return NO_PAGE();
    const rows = c.EVENTS.map(e => fixtureEventRow(c, e));
    return ok({
      upcoming: rows.filter(e => e.state === "planned").sort(soonest), completed: rows.filter(e => e.state === "done"),
      truncated: false, stats: { state: "fresh", value: [], asOf: 0 },
    });
  },
};

/** The capture form's event picker (M14-S03-W1): the same list, read only while the source is Events. */
export const eventPicker: ReadEndpoint<ConsoleState, boolean, EventList> = {
  path: on => (on ? "/api/events" : null),
  pick: eventList.pick,
  fixture: (c) => eventList.fixture(c, undefined),
};

/** Zoho's Lead_Status for a rung of the demo ladder. */
const statusOf = (done: number): string => LADDER[Math.max(0, done - 1)]!.t;
export const eventOne: ReadEndpoint<ConsoleState, string | null, EventOne> = {
  path: id => (id ? `/api/events/${encodeURIComponent(id)}` : null),
  pick: j => j as EventOne,
  fixture(c, id) {
    if (!canReach(c, "events")) return NO_PAGE();
    const e = c.EVENTS.find(x => x.id === id);
    if (!e) return GONE();
    const all = evLeads(c, e.id), open = openable(c);
    const named = all.filter(l => open.some(x => x.id === l.id));
    return ok({ event: fixtureEventRow(c, e), leads: named.map(l => ({ id: l.id, name: l.n, status: statusOf(l.done), ownerId: l.own, ownerName: l.own ? P(c.PEOPLE, l.own).n : null, units: l.units })), othersCount: all.length - named.length, truncated: false });
  },
};

/* ---- the draft the drawer keeps, as the route's body ---------------------------------------- */
export type EventArgs = { id: string | null; n: string; type: string; ch: string; from: string; to: string; city: string; cost: number; state: string; off: number; staff: string[] };
const bodyOf = (a: EventArgs) => ({
  name: a.n, startsOn: a.from, endsOn: a.to, city: a.city, kind: a.type, channel: a.ch, state: a.state, cost: a.cost,
  ...(a.state === "done" ? { namesTaken: a.off } : {}), staffIds: a.staff,
});
const gapsErr = (gaps: string[]): ApiErr => ({ ...fail(422, "gaps", "the event is not complete"), detail: { gaps } });

const peek = (c: ConsoleState, a: Action) => reducer(c, a);

export const eventCreate: WriteEndpoint<ConsoleState, EventArgs, EventAdded, LeadDispatch> = {
  method: "POST",
  path: () => "/api/events",
  body: bodyOf,
  pick: j => (j as { event: EventAdded }).event,
  fixture(c, d, a) {
    if (!may(c, "events", "edit")) return NO_EDIT();
    const gaps = evGaps({ ...a, id: null, type: a.type as EventRec["type"], ch: a.ch as EventRec["ch"], state: a.state as EventRec["state"], date: "", staff: a.staff }, null, k => assignees(c).includes(k));
    if (gaps.length) return gapsErr(gaps);
    const act: Action = { type: "saveEvent" };
    const ev = peek(c, act).EVENTS.find(x => !c.EVENTS.some(y => y.id === x.id));
    if (!ev) return fail(422, "refused", "the event was not added");
    d(act);
    return ok({ eventId: evNextId(c.EVKEY + 1), name: a.n.trim(), startsOn: a.from, endsOn: a.to, city: a.city.trim(), staffIds: a.staff, state: a.state === "done" ? "done" : "planned" });
  },
};

export type ChangeArgs = EventArgs & { id: string; modifiedTime: string | null };
export const eventChange: WriteEndpoint<ConsoleState, ChangeArgs, EventChanged, LeadDispatch> = {
  method: "PATCH",
  path: a => `/api/events/${encodeURIComponent(a.id)}`,
  body: a => ({ ...bodyOf(a), modifiedTime: a.modifiedTime ?? undefined }),
  pick: j => (j as { event: EventChanged }).event,
  fixture(c, d, a) {
    if (!may(c, "events", "edit")) return NO_EDIT();
    const e = c.EVENTS.find(x => x.id === a.id);
    if (!e) return GONE();
    const gaps = evGaps({ ...a, type: a.type as EventRec["type"], ch: a.ch as EventRec["ch"], state: a.state as EventRec["state"], date: "", staff: a.staff, id: e.id }, e, k => assignees(c).includes(k));
    if (gaps.length) return gapsErr(gaps);
    d({ type: "saveEvent" });
    /* what moved is named in the activity line the reducer wrote; the route answers it as fields (the page words it in live mode) */
    return ok({ eventId: e.id, name: a.n.trim(), moved: [], taggedStay: evLeads(c, e.id).length, modifiedTime: null });
  },
};

export type RemoveArgs = { id: string; confirm: boolean };
export const eventRemove: WriteEndpoint<ConsoleState, RemoveArgs, EventRemoved, LeadDispatch> = {
  method: "DELETE",
  path: a => `/api/events/${encodeURIComponent(a.id)}${a.confirm ? "?confirm=1" : ""}`,
  pick: j => (j as { removed: EventRemoved }).removed,
  fixture(c, d, a) {
    if (!may(c, "events", "edit")) return NO_EDIT();
    const e = c.EVENTS.find(x => x.id === a.id);
    if (!e) return GONE();
    const n = evLeads(c, e.id).length;
    if (!a.confirm) return { ...fail(428, "confirm-needed", "removing an event is confirmed on the page first"), detail: { taggedLeads: n, eventName: e.n } };
    d({ type: "dropEvent", id: e.id });
    return ok({ eventId: e.id, name: e.n, leadsUntagged: n });
  },
};

/** The 428's numbers, for the in-page confirmation. */
export const askedOf = (e: ApiErr): { taggedLeads: number; eventName: string } | null => {
  const d = e.detail;
  return e.status === 428 && d && typeof d.taggedLeads === "number" && typeof d.eventName === "string" ? { taggedLeads: d.taggedLeads, eventName: d.eventName } : null;
};

/** A "Changed the event" line's note, worded from the route's answer (what moved, and how many leads stay tagged). */
export function changedNote(name: string, moved: readonly Moved[], taggedStay: number | null, nameOf: (id: string) => string): string {
  const rs = (v: unknown) => "₹" + Number(v ?? 0).toLocaleString("en-IN");
  const line = moved.map(m => {
    switch (m.field) {
      case "name": return `name: ${m.from} → ${m.to}`;
      case "kind": return `kind: ${m.from} → ${m.to}`;
      case "channel": return `channel: ${m.from} → ${m.to}`;
      case "dates": { const [f1, t1] = String(m.from).split("/"), [f2, t2] = String(m.to).split("/");
        return `dates: ${f1 && t1 ? evDateText(f1, t1) : "—"} → ${evDateText(f2 ?? "", t2 ?? "")}`; }
      case "city": return `city: ${m.from} → ${m.to}`;
      case "cost": return `cost: ${rs(m.from)} → ${rs(m.to)}`;
      case "staff": { const to = (m.to as readonly string[]) ?? []; return "working it: " + (to.length ? to.map(k => nameOf(k).split(" ")[0]).join(", ") : "nobody"); }
      case "state": return "it has run";
      case "namesTaken": return `names taken on the night: ${m.from} → ${m.to}`;
    }
  });
  return name + " — " + (line.length ? line.join(" · ") : "nothing moved")
    + (taggedStay ? ` · ${taggedStay} lead${taggedStay === 1 ? "" : "s"} stay tagged to it` : "");
}

/* ---- the sheet card ------------------------------------------------------------------------- */
export type SheetRule = { kind: "round-robin" } | { kind: "me" } | { kind: "unassigned" } | { kind: "one"; ownerId: string | null };
export type SheetIntake = { name: string; mobile: string; email?: string; city?: string; units?: number; consent: { msg: boolean; call: boolean; email?: boolean } };
export type SheetArgs = { eventId: string; rule: SheetRule; rows: SheetIntake[] };
const RULE_OF: Record<string, SheetRule["kind"]> = { roster: "round-robin", self: "me", one: "one", none: "unassigned" };
/** The card's rule select (a key of ASSIGNRULE) as the route's rule. */
export const ruleOf = (ar: string, who: string | null): SheetRule => {
  const kind = RULE_OF[ar] ?? "round-robin";
  return kind === "one" ? { kind, ownerId: who } : { kind } as SheetRule;
};

/* The card's state. Live: GET /api/events/[id]/sheet. Fixture: the demo book's SheetRec and the load lines the reducer wrote.
   PROVISIONAL (live): willLoad, filledBy/At and rule are null — Lead_Events needs Sheet_Rows, Sheet_Filled_By/At and Load_Rule. */
export type SheetView = Pick<SheetState, "eventId" | "state" | "inFile" | "willLoad" | "duplicates" | "refused" | "loaded" | "filledBy" | "filledAt"
  | "loadedBy" | "loadedAt" | "rule" | "mayLoad"> & { staff: SheetState["staff"][number][]; log: SheetState["log"][number][] };

export const sheetState: ReadEndpoint<ConsoleState, string | null, SheetView> = {
  path: id => (id ? `/api/events/${encodeURIComponent(id)}/sheet` : null),
  pick: j => { const o = (j as { sheet: SheetState }).sheet; return { ...o, staff: [...o.staff], log: [...o.log] }; },
  fixture(c, id) {
    if (!canReach(c, "events")) return NO_PAGE();
    const e = c.EVENTS.find(x => x.id === id);
    if (!e) return GONE();
    const sh = c.SHEET[e.id];
    const who = (k: string) => ({ id: k, name: P(c.PEOPLE, k).n });
    const state = !sh ? "none" : sh.state;
    const done = sh?.state === "loaded";
    return ok({
      eventId: e.id, state,
      inFile: sh ? sh.rows : null, willLoad: sh && !done ? sh.ok : null, duplicates: sh ? sh.dupe : null, refused: sh ? sh.bad : null,
      loaded: done ? sh.ok : null, filledBy: sh ? who(sh.by) : null, filledAt: sh ? sh.at : null,
      loadedBy: done && sh.loadedBy ? who(sh.loadedBy) : null, loadedAt: done ? sh.loadedAt ?? null : null, rule: done ? sh.rule ?? null : null,
      staff: e.staff.map(who), mayLoad: may(c, "events", "load"),
      log: c.LOG.filter(l => l.what === "Loaded the event sheet" && l.note.startsWith(e.n + " — ")).map(l => ({ at: l.at, what: l.what, by: who(l.who), note: l.note })),
    });
  },
};

export const sheetLoad: WriteEndpoint<ConsoleState, SheetArgs, SheetLoaded, LeadDispatch> = {
  method: "POST",
  path: a => `/api/events/${encodeURIComponent(a.eventId)}/sheet`,
  body: a => ({ rule: a.rule, rows: a.rows }),
  pick: j => (j as { load: SheetLoaded }).load,
  fixture(c, d, a) {
    if (!may(c, "events", "load")) return fail(403, "capability-missing", "Your seat does not load event sheets; the IR team or Marketing do.");
    const sh = c.SHEET[a.eventId];
    if (!c.EVENTS.some(e => e.id === a.eventId) || !sh) return GONE();
    if (sh.state !== "ready") return fail(409, "already-loaded", "A sheet loads once.");
    if (a.rule.kind === "one" && !a.rule.ownerId) return fail(422, "owner-missing", "Choose who carries the new leads first.");
    const act: Action = { type: "loadSheet", ev: a.eventId };
    const n = peek(c, act);
    const loaded = n.LEADS.filter(l => !c.LEADS.some(x => x.id === l.id));
    if (!loaded.length && n === c) return fail(422, "refused", "Nothing was loaded.");
    const by = new Map<string | null, number>();
    for (const l of loaded) by.set(l.own, (by.get(l.own) ?? 0) + 1);
    const after = n.SHEET[a.eventId];
    d(act);
    return ok({ eventId: a.eventId, rule: a.rule.kind, inFile: sh.rows, loaded: loaded.length, duplicates: after?.skipped ?? 0, refused: sh.bad,
      split: [...by].map(([ownerId, count]) => ({ ownerId, count })), countsSaved: true });
  },
};

