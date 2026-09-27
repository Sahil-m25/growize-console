/**
 * THE SEAM THE SCREENS WILL CALL — ONE INTERFACE, A FIXTURE BEHIND IT TODAY, ZOHO BEHIND IT LATER.
 *
 * Implements D45 (screens read and write Zoho live; a write returns Zoho's answer, never a cached
 * one; a lead under a D44 cover window is written conditionally on the version the screen loaded),
 * D46 (the allow-list survives as the projection a server-side read may return), D52 (the lead
 * carries all seven rungs and a rung moves by blueprint transition), D53 (an adapter is bound to one
 * person when it is made — no parameter exists through which to read as somebody else — and its
 * aggregates are cached under that person's scope) and D47 (the live half logs through Plane B, via
 * the client).
 *
 * Nothing imports this yet. The existing screens keep running on `store.tsx` and its reducer, which
 * stays the source of behaviour until a page is deliberately moved across. The fixture wraps the same
 * seed — `LEADS`, and `seedBook()` for the paper — so that move can happen one page at a time with a
 * demo that does not change under anyone. It clones the seed when it is made and never mutates the
 * module constants.
 *
 * The fixture enforces the visibility Zoho will enforce for real, so a screen built against it cannot
 * come to depend on seeing more than it will (D52): Private default sharing (your own records), the
 * role hierarchy (your reports' records), and D44's record-level share while a cover is on. Every
 * write takes the version the screen loaded, or an explicit `null` to write unconditionally; a stale
 * version is a `conflict`, the same answer Zoho's 412 will give.
 *
 * Its ladder rules are deliberately thin — a rung moves one step, a Finance-gated rung is not the
 * IR's to tick, a closed lead does not move — and do not replace the reducer's. Error `detail`
 * strings are for developers; the words a person reads are the screens' to choose.
 *
 * `createLiveAdapter` is a typed stub: every method answers `not-implemented` and says which Zoho
 * call will back it. It fails loudly rather than fall back to the fixture, so a page wired to it by
 * mistake shows an error, not demo data dressed as live data.
 */

import { cacheKey, createScopedCache, type AggregateValue, type CacheError, type CacheRead, type CountBucket, type ScopedCache } from "./cache";
import type { UserCredential, ZohoClient } from "./client";
/* the fixture adapter wraps the demo book, which lives outside src/ (it is never bundled for a page) */
import { NOW } from "../../../fixtures/book/clock";
import { LADDER, LOSTWHY, ST } from "../../domain/ladder";
import { LEADS } from "../../../fixtures/book/leads";
import { COVER, PEOPLE } from "../../../fixtures/book/people";
import { seedBook } from "../../../fixtures/book/seed";
import type { Channel, FcCat, Lead, LeadId, LostWhy, NextStep, PaperRow, PersonKey } from "../../domain/types";

/** Opaque. Fixture: a revision counter. Live: the record's Modified_Time (sent as If-Unmodified-Since). */
export type LeadVersion = string;

export interface LeadView {
  readonly lead: Lead;
  readonly paper: PaperRow | null;
  readonly version: LeadVersion;
}

export type AdapterErrorKind = "conflict" | "not-found" | "forbidden" | "invalid" | "unavailable" | "not-implemented";
export interface AdapterError {
  readonly kind: AdapterErrorKind;
  /** For developers and logs, never shown as copy. */
  readonly detail: string;
  readonly retryable: boolean;
}
export type AdapterResult<T> =
  | { readonly ok: true; readonly value: T; readonly asOf: number }
  | { readonly ok: false; readonly error: AdapterError };

/** `from` is the rung the screen saw: if the lead has moved since, the move is a conflict. */
export interface RungMove {
  readonly from: number;
  readonly to: number;
}

export interface ConsoleAdapter {
  readonly source: "fixture" | "live";
  /** The person this adapter acts as, fixed when it was made. */
  readonly who: PersonKey;
  readMyBook(): Promise<AdapterResult<readonly LeadView[]>>;
  readTeamBook(): Promise<AdapterResult<readonly LeadView[]>>;
  readLead(id: LeadId): Promise<AdapterResult<LeadView>>;
  /** One bucket per rung plus "lost", cached under this person's own scope. */
  readMyFunnel(): Promise<CacheRead<readonly CountBucket[]>>;
  /** The same over this person's subtree, cached under the subtree scope. Not for someone with no reports. */
  readTeamFunnel(): Promise<CacheRead<readonly CountBucket[]>>;
  writeTouch(id: LeadId, channel: Channel, expect: LeadVersion | null): Promise<AdapterResult<LeadView>>;
  moveRung(id: LeadId, move: RungMove, expect: LeadVersion | null): Promise<AdapterResult<LeadView>>;
  saveNext(id: LeadId, next: NextStep, expect: LeadVersion | null): Promise<AdapterResult<LeadView>>;
  setForecast(id: LeadId, category: FcCat, expect: LeadVersion | null): Promise<AdapterResult<LeadView>>;
  closeLost(id: LeadId, why: LostWhy, note: string, expect: LeadVersion | null): Promise<AdapterResult<LeadView>>;
}

/** Cache key prefix for every funnel; a write invalidates it across all scopes that counted the lead. */
export const FUNNEL_PREFIX = "funnel.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** The prototype's `stamp()` shape: "DD Mon HH:MM". */
const stampOf = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const CHANNELS: readonly Channel[] = ["msg", "email", "call", "visit"];
const FCATS: readonly FcCat[] = ["commit", "probable", "pipeline"];
const RUNGS = (Object.entries(ST) as [string, number][]).sort((a, b) => a[1] - b[1]);

const failure = (kind: AdapterErrorKind, detail: string, retryable = false): { readonly ok: false; readonly error: AdapterError } => ({
  ok: false,
  error: { kind, detail, retryable },
});
const refusedAggregate = <V extends AggregateValue>(reason: string, at: number, error: unknown = null): CacheError<V> => ({
  state: "error",
  reason,
  error,
  failedAt: at,
  lastGoodAt: null,
  settled: null,
});

export interface FixtureAdapterOptions {
  readonly who: PersonKey;
  /** For `asOf` and the cache. */
  readonly clock?: () => number;
  /** For the stamps written onto records; defaults to the console's frozen `NOW` (28 Aug 2026). */
  readonly stampClock?: () => number;
  readonly cache?: ScopedCache;
}

export function createFixtureAdapter(options: FixtureAdapterOptions): ConsoleAdapter {
  const who = options.who;
  if (typeof who !== "string" || !Object.prototype.hasOwnProperty.call(PEOPLE, who)) throw new TypeError(`Unknown person ${JSON.stringify(who)}.`);
  const clock = options.clock ?? Date.now;
  const stampClock = options.stampClock ?? (() => NOW.getTime());
  const cache = options.cache ?? createScopedCache({ clock });
  const paper = seedBook().PAPER;
  const book = new Map<LeadId, { readonly lead: Lead; readonly rev: number }>();
  for (const l of LEADS) book.set(l.id, { lead: structuredClone(l), rev: 1 });

  /* Zoho's visibility, restated: own records, the role hierarchy, and D44's cover share. */
  const reportsTo = (person: PersonKey | null, manager: PersonKey): boolean => {
    let at: PersonKey | null = person && PEOPLE[person] ? PEOPLE[person].mgr : null;
    for (let hops = 0; at && hops < 32; hops++) {
      if (at === manager) return true;
      at = PEOPLE[at] ? PEOPLE[at].mgr : null;
    }
    return false;
  };
  const manages = Object.values(PEOPLE).some((p) => p.mgr === who);
  const coveredBy = (l: Lead): PersonKey | null => l.cov?.by ?? (l.own && COVER[l.own] ? COVER[l.own].by : null);
  const mine = (l: Lead) => l.own === who || coveredBy(l) === who;
  const visible = (l: Lead) => mine(l) || reportsTo(l.own, who) || (l.own === null && manages);

  const versionOf = (rev: number): LeadVersion => `fx-${rev}`;
  const view = (id: LeadId): LeadView => {
    const entry = book.get(id)!;
    return { lead: structuredClone(entry.lead), paper: paper[id] ? structuredClone(paper[id]) : null, version: versionOf(entry.rev) };
  };
  const list = (pick: (l: Lead) => boolean): readonly LeadView[] => [...book.values()].filter((e) => pick(e.lead)).map((e) => view(e.lead.id));
  const funnelOf = (pick: (l: Lead) => boolean): CountBucket[] => {
    const leads = [...book.values()].map((e) => e.lead).filter(pick);
    const rungs = RUNGS.map(([name, done]) => ({ key: name.toLowerCase(), count: leads.filter((l) => !l.lost && l.done === done).length }));
    return [...rungs, { key: "lost", count: leads.filter((l) => !!l.lost).length }];
  };

  const write = async (id: LeadId, expect: LeadVersion | null, change: (lead: Lead, at: string) => AdapterError | null): Promise<AdapterResult<LeadView>> => {
    const entry = book.get(id);
    if (!entry) return failure("not-found", `No lead ${id}.`);
    if (!visible(entry.lead)) return failure("forbidden", `Lead ${id} is not in ${who}'s book or subtree.`);
    if (expect !== null && expect !== versionOf(entry.rev)) return failure("conflict", `Lead ${id} changed since it was loaded (${expect} → ${versionOf(entry.rev)}).`);
    const draft = structuredClone(entry.lead);
    const refused = change(draft, stampOf(stampClock()));
    if (refused) return { ok: false, error: refused };
    book.set(id, { lead: draft, rev: entry.rev + 1 });
    await cache.invalidate({ prefix: FUNNEL_PREFIX }); // the IR's own funnel, their manager's subtree, a role's
    return { ok: true, value: view(id), asOf: clock() };
  };
  const bad = (kind: AdapterErrorKind, detail: string): AdapterError => ({ kind, detail, retryable: false });

  return {
    source: "fixture",
    who,
    async readMyBook() {
      return { ok: true, value: list(mine), asOf: clock() };
    },
    async readTeamBook() {
      if (!manages) return failure("forbidden", `${who} has no reports; there is no team book to read.`);
      return { ok: true, value: list(visible), asOf: clock() };
    },
    async readLead(id) {
      const entry = book.get(id);
      if (!entry) return failure("not-found", `No lead ${id}.`);
      if (!visible(entry.lead)) return failure("forbidden", `Lead ${id} is not in ${who}'s book or subtree.`);
      return { ok: true, value: view(id), asOf: clock() };
    },
    readMyFunnel() {
      return cache.read(cacheKey<readonly CountBucket[]>({ kind: "user", userId: who }, `${FUNNEL_PREFIX}rungs`), async () => funnelOf(mine));
    },
    async readTeamFunnel() {
      if (!manages) return refusedAggregate<readonly CountBucket[]>("forbidden", clock());
      return cache.read(cacheKey<readonly CountBucket[]>({ kind: "subtree", managerId: who }, `${FUNNEL_PREFIX}rungs`), async () => funnelOf(visible));
    },
    writeTouch(id, channel, expect) {
      return write(id, expect, (l, at) => {
        if (!CHANNELS.includes(channel)) return bad("invalid", `Unknown channel ${String(channel)}.`);
        if (l.lost) return bad("invalid", "A closed lead takes no new touches.");
        l.touch = { ...l.touch, [channel]: [...l.touch[channel], at] };
        return null;
      });
    },
    moveRung(id, move, expect) {
      return write(id, expect, (l, at) => {
        if (l.lost) return bad("invalid", "A closed lead does not move.");
        if (l.done !== move.from) return { kind: "conflict", detail: `Lead ${id} is on rung ${l.done}, not ${move.from}.`, retryable: false };
        if (!Number.isInteger(move.to) || move.to < ST.CAPTURE || move.to > ST.ONBOARDED || Math.abs(move.to - move.from) !== 1) {
          return bad("invalid", "A rung moves one step at a time.");
        }
        const gated = LADDER[Math.max(move.to, move.from) - 1]?.gate;
        if (gated) return bad("forbidden", `That rung rests on Finance's ${gated} gate, which the IR does not tick.`);
        if (move.to > move.from) l.at = [...l.at, at];
        else {
          l.at = l.at.slice(0, move.to);
          l.undoAt = at;
          l.undoWhat = LADDER[move.from - 1]?.t;
        }
        l.done = move.to;
        return null;
      });
    },
    saveNext(id, next, expect) {
      return write(id, expect, (l) => {
        if (!next || typeof next.t !== "string" || !next.t.trim() || typeof next.by !== "string" || !next.by.trim()) {
          return bad("invalid", "A next step is an action and a date.");
        }
        l.nx = { ...next };
        return null;
      });
    },
    setForecast(id, category, expect) {
      return write(id, expect, (l, at) => {
        if (!FCATS.includes(category)) return bad("invalid", `Unknown forecast category ${String(category)}.`);
        l.fc = { c: category, by: l.fc?.by ?? "", ev: l.fc?.ev ?? "", at, who };
        return null;
      });
    },
    closeLost(id, why, note, expect) {
      return write(id, expect, (l, at) => {
        if (l.lost) return bad("invalid", "This lead is already closed.");
        if (!(LOSTWHY as readonly string[]).includes(why)) return bad("invalid", "A loss needs a reason from the closed list.");
        l.lost = { why, note: typeof note === "string" ? note : "", at, by: who, stage: l.done, nx: l.nx };
        l.nx = null;
        return null;
      });
    },
  };
}

export interface LiveAdapterDeps {
  readonly who: PersonKey;
  /** The signed-in person's own token — never a service token (D53). */
  readonly credential: UserCredential;
  readonly client: ZohoClient;
  readonly cache: ScopedCache;
  readonly clock?: () => number;
}

/** Typed stub. Each method names the call that will back it, and fails loudly until it is built. */
export function createLiveAdapter(deps: LiveAdapterDeps): ConsoleAdapter {
  const clock = deps.clock ?? Date.now;
  const todo = async <T>(backedBy: string): Promise<AdapterResult<T>> => failure("not-implemented", `Live adapter not built yet: ${backedBy}.`);
  const todoAggregate = async (backedBy: string): Promise<CacheRead<readonly CountBucket[]>> =>
    refusedAggregate<readonly CountBucket[]>("not-implemented", clock(), new Error(`Live adapter not built yet: ${backedBy}.`));
  return {
    source: "live",
    who: deps.who,
    readMyBook: () => todo("client.coql over Leads where Owner is the acting person, fields from the projection allow-list (D46)"),
    readTeamBook: () => todo("client.coql under the manager's own token, scoped by Zoho's role hierarchy (D52)"),
    readLead: () => todo("client.getRecord(Leads, id) with the projection's fields; wasDeleted() when Zoho returns nothing"),
    readMyFunnel: () => todoAggregate("cache.read under the user scope over a COQL GROUP BY on the rung field"),
    readTeamFunnel: () => todoAggregate("cache.read under the subtree scope over a COQL GROUP BY on the rung field"),
    writeTouch: () => todo("client.update(Leads, id, touch fields, { ifUnmodifiedSince: version })"),
    moveRung: () => todo("client.blueprintTransition(Leads, id, transitionId) — never a field write (D45)"),
    saveNext: () => todo("client.update(Leads, id, next-step fields, { ifUnmodifiedSince: version })"),
    setForecast: () => todo("client.update(Leads, id, forecast fields, { ifUnmodifiedSince: version })"),
    closeLost: () => todo("client.blueprintTransition to Lost — the Lost guard lives in Zoho again (D52)"),
  };
}
