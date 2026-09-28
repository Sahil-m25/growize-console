/**
 * M15-S03-T02/T05 — THE ACTIVITY QUERY: who did what, each seat its own scope, Lead side | Investors side.
 *
 * Sources by plane (D47): cross-record rows come from the archived org audit export (./archive.ts — never a
 * live per-record fan-out, TC-E11-013); identity reveals, step-ups and seat changes from Plane C. A record's
 * own history is read live from its __timeline (./sources.ts recordHistory), not here.
 *
 * Scope, per seat (the prototype's activityActors/actActors):
 *   Lead side       IR, channel partner → self · IR Manager → self + team · Digital Infrastructure → all
 *   Investors side  KAM, Finance, Head of Finance, Compliance, Executive, BU owner → self · Head of AM → self +
 *                   team · Auditor → the Finance people · Digital Infrastructure → all, investor details withheld
 * A row about a record is kept only if the reader can open that record: one COQL `id in (…)` per module and
 * ≤100 ids, on the reader's OWN token (D53) — Zoho's sharing answers, not ours. A record in a module that
 * cannot be checked, or a check that failed, drops the row (fail closed) and says so (`partial`).
 * Filters (month, day, person, kind) that are not valid for this reader are ignored and named (TC-E11-012).
 */

import type { PlaneCEvent } from "../identity/plane-c";
import type { ArchivedAuditRow } from "./archive";
import { checkableModule, classify, classifyPlaneC, describe, kindsOf, type Side } from "./kinds";

export interface ActivityRow {
  readonly at: string;
  readonly day: string;
  readonly byId: string;
  readonly side: Side;
  readonly kind: string;
  readonly what: string;
  readonly module: string;
  /** null when withheld (Administration's Investors side) or when the row concerns no record. */
  readonly recordId: string | null;
  readonly source: "archive" | "plane-c";
  readonly withheld: boolean;
}

type Reach = "self" | "team" | "finance" | "all";
const LEAD_REACH: Readonly<Record<string, Reach>> = Object.freeze({ ir: "self", cp: "self", conv: "team", ops: "all", di: "all" });
const INVESTOR_REACH: Readonly<Record<string, Reach>> = Object.freeze({
  kam: "self", fin: "self", head: "self", comp: "self", exec: "self", bu: "self", amlead: "team", audit: "finance", ops: "all", di: "all",
});
const reachOf = (seat: string, side: Side): Reach | null => {
  const t = side === "lead" ? LEAD_REACH : INVESTOR_REACH;
  return Object.hasOwn(t, seat) ? t[seat]! : null;
};

/** The sides this seat's Activity page has; two → the page shows the switch (one entry in the rail). */
export const activitySides = (seat: string): Side[] => (["lead", "investors"] as const).filter((s) => reachOf(seat, s) !== null);

export interface ActivityDeps {
  readonly archive: { days(): Promise<readonly string[]>; read(day: string): Promise<readonly ArchivedAuditRow[]> };
  /** Plane C events in [fromMs, toMs). */
  readonly planeC: (fromMs: number, toMs: number) => Promise<readonly PlaneCEvent[]> | readonly PlaneCEvent[];
  /** A manager's reports (Roles & Users API); null → unknown, the visibility check alone limits the team. */
  readonly subtreeOf?: (managerId: string) => Promise<readonly string[] | null>;
  /** The Finance people, for the Auditor; null → unknown, Finance kinds (money, documents, KYC) stand in. */
  readonly financeUserIds?: () => Promise<readonly string[] | null>;
  /** Of these ids (≤100, one module), the ones the reader can open, on their own token. null → the check failed. */
  readonly visible: (module: string, ids: readonly string[]) => Promise<ReadonlySet<string> | null>;
  readonly clock?: () => number;
}

export interface ActivityParams { readonly side?: string | null; readonly month?: string | null; readonly day?: string | null;
  readonly person?: string | null; readonly kind?: string | null; readonly offset?: string | null; readonly limit?: string | null }

export interface Tally { readonly key: string; readonly total: number; readonly kinds: Readonly<Record<string, number>> }

export type ActivityResult =
  | { readonly ok: false; readonly reason: "no-activity" }
  | {
    readonly ok: true; readonly side: Side; readonly sides: readonly Side[];
    /** Self only: no Person column, no By person view. */
    readonly solo: boolean;
    /** Digital Infrastructure's Investors side: organisation audit with investor details withheld. */
    readonly adminView: boolean;
    readonly month: string; readonly day: string | null; readonly person: string | null; readonly kind: string | null;
    readonly ignored: readonly string[]; readonly kinds: Readonly<Record<string, string>>;
    readonly people: readonly string[]; readonly total: number; readonly offset: number; readonly limit: number;
    readonly rows: readonly ActivityRow[]; readonly byPerson: readonly Tally[]; readonly byDay: readonly Tally[];
    /** A visibility check failed: rows on those records were left out rather than shown unchecked. */
    readonly partial: boolean;
  };

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const USER_ID = /^\d{15,25}$/;
const istMonth = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 7);
const istIso = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const validDay = (d: string, month: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !d.startsWith(month + "-")) return false;
  const t = new Date(d + "T00:00:00Z");
  return Number.isFinite(+t) && t.toISOString().slice(0, 10) === d;
};
const PLANE_C_WHAT: Readonly<Record<string, string>> = Object.freeze({
  reveal: "Identity revealed", "step-up": "Stepped up", "seat-change": "Seat changed", "grant-change": "Access changed",
  "access-granted": "Console access granted", "access-ended": "Console access ended", "manager-change": "Changed who they report to",
});
/** "3 accounts returned to the pool" — a seat change's count (M03-S04-T02); nothing when none moved. */
export const pooledText = (n: number | undefined): string | null =>
  typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? `${n} account${n === 1 ? "" : "s"} returned to the pool` : null;

export function rowFromArchive(r: ArchivedAuditRow): ActivityRow | null {
  const c = classify(r.module, r.action);
  if (!c) return null;
  return { at: r.at, day: r.day, byId: r.byId, side: c.side, kind: c.kind, what: describe(c.side, c.kind, r.action, r.module), module: r.module, recordId: r.recordId, source: "archive", withheld: false };
}

export function rowFromPlaneC(e: PlaneCEvent): ActivityRow | null {
  const c = classifyPlaneC(e.action);
  if (!c) return null;
  const at = istIso(e.at);
  const recordId = e.recordIds?.[0] ?? null;
  const pooled = e.action === "seat-change" && e.outcome === "ok" ? pooledText(e.count) : null;
  return { at, day: at.slice(0, 10), byId: e.who, side: c.side, kind: c.kind,
    what: (PLANE_C_WHAT[e.action] ?? "Admin action") + (pooled ? ` · ${pooled}` : "") + (e.outcome === "refused" ? " (refused)" : ""),
    module: recordId ? "Contacts" : "Users", recordId, source: "plane-c", withheld: false };
}

function tally(rows: readonly ActivityRow[], by: "person" | "day"): Tally[] {
  const g = new Map<string, { key: string; total: number; kinds: Record<string, number> }>();
  for (const r of rows) {
    const key = by === "person" ? r.byId : r.day;
    const t = g.get(key) ?? { key, total: 0, kinds: {} };
    t.total++; t.kinds[r.kind] = (t.kinds[r.kind] ?? 0) + 1;
    g.set(key, t);
  }
  return [...g.values()].sort((a, b) => (by === "person" ? b.total - a.total || a.key.localeCompare(b.key) : b.key.localeCompare(a.key)));
}

export async function queryActivity(reader: { readonly seat: string; readonly userId: string }, p: ActivityParams, deps: ActivityDeps): Promise<ActivityResult> {
  const sides = USER_ID.test(reader.userId) ? activitySides(reader.seat) : [];
  if (!sides.length) return { ok: false, reason: "no-activity" };
  const ignored: string[] = [];
  const side: Side = p.side && (sides as string[]).includes(p.side) ? (p.side as Side) : sides[0]!;
  if (p.side && side !== p.side) ignored.push("side");
  const reach = reachOf(reader.seat, side)!;
  const clock = deps.clock ?? Date.now;

  let month = istMonth(clock());
  if (p.month) { if (MONTH.test(p.month)) month = p.month; else ignored.push("month"); }

  /* the month's rows from the archive and Plane C */
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = Date.parse(`${month}-01T00:00:00+05:30`);
  const to = Date.parse(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01T00:00:00+05:30`);
  const days = (await deps.archive.days()).filter((d) => d.startsWith(month + "-"));
  const raw: ActivityRow[] = [];
  for (const d of days) for (const r of await deps.archive.read(d)) { const x = rowFromArchive(r); if (x) raw.push(x); }
  for (const e of await deps.planeC(from, to)) { const x = rowFromPlaneC(e); if (x && x.at >= istIso(from) && x.at < istIso(to)) raw.push(x); }
  let rows = raw.filter((r) => r.side === side);

  /* who: the reader's actors */
  if (reach === "self") rows = rows.filter((r) => r.byId === reader.userId);
  else if (reach === "team") {
    const team = deps.subtreeOf ? await deps.subtreeOf(reader.userId) : null;
    if (team) { const ids = new Set([reader.userId, ...team]); rows = rows.filter((r) => ids.has(r.byId)); }
    else rows = rows.filter((r) => r.byId === reader.userId || r.recordId !== null); // PROVISIONAL: Zoho's hierarchy limits it below
  } else if (reach === "finance") {
    const fin = deps.financeUserIds ? await deps.financeUserIds() : null;
    if (fin) { const ids = new Set(fin); rows = rows.filter((r) => ids.has(r.byId)); }
    else rows = rows.filter((r) => r.kind === "money" || r.kind === "doc" || r.kind === "kyc");
  }

  /* what: only rows about records the reader can open (Digital Infrastructure sees the org) */
  let partial = false;
  const adminView = reach === "all" && side === "investors";
  if (reach !== "all") {
    const want = new Map<string, Set<string>>();
    for (const r of rows) if (r.recordId) {
      const mod = checkableModule(r.module);
      if (mod) (want.get(mod) ?? want.set(mod, new Set()).get(mod)!).add(r.recordId);
    }
    const ok = new Set<string>();
    for (const [mod, set] of want) {
      const ids = [...set];
      for (let i = 0; i < ids.length; i += 100) {
        const seen = await deps.visible(mod, ids.slice(i, i + 100));
        if (!seen) { partial = true; continue; }
        for (const id of seen) ok.add(`${mod}:${id}`);
      }
    }
    rows = rows.filter((r) => { if (!r.recordId) return true; const mod = checkableModule(r.module); return !!mod && ok.has(`${mod}:${r.recordId}`); });
  }
  if (adminView) rows = rows.map((r) => (r.recordId || r.module === "Contacts" ? { ...r, recordId: null, withheld: true, what: `${kindsOf(side)[r.kind] ?? "Investor"} event` } : r));

  /* filters that make sense for this reader */
  const solo = reach === "self";
  const people = [...new Set(rows.map((r) => r.byId))].sort();
  let day: string | null = null, person: string | null = null, kind: string | null = null;
  if (p.day) { if (validDay(p.day, month)) day = p.day; else ignored.push("day"); }
  if (p.person) { if (!solo && people.includes(p.person)) person = p.person; else ignored.push("person"); }
  if (p.kind) { if (Object.hasOwn(kindsOf(side), p.kind)) kind = p.kind; else ignored.push("kind"); }
  const cut = rows.filter((r) => (!day || r.day === day) && (!person || r.byId === person) && (!kind || r.kind === kind))
    .sort((a, b) => b.at.localeCompare(a.at));

  const limit = Math.min(200, Math.max(1, Number.parseInt(p.limit ?? "", 10) || 40));
  const offset = Math.max(0, Number.parseInt(p.offset ?? "", 10) || 0);
  return {
    ok: true, side, sides, solo, adminView, month, day, person, kind, ignored, kinds: kindsOf(side), people,
    total: cut.length, offset, limit, rows: cut.slice(offset, offset + limit),
    byPerson: solo ? [] : tally(cut, "person"), byDay: tally(cut, "day"), partial,
  };
}
