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
 * Cases' Category / SLA_Due / Closed_At are M02-S12's new fields (PROVISIONAL until the sandbox).
 */

import { IDENTITY_FIELDS } from "../../lib/zoho/identity";
import { DETAIL_FIELDS, SENSITIVE_CONTACT_FIELDS } from "../investors/book";

export const MODULES = Object.freeze({
  contacts: "Contacts",
  llps: "LLP_Creation_Module",
  allotments: "LLP_UnitAllocation_Module",
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

export const PROJECTIONS: Readonly<Record<ModuleKey, readonly string[]>> = Object.freeze({
  contacts: checkProjection(MODULES.contacts, [
    "id", "ARL_ID", ...DETAIL_FIELDS, "Residency", "KAM", "KAM_Since", "KAM_Intro_At",
    "Origin_Lead", "Originating_IR", "Said_Yes_At", "Created_Time", "Modified_Time",
  ]),
  // The LLP's own PAN and GST are not personal, but the rule is simpler without exceptions: the shelf does not need them.
  llps: checkProjection(MODULES.llps, [
    "id", "Name", "Block_Code", "Acreage_Acres", "Total_Units", "Unit_Price", "LLP_Status",
    "Insurer", "Insurance_Policy_No", "Insured_Till", "Annual_Rental_Yield",
  ]),
  allotments: checkProjection(MODULES.allotments, [
    "id", "Customer", "LLP", "Allocation_Status", "Issued_Units", "Reserved_Units", "Unit_Price",
    "Token_Advance_Amount", "Total_Amount_Received", "Total_Amount_Receivable", "Issued_On", "Annual_Rental_Yield",
  ]),
  receipts: checkProjection(MODULES.receipts, [
    "id", "Allotment", "Kind", "Amount", "Mode", "UTR", "Received_On", "Match_State", "Reversal_Of", "Created_By",
  ]),
  cases: checkProjection(MODULES.cases, [
    "id", "Subject", "Description", "Contact_Name", "Owner", "Priority", "Status", "Case_Origin",
    "Created_Time", "Category", "SLA_Due", "Closed_At",
  ]),
  holdings: checkProjection(MODULES.holdings, [
    "id", "Contact", "Instrument_Type", "Amount_Invested", "Invested_On", "Interest_Rate", "Maturity_On",
  ]),
  arlTransactions: checkProjection(MODULES.arlTransactions, ["id", "Holding", "Type", "Date", "Amount"]),
});
