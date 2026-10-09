/* ── im/money-types.ts — records the later owner decisions added (not in the prototype) ──────
   D70 (three scopes: the farm LLP, the allotment investor × LLP, receipts on the allotment),
   D81/D82/D84 (Investor Payouts: 60 monthly records per 5-year allotment; TDS typed by Finance),
   D93 (app access run from the console: On hold / Invite, welcome, preview, test sign-in link),
   and ARL_Holdings / ARL_Transactions (read-only corporate instruments, D70 "stay a read-only panel").

   Field names are the Zoho API names from pm/plan-merged/zoho-field-mapping.json /
   ZOHO-FIELD-MAPPING.md and docs/decisions/D82, so phase 2 swaps the source and nothing else.
   A record's own key is `id`; a lookup holds the other record's `id`.
   ────────────────────────────────────────────────────────────────────────────────────────── */

/** LLP_Creation_Module.LLP_Status (the org's "Darft" is shown as Draft — D81) */
export type ImLlpStatus = "Draft" | "Open for Reservation" | "Open for Issuance" | "Fully Subscribed" | "Active";
export type ImSpoc = { n: string; role: string; ph: string };

/** LLP_Creation_Module — one farm/project LLP (M11-S01). The prototype's Block A–F are these records:
 *  `Block_Code` is the prototype's FARMS[].k, so the shelf and the LLP read the same record. */
export type ImLlp = {
  id: string;
  Name: string;
  Block_Code: string;
  /** Acreage_Acres / Total_Units — read from FARMS when the block is on the prototype's shelf */
  Acreage_Acres?: number;
  Total_Units?: number;
  Unit_Price: number;
  LLP_Status: ImLlpStatus;
  PAN: string;
  GST: string;
  SPOCs: ImSpoc[];
  Insurer: string;
  Insurance_Policy_No: string;
  Insured_Till: string;
  /** Annual_Rental_Yield — the contract rate an allotment's payouts are built from (D82), in % */
  Annual_Rental_Yield: number;
};

/** LLP_UnitAllocation_Module.Allocation_Status */
export type ImAllocStatus = "Reserved" | "Issued" | "Cancelled";
/** LLP_UnitAllocation_Module.Payment_Status — computed from the matched receipts (D70) */
export type ImPayStatus = "Yet to initiate" | "Partial" | "Full";

/** LLP_UnitAllocation_Module — one allotment: an investor (Contact) × one farm LLP (M11-S02). */
export type ImAllot = {
  id: string;
  /** Customer → Contacts (the investor's ARL id) */
  Customer: string;
  /** LLP_Lookup → LLP_Creation_Module */
  LLP_Lookup: string;
  Committed_Units: number;
  Issued_Units: number;
  /** the price per unit as recorded when the allotment was made — never recomputed from today's LLP price */
  Unit_Price: number;
  /** Ticket_Snapshot — the ticket (units × price) as recorded */
  Ticket_Snapshot: number;
  Allocation_Status: ImAllocStatus;
  /** "YYYY-MM-DD" — when it was issued; the payout schedule starts the month after */
  Issued_On: string | null;
  Annual_Rental_Yield: number;
};

/** Investor_Payouts.Payout_State (D82) */
export type ImPayoutState = "Scheduled" | "Paid" | "Held" | "Failed" | "Cancelled";
export type ImPayoutMode = "NEFT" | "RTGS" | "IMPS" | "UPI";
/** Investor_Payouts — one monthly payout (D82: 60 per 5-year allotment). */
export type ImPayout = {
  id: string;
  /** Allotment → LLP_UnitAllocation_Module */
  Allotment: string;
  Payout_Kind: "Rental yield" | "Exit" | "Refund" | "Other";
  Instalment_No: number;
  /** "YYYY-MM" */
  Period_Month: string;
  /** "YYYY-MM-DD" */
  Due_On: string;
  Gross_Amount: number;
  /** typed by Finance, default 0 — the console never computes TDS (D84) */
  TDS_Amount: number;
  /** Gross_Amount − TDS_Amount */
  Net_Amount: number;
  Payout_State: ImPayoutState;
  Paid_On: string | null;
  Payout_Mode: ImPayoutMode | null;
  Payout_UTR: string | null;
  /** a console person key */
  Paid_By: string | null;
  Payout_Note: string;
};

/** ARL_Holdings — a corporate instrument per Contact (read-only here, M10-S09) */
export type ImHolding = {
  id: string; Contact: string; Instrument_Type: "CCD" | "Equity" | "Preference";
  Amount_Invested: number; Invested_On: string; Interest_Rate: number | null; Maturity_On: string | null;
};
export type ImArlTxnType = "Capital Call" | "Interest" | "Distribution" | "Conversion" | "Fee";
/** ARL_Transactions — a movement against a holding */
export type ImArlTxn = { id: string; Holding: string; Type: ImArlTxnType; Date: string; Amount: number };

/** Contacts.App_Access (D93): Hold = data synced, sign-in locked, no email; Invite = unlocked, one welcome */
export type ImAppAccess = "Hold" | "Invite";
export type ImAccess = {
  App_Access: ImAppAccess;
  /** written back by the investor app when the welcome is delivered */
  App_Welcome_At: string | null;
  App_Welcome_Channel: "Email" | "WhatsApp" | "SMS" | null;
  /** set when Finance locks an invited account again (the history lives in Zoho field history + Activity) */
  Locked_Reason?: string | null;
  Locked_By?: string | null;
  Locked_At?: string | null;
  /** a test account (not a real investor) — no warning on a test sign-in link */
  Test_Account?: boolean;
};

/** A one-time test sign-in link (M10-S23). Audit row: who, whom, when, why, when used. */
export type ImTestLink = {
  id: string; inv: string; by: string; why: string;
  /** "YYYY-MM-DDTHH:MM" */
  at: string; expires: string; usedAt: string | null;
  url: string;
};

export type ImMoneyDrawerKey = "payout" | "llp" | "addinv" | "applock" | "testlink" | "preview" | "convert" | "fullpaid";

export type ImMoneyAction =
  | { type: "mset"; k: string; v: string }
  | { type: "markPayoutPaid"; id: string; paidOn: string; mode: ImPayoutMode; utr: string; tds: number }
  /** M10-S20-W1: the schedule job's fixture half — the missing of an Issued allotment's 60 payouts (POST /api/payouts/schedule) */
  | { type: "schedulePayouts"; ids: string[] }
  | { type: "sendWelcome"; id: string }
  | { type: "welcomeDelivered"; id: string }
  | { type: "lockApp"; id: string; why: string }
  | { type: "createTestLink"; id: string; why: string }
  | { type: "addInvestor"; n: string; em: string; ph: string; llp: string; units: number; paid: number; on: string };
