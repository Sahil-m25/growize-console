/* W3-KAM-2 — the investor record's ticket row formats the SLA like the Tickets page: never the raw ISO stamp. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImState } from "@/lib/im";
import { TkRow } from "./TkRow";

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });

describe("TkRow SLA", () => {
  it("a live ISO SLA reads '13 Oct 11:52'; an empty one reads 'not set'", () => {
    const s = st();
    const t = s.data.TKT.find(x => x.state !== "closed")!;
    const h = (sla: string) => renderToStaticMarkup(<TkRow s={s} me="imran" dispatch={() => {}} t={{ ...t, sla }} />);
    expect(h("2026-10-13T11:52")).toContain("SLA 13 Oct 11:52");
    expect(h("2026-10-13T11:52")).not.toContain("T11:52");
    expect(h("")).toContain("SLA not set");
  });
});
