/**
 * M09-S07-T01 — INVESTOR SEARCH on the Investors page (D69, D53, D52, D47).
 *
 * One box finds an investor by name, ARL code, city or the last digits of the phone, optionally inside one
 * farm LLP. It is the Investors-side twin of server/leads/search (the lead-side top bar never names Contacts,
 * D69) and keeps the same wall:
 *  - `investorSearchRequestOf` admits `q` and `farm` (an LLP record id) and nothing else. A request naming a
 *    module other than Contacts, or carrying its own criteria/fields/word/phone, is refused before anything is
 *    read; an owner filter is ignored — the book is the caller's own, never a parameter.
 *  - the module is fixed to Contacts here. The query is a COQL SELECT on the person's own token whose WHERE is
 *    the seat's own Investors filter (../data/ir-guard contactsWhere: an IR's Originating_IR + Origin_Lead, a
 *    KAM's KAM) AND the match, so Zoho never returns an investor outside the person's scope; every row is then
 *    re-admitted with `admitContact` (a row that slips through is dropped and logged by id, never shown).
 *    PROVISIONAL (jev "b" 0.76): COQL with the scope in the WHERE, not the Search API (which cannot carry it).
 *  - the farm filter reads the LLP's allotments through ../investors/allotments byLlp (the same scoped
 *    by-LLP read Farms uses; Cancelled allotments do not put anyone on a farm) and asks only for those ids.
 *  - a hit carries id, name, ARL code, city and the LAST FOUR digits of the mobile — never the full number.
 *  - the only thing cached is the result COUNT, keyed by the caller's Investors scope (ir-guard investorsKey)
 *    and an HMAC of the query, never the query. Rows are records and are never cached (D52).
 *  - one Plane B event per completed search (lib/zoho/log `event`): who, the scope and the count. No text.
 * Debounce (200 ms) is the search box's; this module answers each request it is given.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { ScopedCache } from "../../lib/zoho/cache";
import { coqlAll, coqlAny, coqlWhere } from "../../lib/zoho/coql";
import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { InvestorEvents } from "../data/events";
import { parseContact, type ContactRow } from "../data/contact-row";
import { admitContact, contactsWhere, investorsKey } from "../data/ir-guard";
import { checkAmProjection, MODULES } from "../data/projections";
import { scopesFor, type BookScope } from "../data/scope";
import { pagedSelect } from "../cases/predicate";
import { createAllotmentReader, type AllotmentReaderDeps } from "./allotments";

export const SHOWN = 50;
const RECORD_ID = /^\d{15,22}$/;
const IN_CHUNK = 100;
const MAX_TOKENS = 3;
/** What the search reads of a Contact: enough to match, admit and show. No money, no identity (checked at load). */
export const SEARCH_FIELDS = checkAmProjection(MODULES.contacts, [
  "id", "ARL_ID", "First_Name", "Last_Name", "Mobile", "Mailing_City", "KAM", "Origin_Lead", "Originating_IR",
]);

export interface InvestorHit {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly city: string | null;
  /** The last four digits of the mobile, or null. The full number never leaves the server. */
  readonly phoneLast4: string | null;
}

export type InvestorSearchRefusal = "invalid-request" | "module-refused" | "term-too-short" | "capability-missing" | "source-invalid" | "scope-drift";
export type InvestorSearchResult =
  | { readonly ok: true; readonly value: { readonly book: BookScope["kind"]; readonly hits: readonly InvestorHit[]; readonly more: number; readonly farmId: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: InvestorSearchRefusal }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" | string; readonly retryable: boolean };

/* ---- the wall ------------------------------------------------------------------------------ */
export type InvestorSearchRequest =
  | { readonly ok: true; readonly term: string | null; readonly farmId: string | null }
  | { readonly ok: false; readonly reasonCode: "invalid-request" | "module-refused" };
const IGNORED_PARAMS: ReadonlySet<string> = new Set(["owner", "ownerId", "Owner", "owner_id"]);

/** What the route may pass on: a term and/or one farm LLP id. Anything choosing the module or the criteria is refused. */
export function investorSearchRequestOf(params: URLSearchParams): InvestorSearchRequest {
  let term: string | null = null, farm: string | null = null;
  for (const [k, v] of params) {
    if (k === "q") { if (term !== null) return { ok: false, reasonCode: "invalid-request" }; term = v; continue; }
    if (k === "farm") { if (farm !== null) return { ok: false, reasonCode: "invalid-request" }; farm = v; continue; }
    if (k === "module") { if (v !== MODULES.contacts) return { ok: false, reasonCode: "module-refused" }; continue; }
    if (IGNORED_PARAMS.has(k)) continue;
    return { ok: false, reasonCode: "invalid-request" };
  }
  if (term !== null && term.length > 200) return { ok: false, reasonCode: "invalid-request" };
  if (farm !== null && !RECORD_ID.test(farm)) return { ok: false, reasonCode: "invalid-request" };
  if (farm === null && (term === null || term.trim() === "")) return { ok: false, reasonCode: "invalid-request" };
  return { ok: true, term: term !== null && term.trim() !== "" ? term : null, farmId: farm };
}

/* ---- the query ----------------------------------------------------------------------------- */
export type InvestorQuery =
  | { readonly kind: "code"; readonly code: string }
  | { readonly kind: "phone"; readonly digits: string }
  | { readonly kind: "words"; readonly tokens: readonly string[] };

/** An ARL code ("ARL-INV-0220") matches that code; 4–15 digits match the end of the mobile; else up to three words. */
export function investorQueryFor(raw: unknown): InvestorQuery | null {
  if (typeof raw !== "string") return null;
  const t = raw.normalize("NFC").trim();
  if (/^ARL-[A-Z]{2,5}-\d{2,8}$/i.test(t)) return { kind: "code", code: t.toUpperCase() };
  const digits = t.replace(/[\s()+.-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= 4 && digits.length <= 15 ? { kind: "phone", digits } : null;
  // Letters, digits, dot and hyphen only: nothing that can close a COQL string or widen a LIKE.
  const tokens = t.replace(/[^\p{L}\p{N}.\-\s]/gu, " ").split(/\s+/).map((x) => x.slice(0, 40)).filter((x) => x.length >= 2).slice(0, MAX_TOKENS);
  return tokens.length ? { kind: "words", tokens: Object.freeze(tokens) } : null;
}

/** The match half of the WHERE. Values are from `investorQueryFor`, so they carry no quote, % or backslash. */
export function matchWhere(q: InvestorQuery): string {
  switch (q.kind) {
    case "code": return `ARL_ID = '${q.code}'`;
    case "phone": return `Mobile like '%${q.digits.slice(-4)}'`;
    case "words": return coqlAll(q.tokens.map((t) => coqlAny([`First_Name like '%${t}%'`, `Last_Name like '%${t}%'`, `Mailing_City like '%${t}%'`, `ARL_ID like '%${t}%'`])));
  }
}

/** The same rule in memory, on the parsed row: Zoho's LIKE narrows, this decides (phone: the typed digits end the number). */
export function matchesRow(q: InvestorQuery, c: Pick<ContactRow, "code" | "firstName" | "lastName" | "city" | "mobile">): boolean {
  switch (q.kind) {
    case "code": return c.code.toUpperCase() === q.code;
    case "phone": return !!c.mobile && c.mobile.replace(/\D/g, "").endsWith(q.digits);
    case "words": {
      const hay = [c.firstName ?? "", c.lastName, c.city ?? "", c.code].join(" ").toLocaleLowerCase("en-IN");
      return q.tokens.every((t) => hay.includes(t.toLocaleLowerCase("en-IN")));
    }
  }
}

/* ---- the search ---------------------------------------------------------------------------- */
const PROCESS_KEY = randomBytes(32);
const defaultTermKey = (s: string): string => createHmac("sha256", PROCESS_KEY).update(s).digest("hex").slice(0, 24);
const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";

export interface InvestorSearchDeps {
  readonly crm: Pick<ZohoClient, "coql"> & AllotmentReaderDeps["crm"];
  readonly events: InvestorEvents;
  /** Plane B (lib/zoho/log): the `event` kind records a completed search; a log without it records nothing. */
  readonly log: Pick<OpsLog, "event">;
  readonly cache?: Pick<ScopedCache, "readSettled">;
  /** A keyed hash that stands in for the query in the count's cache key; defaults to a per-process HMAC. */
  readonly termKey?: (s: string) => string;
  readonly clock?: () => number;
}

export function createInvestorSearch(deps: InvestorSearchDeps) {
  const { crm, events, log } = deps;
  const clock = deps.clock ?? Date.now;
  const termKey = deps.termKey ?? defaultTermKey;
  const allotments = createAllotmentReader({ crm, events });
  const refuse = (me: string, reasonCode: InvestorSearchRefusal, ids: readonly string[] = []): InvestorSearchResult => {
    events.refusal(me, "investor-search", reasonCode, ids);
    return { ok: false, kind: "refused", reasonCode };
  };

  return Object.freeze({
    async find(p: { readonly credential: UserCredential; readonly seat: string }, req: { readonly term: string | null; readonly farmId: string | null }, signal?: AbortSignal): Promise<InvestorSearchResult> {
      const cred = p.credential, me = cred.userId;
      const scope = scopesFor(p.seat, me).investors;
      const scopeWhere = contactsWhere(scope);
      if (!scopeWhere || scope.kind === "user") return refuse(me, "capability-missing");
      const farmId = req.farmId;
      if (farmId !== null && !RECORD_ID.test(farmId)) return refuse(me, "invalid-request");
      let q: InvestorQuery | null = null;
      if (req.term !== null) {
        q = investorQueryFor(req.term);
        if (!q) return { ok: false, kind: "refused", reasonCode: "term-too-short" };
      } else if (farmId === null) return refuse(me, "invalid-request");

      // The farm filter: the LLP's live allotments, within the seat's investors scope (byLlp).
      let onFarm: string[] | null = null;
      if (farmId !== null) {
        const a = await allotments.byLlp(cred, p.seat, farmId, signal);
        if (!a.ok) {
          if (a.kind === "refused") return { ok: false, kind: "refused", reasonCode: a.reason === "source-invalid" ? "source-invalid" : a.reason === "scope-drift" ? "scope-drift" : "capability-missing" };
          return { ok: false, kind: "source-error", errorKind: a.errorKind, retryable: retryable(a.errorKind) };
        }
        onFarm = [...new Set(a.rows.filter((x) => x.status !== "Cancelled" && x.investor.id).map((x) => x.investor.id))];
      }

      const base = [`(${scopeWhere})`, ...(q ? [coqlWhere(matchWhere(q))] : [])];
      const wheres = onFarm === null ? [coqlAll(base)]
        : Array.from({ length: Math.ceil(onFarm.length / IN_CHUNK) }, (_, i) => coqlAll([...base, `id in (${onFarm!.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK).map((x) => `'${x}'`).join(", ")})`]));
      const rows: ContactRow[] = [];
      let truncated = false;
      for (const w of wheres) {
        const r = await pagedSelect(crm, cred, SEARCH_FIELDS, MODULES.contacts, w, "Last_Name asc", signal, 1);
        if (!r.ok) return r.kind === "refused" ? refuse(me, "source-invalid") : { ok: false, kind: "source-error", errorKind: r.errorKind, retryable: r.retryable };
        for (const x of r.rows) {
          const c = parseContact(x);
          if (!c) return refuse(me, "source-invalid", [String(x.id ?? "")]);
          rows.push(c);
        }
        truncated ||= r.truncated;
      }

      const farmSet = onFarm ? new Set(onFarm) : null;
      const hits: InvestorHit[] = [];
      const dropped: string[] = [];
      const seen = new Set<string>();
      for (const c of rows) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        if (!admitContact(scope, c).ok || (farmSet && !farmSet.has(c.id))) { dropped.push(c.id); continue; }
        if (q && !matchesRow(q, c)) continue;
        const digits = c.mobile ? c.mobile.replace(/\D/g, "") : "";
        hits.push(Object.freeze({
          id: c.id, name: `${c.firstName ?? ""} ${c.lastName}`.trim().slice(0, 121), code: c.code, city: c.city,
          phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
        }));
      }
      if (dropped.length) events.refusal(me, "investor-search", "outside-book", dropped);
      const n = hits.length;
      // D47: one Plane B event — who searched, in which scope, how many. Never the term, never a name.
      log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action: "investor-search", reason: `scope-${scope.kind}.count-${Math.min(n, 9999)}`, recordIds: [] });
      if (deps.cache) {
        try {
          await deps.cache.readSettled(investorsKey<number>(scope, `search.${termKey(JSON.stringify([q, farmId]))}`), async () => n);
        } catch { /* the cache is a convenience; the answer stands */ }
      }
      return { ok: true, value: {
        book: scope.kind, hits: Object.freeze(hits.slice(0, SHOWN)), more: Math.max(0, n - SHOWN) + (truncated ? 1 : 0), farmId,
      } };
    },
  });
}
export type InvestorSearch = ReturnType<typeof createInvestorSearch>;
