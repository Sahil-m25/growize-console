/* B-02b / B-02a — what the Finance pages say when Zoho's answer is incomplete: an unpriced reservation left out of
 * "still due" (register problems) and KYC/FEMA hidden from the seat's profile (finance list statusHidden). The endpoints'
 * fixtures are wrapped to answer as the live routes do in that state; everything else is the demo book. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";

vi.mock("@/lib/data/endpoints/payments", async (orig) => {
  const m = await orig<typeof import("@/lib/data/endpoints/payments")>();
  return { ...m, paymentsRegister: { ...m.paymentsRegister, fixture: (b: never, a: never) => {
    const r = m.paymentsRegister.fixture!(b, a) as { ok: boolean; data?: Record<string, unknown> };
    return r.ok ? { ...r, data: { ...r.data, problems: ["price-missing:2"] } } : r;
  } } };
});
vi.mock("@/lib/data/endpoints/investors", async (orig) => {
  const m = await orig<typeof import("@/lib/data/endpoints/investors")>();
  return { ...m, financeInvestors: { ...m.financeInvestors, fixture: (b: never, a: never) => {
    const r = m.financeInvestors.fixture!(b, a) as { ok: boolean; data?: { rows: { kyc: string }[] } & Record<string, unknown> };
    return r.ok ? { ...r, data: { ...r.data, statusHidden: true, rows: r.data!.rows.map((x) => ({ ...x, kyc: "hidden", fema: null })) } } : r;
  } } };
});

const { ImTxn } = await import("./index");
const { ImInv } = await import("../inv/index");
const state = (): ImState => ({ data: imDemoData(), ui: initialImUi() });

describe("degraded Finance reads", () => {
  it("the register says how many reservations still due leaves out", () => {
    const h = renderToStaticMarkup(<ImTxn s={state()} me="meena" dispatch={() => {}} />);
    expect(h).toContain("2 reservations have no unit price (or units) in Zoho, so “still due” leaves them out.");
  });
  it("the Investors list reads KYC as not visible, says why, and offers no 'KYC not passed' cut", () => {
    const h = renderToStaticMarkup(<ImInv s={state()} me="harsha" dispatch={() => {}} />);
    expect(h).toContain("KYC and FEMA are not visible to your seat in Zoho");
    expect(h).toContain("KYC not visible");
    expect(h).not.toContain("KYC pending");
    expect(h).not.toContain("KYC not passed");
  });
});
