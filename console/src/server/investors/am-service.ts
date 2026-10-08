/**
 * M09-S04-T03 / M09-S02-T03 / M16-S08-T02 — THE ACCOUNT-MANAGEMENT LIST, on the signed-in person's own token (D53).
 *
 * One read that answers three screens, so no screen has to read the book to count it:
 *   managers   the manager dropdown of the "Name a manager" drawer: every Key Account Manager (Zoho users, active first),
 *              each with accounts, Tier A, gone quiet, conversations logged, tickets open, accounts ended on a concern;
 *   pool       the accounts with no named manager (accounts, Tier A, gone quiet, "should be named");
 *   accounts   the AM row list behind GET /api/investors/am (name, ARL ID, units, tier, manager, last heard, next owed);
 *   service    the Numbers "Service" section: the four tiles, the tier counts and the monthly load.
 *
 * Built from readers that already exist and the rules the care queue already uses (../queues/rules): the AM book
 * (../investors/book list), Touches of the book's origin leads (the last conversation and who held it), the Cases
 * register (open tickets per owner) and the Zoho user list for names. Nothing is cached and no Receipt, price or amount
 * is read (the AM wall, D12). A KAM gets their own row only; the Head of AM gets everyone. Logs carry ids and codes.
 *
 * PROVISIONAL: Contacts has no Tier field — the tier is computed from issued units (rules.tierFor). The manager names come
 * from the Zoho user list on the person's own token; where Zoho refuses it the managers are the ids found on the book and
 * their names read null (the page then shows "a manager"). "Land" (the blocks held) is not on the AM projection.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { IN_CHUNK, idOf, inClause, istStamp, pagedSelect, str } from "../cases/predicate";
import type { CasesRegister } from "../cases/register";
import { amScopeOf } from "../data/am-scope";
import type { KamBookEntry, KamBookService } from "./book";
import { goneQuiet, overdueDays, tierFor, type CareAccount, type Tier } from "../queues/rules";

const TOUCHES_MODULE = "Touches";
const TOUCH_FIELDS = Object.freeze(["id", "Lead", "Occurred_At", "Owner", "Mood"]);
/** A ticket past its window: high priority open more than 2 days, any other more than 5 (the prototype's Service tile). */
const SLA_DAYS: Readonly<Record<"high" | "normal", number>> = Object.freeze({ high: 2, normal: 5 });
const DAY_MS = 86_400_000;

export interface AmManagerRow {
  readonly id: string;
  /** null when Zoho did not name them to this person. */
  readonly name: string | null;
  /** deactivated in Zoho but still holding accounts */
  readonly left: boolean;
  readonly accounts: number;
  readonly tierA: number;
  /** their accounts by tier, and the conversations a month the cadences already promise them (the drawer's "what they carry today") */
  readonly tiers: Readonly<Record<Tier["k"], number>>;
  readonly perMonth: number;
  readonly goneQuiet: number;
  /** conversations logged by them (Touches they own) — null when Touches could not be read */
  readonly conversations: number | null;
  /** tickets open on them — null when the Cases register could not be read */
  readonly openTickets: number | null;
  readonly onConcern: number;
}
export interface AmPoolRow { readonly accounts: number; readonly tierA: number; readonly goneQuiet: number; readonly shouldBeNamed: number }
export interface AmAccountRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly city: string | null;
  readonly nri: boolean;
  readonly units: number;
  readonly tier: Tier["k"];
  readonly kamUserId: string | null;
  readonly introduced: boolean;
  /** naive IST "YYYY-MM-DDTHH:mm", or null: never spoken to */
  readonly lastHeardAt: string | null;
  readonly lastMood: string | null;
  /** days past the cadence (negative: days until the next conversation is owed); null with no base date */
  readonly overdue: number | null;
}
export interface AmServiceTiles {
  readonly goneQuiet: number;
  /** whole per cent of accounts inside their cadence; 100 with no accounts */
  readonly insideCadencePct: number;
  /** null when the Cases register could not be read */
  readonly ticketsPastWindow: number | null;
  readonly endedOnConcern: number;
}
export interface AmServiceView {
  readonly book: "kam" | "head";
  readonly managers: readonly AmManagerRow[];
  readonly pool: AmPoolRow | null;
  readonly accounts: readonly AmAccountRow[];
  /** the active Key Account Managers in the org (the cadence card's "N people can deliver"); null when Zoho would not say */
  readonly team: number | null;
  readonly tiers: Readonly<Record<Tier["k"], number>>;
  /** conversations a month the cadences promise: the whole book, and the part of it that sits in the pool */
  readonly load: { readonly perMonth: number; readonly poolPerMonth: number };
  readonly tiles: AmServiceTiles;
  readonly problems: readonly string[];
  readonly asOf: number;
}

export type AmServiceResult =
  | { readonly ok: true; readonly view: AmServiceView }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "seat-denied" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface AmKamName { readonly id: string; readonly name: string; readonly left: boolean }
export interface AmServiceDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly amBook: Pick<KamBookService, "list">;
  readonly cases: Pick<CasesRegister, "list">;
  /** Every Key Account Manager the person's token can see, or null when Zoho would not say (names then read null). */
  readonly kams: (credential: UserCredential, signal?: AbortSignal) => Promise<readonly AmKamName[] | null>;
  readonly log: Pick<OpsLog, "refusal">;
  readonly clock?: () => number;
  readonly maxPages?: number;
}
export interface AmServicePrincipal { readonly credential: UserCredential; readonly sessionId: string; readonly seat: string }

interface Touch { readonly at: string; readonly mood: string | null }
export interface AmInputs {
  readonly book: readonly KamBookEntry[];
  /** last conversation per origin lead */
  readonly last: ReadonlyMap<string, Touch>;
  /** conversations logged per owner, or null when Touches was unreadable */
  readonly touchesBy: ReadonlyMap<string, number> | null;
  readonly tickets: readonly { readonly own: string; readonly state: string; readonly pri: "high" | "normal"; readonly opened: string }[] | null;
  readonly kams: readonly AmKamName[] | null;
}

const concern = (mood: string | null): boolean => !!mood && /concern/i.test(mood);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The view from the inputs — pure, so the rules are tested without Zoho. `me` is the reader; a KAM reads their own row only. */
export function amServiceView(i: AmInputs, o: { readonly kind: "kam" | "head"; readonly me: string; readonly now: number; readonly problems?: readonly string[] }): AmServiceView {
  const book = o.kind === "kam" ? i.book.filter((e) => e.kamUserId === o.me) : i.book;
  const accounts: (CareAccount & { e: KamBookEntry })[] = book.map((e) => ({
    e, id: e.id, name: [e.firstName, e.lastName].filter(Boolean).join(" "), units: e.issuedUnits, kamUserId: e.kamUserId,
    introducedAt: e.introductionAt, since: e.kamSince ?? e.saidYesAt, lastHeardAt: e.originLeadId ? i.last.get(e.originLeadId)?.at ?? null : null,
  }));
  const moodOf = (a: { e: KamBookEntry }): string | null => (a.e.originLeadId ? i.last.get(a.e.originLeadId)?.mood ?? null : null);
  const quiet = (a: CareAccount) => goneQuiet(a, o.now);
  const tier = (a: CareAccount) => tierFor(a.units);

  const perMonth = (xs: readonly CareAccount[]) => round1(xs.reduce((s, a) => s + 30 / tierFor(a.units).every, 0));
  const known = new Map((i.kams ?? []).map((k) => [k.id, k]));
  const ids = new Set<string>([...known.keys()]);
  for (const a of accounts) if (a.kamUserId) ids.add(a.kamUserId);
  const wanted = o.kind === "kam" ? [o.me] : [...ids];
  const managers = wanted.map((id): AmManagerRow => {
    const k = known.get(id);
    const mine = accounts.filter((a) => a.kamUserId === id);
    const byTier = { A: 0, B: 0, C: 0 };
    for (const a of mine) byTier[tier(a).k]++;
    return Object.freeze({
      id, name: k?.name || null, left: !!k?.left, accounts: mine.length, tierA: byTier.A, tiers: Object.freeze(byTier), perMonth: perMonth(mine),
      goneQuiet: mine.filter(quiet).length, conversations: i.touchesBy ? i.touchesBy.get(id) ?? 0 : null,
      openTickets: i.tickets ? i.tickets.filter((t) => t.own === id && t.state !== "closed").length : null,
      onConcern: mine.filter((a) => concern(moodOf(a))).length,
    });
  }).sort((a, b) => Number(a.left) - Number(b.left) || Number(a.name === null) - Number(b.name === null) || (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));

  const pooled = accounts.filter((a) => !a.kamUserId);
  const pool: AmPoolRow | null = o.kind === "kam" ? null : Object.freeze({
    accounts: pooled.length, tierA: pooled.filter((a) => tier(a).k === "A").length, goneQuiet: pooled.filter(quiet).length,
    shouldBeNamed: pooled.filter((a) => !tier(a).pool).length,
  });

  const rows = accounts.map((a): AmAccountRow => {
    const l = a.e.originLeadId ? i.last.get(a.e.originLeadId) : undefined;
    return Object.freeze({
      id: a.id, code: a.e.investorCode, name: a.name, city: a.e.city, nri: a.e.residency === "NRI" || a.e.residency === "OCI", units: a.units,
      tier: tier(a).k, kamUserId: a.kamUserId, introduced: !!a.introducedAt, lastHeardAt: l ? istStamp(l.at) : null, lastMood: l?.mood ?? null,
      overdue: overdueDays(a, o.now),
    });
  });
  const tiers = { A: 0, B: 0, C: 0 };
  for (const a of accounts) tiers[tier(a).k]++;
  const kept = accounts.filter((a) => { const d = overdueDays(a, o.now); return d !== null && d <= 0; }).length;
  const tickets = i.tickets && i.tickets.filter((t) => t.state !== "closed" && (o.kind === "head" ? ids.has(t.own) || t.own === o.me : t.own === o.me));
  const days = (t: { opened: string }) => { const ms = Date.parse(t.opened + "+05:30"); return Number.isFinite(ms) ? Math.floor((o.now - ms) / DAY_MS) : 0; };
  return Object.freeze({
    book: o.kind, managers: Object.freeze(managers), pool, accounts: Object.freeze(rows), team: i.kams ? i.kams.filter((k) => !k.left).length : null, tiers: Object.freeze(tiers),
    load: Object.freeze({ perMonth: perMonth(accounts), poolPerMonth: perMonth(pooled) }),
    tiles: Object.freeze({
      goneQuiet: accounts.filter(quiet).length, insideCadencePct: accounts.length ? Math.round((kept / accounts.length) * 100) : 100,
      ticketsPastWindow: tickets ? tickets.filter((t) => days(t) > SLA_DAYS[t.pri]).length : null,
      endedOnConcern: accounts.filter((a) => concern(moodOf(a))).length,
    }),
    problems: Object.freeze([...(o.problems ?? [])]), asOf: o.now,
  });
}

export function createAmService(deps: AmServiceDeps) {
  const clock = deps.clock ?? Date.now;

  async function byIds(cred: UserCredential, ids: readonly string[], signal?: AbortSignal) {
    const rows: ZohoRecord[] = [];
    let truncated = false;
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const inc = inClause("Lead", ids.slice(i, i + IN_CHUNK));
      if (!inc) continue;
      const r = await pagedSelect(deps.crm, cred, TOUCH_FIELDS, TOUCHES_MODULE, inc, "id asc", signal, deps.maxPages);
      if (!r.ok) return r;
      truncated ||= r.truncated;
      rows.push(...r.rows);
    }
    return { ok: true as const, rows, truncated };
  }

  return Object.freeze({
    async read(p: AmServicePrincipal, signal?: AbortSignal): Promise<AmServiceResult> {
      const me = p?.credential?.userId;
      const scope = typeof me === "string" && typeof p.seat === "string" ? amScopeOf(p.seat, me) : null;
      if (!scope || typeof me !== "string") {
        if (typeof me === "string") { try { deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "am-service-read", reason: "seat-denied", recordIds: [] }); } catch { /* a log never breaks the refusal */ } }
        return { ok: false, kind: "refused", reason: "seat-denied" };
      }
      const kind = scope.kind === "kam" ? "kam" : "head";
      const problems: string[] = [];
      const b = await deps.amBook.list({ credential: p.credential, sessionId: p.sessionId }, signal);
      if (!b.ok) return b.kind === "refused" ? { ok: false, kind: "refused", reason: "seat-denied" } : { ok: false, kind: "source-error", errorKind: b.errorKind, retryable: b.retryable };
      const book = kind === "kam" ? b.value.filter((e) => e.kamUserId === me) : b.value;

      const leads = [...new Set(book.map((e) => e.originLeadId).filter((x): x is string => !!x))];
      const last = new Map<string, Touch>();
      const kamOfLead = new Map<string, string | null>();
      for (const e of book) if (e.originLeadId && !kamOfLead.has(e.originLeadId)) kamOfLead.set(e.originLeadId, e.kamUserId);
      let touchesBy: Map<string, number> | null = new Map();
      const t = leads.length ? await byIds(p.credential, leads, signal) : { ok: true as const, rows: [] as ZohoRecord[], truncated: false };
      if (!t.ok) { problems.push(`touches:${t.kind === "refused" ? t.reason : t.errorKind}`); touchesBy = null; }
      else {
        if (t.truncated) problems.push("touches:truncated");
        for (const r of t.rows) {
          const lead = idOf(r.Lead), at = str(r, "Occurred_At", 40), owner = idOf(r.Owner);
          if (!lead || !at || !Number.isFinite(Date.parse(at))) continue;
          if (owner) touchesBy!.set(owner, (touchesBy!.get(owner) ?? 0) + 1);
          // "Last heard" is the KAM's own logged conversations: a lead-side IR touch on the origin lead is not one.
          if (!kamOfLead.get(lead) || owner !== kamOfLead.get(lead)) continue;
          const prev = last.get(lead);
          if (!prev || Date.parse(at) > Date.parse(prev.at)) last.set(lead, { at, mood: str(r, "Mood", 20) });
        }
      }

      let tickets: AmInputs["tickets"] = [];
      const c = await deps.cases.list({ credential: p.credential, seat: p.seat }, signal);
      if (!c.ok) { problems.push(`cases:${c.kind === "refused" ? c.reason : c.errorKind}`); tickets = null; }
      else {
        if (c.truncated) problems.push("cases:truncated");
        tickets = c.rows.map((x) => ({ own: x.own, state: x.state, pri: x.pri, opened: x.opened }));
      }

      /* the user list names the managers the Head of AM offers; a KAM reads it only to count the team (their own row stays their own) */
      let kams: readonly AmKamName[] | null = null;
      try { kams = await deps.kams(p.credential, signal); } catch { kams = null; }
      if (!kams) problems.push("users:unavailable");
      return { ok: true, view: amServiceView({ book, last, touchesBy, tickets, kams }, { kind, me, now: clock(), problems }) };
    },
  });
}
export type AmService = ReturnType<typeof createAmService>;
