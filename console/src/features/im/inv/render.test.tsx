import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImUi } from "@/lib/im";
import { ImInv } from "./index";

const text = (h: string) => h.replace(/<br\/?>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (me: string, ui: Partial<ImUi> = {}) => {
  const s = { data: imDemoData(), ui: { ...initialImUi(), ...ui } };
  const html = renderToStaticMarkup(<ImInv s={s} me={me} dispatch={() => {}} />);
  return { html, t: text(html) };
};
const rec = (me: string, id: string, sec: string) => render(me, { SEL: id, SEC: { ["inv:" + id]: sec } });

describe("ImInv — vInv, the list", () => {
  it("Finance (harsha): the whole book and its cuts", () => {
    const { html, t } = render("harsha");
    expect(t).toContain("Investors15 on the book · 40 units");
    expect(t).toContain("Everyone 15KYC not passed 1Balance outstanding 2NRI 1FEMA outstanding 1");
    expect(t).toContain("InvestorARL IDUnitsLandStateKYCPaidDueIR");
    expect(t).toContain("Radhika MenonBengaluruARL-INV-02054Block A ×4allocatedKYC passed₹1 Cr—");
    expect(html).toContain('placeholder="Name, ARL ID, city…"');
  });
  it("KAM (imran): only their accounts, with care columns", () => {
    const { t } = render("imran");
    expect(t).toContain("My accounts4 under care");
    expect(t).toContain("Everyone 4Gone quiet 2A concern last time 1Tier A 3");
    expect(t).toContain("TierManagerLast heardNext owedLand");
    expect(t).toContain("Call · 36d ago6d overdueBlock A ×4");
  });
  it("Head of Account Management (divya): Accounts, and a search that matches nobody", () => {
    expect(render("divya").t).toContain("Accounts13 under care");
    expect(render("divya", { IQ: "zzz" }).t).toContain("Nobody matches that.");
  });
});

describe("ImInv — vOne, the record", () => {
  it("Finance (harsha) on a reservation: the hold note, masked PII, money and paper", () => {
    const who = rec("harsha", "ARL-INV-0208", "who").t;
    expect(who).toContain("₹22.5 L due in 21 days. The hold ends 23 Sep. A lapse forfeits ₹50,000 and puts 1 unit back on the shelf.");
    expect(who).toContain("Who they areWhat they holdMoney1PaperJourneyTickets");
    expect(who).toContain("PANAFT•••••Lreveal");
    expect(who).toContain("HDFC0000911 · PRAKASH BHAT · name match matched");
    const money = rec("harsha", "ARL-INV-0208", "money").t;
    expect(money).toContain("₹2.5 L of ₹25 L · ₹22.5 L due");
    expect(money).toContain("Record a receiptThe balance ₹22.5 L");
    const paper = rec("harsha", "ARL-INV-0208", "paper").t;
    expect(paper).toContain("3 documents, all under ARL-INV-0208＋ Send one");
    expect(rec("harsha", "ARL-INV-0208", "tkt").t).toContain("Nothing has been raised on this investor.");
  });
  it("KAM (imran) on their own account: gone quiet, Finance-only identity, care, tickets", () => {
    const who = rec("imran", "ARL-INV-0205", "who").t;
    expect(who).toContain("Gone quiet — 6 days past the Tier A cadence. An account nobody has spoken to since 28 Jul is the one that is surprised by everything.");
    expect(who).toContain("PANFinance onlyAadhaarFinance onlyKYCclear");
    expect(who).toContain("Identity and bank details are Finance's. You are talking to this person every month");
    expect(who).toContain("It is on their record; it is not on your screen.");
    expect(who).not.toContain("Money");
    const care = rec("imran", "ARL-INV-0205", "care").t;
    expect(care).toContain("Tier A · a named manager, monthly");
    expect(care).toContain("every 30 days · 6 days overdue");
    expect(care).toContain("— Kavya stayed on the first call");
    expect(care).toContain("Log a conversation");
    expect(rec("imran", "ARL-INV-0205", "tkt").t).toContain("Hand it to Financea bank account cannot be changed from this side, and should not be");
  });
  it("Head of AM (divya): may move the account, and reads another KAM's tickets", () => {
    expect(rec("divya", "ARL-INV-0205", "care").t).toContain("Move the account");
    expect(rec("divya", "ARL-INV-0205", "tkt").t).toContain("open · Imran's");
  });
  it("a record the seat cannot read falls back to the list", () => {
    expect(render("imran", { SEL: "ARL-INV-0208" }).t).toContain("My accounts");
  });
});
