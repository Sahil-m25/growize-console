/* Review 11 + 12: Balances to chase builds its sentence from the server's own deadline fields, and claim dates read "20 Sep". */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const row = { contactId: "c", code: "ARL-INV-0001", name: "Synth Investor", leadId: "l", allotmentId: "a", farm: "Block A", units: 2, holdUntil: "2026-11-16",
  daysLeft: 20, due: 1000, fromDay: "2026-10-10", extendedBy: 7,
  claims: [{ claimId: "k1", leadId: "l", seq: 1, state: "matched", amount: 250000, claimedOn: "2026-09-20", answeredOn: "2026-09-22", reason: null }] };
vi.mock("@/features/im/host", () => ({ useIm: () => ({ s: {}, me: "x" }) }));
vi.mock("@/lib/data/api", () => ({ useApiRead: () => ({ state: "ok", data: { chase: [row] } }) }));
import { BalanceChase } from "./BalanceChase";

describe("BalanceChase", () => {
  it("shows the server's deadline sentence (with the extension) and claim dates as '20 Sep'", () => {
    const t = renderToStaticMarkup(<BalanceChase onOpenLead={() => {}} />).replace(/<[^>]+>/g, "");
    expect(t).toContain("Balance due 16 Nov — 30 days from Finance confirming the 10% on 10 Oct, extended by 7 days");
    expect(t).toContain("You reported ₹2,50,000 (paid 20 Sep) — matched by Finance on 22 Sep");
  });
});
