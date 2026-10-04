import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImState } from "@/lib/im";
import { ImTeam, ImTeamBody } from ".";

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const html = (me: string, body = false) => renderToStaticMarkup(body
  ? <ImTeamBody s={st()} me={me} dispatch={() => {}} /> : <ImTeam s={st()} me={me} dispatch={() => {}} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Team (vTeam)", () => {
  it("Super administrator: every seat is a select, emails shown", () => {
    const h = html("pradeep"), t = text(h);
    expect(t).toContain("Teams who holds which seat on the Investors pages you can change seats Three teams, one wall.");
    expect(t).toContain("HB Harsha Bhat harsha@agresearchlabs.com Finance, Legal & Compliance");
    expect(h).toContain('<option value="head" selected="">Head of Finance</option>');
    expect(t).toContain("PR Pradeep Ram you pradeep@agresearchlabs.com Administration Super administrator");
  });
  it("Head of AM: moves only AM seats; other teams read 'another team's seat'", () => {
    const h = html("divya"), t = text(h);
    expect(t).toContain("Head of Finance another team's seat");
    expect(h).toContain('<option value="amlead">Head of Account Management</option><option value="kam" selected="">Key Account Manager</option>');
    expect(t).toContain("IS Imran Sheikh imran@agresearchlabs.com Account Management 4 accounts");
  });
  it("Auditor: read only, no emails but their own, the rights matrix", () => {
    const t = text(html("latha"));
    expect(t).toContain("read only");
    expect(t).not.toContain("harsha@agresearchlabs.com");
    expect(t).toContain("LP Latha Prabhu you latha@agresearchlabs.com");
    expect(t).toContain("What each seat holds Right Head of Finance Head of Finance Finance Operations Finance Operations Compliance & KYC Compliance and Audit Auditor Compliance and Audit");
    expect(t).toContain("Administrator Digital Infrastructure");
    expect(t).not.toContain("Super administrator Digital");
    expect(t).toContain("Seeing a bank account and revealing a PAN are deliberately different rights.");
  });
  it("ImTeamBody drops the heading block only", () => {
    const b = html("pradeep", true);
    expect(b).not.toContain('<div class="ph">');
    expect(b.startsWith('<div class="note" style="margin-bottom:8px"><b>Three teams, one wall.</b>')).toBe(true);
  });
});
