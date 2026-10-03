/* M15-S03-W1 — Activity, Investors side: GET /api/activity?side=investors[&person&kind] and GET /api/activity/history.
   Live: the route (the archived org audit + Plane C, scoped to the reader and to records they can open).
   Fixture: the same ActivityResult projected from the demo book's log (activityBase).
   The route's rows carry no Detail line (the archive holds action codes, not the note); the screen shows one, so the
   view type adds an optional `detail` the fixture fills and the live half leaves empty — PROVISIONAL (see the report). */

import type { ActivityResult, ActivityRow, Tally } from "@/server/activity/query";
import type { HistoryEntry } from "@/server/activity/sources";
import { activityBase, isAuditor, isSys, KINDS, logFor, may, pageReadable, safeNote } from "@/lib/im";
import { KINDS as LEAD_KINDS } from "@/domain";
import { activityRows, isHumanTouch, logNote, may as leadMay } from "@/lib/selectors";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";
import type { ConsoleBook } from "./lead";

type Ok = Extract<ActivityResult, { ok: true }>;
export type ActivityRowView = ActivityRow & { readonly detail?: string | null };
export type ActivityView = Omit<Ok, "ok" | "rows"> & { readonly rows: readonly ActivityRowView[] };
/** null → nothing to read (no filter set: the unfiltered read already has everything) */
export type ActivityArgs = { person: string | null; kind: string | null } | null;

export const activityRead: ReadEndpoint<ImBook, ActivityArgs, ActivityView> = {
  path: a => {
    if (!a) return null;
    const q = new URLSearchParams({ side: "investors", limit: "200" });
    if (a.person) q.set("person", a.person);
    if (a.kind) q.set("kind", a.kind);
    return `/api/activity?${q}`;
  },
  pick: j => j as ActivityView,
  fixture({ s, me }, a) {
    if (!a) return fail(400, "invalid-request", "Nothing to read.");
    if (!pageReadable(s, me, "act")) return fail(403, "no-activity", "Activity is not part of this seat.");
    const all = activityBase(s, me), solo = !may(s, me, "log") && !isAuditor(s, me), adminView = isSys(s, me) && may(s, me, "log");
    const rowOf = (e: (typeof all)[number]): ActivityRowView => ({ at: e.at, day: e.at.slice(0, 6), byId: e.who, side: "investors", kind: e.kind, what: e.what,
      module: "", recordId: e.inv, source: "archive", withheld: adminView && /^Investor details withheld/.test(e.note), detail: safeNote(s, me, e.note) });
    const cut = all.filter(e => (!a.person || (!solo && e.who === a.person)) && (!a.kind || e.kind === a.kind));
    const tally = (by: "person" | "day", rows: typeof all): Tally[] => {
      const g = new Map<string, { key: string; total: number; kinds: Record<string, number> }>();
      for (const e of rows) {
        const key = by === "person" ? e.who : e.at.slice(0, 6);
        const t = g.get(key) ?? { key, total: 0, kinds: {} };
        t.total++; t.kinds[e.kind] = (t.kinds[e.kind] ?? 0) + 1; g.set(key, t);
      }
      return [...g.values()].sort((x, y) => (by === "person" ? y.total - x.total || x.key.localeCompare(y.key) : 0));
    };
    return ok({
      side: "investors", sides: ["investors"], solo, adminView, month: "", day: null, person: a.person, kind: a.kind, ignored: [], kinds: KINDS,
      people: [...new Set(all.map(e => e.who))], total: cut.length, offset: 0, limit: 200, rows: cut.map(rowOf),
      byPerson: solo ? [] : tally("person", cut), byDay: tally("day", cut), partial: false,
    });
  },
};

/** One record's history — module + record id → who changed which fields, when (never the values). */
export type HistoryView = { entries: readonly HistoryEntry[]; more: boolean };
export const recordHistory: ReadEndpoint<ImBook, { module: string; id: string | null }, HistoryView> = {
  path: a => (a.id ? `/api/activity/history?module=${encodeURIComponent(a.module)}&id=${encodeURIComponent(a.id)}` : null),
  pick: j => j as HistoryView,
  fixture({ s, me }, a) {
    if (!a.id) return fail(400, "invalid-request", "Ask by module and record id.");
    const rows = logFor(s, me, a.id);
    if (!rows.length && !s.data.INV.some(x => x.id === a.id)) return fail(404, "not-found", "This record's history is not available to you.");
    return ok({ entries: rows.map(e => ({ at: e.at, byId: e.who, action: e.what, fields: [] })), more: false });
  },
};

/* M15-S03-W2 — Activity, Lead side: the same route with side=lead, month-scoped (the route's own unit).
   Fixture: the demo book's log through the same gate the page used (activityRows = the seat's actors and the leads it can open),
   cut to the month / day / person / kind exactly as the route cuts them. The route's rows carry no note, touch count or lead name;
   the page shows them, so the view type adds optional `detail`, `touch`, `human` the fixture fills and the live half leaves empty
   — PROVISIONAL (see the report). */
export type LeadActivityRowView = ActivityRow & { readonly detail?: string | null; readonly touch?: number | null; readonly human?: boolean };
export type LeadActivityView = Omit<Ok, "ok" | "rows"> & { readonly rows: readonly LeadActivityRowView[] };
/** null → nothing to read (the whole-month read is the same read when no day is picked) */
export type LeadActivityArgs = { month: string; day: string | null; person: string | null; kind: string | null } | null;

export const leadActivityRead: ReadEndpoint<ConsoleBook, LeadActivityArgs, LeadActivityView> = {
  path: a => {
    if (!a) return null;
    const q = new URLSearchParams({ side: "lead", month: a.month, limit: "200" });
    if (a.day) q.set("day", a.day);
    if (a.person) q.set("person", a.person);
    if (a.kind) q.set("kind", a.kind);
    return `/api/activity?${q}`;
  },
  pick: j => j as LeadActivityView,
  fixture(state, a) {
    if (!a) return fail(400, "invalid-request", "Nothing to read.");
    if (!leadMay(state, "activity", "view")) return fail(403, "no-activity", "Activity is not part of this seat.");
    const solo = !leadMay(state, "activity", "others");
    const stamp = (e: { d: string; at: string }) => `${e.d}T${e.at.slice(-5)}:00+05:30`;
    const inMonth = activityRows(state).filter(e => e.d.startsWith(a.month + "-"));
    const people = [...new Set(inMonth.map(e => e.who))].sort();
    const day = a.day && a.day.startsWith(a.month + "-") ? a.day : null;
    const person = a.person && !solo && people.includes(a.person) ? a.person : null;
    const kind = a.kind && Object.hasOwn(LEAD_KINDS, a.kind) ? a.kind : null;
    const cut = inMonth.filter(e => (!day || e.d === day) && (!person || e.who === person) && (!kind || e.kind === kind))
      .sort((x, y) => stamp(y).localeCompare(stamp(x)));
    const tally = (by: "person" | "day"): Tally[] => {
      const g = new Map<string, { key: string; total: number; kinds: Record<string, number> }>();
      for (const e of cut) {
        const key = by === "person" ? e.who : e.d;
        const t = g.get(key) ?? { key, total: 0, kinds: {} };
        t.total++; t.kinds[e.kind] = (t.kinds[e.kind] ?? 0) + 1; g.set(key, t);
      }
      return [...g.values()].sort((x, y) => (by === "person" ? y.total - x.total || x.key.localeCompare(y.key) : y.key.localeCompare(x.key)));
    };
    return ok({
      side: "lead", sides: ["lead"], solo, adminView: false, month: a.month, day, person, kind, ignored: [], kinds: LEAD_KINDS,
      people, total: cut.length, offset: 0, limit: 200,
      rows: cut.slice(0, 200).map((e): LeadActivityRowView => ({ at: stamp(e), day: e.d, byId: e.who, side: "lead", kind: e.kind, what: e.what, module: "Leads",
        recordId: e.lead, source: "archive", withheld: false, detail: logNote(state, e), touch: e.touch ?? null, human: isHumanTouch(e) })),
      byPerson: solo ? [] : tally("person"), byDay: tally("day"), partial: false,
    });
  },
};
