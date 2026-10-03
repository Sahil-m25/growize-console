/* The typed slots (M12-S02-T01 fields, confirmed read-only in the org 2026-09-28): a file-upload field on the record, by scope.
   Kept apart from upload.ts so the attachment lister (M12-S01) can name a slot file without importing the uploader. */

export type UploadScope = "personal" | "allotment" | "project" | "lead";

/** The typed slots → file-upload field. OD8 may add more. */
export const SLOTS: Readonly<Record<UploadScope, Readonly<Record<string, { readonly field: string; readonly label: string }>>>> = Object.freeze({
  lead: Object.freeze({ "signed-nda": { field: "NDA", label: "Signed NDA" } }),
  personal: Object.freeze({
    "pan-proof": { field: "PAN_Proof", label: "PAN proof" },
    "bank-proof": { field: "Bank_Proof", label: "Bank proof" },
    "fema-declaration": { field: "FEMA_Declaration", label: "FEMA declaration" },
  }),
  allotment: Object.freeze({
    "supplementary-agreement": { field: "Supplementary_Agreement", label: "Supplementary agreement" },
    "allocation-letter": { field: "Allocation_Letter", label: "Allocation letter" },
    "unit-certificate": { field: "Unit_Certificate", label: "Unit certificate" },
  }),
  project: Object.freeze({
    "llp-deed": { field: "LLP_Deed", label: "LLP deed" },
    "insurance-policy": { field: "Insurance_Policy_Document", label: "Insurance policy" },
  }),
});
