/**
 * M01-S03-T01 — THE SERVER DATA LAYER: one signed-in person's Dataset, read live from Zoho (D45, D53).
 *
 * Composition, not a second implementation. Per request it is handed ONE shared client (built on the
 * process-wide gate, ./runtime) and the person's own credential, and it composes the readers that
 * already exist:
 *   Leads      — createLeadsBook (server/leads/book): personal scope for an IR, team for an IR Manager;
 *                then one projection read of the rung stamps (server/leads/journey RUNGS) for those ids.
 *   KAM book   — createKamBookService (server/investors/book) for a Key Account Manager's own book.
 *   Investors  — ./adapters for the other scopes and for LLPs, allotments, receipts, cases, holdings.
 * into the `Dataset` of src/lib/data/types.ts. Nothing is copied or kept: rows live for one response
 * (D45 zero copy). The shared cache holds only aggregates, keyed by ./scope (D52/D53) — `count()`.
 *
 * A reader that fails leaves its part of the book empty and says so in `problems` (ids and codes,
 * never values); it never falls back to older rows.
 */

import type { Channel, Lead, LostWhy, Source } from "../../domain/types";
import type { Dataset } from "../../lib/data/types";
import { emptyDataset } from "../../lib/data/empty";
import type { ImInvestor } from "../../lib/im/types";
import type { CacheError, CacheFresh, CacheStale, ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import { createKamBookService, type KamBookEntry } from "../investors/book";
import { createLeadsBook, type LeadRow, type LeadsAccess } from "../leads/book";
import { LOST_REASONS } from "../leads/followup";
import { RUNGS } from "../leads/journey";
import type { ZohoProfileName, ZohoRoleName, ZohoSeat } from "../oauth/seat";
import { CONSOLE_SEAT, type ConsoleSession } from "../oauth/user-session";
import { createInvestorsAdapters, type AllotmentRow, type ContactRow, type ReadResult } from "./adapters";
import type { InvestorEvents } from "./events";
import { MODULES } from "./projections";
import { scopedKey, scopesFor, type BookScope, type SeatScopes } from "./scope";

export interface LivePrincipal {
  readonly credential: UserCredential;
  readonly session: ConsoleSession;
  readonly sessionId: string;
}

export interface SeatIds {
  readonly roleIds: Readonly<Partial<Record<ZohoRoleName, string>>>;
  readonly profileIds: Readonly<Partial<Record<ZohoProfileName, string>>>;
}

export interface LiveDeps {
  /** The one shared client of this request — on the process-wide gate. */
  readonly crm: Pick<ZohoClient, "coql" | "aggregate" | "getRecord" | "update" | "insert">;
  readonly cache: ScopedCache;
  readonly log: OpsLog;
  readonly events: InvestorEvents;
  readonly recordIdPrefix: string;
  /** Re-reads the live session behind a session id: who is signed in now, or null. */
  readonly recheck: (sessionId: string, signal?: AbortSignal) => Promise<{ readonly credential: UserCredential; readonly session: ConsoleSession } | null>;
  /** Pinned role/profile ids (ZOHO_SEAT_IDS); the KAM book checks them. */
  readonly seatIds?: SeatIds;
  /** An IR Manager's reports; null → the manager's own token under Zoho's role hierarchy (PROVISIONAL, jev "a"). */
  readonly subtreeOf?: (managerId: string, signal?: AbortSignal) => Promise<readonly string[] | null>;
  readonly unassignedQueueUserId?: string | null;
  readonly clock?: () => number;
}

export interface LiveLoad {
  readonly ds: Dataset;
  readonly scopes: SeatScopes;
  /** What could not be read: `<book>:<code>` — never a value. Empty when everything answered. */
  readonly problems: readonly string[];
}

const SEAT_ROLE: Readonly<Partial<Record<ZohoSeat, { role: ZohoRoleName; profile: ZohoProfileName }>>> = Object.freeze({
  "investor-relations": { role: "Investor Relations", profile: "IR" },
  "ir-manager": { role: "IR Manager", profile: "IR Manager" },
  "channel-partner": { role: "Channel Partner", profile: "Channel Partner" },
  "key-account-manager": { role: "Key Account Manager", profile: "KAM" },
  "head-of-account-management": { role: "Head of Account Management", profile: "AM Head" },
});
/** Console seat token → Zoho seat (the inverse of CONSOLE_SEAT); Digital Infrastructure's "ops" is its own. */
export function zohoSeatOf(token: string): ZohoSeat | null {
  if (token === "ops" || token === "di") return "digital-infrastructure";
  const hit = (Object.entries(CONSOLE_SEAT) as [ZohoSeat, string | null][]).find(([, t]) => t === token);
  return hit ? hit[0] : null;
}

const SOURCES: ReadonlySet<string> = new Set(["Events", "Founder network", "Referral — investor", "Channel partner", "Website", "LinkedIn", "Walk-in or call-in", "Other"]);
const LOST_BY_ZOHO: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(Object.entries(LOST_REASONS).map(([k, v]) => [v, k])));
const RUNG_FIELDS = RUNGS.map((r) => r.field);
const LEAD_DETAIL = Object.freeze(["id", ...RUNG_FIELDS, "Lost_Reason", "Next_Step", "Consent_WhatsApp", "Consent_Email", "Consent_Call", "Consent_Visit"]);
const CONSENT: Readonly<Record<Channel, string>> = { msg: "Consent_WhatsApp", email: "Consent_Email", call: "Consent_Call", visit: "Consent_Visit" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** A Zoho datetime as the console prints it, in IST: "DD Mon HH:MM". */
export function stampOf(zoho: string | null | undefined): string {
  const ms = typeof zoho === "string" ? Date.parse(zoho) : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 5.5 * 3_600_000);
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
/** Naive IST wall time "YYYY-MM-DDTHH:mm" of a Zoho datetime. */
const istIso = (zoho: string | null | undefined): string | null => {
  const ms = typeof zoho === "string" ? Date.parse(zoho) : NaN;
  return Number.isFinite(ms) ? new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 16) : null;
};
const istNow = (ms: number) => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 16);

/** One LeadRow (plus its stamps) as the console's Lead. Only what Zoho holds; the rest empty, never invented. */
export function leadOf(row: LeadRow, detail: ZohoRecord | undefined): Lead {
  const at: string[] = [stampOf(row.createdAt)];
  let done = 1;
  let skipped = false;
  for (const r of RUNGS) {
    const v = detail?.[r.field];
    if (typeof v === "string" && v) { done = r.n; at.push(stampOf(v)); continue; }
    if ("skip" in r && r.skip && RUNGS.some((x) => x.n > r.n && typeof detail?.[x.field] === "string" && detail[x.field])) { skipped = true; at.push(""); continue; }
    break;
  }
  const con: Partial<Record<Channel, boolean>> = {};
  for (const [ch, f] of Object.entries(CONSENT) as [Channel, string][]) if (typeof detail?.[f] === "boolean") con[ch] = detail[f] as boolean;
  const nextText = typeof detail?.Next_Step === "string" ? detail.Next_Step : null;
  const nextIso = istIso(row.nextStepAt);
  const lostWhy = typeof detail?.Lost_Reason === "string" ? (LOST_BY_ZOHO[detail.Lost_Reason] ?? detail.Lost_Reason) : "";
  return {
    id: row.id,
    n: [row.firstName, row.lastName].filter(Boolean).join(" "),
    ph: row.mobile ?? "", em: "", city: "",
    own: row.ownerId, sec: row.secondaryOwnerId,
    src: (row.source && SOURCES.has(row.source) ? row.source : "Other") as Source,
    ev: null, done, at,
    touch: { msg: [], email: [], call: [], visit: [] },
    units: row.unitsInterested ?? 0, unitsKnown: row.unitsInterested !== null,
    nx: nextText && nextIso ? { t: nextText, by: stampOf(row.nextStepAt).slice(0, 6), d: nextIso.slice(0, 10), who: row.ownerId ?? "", at: "" } : null,
    fc: null,
    consent: false, con,
    reply: row.lastReplyAt ? stampOf(row.lastReplyAt) : null,
    lost: row.lostAt ? { why: lostWhy as LostWhy, note: "", at: stampOf(row.lostAt), by: row.ownerId ?? "", stage: done } : null,
    ...(skipped ? { skipped: true } : {}),
    ...(row.coverById ? { cov: { by: row.coverById, to: row.coverUntil ? stampOf(row.coverUntil + "T00:00:00+05:30").slice(0, 6) : "", why: "" } } : {}),
  };
}

/** A Contact (and its allotments) as the Investors side's investor. Identity fields are never read: pan null, bank blank. */
export function investorOf(c: ContactRow, allots: readonly AllotmentRow[], blockOf: (llpId: string) => string): ImInvestor {
  const live = allots.filter((a) => a.Allocation_Status !== "Cancelled");
  const units = live.reduce((t, a) => t + a.Committed_Units, 0);
  const blocks: Record<string, number> = {};
  for (const a of live) { const b = blockOf(a.LLP_Lookup) || a.LLP_Lookup; blocks[b] = (blocks[b] ?? 0) + a.Committed_Units; }
  const paid = live.length > 0 && live.every((a) => (a.receivable ?? 1) === 0 && (a.received ?? 0) > 0);
  return {
    id: c.id, n: [c.firstName, c.lastName].filter(Boolean).join(" "), ph: c.mobile ?? "", em: c.email ?? "", city: c.city ?? "", addr: c.address,
    nri: !!c.residency && /non|nri/i.test(c.residency),
    pan: null, aadh: null, aref: null, kyc: "pending", kycOn: null,
    bank: { acct: "", ifsc: "", name: "", drop: "" },
    units, blocks, st: live.some((a) => a.Allocation_Status === "Issued") ? "allocated" : paid ? "paid" : "reserved",
    ir: c.originatingIrId ?? "", src: "", since: c.saidYesAt ?? c.createdAt ?? "", nominee: c.nominee ?? "",
    kam: c.kamId, kamOn: c.kamSince, intro: c.introAt, ...(c.originLeadId ? { lead: c.originLeadId } : {}),
  };
}

const kamEntryToContact = (e: KamBookEntry): ContactRow => ({
  id: e.id, code: e.investorCode, firstName: e.firstName, lastName: e.lastName, mobile: e.mobile, email: e.email, city: e.city,
  address: [e.flatOrBuilding, e.street, e.city, e.state, e.postalCode, e.country].filter(Boolean).join(", "),
  residency: e.residency, nominee: e.nomineeName ? (e.nomineeRelation ? `${e.nomineeName} (${e.nomineeRelation})` : e.nomineeName) : null,
  kamId: e.kamUserId, kamSince: e.kamSince, introAt: e.introductionAt, originLeadId: e.originLeadId, originatingIrId: null,
  saidYesAt: e.saidYesAt, createdAt: null,
});

export type CountRead = CacheFresh<number> | CacheStale<number> | CacheError<number>;

export function createLiveDataLayer(deps: LiveDeps) {
  const clock = deps.clock ?? Date.now;
  const adapters = createInvestorsAdapters({ crm: deps.crm, events: deps.events });

  /** The leads book's access, re-derived from the live session on every recheck (never from the request). */
  const leadsAccess = (start: ConsoleSession) => ({
    async recheck(cred: UserCredential, sid: string, signal?: AbortSignal): Promise<LeadsAccess | null> {
      const now = await deps.recheck(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      if (now.session.seat !== start.seat) { deps.events.seatChange(cred.userId, start.seat, now.session.seat); return null; }
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      const scope = scopesFor(now.session.seat, cred.userId).leads;
      const ids = SEAT_ROLE[seat];
      let team: readonly string[] | null = null;
      if (scope.kind === "subtree") team = deps.subtreeOf ? await deps.subtreeOf(cred.userId, signal) : null;
      return {
        actor: { userId: cred.userId, roleId: (ids && deps.seatIds?.roleIds[ids.role]) || "", profileId: (ids && deps.seatIds?.profileIds[ids.profile]) || "", seat },
        mayViewLeads: scope.kind !== "none",
        teamOwnerIds: scope.kind === "subtree" && team ? [...team] : null,
        // PROVISIONAL (jev "a"): without a subtree reader the manager's own token, under Zoho's role
        // hierarchy and Private sharing, is what limits the team read; "all" is Digital Infrastructure.
        teamOrgWide: scope.kind === "all" || (scope.kind === "subtree" && !team),
        unassignedQueueUserId: deps.unassignedQueueUserId ?? null,
        seesUnassignedInPersonal: now.session.seat === "ir",
      };
    },
  });

  const kamAccess = (start: ConsoleSession) => ({
    async recheck(cred: UserCredential, sid: string, signal?: AbortSignal) {
      const now = await deps.recheck(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      if (now.session.seat !== start.seat) { deps.events.seatChange(cred.userId, start.seat, now.session.seat); return null; }
      const seat = zohoSeatOf(now.session.seat);
      const ids = seat ? SEAT_ROLE[seat] : undefined;
      if (seat !== "key-account-manager" || !ids) return null;
      return { actor: { userId: cred.userId, roleId: deps.seatIds?.roleIds[ids.role] ?? "", profileId: deps.seatIds?.profileIds[ids.profile] ?? "", seat }, activeKamUserIds: [cred.userId] };
    },
  });

  async function readLeads(p: LivePrincipal, scope: BookScope, problems: string[], signal?: AbortSignal): Promise<Lead[]> {
    if (scope.kind === "none" || scope.kind === "own-lead" || scope.kind === "own-book" || scope.kind === "org") return [];
    const book = createLeadsBook({ crm: deps.crm, access: leadsAccess(p.session), log: deps.log, recordIdPrefix: deps.recordIdPrefix, clock });
    const which: ("personal" | "team")[] = scope.kind === "user" ? ["personal"] : scope.kind === "subtree" ? ["personal", "team"] : ["team"];
    const rows = new Map<string, LeadRow>();
    for (const s of which) {
      let offset: number | null = 0;
      while (offset !== null) {
        const r = await book.list({ credential: p.credential, sessionId: p.sessionId }, s, offset, signal);
        if (!r.ok) { problems.push(`leads:${r.kind === "refused" ? r.reasonCode : r.errorKind}`); return []; }
        for (const row of r.value.rows) if (!rows.has(row.id)) rows.set(row.id, row);
        offset = r.value.nextOffset !== null && r.value.nextOffset < 2_000 ? r.value.nextOffset : null;
      }
    }
    const ids = [...rows.keys()];
    const detail = new Map<string, ZohoRecord>();
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await deps.crm.coql(p.credential, `select ${LEAD_DETAIL.join(", ")} from Leads where id in (${chunk.map((x) => `'${x}'`).join(", ")}) order by id asc limit 0, 200`, { signal });
      if (!r.ok) { problems.push(`leads-detail:${r.error.kind}`); break; }
      for (const rec of r.value.records) if (chunk.includes(rec.id)) detail.set(rec.id, rec);
    }
    return [...rows.values()].map((row) => leadOf(row, detail.get(row.id)));
  }

  async function readInvestors(p: LivePrincipal, scopes: SeatScopes, ds: Dataset, problems: string[], signal?: AbortSignal) {
    const me = p.credential.userId;
    const ok = <T>(book: string, r: ReadResult<T>): readonly T[] => {
      if (r.ok) { if (r.truncated) problems.push(`${book}:truncated`); return r.rows; }
      problems.push(`${book}:${r.kind === "refused" ? r.reason : r.errorKind}`);
      return [];
    };
    let contacts: readonly ContactRow[] = [];
    if (scopes.investors.kind === "own-book") {
      const kam = createKamBookService({ crm: deps.crm, access: kamAccess(p.session), log: deps.log, recordIdPrefix: deps.recordIdPrefix, clock });
      const r = await kam.list({ credential: p.credential, sessionId: p.sessionId }, signal);
      if (r.ok) contacts = r.value.filter((e) => e.kamUserId === me).map(kamEntryToContact);
      else problems.push(`investors:${r.kind === "refused" ? r.reasonCode : r.errorKind}`);
    } else contacts = ok("investors", await adapters.contacts(p.credential, scopes.investors, signal));
    if (scopes.farms.kind === "none" && scopes.investors.kind === "none") return;

    const llps = scopes.farms.kind === "none" ? [] : ok("farms", await adapters.llps(p.credential, signal));
    const contactIds = contacts.map((c) => c.id);
    const allots = ok("allotments", await adapters.allotments(p.credential, scopes.money, contactIds, signal));
    const receipts = ok("receipts", await adapters.receipts(p.credential, scopes.money, allots.map((a) => a.id), signal));
    const cases = ok("cases", await adapters.cases(p.credential, scopes.cases, contactIds, signal));
    const holdings = ok("holdings", await adapters.holdings(p.credential, scopes.holdings, signal));
    const arl = holdings.length ? ok("arl-transactions", await adapters.arlTransactions(p.credential, holdings.map((h) => h.id), signal)) : [];

    const blockOf = new Map(llps.map((l) => [l.id, l.Block_Code]));
    const byContact = new Map<string, AllotmentRow[]>();
    for (const a of allots) byContact.set(a.Customer, [...(byContact.get(a.Customer) ?? []), a]);
    const custOf = new Map(allots.map((a) => [a.id, a.Customer]));
    const im = ds.im;
    im.INV = contacts.map((c) => investorOf(c, byContact.get(c.id) ?? [], (id) => blockOf.get(id) ?? ""));
    im.LLP = [...llps];
    im.ALLOT = allots.map(({ received: _r, receivable: _v, token: _t, ...a }) => a);
    im.TXN = receipts.filter((x) => x.allotmentId && custOf.has(x.allotmentId)).map((x) => ({
      id: x.id, inv: custOf.get(x.allotmentId!)!, kind: x.reversalOf ? "refund" : x.kind === "Advance" ? "advance" : x.kind === "Balance" ? "balance" : x.kind === "Refund" ? "refund" : "full",
      amt: x.amount, mode: x.mode ?? "", utr: x.utr ?? "", on: x.on ?? "", by: x.byId ?? "", rec: x.matched ? "matched" : "pending", Allotment: x.allotmentId!,
    }));
    im.TKT = cases.map(({ contactId: _c, ...t }) => t);
    im.HOLDING = [...holdings];
    im.ARLTXN = [...arl];
  }

  return Object.freeze({
    /** The signed-in person's Dataset. Their own token, their own scope; rows kept for this response only. */
    async load(p: LivePrincipal, signal?: AbortSignal): Promise<LiveLoad> {
      const now = istNow(clock());
      const ds = emptyDataset(now.slice(0, 10) + "T00:00", now);
      ds.NOW = now;
      const scopes = scopesFor(p.session.seat, p.credential.userId);
      const problems: string[] = [];
      ds.LEADS = await readLeads(p, scopes.leads, problems, signal);
      await readInvestors(p, scopes, ds, problems, signal);
      return { ds, scopes, problems: Object.freeze(problems) };
    },

    /** A badge count for one book, cached under this person's scope for that book — never another's (D53). */
    async count(p: LivePrincipal, book: "leads" | "investors", signal?: AbortSignal): Promise<CountRead | null> {
      const scopes = scopesFor(p.session.seat, p.credential.userId);
      const s = scopes[book];
      if (s.kind === "none") return null;
      const me = p.credential.userId;
      const where = book === "leads"
        ? s.kind === "user" ? `Owner = '${me}' or Secondary_Owner = '${me}'` : "id is not null"
        : s.kind === "own-lead" ? `Originating_IR = '${me}'` : s.kind === "own-book" ? `KAM = '${me}'` : "id is not null";
      const module = book === "leads" ? "Leads" : MODULES.contacts;
      return deps.cache.readSettled<number>(scopedKey<number>(s, `${book}.count`), async () => {
        const r = await deps.crm.aggregate(p.credential, `select COUNT(id) from ${module} where (${where})`, { signal });
        if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
        const v = r.value[0]?.["COUNT(id)"];
        return typeof v === "number" ? v : 0;
      });
    },
  });
}
export type LiveDataLayer = ReturnType<typeof createLiveDataLayer>;
