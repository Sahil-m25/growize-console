/**
 * M09-S01-T01 — THE INVESTORS LIST FOR FINANCE (D45, D48, D53, D70).
 *
 * One row per investor on the book: name, ARL ID, city, lifecycle state, KYC status, residency (NRI),
 * FEMA state, units and the LLPs (farms) they sit in, paid and due, and the originating IR. Read live on
 * the signed-in person's own token (D53) — COQL over Contacts, then every allotment and every receipt the
 * token sees (server/data/adapters, through the one shared client and gate). Rows live for one response
 * (D45 zero copy); only the summary counts go into the scoped cache, keyed by the visibility scope, 60 s.
 *
 * Offered only to a seat whose Investors book is org-wide (Finance, Head of Finance, Compliance, the
 * viewers) or `all`; an IR, a KAM or the Head of AM is refused (their books are their own reads).
 *
 * KYC and FEMA are STATUS fields (picklist / boolean / date). They are outside the KAM book's projection
 * (investors/book SENSITIVE_CONTACT_FIELDS) and inside Finance's; PAN, bank and Aadhaar are in neither —
 * `FINANCE_CONTACT_FIELDS` is checked when this module loads and refuses them.
 *
 * Money, as the Payments register (money/register) works it out, never typed:
 *   paid = inbound receipts (Advance, Part/Balance, Full) that stand (not Reversed / Not found / Claimed)
 *   due  = over Reserved allotments, units × unit price − what stands against each (net of refunds), ≥ 0
 */

import { IDENTITY_FIELDS } from "../../lib/zoho/identity";
import type { ImSt } from "../../lib/im/types";
import type { ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { createInvestorsAdapters, PAGE, DEFAULT_MAX_PAGES, type AllotmentRow, type ReceiptRow } from "../data/adapters";
import { idOf, str } from "../data/contact-row";
import type { InvestorEvents } from "../data/events";
import { MODULES } from "../data/projections";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";

export const FINANCE_TTL_MS = 60_000;
const NOT_STANDING: ReadonlySet<string> = new Set(["Reversed", "Not found", "Claimed"]);
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
const IDENTITY_PATTERN = /(^|_)(pan|bank|aadhaar|ifsc|isfc)(_|$)/i;

/** Status, never identity. A field added here that names PAN, bank or Aadhaar fails the server at load. */
export const FINANCE_CONTACT_FIELDS: readonly string[] = (() => {
  const f = ["id", "ARL_ID", "First_Name", "Last_Name", "Email", "Mailing_City", "Residency",
    "KYC", "KYC_Completed_On", "FEMA_Applicable", "FEMA_Verified_At", "Originating_IR"];
  const bad = f.filter((x) => (IDENTITY_FIELDS as readonly string[]).includes(x) || IDENTITY_PATTERN.test(x));
  if (bad.length) throw new TypeError(`Finance investors list may not select identity fields (${bad.join(", ")}) — D52/D53.`);
  return Object.freeze(f);
})();

export type FinanceKyc = "passed" | "pending" | "failed" | "na";

export interface FinanceFarm { readonly llpId: string; readonly name: string; readonly block: string; readonly units: number }

export interface FinanceInvestorRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly city: string;
  readonly email: string;
  readonly residency: string | null;
  readonly nri: boolean;
  readonly kyc: FinanceKyc;
  readonly kycOn: string | null;
  /** "outstanding" while FEMA applies and is not verified; "done" once verified; null when it does not apply. */
  readonly fema: "outstanding" | "done" | null;
  readonly units: number;
  readonly farms: readonly FinanceFarm[];
  /** reserved → paid → allocated; lapsed when every allotment is cancelled; null with no allotment yet. */
  readonly state: ImSt | null;
  readonly paid: number;
  readonly due: number;
  readonly ir: string | null;
}

export interface FinanceSummary {
  readonly onBook: number;
  readonly units: number;
  readonly kycNotPassed: number;
  readonly balanceOutstanding: number;
  readonly nri: number;
  readonly femaOutstanding: number;
}

export type FinanceListResult =
  | { readonly ok: true; readonly rows: readonly FinanceInvestorRow[]; readonly summary: FinanceSummary; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "seat-denied" | "scope-drift" | "source-invalid" | string }
  | { readonly ok: false; readonly kind: "source-error"; readonly book: string; readonly errorKind: ZohoFailureKind | "unexpected" };

export interface FinanceListDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  readonly maxPages?: number;
}

const kycOf = (v: string | null): FinanceKyc =>
  v === "Completed" ? "passed" : v === "Failed" ? "failed" : v === "NA" ? "na" : "pending";

/** Pure: the rows and summary from what was read. Exported for tests and for a future export job. */
export function buildFinanceRows(
  contacts: readonly ZohoRecord[], allots: readonly AllotmentRow[], receipts: readonly ReceiptRow[],
  llps: ReadonlyMap<string, { readonly name: string; readonly block: string }>,
): { rows: FinanceInvestorRow[]; summary: FinanceSummary } {
  const standing = new Map<string, number>();   // allotment → net standing (inbound − refunds)
  const inbound = new Map<string, number>();    // allotment → inbound standing
  for (const r of receipts) {
    if (!r.allotmentId || (r.matchState && NOT_STANDING.has(r.matchState))) continue;
    const isRefund = r.kind === "Refund" || !!r.reversalOf;
    const isIn = !isRefund && !!r.kind && INBOUND.has(r.kind);
    if (isIn) inbound.set(r.allotmentId, (inbound.get(r.allotmentId) ?? 0) + r.amount);
    standing.set(r.allotmentId, (standing.get(r.allotmentId) ?? 0) + (isIn ? r.amount : isRefund ? -r.amount : 0));
  }
  const byContact = new Map<string, AllotmentRow[]>();
  for (const a of allots) byContact.set(a.Customer, [...(byContact.get(a.Customer) ?? []), a]);

  const rows: FinanceInvestorRow[] = [];
  for (const c of contacts) {
    if (!idOf(c.id)) continue;
    const last = str(c, "Last_Name", 80);
    if (!last) continue;
    const mine = byContact.get(c.id) ?? [];
    const live = mine.filter((a) => a.Allocation_Status !== "Cancelled");
    const farms = new Map<string, FinanceFarm>();
    for (const a of live) {
      const l = llps.get(a.LLP_Lookup);
      const prev = farms.get(a.LLP_Lookup);
      farms.set(a.LLP_Lookup, { llpId: a.LLP_Lookup, name: l?.name ?? "", block: l?.block ?? "", units: (prev?.units ?? 0) + a.Committed_Units });
    }
    const paid = live.reduce((t, a) => t + (inbound.get(a.id) ?? 0), 0);
    const due = live.filter((a) => a.Allocation_Status === "Reserved")
      .reduce((t, a) => t + Math.max(0, a.Committed_Units * a.Unit_Price - (standing.get(a.id) ?? 0)), 0);
    const state: ImSt | null = !mine.length ? null : !live.length ? "lapsed"
      : live.some((a) => a.Allocation_Status === "Issued") ? "allocated" : due === 0 && paid > 0 ? "paid" : "reserved";
    const residency = str(c, "Residency", 40);
    const femaApplies = c.FEMA_Applicable === true;
    rows.push(Object.freeze({
      id: c.id, code: str(c, "ARL_ID", 40) ?? "", name: [str(c, "First_Name", 40), last].filter(Boolean).join(" "),
      city: str(c, "Mailing_City", 120) ?? "", email: str(c, "Email", 100) ?? "",
      residency, nri: residency === "NRI" || residency === "OCI",
      kyc: kycOf(str(c, "KYC", 40)), kycOn: (str(c, "KYC_Completed_On", 40) ?? "").slice(0, 10) || null,
      fema: femaApplies ? (str(c, "FEMA_Verified_At", 40) ? "done" : "outstanding") : null,
      units: live.reduce((t, a) => t + a.Committed_Units, 0), farms: Object.freeze([...farms.values()]),
      state, paid, due, ir: idOf(c.Originating_IR),
    }));
  }
  const summary: FinanceSummary = Object.freeze({
    onBook: rows.length,
    units: rows.reduce((t, r) => t + r.units, 0),
    kycNotPassed: rows.filter((r) => r.kyc !== "passed" && r.kyc !== "na").length,
    balanceOutstanding: rows.filter((r) => r.due > 0).length,
    nri: rows.filter((r) => r.nri).length,
    femaOutstanding: rows.filter((r) => r.fema === "outstanding").length,
  });
  return { rows, summary };
}

export function createFinanceInvestorList(deps: FinanceListDeps) {
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const adapters = createInvestorsAdapters({ crm: deps.crm, events: deps.events, maxPages });

  const financeScope = (cred: UserCredential, seat: string): BookScope | null => {
    const s = scopesFor(seat, cred.userId).investors;
    return s.kind === "org" || s.kind === "all" ? s : null;
  };

  async function contacts(cred: UserCredential, signal?: AbortSignal): Promise<{ ok: true; rows: ZohoRecord[]; truncated: boolean } | { ok: false; errorKind: ZohoFailureKind | "unexpected" }> {
    const rows: ZohoRecord[] = [];
    for (let page = 0; page < maxPages; page++) {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try {
        r = await deps.crm.coql(cred, `select ${FINANCE_CONTACT_FIELDS.join(", ")} from ${MODULES.contacts} where (id is not null) order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
      } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) return { ok: false, errorKind: r.error.kind };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { ok: true, rows, truncated: false };
    }
    return { ok: true, rows, truncated: true };
  }

  async function list(cred: UserCredential, seat: string, signal?: AbortSignal): Promise<FinanceListResult> {
    const scope = financeScope(cred, seat);
    if (!scope) {
      deps.events.refusal(cred.userId, "finance-investors", "seat-denied");
      return { ok: false, kind: "refused", reason: "seat-denied" };
    }
    const c = await contacts(cred, signal);
    if (!c.ok) return { ok: false, kind: "source-error", book: "investors", errorKind: c.errorKind };
    const [al, ll] = await Promise.all([adapters.allotments(cred, scope, [], signal), adapters.llps(cred, signal)]);
    if (!al.ok) return al.kind === "refused" ? { ok: false, kind: "refused", reason: al.reason } : { ok: false, kind: "source-error", book: "allotments", errorKind: al.errorKind };
    if (!ll.ok) return ll.kind === "refused" ? { ok: false, kind: "refused", reason: ll.reason } : { ok: false, kind: "source-error", book: "farms", errorKind: ll.errorKind };
    const rc = await adapters.receipts(cred, scope, [], signal);
    if (!rc.ok) return rc.kind === "refused" ? { ok: false, kind: "refused", reason: rc.reason } : { ok: false, kind: "source-error", book: "receipts", errorKind: rc.errorKind };
    const llps = new Map(ll.rows.map((l) => [l.id, { name: l.Name, block: l.Block_Code }]));
    const { rows, summary } = buildFinanceRows(c.rows, al.rows, rc.rows, llps);
    return { ok: true, rows: Object.freeze(rows), summary, truncated: c.truncated || al.truncated || rc.truncated || ll.truncated };
  }

  return Object.freeze({
    list,
    /** The subtitle and filter counts only, cached 60 s under the viewer's scope (org / all) — never a row. */
    async summary(cred: UserCredential, seat: string, signal?: AbortSignal) {
      const scope = financeScope(cred, seat);
      if (!scope) { deps.events.refusal(cred.userId, "finance-investors", "seat-denied"); return null; }
      return deps.cache.readSettled<Readonly<Record<string, number>>>(scopedKey(scope, "investors.finance.summary"), async () => {
        const r = await list(cred, seat, signal);
        if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.kind === "source-error" ? r.errorKind : r.reason });
        return { ...r.summary };
      }, { ttlMs: FINANCE_TTL_MS });
    },
  });
}
export type FinanceInvestorList = ReturnType<typeof createFinanceInvestorList>;
