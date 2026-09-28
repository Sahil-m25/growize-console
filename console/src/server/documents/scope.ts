/**
 * M12-S01-T01/T03 — WHO SEES WHICH DOCUMENT SCOPE (D70, M12-S01 acceptance; OD8 still open).
 *
 *   scope      lives on                     seats that list the files
 *   personal   Contact                      Finance (fin, head, ops=Finance Ops on the Investors side), Compliance (comp,
 *                                           the KYC owner — PROVISIONAL), the investor's KAM (kam own-book), Head of AM
 *                                           (amlead subtree — PROVISIONAL), Sahil (di/ops, "all"; numbers masked)
 *                                           · never an IR, never audit/exec/bu
 *   allotment  LLP_UnitAllocation_Module    every seat that has the investor (org/all/subtree/own-book);
 *                                           an IR (own-lead): paperwork STATUS only — a count, never a name or id
 *   project    LLP_Creation_Module          every seat whose farms book is not none (staff with access to the LLP);
 *                                           an investor: only LLPs they hold a live allotment in (`holdsLlp`)
 *
 * The seat → book scope comes from server/data/scope (scopesFor) — the one table; Zoho's own sharing on the
 * caller's token (D53, Sahil's T02 profiles) is the second wall behind this one.
 */

import type { BookScope } from "../data/scope";
import { scopesFor } from "../data/scope";

export type AllotmentAccess = "files" | "status" | "none";
export interface DocAccess {
  readonly personal: boolean;
  readonly allotment: AllotmentAccess;
  readonly project: boolean;
  /** the Investors book scope that admits an investor (ir-guard), for the investor-side read */
  readonly investors: BookScope;
}

/** Seats whose org-wide investor read does NOT include personal papers (viewers and audit). */
const NO_PERSONAL: ReadonlySet<string> = new Set(["audit", "exec", "bu"]);

export function docAccessFor(seat: string, userId: string): DocAccess {
  const s = scopesFor(seat, userId);
  const inv = s.investors;
  const project = s.farms.kind !== "none";
  switch (inv.kind) {
    case "own-lead": return Object.freeze({ personal: false, allotment: "status", project, investors: inv });
    case "own-book":
    case "subtree": return Object.freeze({ personal: true, allotment: "files", project, investors: inv });
    case "org":
    case "all": return Object.freeze({ personal: !NO_PERSONAL.has(seat), allotment: "files", project, investors: inv });
    default: return Object.freeze({ personal: false, allotment: "none", project, investors: inv });
  }
}

/** The allotment fields a holder check needs. */
export interface HolderRow { readonly Customer: string; readonly LLP_Lookup: string; readonly Allocation_Status: string }

/** Investor side (D70 project scope): does this Contact hold a live (not Cancelled) allotment in this LLP? */
export function holdsLlp(allotments: readonly HolderRow[], contactId: string, llpId: string): boolean {
  return allotments.some((a) => a.Customer === contactId && a.LLP_Lookup === llpId && a.Allocation_Status !== "Cancelled");
}

/** The LLPs whose project papers this Contact may see: those they hold a live allotment in, once each. */
export function heldLlps(allotments: readonly HolderRow[], contactId: string): readonly string[] {
  return Object.freeze([...new Set(allotments.filter((a) => a.Customer === contactId && a.Allocation_Status !== "Cancelled" && a.LLP_Lookup).map((a) => a.LLP_Lookup))]);
}
