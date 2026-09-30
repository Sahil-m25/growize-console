/**
 * M06-S03-W2 / M06-S05-W2 — THE TOP-BAR SEARCH FOLLOWS THE SEAT (D110 ruling 2, replacing the search clauses of
 * D60 and D69).
 *
 *   IR, channel partner      leads in their own book                    the Contacts wall holds (M06-S05)
 *   IR Manager               their team's leads                         the Contacts wall holds
 *   viewer (granted Leads)   leads as their grant reads them (D60)      the Contacts wall holds
 *   Digital Infrastructure,  org-wide: leads AND investors; every hit   Contacts on their own token
 *   the business owner       carries its kind and opens its record
 *   Finance, KAM, Head of AM investors within their own scope           Contacts on their own token
 *
 * Always the person's own token (D53): org-wide works because those seats' Zoho roles see the org, never through a
 * service read. Each half is the existing, already-walled search — ./search (Leads; post-filtered to the book) and
 * ../investors/search (Contacts; the seat's own WHERE and admitContact) — so no new read path exists. The only
 * things cached stay each half's scoped COUNT (their own keys, D53 rule 8); no hit is cached.
 *
 * The wall, per seat: a walled seat's request is `searchRequestOf` exactly (anything naming a module other than
 * Leads is refused before anything is read). An org or investor seat may add `module=Leads` or `module=Contacts` to
 * narrow to one half it holds; any other module, or a half it does not hold, is refused the same way.
 */

import type { UserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { BookScope } from "../data/scope";
import type { InvestorHit, InvestorSearchResult } from "../investors/search";
import { LEADS_MODULE } from "./capture";
import { searchRequestOf, SHOWN, type SearchHit, type SearchResult } from "./search";

const CONTACTS_MODULE = "Contacts";

export interface SearchPlan {
  /** the lead half: the seat's lead book (./search decides its scope from the live session) */
  readonly leads: boolean;
  /** the investor half: the seat's Investors scope (../investors/search) */
  readonly investors: boolean;
  /** M06-S05: this seat's request may never name Contacts */
  readonly contactsWall: boolean;
}

const LEADS_ONLY: SearchPlan = Object.freeze({ leads: true, investors: false, contactsWall: true });
const ORG_WIDE: SearchPlan = Object.freeze({ leads: true, investors: true, contactsWall: false });
const INVESTORS: SearchPlan = Object.freeze({ leads: false, investors: true, contactsWall: false });
const NOTHING: SearchPlan = Object.freeze({ leads: false, investors: false, contactsWall: true });

/** Session seat token (CONSOLE_SEAT's vocabulary, data/scope.ts) → what its top-bar search covers. */
export const SEARCH_PLANS: Readonly<Record<string, SearchPlan>> = Object.freeze({
  ir: LEADS_ONLY, cp: LEADS_ONLY, conv: LEADS_ONLY, exec: LEADS_ONLY,
  ops: ORG_WIDE, di: ORG_WIDE, bu: ORG_WIDE,
  head: INVESTORS, fin: INVESTORS, comp: INVESTORS, amlead: INVESTORS, kam: INVESTORS,
});

export const searchPlanOf = (seat: string): SearchPlan =>
  Object.prototype.hasOwnProperty.call(SEARCH_PLANS, seat) ? SEARCH_PLANS[seat]! : NOTHING;

export type SeatSearchRequest =
  | { readonly ok: true; readonly term: string; readonly only: "leads" | "investors" | null }
  | { readonly ok: false; readonly reasonCode: "invalid-request" | "module-refused" };

/** What the route may pass on, for this seat. */
export function seatSearchRequestOf(params: URLSearchParams, plan: SearchPlan): SeatSearchRequest {
  if (plan.contactsWall) {
    const r = searchRequestOf(params);
    return r.ok ? { ok: true, term: r.term, only: null } : r;
  }
  let module: string | null = null;
  const rest = new URLSearchParams();
  for (const [k, v] of params) {
    if (k === "module") {
      if (module !== null) return { ok: false, reasonCode: "invalid-request" };
      module = v;
      continue;
    }
    rest.append(k, v);
  }
  if (module !== null && !((module === LEADS_MODULE && plan.leads) || (module === CONTACTS_MODULE && plan.investors))) {
    return { ok: false, reasonCode: "module-refused" };
  }
  const r = searchRequestOf(rest);
  return r.ok ? { ok: true, term: r.term, only: module === null ? null : module === LEADS_MODULE ? "leads" : "investors" } : r;
}

export type LeadSeatHit = SearchHit & { readonly kind: "lead"; readonly mine: boolean };
export type InvestorSeatHit = InvestorHit & { readonly kind: "investor" };
export type SeatHit = LeadSeatHit | InvestorSeatHit;

export interface SeatSearchValue {
  /** the lead half's book, or null when it was not searched */
  readonly book: "yours" | "team" | "all" | null;
  /** the investor half's scope, or null when it was not searched */
  readonly investorBook: BookScope["kind"] | null;
  readonly hits: readonly SeatHit[];
  readonly more: number;
}

type Refusal = "invalid-request" | "term-too-short" | "session-changed" | "capability-missing" | "source-invalid" | "scope-drift" | "module-refused";
export type SeatSearchResult =
  | { readonly ok: true; readonly value: SeatSearchValue }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: Refusal }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" | string; readonly retryable: boolean };

export interface SeatSearchDeps {
  readonly leads: { find(p: { credential: UserCredential; sessionId: string }, term: string, signal?: AbortSignal): Promise<SearchResult> };
  /** built only when the seat holds the investor half (its runtime reads the live investors context) */
  readonly investors: () => Promise<{ find(p: { credential: UserCredential; seat: string }, req: { term: string | null; farmId: string | null }, signal?: AbortSignal): Promise<InvestorSearchResult> } | null>;
}

/** A half that has nothing to say for this seat or this term is skipped; any other failure is the answer. */
const SKIP: ReadonlySet<string> = new Set(["capability-missing", "term-too-short"]);

export function createSeatSearch(deps: SeatSearchDeps) {
  return Object.freeze({
    async find(p: { credential: UserCredential; sessionId: string; seat: string }, req: { term: string; only: "leads" | "investors" | null }, signal?: AbortSignal): Promise<SeatSearchResult> {
      const plan = searchPlanOf(p.seat);
      const wantLeads = plan.leads && req.only !== "investors";
      const wantInv = plan.investors && req.only !== "leads";
      if (!wantLeads && !wantInv) return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      const inv = wantInv ? await deps.investors() : null;
      const [l, i] = await Promise.all([
        wantLeads ? deps.leads.find({ credential: p.credential, sessionId: p.sessionId }, req.term, signal) : Promise.resolve(null),
        inv ? inv.find({ credential: p.credential, seat: p.seat }, { term: req.term, farmId: null }, signal) : Promise.resolve(null),
      ]);
      const skipped: Refusal[] = [];
      for (const r of [l, i]) {
        if (!r || r.ok) continue;
        if (r.kind === "refused" && SKIP.has(r.reasonCode)) { skipped.push(r.reasonCode); continue; }
        return r.kind === "refused" ? { ok: false, kind: "refused", reasonCode: r.reasonCode } : { ok: false, kind: "source-error", errorKind: r.errorKind, retryable: r.retryable };
      }
      const lv = l && l.ok ? l.value : null, iv = i && i.ok ? i.value : null;
      if (!lv && !iv) return { ok: false, kind: "refused", reasonCode: skipped.includes("term-too-short") ? "term-too-short" : "capability-missing" };
      const me = p.credential.userId;
      const leadHits: SeatHit[] = (lv?.hits ?? []).map((h) => Object.freeze({ ...h, kind: "lead" as const, mine: lv!.book === "yours" || h.ownerId === me }));
      const invHits: SeatHit[] = (iv?.hits ?? []).slice(0, SHOWN).map((h) => Object.freeze({ ...h, kind: "investor" as const }));
      return {
        ok: true,
        value: {
          book: lv ? lv.book : null,
          investorBook: iv ? iv.book : null,
          hits: Object.freeze([...leadHits, ...invHits]),
          more: (lv?.more ?? 0) + Math.max(0, (iv?.hits.length ?? 0) - SHOWN) + (iv?.more ?? 0),
        },
      };
    },
  });
}
