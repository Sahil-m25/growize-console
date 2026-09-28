/* ── fixtures/im/money.ts — demo records for the later owner decisions (not in the prototype) ─
   Farm LLPs (the prototype's Blocks become LLP_Creation_Module records, plus one new LLP, E),
   one allotment per investor × block (LLP_UnitAllocation_Module), the monthly payouts built from
   each issued allotment (Investor_Payouts, D82), two ARL holdings, and every app account's
   App_Access (D93). All fictional. Nothing the prototype already shows is changed by this file:
   every investor keeps the one block the prototype gives them, and every existing account reads
   as invited with its welcome delivered, exactly as the prototype's card says.
   The two-farm investor, an account on hold and a locked one are the named fixture IM:MONEY_DEMO
   (money-fixtures.ts), so the prototype comparison stays exact.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import {
  UNIT, nowDay, payoutSchedule, when, ymd,
  type ImAccess, type ImAllot, type ImArlTxn, type ImData, type ImHolding, type ImInvestor, type ImLlp, type ImPayout,
} from "@/lib/im";

const spoc = (n: string, role: string, ph: string) => ({ n, role, ph });
const LLP: ImLlp[] = [
  { id: "LLP-A", Name: "Block A — Doddaballapura", Block_Code: "A", Unit_Price: UNIT, LLP_Status: "Active",
    PAN: "AAKFG4410A", GST: "29AAKFG4410A1Z3", SPOCs: [spoc("Harsha Bhat", "Finance", "+91 98450 10401"), spoc("Divya Kamath", "Farm liaison", "+91 98450 10402")],
    Insurer: "Demo General Insurance", Insurance_Policy_No: "DGI-CROP-2026-0410", Insured_Till: "2027-03-31", Annual_Rental_Yield: 12 },
  { id: "LLP-B", Name: "Block B — Doddaballapura", Block_Code: "B", Unit_Price: UNIT, LLP_Status: "Open for Issuance",
    PAN: "AAKFG4411B", GST: "29AAKFG4411B1Z1", SPOCs: [spoc("Harsha Bhat", "Finance", "+91 98450 10401")],
    Insurer: "Demo General Insurance", Insurance_Policy_No: "DGI-CROP-2026-0411", Insured_Till: "2027-03-31", Annual_Rental_Yield: 12 },
  { id: "LLP-C", Name: "Block C — Chikkaballapura", Block_Code: "C", Unit_Price: UNIT, LLP_Status: "Draft",
    PAN: "AAKFG4412C", GST: "29AAKFG4412C1Z9", SPOCs: [], Insurer: "", Insurance_Policy_No: "", Insured_Till: "", Annual_Rental_Yield: 12 },
  { id: "LLP-D", Name: "Block D — Chikkaballapura", Block_Code: "D", Unit_Price: UNIT, LLP_Status: "Draft",
    PAN: "AAKFG4413D", GST: "29AAKFG4413D1Z7", SPOCs: [], Insurer: "", Insurance_Policy_No: "", Insured_Till: "", Annual_Rental_Yield: 12 },
  { id: "LLP-E", Name: "Block E — Kolar", Block_Code: "E", Acreage_Acres: 0.9, Total_Units: 22, Unit_Price: UNIT,
    LLP_Status: "Open for Reservation", PAN: "AAKFG4414E", GST: "29AAKFG4414E1Z5",
    SPOCs: [spoc("Meena Raghavan", "Finance", "+91 98450 10403")],
    Insurer: "Demo General Insurance", Insurance_Policy_No: "DGI-CROP-2026-0414", Insured_Till: "2027-09-30", Annual_Rental_Yield: 12 },
];

/** "25 Jul" (around NOW) → "2026-07-25" */
const isoOf = (NOW: string, d: string): string | null => { const ms = when(NOW, d); return ms == null ? null : ymd(ms); };

/** one allotment per investor × block, from the prototype's own holdings */
export function allotsFrom(NOW: string, INV: ImInvestor[]): ImAllot[] {
  return INV.flatMap(x => Object.entries(x.blocks).map(([k, n], i) => {
    const issued = x.st === "allocated";
    return {
      id: "AL-" + x.id.slice(-4) + (i ? "-" + k : ""), Customer: x.id, LLP_Lookup: "LLP-" + k,
      Committed_Units: n, Issued_Units: issued ? n : 0, Unit_Price: UNIT, Ticket_Snapshot: n * UNIT,
      Allocation_Status: x.st === "lapsed" ? "Cancelled" : issued ? "Issued" : "Reserved",
      Issued_On: issued ? isoOf(NOW, x.since) : null, Annual_Rental_Yield: 12,
    } satisfies ImAllot;
  }));
}

/* the paid history: everything due before NOW is paid on its due date, except these */
const EXCEPT: Record<string, Partial<ImPayout>> = {
  "PO-0214-01": { Payout_State: "Failed", Payout_Note: "Returned by the bank — the account was closed; new details asked for" },
  "PO-0216-01": { Payout_State: "Held", Payout_Note: "Held until the bank name match is re-run" },
};
const TDS: Record<string, number> = { "0212": 15000 };
export function payoutsFrom(NOW: string, ALLOT: ImAllot[]): ImPayout[] {
  const today = ymd(nowDay(NOW));
  return ALLOT.flatMap(a => payoutSchedule(a)).map((p, i) => {
    const id4 = p.id.slice(3, 7);
    if (EXCEPT[p.id]) return { ...p, ...EXCEPT[p.id] };
    if (p.Due_On >= today) return p;
    const tds = TDS[id4] || 0;
    return { ...p, Payout_State: "Paid" as const, Paid_On: p.Due_On, Payout_Mode: "NEFT" as const,
      Payout_UTR: "PO" + p.Due_On.replace(/-/g, "").slice(2) + id4, Paid_By: i % 2 ? "meena" : "harsha",
      TDS_Amount: tds, Net_Amount: p.Gross_Amount - tds };
  });
}

const HOLDING: ImHolding[] = [
  { id: "H-01", Contact: "ARL-INV-0212", Instrument_Type: "CCD", Amount_Invested: 5000000, Invested_On: "2025-11-01",
    Interest_Rate: 10, Maturity_On: "2028-10-31" },
  { id: "H-02", Contact: "ARL-INV-0213", Instrument_Type: "Equity", Amount_Invested: 2000000, Invested_On: "2026-01-15",
    Interest_Rate: null, Maturity_On: null },
];
const ARLTXN: ImArlTxn[] = [
  { id: "AT-01", Holding: "H-01", Type: "Capital Call", Date: "2025-11-01", Amount: 5000000 },
  { id: "AT-02", Holding: "H-01", Type: "Interest", Date: "2026-05-01", Amount: 250000 },
  { id: "AT-03", Holding: "H-02", Type: "Capital Call", Date: "2026-01-15", Amount: 2000000 },
  { id: "AT-04", Holding: "H-02", Type: "Fee", Date: "2026-01-15", Amount: 20000 },
];

/** Add the later decisions' records to a seeded demo book (after seedApp: the accounts exist). */
export function withMoney(d: ImData): ImData {
  const ALLOT = allotsFrom(d.NOW, d.INV);
  const ACCESS: Record<string, ImAccess> = {};
  Object.entries(d.APP).forEach(([id, a]) => {
    ACCESS[id] = { App_Access: "Invite", App_Welcome_At: a.welcome.at, App_Welcome_Channel: "Email" };
  });
  return { ...d, LLP: structuredClone(LLP), ALLOT, PAYOUT: payoutsFrom(d.NOW, ALLOT), HOLDING: structuredClone(HOLDING),
    ARLTXN: structuredClone(ARLTXN), ACCESS, TESTLINK: [] };
}
