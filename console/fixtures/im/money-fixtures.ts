/* ── fixtures/im/money-fixtures.ts — named fixtures for the later decisions' screens ───────────
   IM:MONEY_DEMO shows what the default book cannot without changing a screen the prototype draws:
   - Joseph Mathew (ARL-INV-0209) holds two allotments: 2 units on Block B (his ₹10 L advance) and
     2 on Block A (nothing paid yet) — the per-farm Money blocks, the total line and the receipt
     picker that must be picked (M10-S07, M10-S08, M11-S02). His 4 units and ₹1 Cr are unchanged.
   - Joseph's app account is On hold (D93, M10-S21); Abhijit Sen's is locked.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import type { Dataset } from "@/lib/data/types";
import { UNIT } from "@/lib/im";

export const MONEY_FIXTURES: Record<string, (ds: Dataset) => void> = {
  "IM:MONEY_DEMO": (ds) => {
    const d = ds.im;
    const j = d.INV.find(x => x.id === "ARL-INV-0209");
    const b = (d.ALLOT || []).find(a => a.id === "AL-0209");
    if (!j || !b) throw new Error("fixture: no Joseph Mathew or his allotment");
    j.blocks = { B: 2, A: 2 };
    b.Committed_Units = 2; b.Ticket_Snapshot = 2 * UNIT;
    d.ALLOT = (d.ALLOT || []).concat([{ id: "AL-0209-A", Customer: j.id, LLP_Lookup: "LLP-A", Committed_Units: 2, Issued_Units: 0,
      Unit_Price: UNIT, Ticket_Snapshot: 2 * UNIT, Allocation_Status: "Reserved", Issued_On: null, Annual_Rental_Yield: 12 }]);
    const t = d.TXN.find(x => x.id === "T-0030");
    if (t) t.Allotment = "AL-0209";
    d.ACCESS = d.ACCESS || {};
    d.ACCESS[j.id] = { App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null };
    d.ACCESS["ARL-INV-0206"] = { ...(d.ACCESS["ARL-INV-0206"] || { App_Welcome_At: null, App_Welcome_Channel: null }),
      App_Access: "Hold", Locked_Reason: "Asked us to pause the app while he changes banks", Locked_By: "harsha", Locked_At: "01 Sep 16:20" };
  },
};
