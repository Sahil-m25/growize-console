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
 * Money, as the Payments register (money/register) works it out, never typed — through ../money/ledger, the one signed
 * ledger the register, the Money section and the receipt replay use (M01-S08-NOTE-3), so MATCHED money only (D21):
 *   paid = MATCHED inbound receipts (Advance, Part/Balance, Full) not cancelled by a matched reversal
 *   due  = over Reserved allotments, units × unit price − the allotment's matched net (net of refunds), ≥ 0
 * Pending (recorded, not yet matched) money is in neither. Over the live (not Cancelled) allotments, so a row equals
 * the investor record's Money total (money/by-allotment investorRow).
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
import { LIFECYCLE_FIELD, resolveIrs, stateLabel, type InvestorStateLabel } from "./lifecycle";
import { dueOf, ledgerOf, sumsOf } from "../money/ledger";

export const FINANCE_TTL_MS = 60_000;
const IDENTITY_PATTERN = /(^|_)(pan|bank|aadhaar|ifsc|isfc)(_|$)/i;

/** Status, never identity. A field added here that names PAN, bank or Aadhaar fails the server at load. */
export const FINANCE_CONTACT_FIELDS: readonly string[] = (() => {
  const f = ["id", "ARL_ID", "First_Name", "Last_Name", "Email", "Mailing_City", "Residency",
    "KYC", "KYC_Completed_On", "FEMA_Applicable", "FEMA_Verified_At", "Originating_IR", "Origin_Lead", "Said_Yes_At"];
  const bad = f.filter((x) => (IDENTITY_FIELDS as readonly string[]).includes(x) || IDENTITY_PATTERN.test(x));
  if (bad.length) throw new TypeError(`Finance investors list may not select identity fields (${bad.join(", ")}) — D52/D53.`);
  return Object.freeze(f);
})();

/** The KYC/FEMA status columns. Finance Ops reads them (owner ruling 8 Oct, B-02a); if a profile still hides one, Zoho's COQL
 *  refuses the whole select (400 INVALID_QUERY → invalid-data), so the list is re-read once without them (and without the
 *  lifecycle field) and says `statusHidden` — one hidden status field never blanks the whole list. */
export const FINANCE_STATUS_FIELDS: readonly string[] = Object.freeze(["KYC", "KYC_Completed_On", "FEMA_Applicable", "FEMA_Verified_At"]);

/** "hidden": the seat's profile does not show KYC, so the status is not known — never shown as "pending". */
export type FinanceKyc = "passed" | "pending" | "failed" | "na" | "hidden";

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
  /** M08-S07: the state tag — the lifecycle blueprint's when read, else `state`, else "said yes" (./lifecycle). */
  readonly stateLabel: InvestorStateLabel | null;
  readonly paid: number;
  readonly due: number;
  /** Originating_IR, else resolved through the Origin_Lead lookup (the Lead's owner) — D69. */
  readonly ir: string | null;
  /** The Lead this investor came from (Origin_Lead) — the Journey's link back (D54). */
  readonly lead: string | null;
  readonly saidYesAt: string | null;
}

export interface FinanceSummary {
  readonly onBook: number;
  readonly units: number;
  readonly kycNotPassed: number;
  readonly balanceOutstanding: number;
  readonly nri: number;
  readonly femaOutstanding: number;
  /** Said yes and nothing allotted yet — Finance's next step is the supplementary agreement (M08-S07). */
  readonly saidYes: number;
}

export type FinanceListResult =
  | { readonly ok: true; readonly rows: readonly FinanceInvestorRow[]; readonly summary: FinanceSummary; readonly truncated: boolean;
      /** KYC and FEMA could not be read on this seat's token: every row's kyc is "hidden" and fema null; the counts exclude them. */
      readonly statusHidden: boolean }
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
  /** Contact id → IR resolved through the Lead lookup, for Contacts without Originating_IR. */
  leadIr: ReadonlyMap<string, string> = new Map(),
  statusHidden = false,
): { rows: FinanceInvestorRow[]; summary: FinanceSummary } {
  const ledger = ledgerOf(receipts);
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
    const paid = live.reduce((t, a) => t + sumsOf(ledger, a.id).matchedIn, 0);
    const due = live.reduce((t, a) => t + dueOf(a.Allocation_Status, a.Committed_Units * a.Unit_Price, sumsOf(ledger, a.id)), 0);
    const state: ImSt | null = !mine.length ? null : !live.length ? "lapsed"
      : live.some((a) => a.Allocation_Status === "Issued") ? "allocated" : due === 0 && paid > 0 ? "paid" : "reserved";
    const residency = str(c, "Residency", 40);
    const femaApplies = c.FEMA_Applicable === true;
    const saidYesAt = (str(c, "Said_Yes_At", 40) ?? "").slice(0, 16) || null;
    rows.push(Object.freeze({
      id: c.id, code: str(c, "ARL_ID", 40) ?? "", name: [str(c, "First_Name", 40), last].filter(Boolean).join(" "),
      city: str(c, "Mailing_City", 120) ?? "", email: str(c, "Email", 100) ?? "",
      residency, nri: residency === "NRI" || residency === "OCI",
      kyc: statusHidden ? "hidden" : kycOf(str(c, "KYC", 40)),
      kycOn: statusHidden ? null : (str(c, "KYC_Completed_On", 40) ?? "").slice(0, 10) || null,
      fema: !statusHidden && femaApplies ? (str(c, "FEMA_Verified_At", 40) ? "done" : "outstanding") : null,
      units: live.reduce((t, a) => t + a.Committed_Units, 0), farms: Object.freeze([...farms.values()]),
      state, stateLabel: stateLabel({ blueprint: LIFECYCLE_FIELD ? c[LIFECYCLE_FIELD] : null, derived: state, saidYesAt }),
      paid, due, ir: idOf(c.Originating_IR) ?? leadIr.get(c.id) ?? null, lead: idOf(c.Origin_Lead), saidYesAt,
    }));
  }
  const summary: FinanceSummary = Object.freeze({
    onBook: rows.length,
    units: rows.reduce((t, r) => t + r.units, 0),
    kycNotPassed: rows.filter((r) => r.kyc !== "passed" && r.kyc !== "na" && r.kyc !== "hidden").length,
    balanceOutstanding: rows.filter((r) => r.due > 0).length,
    nri: rows.filter((r) => r.nri).length,
    femaOutstanding: rows.filter((r) => r.fema === "outstanding").length,
    saidYes: rows.filter((r) => r.stateLabel === "said yes").length,
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

  const FULL = [...FINANCE_CONTACT_FIELDS, ...(LIFECYCLE_FIELD ? [LIFECYCLE_FIELD] : [])];
  const BARE = FINANCE_CONTACT_FIELDS.filter((f) => !FINANCE_STATUS_FIELDS.includes(f));

  async function contacts(cred: UserCredential, signal?: AbortSignal): Promise<{ ok: true; rows: ZohoRecord[]; truncated: boolean; statusHidden: boolean } | { ok: false; errorKind: ZohoFailureKind | "unexpected" }> {
    const rows: ZohoRecord[] = [];
    let fields = FULL, statusHidden = false;
    for (let page = 0; page < maxPages; page++) {
      let r: Awaited<ReturnType<typeof deps.crm.coql>>;
      try {
        r = await deps.crm.coql(cred, `select ${fields.join(", ")} from ${MODULES.contacts} where (id is not null) order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
        /* B-02a: COQL refuses a column the profile hides — re-read once without the status columns. */
        if (!r.ok && r.error.kind === "invalid-data" && page === 0 && !statusHidden) {
          fields = BARE; statusHidden = true;
          r = await deps.crm.coql(cred, `select ${fields.join(", ")} from ${MODULES.contacts} where (id is not null) order by id asc limit 0, ${PAGE}`, { signal });
        }
      } catch { return { ok: false, errorKind: "unexpected" }; }
      if (!r.ok) return { ok: false, errorKind: r.error.kind };
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { ok: true, rows, truncated: false, statusHidden };
    }
    return { ok: true, rows, truncated: true, statusHidden };
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
    // M08-S07-T02: a Contact without Originating_IR is resolved through its Origin_Lead (the Lead's owner).
    const origin = c.rows.map((x) => ({ id: x.id, originLeadId: idOf(x.Origin_Lead), originatingIrId: idOf(x.Originating_IR) }));
    const irs = await resolveIrs(deps.crm, cred, origin, signal);
    const leadIr = new Map<string, string>();
    origin.forEach((o, i) => { if (!o.originatingIrId && irs[i]) leadIr.set(o.id, irs[i]!); });
    const { rows, summary } = buildFinanceRows(c.rows, al.rows, rc.rows, llps, leadIr, c.statusHidden);
    return { ok: true, rows: Object.freeze(rows), summary, truncated: c.truncated || al.truncated || rc.truncated || ll.truncated, statusHidden: c.statusHidden };
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
