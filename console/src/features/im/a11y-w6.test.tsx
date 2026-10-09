/* W6-A11Y-2, -3, -5 — the Today queue card, the "Elsewhere today" strip and the "Block A" link on an investor record.
   (axe-core is installed but this suite has no DOM — no jsdom — so the rules are asserted on the markup:
   nested-interactive, aria-required-children, target-size.)
   Run: npx vitest run src/features/im/a11y-w6.test.tsx */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import { ImDash, QRow } from "./dash";
import { ImInv } from "./inv";

const st = () => ({ data: imDemoData(), ui: initialImUi() });
const row = { key: "k1", kind: "care" as const, investor: { id: "ARL-INV-0205", name: "Radhika Menon" }, text: "Gone quiet", urg: "now" as const, days: 3,
  action: "Open the record" as const, ref: {} };

describe("W6-A11Y-2 queue card", () => {
  const html = renderToStaticMarkup(<QRow s={st()} me="harsha" dispatch={() => {}} x={row as never} />);
  it("the card is not a button, so it holds no button inside a button", () => {
    expect(html).toMatch(/^<div class="qc now">/);
    expect(html).not.toContain('role="button"');
  });
  it("the title is the one control that opens the record, and the action button is separate", () => {
    expect(html).toContain('<button type="button" class="lnk qc-open">Radhika Menon</button>');
    expect(html).toContain('<button class="act ghost">Open the record</button>');
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});

describe("W6-A11Y-3 Elsewhere today", () => {
  const html = renderToStaticMarkup(<ImDash s={st()} me="harsha" dispatch={() => {}} />);
  const at = html.indexOf('class="sigs"');
  const strip = html.slice(at, html.indexOf('class="note su"', at) > 0 ? html.indexOf('class="note su"', at) : at + 2500);
  it("the list holds listitems, each with a real button and no role=button anchor", () => {
    expect(at).toBeGreaterThan(0);
    expect(strip).toContain('role="list"');
    const items = strip.match(/role="listitem"/g) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(strip).not.toContain('role="button"');
    expect(strip).not.toContain("<a ");
    expect((strip.match(/<button type="button" class="chip sig/g) ?? []).length).toBeGreaterThanOrEqual(items.length);
  });
});

describe("W6-A11Y-5 What they hold", () => {
  it("the land link is a real button with a 24px target", () => {
    const s = { data: imDemoData(), ui: { ...initialImUi(), SEL: "ARL-INV-0208", SEC: { "inv:ARL-INV-0208": "hold" } } };
    const html = renderToStaticMarkup(<ImInv s={s} me="harsha" dispatch={() => {}} />);
    const m = html.match(/<button type="button" class="lnk"([^>]*)>([^<]*)<\/button>/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("min-height:24px");
    expect(html).not.toMatch(/<span[^>]*role="button"/);
  });
});
