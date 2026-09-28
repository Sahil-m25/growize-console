/* ── selectors/activity.ts — the roster, Updates, and the audit log read back ───────────────
   Ports `ref/03-app.js` lines 815–856 (who is working today), 3342–3383 (Updates), 3429–3433
   (the feed) and the pure head of `vActivity`, lines 6043–6062 (the month, day by day).

   Writes from these regions — `setAvail`, `setOutWhy`, `setOutTo`, `setOutFrom`, `endCoverFor`,
   `markRead` — are the store's.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import type { Absence, Cover, Lead, LeadId, LogEntry, PersonKey } from "@/domain";
import { dAdd, dayOf, dISOtoDisp, dOf, iso } from "@/lib/format";
import type { Ctx } from "./ctx";
import { me, P } from "./ctx";
import { canAssign, canReadFinance, chainOf, isFin, may, own, roleOf, seeMoney, seesTeam } from "./access";
import {
  coverLive, custodian, lateOf, movesWaiting, myBook, nextUp, openable, rag, scopeOf, teamBook, unassigned, visible,
} from "./leads";

/* ===== WHO IS WORKING TODAY =================================================================
   One record per person; absent means available. An absence carries the day they are back, as a
   date rather than a phrase, for one reason: it is what lets the note put itself away. "Back next
   week" has to be cleared by hand and never is; "back on 29 Aug" stops being true on the 30th on
   its own, and the roster stops lying.
   ========================================================================================== */

/* one answer, whichever way you ask it: a departed person is permanently unavailable */
export const gone = (ctx: Ctx, k: PersonKey): boolean => (ctx.PEOPLE[k] || {}).on === false;

/* the record as written, whether or not today falls inside it */
export const absRec = (ctx: Ctx, k: PersonKey): Absence | null =>
  (ctx.AVAIL || {})[k] || (gone(ctx, k)
    ? { why: "Left the company", from: "—", to: "—", by: "—", at: "—", perm: true }
    : null);

export const absFrom = (ctx: Ctx, k: PersonKey): Date | null => {
  const a = absRec(ctx, k);
  return a ? dOf(a.from) : null;
};
export const absTo = (ctx: Ctx, k: PersonKey): Date | null => {
  const a = absRec(ctx, k);
  return a ? dOf(a.to) : null;
};

/* OUT means today falls inside the window. Two consequences, and both of them are the point:
   leave can be booked before it starts, and on the day somebody said they were back, they are —
   with nobody remembering to clear anything. */
export function outFor(ctx: Ctx, k: PersonKey): Absence | null {
  const a = absRec(ctx, k);
  if (!a) return null;
  if (a.perm) return a;
  const f = absFrom(ctx, k), t = absTo(ctx, k), n = dayOf(ctx.NOW);
  if (f && n < f) return null;                        /* booked, not started */
  if (t && n >= t) return null;                       /* back, as of this morning */
  return a;
}

export const avail = (ctx: Ctx, k: PersonKey): boolean => !outFor(ctx, k);

/* an absence that has not begun: known, worth planning around, and not yet true */
export const planFor = (ctx: Ctx, k: PersonKey): Absence | null => {
  const a = absRec(ctx, k);
  if (!a || a.perm) return null;
  const f = absFrom(ctx, k);
  return f && dayOf(ctx.NOW) < f ? a : null;
};

/* whole days until the first day they are back */
export const outDays = (ctx: Ctx, k: PersonKey): number | null => {
  const t = absTo(ctx, k);
  return t ? Math.round((t.getTime() - dayOf(ctx.NOW).getTime()) / 864e5) : null;
};
export const inDays = (ctx: Ctx, k: PersonKey): number | null => {
  const f = absFrom(ctx, k);
  return f ? Math.round((f.getTime() - dayOf(ctx.NOW).getTime()) / 864e5) : null;
};

/* the two ends of an absence, as printed */
export const outTo = (ctx: Ctx, k: PersonKey): string => {
  const a = absRec(ctx, k);
  if (!a) return "";
  return absTo(ctx, k) ? dISOtoDisp(a.to, ctx.NOW) : (a.to || "—");
};
export const outFromD = (ctx: Ctx, k: PersonKey): string => {
  const a = absRec(ctx, k);
  if (!a) return "";
  return absFrom(ctx, k) ? dISOtoDisp(a.from, ctx.NOW) : (a.from || "—");
};

/* one answer to "who is out" and "who is covering", whether it was set per person or per lead */
export const outOf = (ctx: Ctx, k: PersonKey): Absence | Cover | null =>
  outFor(ctx, k) || (coverLive(ctx, ctx.COVER[k], k) ? ctx.COVER[k] : null)
  || ctx.LEADS.find(l => l.own === k && coverLive(ctx, l.cov, l.own))?.cov || null;

export const coversOf = (ctx: Ctx, k: PersonKey): string | null => {
  const owner = Object.keys(ctx.COVER).find(o => ctx.COVER[o].by === k && coverLive(ctx, ctx.COVER[o], o));
  if (owner) return P(ctx.PEOPLE, owner).i;
  const l = ctx.LEADS.find(x => x.cov?.by === k && coverLive(ctx, x.cov, x.own));
  return l ? P(ctx.PEOPLE, l.own).i : null;
};

/* ===== UPDATES ==============================================================================
   Generic until you ask for specifics. Derived from the audit log and from lead state, never a
   second store, so it can never disagree with the record. One group per kind; a group says what
   happened and to how many. Nothing is named until you open the group.
   ========================================================================================== */
export type UpdateRow = {
  lead: LeadId | null;
  what: string;
  at: string;
  who: PersonKey | null;
  d: string;
  note?: string;
  /** The "access" group's own row is about a person, not a lead — its name stands in where every
   *  other group prints the investor's (ir-console-redesigned.html:8408-8411). */
  n?: string;
};
export type UpdateGroup = {
  k: string; icon: string; title: string; rows: UpdateRow[]; tone: string;
  /** What the rows are counted in — every group has always been leads; "access" is the one thing
   *  in this console that happens to a person rather than to a book, so it names its own unit. */
  unit?: string;
};

/* Keep the audit record intact; its displayed detail follows the same field privacy as the UI.
   A restricted money/doc row still says THAT it is restricted, rather than reading as blank
   (ir-console-redesigned.html:11524-11528). */
export function logNote(ctx: Ctx, e: LogEntry): string {
  if (/^Mobile\s*:/i.test(e.note || "") && /own details/i.test(e.what)) return "Mobile updated";
  /* The IR/Convener mirror reads structured fields, never Finance's free-form notes — visible or
     not. This has to run BEFORE the restricted-placeholder check below: a scoped reader with no
     book relationship to the lead at all (an unrelated team's record, an unowned one) must read as
     silence, not as a placeholder that confirms a financial row exists on a record they cannot open
     (ir-console-redesigned.html:4276, 11524-11528). */
  if (["ir","conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "") && ["money", "doc"].includes(e.kind)) return "";
  const l = e.lead ? ctx.LEADS.find(x => x.id === e.lead) : null;
  const payVisible = e.kind !== "money" || (l ? canReadFinance(ctx, l, "pay") : seeMoney(ctx));
  const docVisible = e.kind !== "doc" || (l ? canReadFinance(ctx, l, "docs")
    : !["ir","conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "") && may(ctx, "docs", "view"));
  if (e.kind === "money" && !payVisible) return e.note ? "Payment details restricted" : "";
  if (e.kind === "doc" && !docVisible) return e.note ? "Document details restricted" : "";
  if (!logReadable(ctx, e)) return "";
  return e.note || "";
}
export const logReadable = (ctx: Ctx, e: LogEntry): boolean => {
  const l = e.lead ? ctx.LEADS.find(l => l.id === e.lead) : null;
  if (e.lead && (!l || !openable(ctx).some(x=>x.id === l.id))) return false;
  return (e.kind !== "money" || (l ? canReadFinance(ctx, l, "pay") : seeMoney(ctx)))
    && (e.kind !== "doc" || (l ? canReadFinance(ctx, l, "docs") : !["ir","conv"].includes(roleOf(ctx.PEOPLE, me(ctx)) || "") && may(ctx, "docs", "view")));
};

export function updates(ctx: Ctx): UpdateGroup[] {
  if (!may(ctx, "updates", "view")) return [];
  const allowed = new Set(openable(ctx).map(l => l.id));
  const book = (isFin(ctx.ROLE) ? visible(ctx) : myBook(ctx)).filter(l => allowed.has(l.id));
  const byId: Record<LeadId, Lead> = {};
  book.forEach(l => { byId[l.id] = l; });
  const since = new Date(ctx.TODAY);
  since.setDate(since.getDate() - 6);                 /* today plus six = seven days */
  const win = iso(since);

  /* the last seven days, other people's actions only, and one row per lead — never per event */
  const pick = (test: (e: LogEntry, l: Lead) => boolean): UpdateRow[] => {
    const seen: Record<LeadId, LogEntry> = {};
    ctx.LOG.filter(e => logReadable(ctx, e) && e.d >= win && e.who !== me(ctx) && !!e.lead && byId[e.lead]
      && test(e, byId[e.lead]))
      .forEach(e => { if (!seen[e.lead!]) seen[e.lead!] = e; });   /* newest first in LOG order */
    return Object.values(seen).map(e => ({
      lead: e.lead as LeadId, what: e.what, at: e.at, who: e.who, d: e.d, note: logNote(ctx, e),
    }));
  };

  const g: UpdateGroup[] = [];
  const add = (k: string, icon: string, title: string, rows: UpdateRow[], tone: string, unit?: string) => {
    if (rows.length) g.push({ k, icon, title, rows, tone, unit });
  };

  /* 1. Money and paper on your leads, established by Finance in the other portal. Nobody loses
     control of a lead any more, so this is no longer "moved on without you" — it is the half of
     the record you do not write, arriving. */
  add("moved", "→", "Finance confirmed something on",
    pick(e => ["money", "doc"].includes(e.kind)), "go");
  /* 2. someone worked a lead that is still yours. "While you were away" needs you to have been. */
  add("cover", "↔",
    absRec(ctx, me(ctx)) ? "Worked for you while you were away —" : "Worked by somebody else —",
    pick((e, l) => custodian(l) === "IR" && e.who !== l.own
      && ["msg", "call", "email", "mat", "pack", "stage"].includes(e.kind)), "");
  /* 3. the names on your leads changed */
  add("admin", "⚑", "An owner or a secondary changed on",
    pick(e => e.kind === "admin"
      && /^(Reassigned|Assigned|Handed|Ended cover|Set secondary|Removed member)/.test(e.what)), "");

  /* state, not history — true right now, and only for the people who act on it. Every one of these
     three also has to pass `openable()`, the same D37–D44 record-access gate every other reading of
     a lead in this console passes: "arrived with no owner" or "breached in your team" is still a
     lead, and a lead nobody may open is not a row here either (ir-console-redesigned.html:8398). */
  if (canAssign(ctx)) add("owner", "?", "Arrived with no owner —",
    unassigned(ctx).filter(l => allowed.has(l.id)).map(l => ({
      lead: l.id, what: "Added by " + P(ctx.PEOPLE, l.by).n, at: l.at[0],
      who: (l.by as PersonKey) || null, d: iso(ctx.TODAY),
    })), "late");
  add("move", "⇄", "Waiting for you to approve a move —",
    movesWaiting(ctx).filter(l => allowed.has(l.id)).map(l => {
      const r = (ctx.REQ || {})[l.id];
      return {
        lead: l.id, what: "To " + P(ctx.PEOPLE, r.to).n + " · " + r.why,
        at: r.at, who: r.by, d: iso(ctx.TODAY),
      };
    }), "late");
  if (seesTeam(ctx)) add("team", "▲", "Breached in your team —",
    teamBook(ctx).filter(l => allowed.has(l.id) && !!l.own && rag(ctx, l) === "red").map(l => ({
      lead: l.id, what: nextUp(ctx, l).t, at: lateOf(l, ctx.NOW) + "d late",
      who: l.own as PersonKey, d: iso(ctx.TODAY),
    })), "late");
  /* 4. what somebody else changed about YOU. Logged like every other admin act and readable on
     Activity — but that page answers what a person did, and a grid change is done to them, so
     without this the only person in the building who cannot see it is the one it happened to
     (ir-console-redesigned.html:8408-8411). */
  add("access", "⚙", "Your access was changed —",
    ctx.LOG.filter(e => e.d >= win && e.who !== me(ctx) && e.about?.includes(me(ctx)))
      .slice(0, 6).map(e => ({
        lead: null, n: (e.note || "").split(" · ")[1] || "Your access",
        what: e.what, note: e.note, at: e.at, who: e.who, d: e.d,
      })), "late", "change");
  return g;
}

export const allRows = (ctx: Ctx): UpdateRow[] => updates(ctx).flatMap(x => x.rows);
export const updateCount = (ctx: Ctx): number => allRows(ctx).length;

/* gNew(x) — ir-console-redesigned.html:8409-8410. "Unread" is asked one group at a time and keyed
   per person AND per group — `NSEEN["<who>|<group>"]` — so signing in as somebody else, or reading
   one group, never marks another person's or another group's news as seen. */
export const gNew = (ctx: Ctx, x: UpdateGroup): number =>
  x.rows.filter(r => (r.d || "") > ((ctx.NSEEN || {})[me(ctx) + "|" + x.k] || "")).length;

export const unread = (ctx: Ctx): number =>
  updates(ctx).reduce((a, x) => a + gNew(ctx, x), 0);

/* what `markRead(k)` should set NSEEN's one key to — the decision half; the store does the
   assignment. `k` omitted reads as "mark every group", one key at a time, exactly as `markRead`
   itself loops (ir-console-redesigned.html:8427-8430). */
export function readMarks(ctx: Ctx, k?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of updates(ctx)) {
    if (k && x.k !== k) continue;
    out[me(ctx) + "|" + x.k] = x.rows.reduce((m, r) => (r.d && r.d > m ? r.d : m), iso(ctx.TODAY));
  }
  return out;
}

/* the specific version, kept under the generic one: every action somebody else took on this book in
   the last seven days, in order, one tap from the record. The same book the groups above read, so
   the two halves of one screen cannot describe two different weeks. No cap: the export and the "all
   history" panel both read this list whole (ir-console-redesigned.html:8371-8420 takes none either;
   a `.slice(0,80)` here was this port's own addition and cut a real week short on a busy book). */
/* D59 g3 (ir-merged.js:6186): whose leads the feed is about, in one word-set, so the subtitle, the
   feed and its empty state all say the same thing — "your leads" only when it is only your leads.
   A manager on team scope has no book of her own, so feedRows reads the book the wording names. */
export const feedTeam = (ctx: Ctx): boolean => !isFin(ctx.ROLE) && seesTeam(ctx) && scopeOf(ctx, "today") === "team";
export const feedScope = (ctx: Ctx): string =>
  isFin(ctx.ROLE) ? "these leads" : feedTeam(ctx) ? "your team's leads" : "your leads";
export function feedRows(ctx: Ctx): LogEntry[] {
  if (!may(ctx, "updates", "view")) return [];
  const allowed = new Set(openable(ctx).map(l => l.id));
  const book = (isFin(ctx.ROLE) ? visible(ctx) : feedTeam(ctx) ? teamBook(ctx) : myBook(ctx)).filter(l => allowed.has(l.id));
  const ids = new Set(book.map(l => l.id));
  const since = iso(dAdd(ctx.TODAY, -6));
  return ctx.LOG.filter(e => logReadable(ctx, e) && e.d >= since && !!e.lead && ids.has(e.lead) && e.who !== me(ctx));
}

/* ===== ACTIVITY — what each person did, day by day ==========================================
   The pure head of the prototype's `vActivity`: which log lines are in scope, how they fall into a
   month, and how dark each calendar cell is. The grid itself is `src/features/activity/**`'s.
   ========================================================================================== */

/* Activity belongs to its actor, even on a shared investor record. The others capability lets a
   manager audit their reporting chain; it never borrows the org-wide lead-book shortcut. */
export function activityActors(ctx: Ctx): PersonKey[] {
  if (!may(ctx, "activity", "view")) return [];
  return may(ctx, "activity", "others") ? supervisedActors(ctx) : [me(ctx)];
}

export const supervisedActors = (ctx: Ctx): PersonKey[] => [me(ctx),
  ...Object.keys(ctx.PEOPLE).filter(k => k !== me(ctx) && chainOf(ctx.PEOPLE, k).includes(me(ctx)))];

/* systemActors() — ir-console-redesigned.html:11519-11522's `systemRows`: `own("system","edit")`
   sees every actor, and everyone else sees exactly `actActors()` — this port's `activityActors` —
   never the broader reporting-chain shortcut. Using `supervisedActors` here let a manager with no
   `activity.others` capability read a colleague's activity through System alone. */
export function systemActors(ctx: Ctx): PersonKey[] {
  if (!may(ctx, "system", "view")) return [];
  return own(ctx, "system", "edit") ? Object.keys(ctx.PEOPLE) : activityActors(ctx);
}
export function systemRows(ctx: Ctx): LogEntry[] {
  const actors = new Set(systemActors(ctx)), ids = new Set(openable(ctx).map(l => l.id));
  return ctx.LOG.filter(e => logReadable(ctx, e) && actors.has(e.who) && (!e.lead || ids.has(e.lead)));
}
/* Every readable row about the team, not merely the ones that look administrative — the redesign
   drops the `kind==="admin"` and wording filters (ir-console-redesigned.html:11524-11528). */
export function teamAuditRows(ctx: Ctx): LogEntry[] {
  if (!may(ctx, "people", "view")) return [];
  const actors = new Set(supervisedActors(ctx)), ids = new Set(openable(ctx).map(l => l.id));
  return ctx.LOG.filter(e => logReadable(ctx, e) && (actors.has(e.who) || e.about?.some(k => actors.has(k)))
    && (!e.lead || ids.has(e.lead)));
}
export const activitySolo = (ctx: Ctx): boolean => activityActors(ctx).length <= 1;
export const activityWho = (ctx: Ctx, who: PersonKey | null | undefined): PersonKey | null =>
  who === null && !activitySolo(ctx) ? null
    : who && activityActors(ctx).includes(who) ? who : me(ctx);

export function activityRows(ctx: Ctx): LogEntry[] {
  const actors = new Set(activityActors(ctx));
  const ids = new Set(openable(ctx).map(l => l.id));
  return ctx.LOG.filter(e => logReadable(ctx, e) && !!e.who && actors.has(e.who) && (!e.lead || ids.has(e.lead)));
}

export type ActMonth = {
  rows: LogEntry[];            /* everything for the person in scope, all time */
  monthRows: LogEntry[];       /* …narrowed to this month */
  monthRowsAll: LogEntry[];    /* the same month for everybody, for the by-person table */
  dayRows: LogEntry[];         /* the picked day, or the whole month when none is picked */
  byDay: Record<string, LogEntry[]>;
  max: number;                 /* the busiest day in the month — the scale for the heat */
  start: number;               /* how many blank cells before the 1st; weeks start Monday */
  days: number;
  cells: { key: string; d: number; n: number; lvl: number }[];
};

export function activityMonth(
  ctx: Ctx, who: PersonKey | null, month: Date, day: string | null,
): ActMonth {
  const allowed = activityRows(ctx);
  const selected = activityWho(ctx, who);
  const rows = allowed.filter(e => !selected || e.who === selected);
  const y = month.getFullYear(), mo = month.getMonth();
  const first = new Date(y, mo, 1);
  const start = (first.getDay() + 6) % 7;             /* weeks start Monday */
  const days = new Date(y, mo + 1, 0).getDate();
  const key = iso(first).slice(0, 7);

  const byDay: Record<string, LogEntry[]> = {};
  rows.forEach(e => { if (e.d.startsWith(key)) (byDay[e.d] = byDay[e.d] || []).push(e); });
  const max = Math.max(1, ...Object.values(byDay).map(a => a.length));

  const monthRows = rows.filter(e => e.d.startsWith(key));
  const monthRowsAll = allowed.filter(e => e.d.startsWith(key));
  const dayRows = day ? (byDay[day] || []) : monthRows;

  const cells: ActMonth["cells"] = [];
  for (let dnum = 1; dnum <= days; dnum++) {
    const k = `${y}-${String(mo + 1).padStart(2, "0")}-${String(dnum).padStart(2, "0")}`;
    const n = (byDay[k] || []).length;
    cells.push({ key: k, d: dnum, n, lvl: n ? Math.min(4, Math.ceil(n / max * 4)) : 0 });
  }
  return { rows, monthRows, monthRowsAll, dayRows, byDay, max, start, days, cells };
}

/* how many of one kind of action are in a set of log lines */
export const actTally = (rows: LogEntry[], k: string): number =>
  rows.filter(e => e.kind === k).length;

/* the touch-in-the-week columns: 1st, 2nd, 3rd, and 4th-or-more */
export const touchTally = (rows: LogEntry[], t: number): number =>
  rows.filter(e => (t < 4 ? e.touch === t : (e.touch || 0) >= 4)).length;
