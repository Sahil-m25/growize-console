/**
 * M01-S03-T02 — EXPLICIT FIELD PROJECTIONS for the Investors-side modules (D46, D52, D53).
 *
 * Every read names its fields; none selects `*`. No projection may carry an identity field: pan,
 * bank_account, Aadhaar, or any of the real Contacts API names that hold them (investors/book.ts
 * SENSITIVE_CONTACT_FIELDS). `checkProjection` is run on every one of these lists when this module
 * loads, so a field added by mistake fails the server at start, not a screen in production.
 *
 * Field API names follow the org as found (docs/zoho-org-as-found-2026-09-23.md), the existing
 * readers (money/register.ts for Receipts and allotments) and money-types.ts for LLP / holdings.
 * Confirmed read-only with getFields (28 Sep 2026): LLP_Creation_Module's price is `Pet_Unit_Price`, its
 * insurance is `Insurance_Provider` / `Insurance_expiry_date` (datetime), `Annual_Rental_Yield` is a picklist
 * of "NN%" (on the LLP and on the allotment); Cases has no Contact_Name or Category — the investor is
 * `Related_To` (lookup → Contacts) and the category `Ticket_Category` (as server/cases/register.ts reads).
 */

import { IDENTITY_FIELDS } from "../../lib/zoho/identity";
import { DETAIL_FIELDS, SENSITIVE_CONTACT_FIELDS } from "../investors/book";

export const MODULES = Object.freeze({
  contacts: "Contacts",
  /** The same module, read for an IR's own-lead investors (M09-S08-T02): no money, no identity, no address. */
  irContacts: "Contacts",
  llps: "LLP_Creation_Module",
  allotments: "LLP_UnitAllocation_Module",
  /** The same module, read for an account-management seat (M09-S02-T02): no money field. */
  amAllotments: "LLP_UnitAllocation_Module",
  receipts: "Receipts",
  cases: "Cases",
  holdings: "ARL_Holdings",
  arlTransactions: "ARL_Transactions",
} as const);
export type ModuleKey = keyof typeof MODULES;

/** Anything that names a PAN, a bank account, Aadhaar, KYC proof or IFSC — refused in any module. */
const FORBIDDEN_PATTERN = /(^|_)(pan|bank|aadhaar|ifsc|isfc|kyc)(_|$)/i;

export function isForbiddenField(field: string): boolean {
  return (IDENTITY_FIELDS as readonly string[]).includes(field) || SENSITIVE_CONTACT_FIELDS.has(field) || FORBIDDEN_PATTERN.test(field);
}

export function checkProjection(module: string, fields: readonly string[]): readonly string[] {
  const bad = fields.filter(isForbiddenField);
  if (bad.length) throw new TypeError(`${module}: a projection may not select identity fields (${bad.join(", ")}) — D52/D53.`);
  if (!fields.includes("id")) throw new TypeError(`${module}: a projection selects id.`);
  return Object.freeze([...fields]);
}

/**
 * M09-S02-T02 — the account-management wall: a KAM's or the Head of AM's read carries no identity field
 * AND no money or Receipt field (D12, D40). Anything naming an amount, a price, a payment, a receipt, a UTR
 * or capital is refused here, at load, on top of the identity rule.
 */
const AM_MONEY_PATTERN = /(amount|price|paid|payment|receipt|receivable|received|utr|capital|advance|ticket|yield|refund|txn|transaction)/i;
export function isAmForbiddenField(field: string): boolean {
  return isForbiddenField(field) || AM_MONEY_PATTERN.test(field);
}
export function checkAmProjection(module: string, fields: readonly string[]): readonly string[] {
  const bad = fields.filter((f) => AM_MONEY_PATTERN.test(f));
  if (bad.length) throw new TypeError(`${module}: an account-management projection may not select money or Receipt fields (${bad.join(", ")}) — D12/D40.`);
  return checkProjection(module, fields);
}

export const PROJECTIONS: Readonly<Record<ModuleKey, readonly string[]>> = Object.freeze({
  contacts: checkProjection(MODULES.contacts, [
    "id", "ARL_ID", ...DETAIL_FIELDS, "Residency", "KAM", "KAM_Since", "KAM_Intro_At",
    "Origin_Lead", "Originating_IR", "Said_Yes_At", "Created_Time", "Modified_Time",
  ]),
  // M09-S08-T02: what an IR reads of their own-lead investors — name, ARL code, state, the lead link and the
  // care fields; no money field, no identity field (checked with the AM money rule too), no street address or nominee.
  irContacts: checkAmProjection(MODULES.irContacts, [
    "id", "ARL_ID", "First_Name", "Last_Name", "Mobile", "Email", "Mailing_City", "Mailing_State", "Residency",
    "KAM", "KAM_Since", "KAM_Intro_At", "Origin_Lead", "Originating_IR", "Said_Yes_At", "Created_Time", "Modified_Time",
  ]),
  // The LLP's own PAN and GST are not personal, but the rule is simpler without exceptions: the shelf does not need them.
  llps: checkProjection(MODULES.llps, [
    "id", "Name", "Block_Code", "Acreage_Acres", "Total_Units", "Units_Reserved", "Units_Issued", "Pet_Unit_Price", "LLP_Status",
    "Insurance_Provider", "Insurance_Policy_No", "Insurance_expiry_date", "Annual_Rental_Yield",
  ]),
  allotments: checkProjection(MODULES.allotments, [
    "id", "Customer", "LLP", "Allocation_Status", "Issued_Units", "Reserved_Units", "Unit_Price",
    "Token_Advance_Amount", "Total_Amount_Received", "Total_Amount_Receivable", "Investment_Date", "Annual_Rental_Yield",
    "Hold_Until", "Hold_Extension_State", "Supplementary_Verified_At",
    // the allotment's version: a typed-slot upload (M12-S02) sends it back as `expected` (If-Unmodified-Since). Not identity.
    "Modified_Time",
  ]),
  // M09-S08-T02: an IR's own-lead investors — the same no-money allotment read as the AM book (farms and units,
  // no price, no amount, no receipt): an IR sees no Paid or Due (D69). Same list, one wall.
  // M09-S02-T02: the AM book's allotments — units, farm, status and hold; no price, no amount, no receipt.
  amAllotments: checkAmProjection(MODULES.amAllotments, [
    "id", "Customer", "LLP", "Allocation_Status", "Issued_Units", "Reserved_Units", "Investment_Date", "Hold_Until", "Modified_Time",
  ]),
  receipts: checkProjection(MODULES.receipts, [
    "id", "Allotment", "Kind", "Amount", "Mode", "UTR", "Received_On", "Match_State", "Reversal_Of", "Created_By",
  ]),
  cases: checkProjection(MODULES.cases, [
    "id", "Case_Number", "Subject", "Description", "Related_To", "Owner", "Priority", "Status", "Case_Origin",
    "Created_Time", "Ticket_Category", "SLA_Due", "Closed_At",
    "Modified_Time",
  ]),
  holdings: checkProjection(MODULES.holdings, [
    "id", "Contact", "Instrument_Type", "Amount_Invested", "Invested_On", "Interest_Rate", "Maturity_On",
  ]),
  arlTransactions: checkProjection(MODULES.arlTransactions, ["id", "Holding", "Type", "Date", "Amount"]),
});
