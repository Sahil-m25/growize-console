import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NoteBlock, NoteStep } from "@/lib/data/types";
import { MergeBlocks } from "./merge";

/* the "How the merge works" drawer renders whatever blocks the dataset carries (Dataset.MERGENOTES);
   the chip is swapped for a plain label so no store is needed */
const blocks: NoteBlock[] = [
  { kind: "h", t: "The idea" },
  { kind: "p", runs: [{ t: "now its " }, { t: "Investors", b: true }, { t: " side" }] },
  { kind: "table", head: ["From", "Here"], rows: [[[{ t: "Dashboard" }], [{ t: "Today" }]]] },
  { kind: "steps", steps: [{ k: "a" as NoteStep["k"], page: "today", t: "A: Today" }, { k: "b" as NoteStep["k"], page: "pay", t: "B: Payments" }] },
  { kind: "ul", items: [[{ t: "Audit.", b: true }, { t: " two apps" }]] },
];
const Step = ({ t }: NoteStep) => <a className="chip">{t}</a>;

describe("MergeBlocks", () => {
  const html = renderToStaticMarkup(<MergeBlocks blocks={blocks} Step={Step} />);
  it("renders a heading, a bold run, a table cell, chips with arrows and a list", () => {
    expect(html).toContain("<h3>The idea</h3>");
    expect(html).toContain("<p>now its <b>Investors</b> side</p>");
    expect(html).toContain("<td>Dashboard</td>");
    expect(html).toContain('<a class="chip">A: Today</a><span class="sm" aria-hidden="true">→</span><a class="chip">B: Payments</a>');
    expect(html).toContain("<li><b>Audit.</b> two apps</li>");
  });
  it("renders nothing but the frame for the empty book", () => {
    expect(renderToStaticMarkup(<MergeBlocks blocks={[]} Step={Step} />)).toBe('<div class="mn"></div>');
  });
});
