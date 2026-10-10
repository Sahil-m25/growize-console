/* W9-KAM-1: a seat the holdings route refuses (a KAM) must not call it; Finance still does. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";

const seen: unknown[] = [];
vi.mock("@/lib/data/api", async () => {
  const a = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return { ...a, useApiRead: (ep: any, book: any, args: unknown, f?: any) => { if (ep.path("x")?.endsWith("/holdings")) seen.push(args); return a.useApiRead(ep, book, args, f); } };
});
import { ArlHoldings } from "./record";

describe("W9-KAM-1 — the holdings read", () => {
  it("a KAM asks for nothing; Finance asks for the investor", () => {
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    const x = s.data.INV.find(i => i.id === "ARL-INV-0212")!;
    renderToStaticMarkup(<ArlHoldings s={s} me="imran" dispatch={() => {}} x={x} />);
    expect(seen).toEqual([null]);
    renderToStaticMarkup(<ArlHoldings s={s} me="harsha" dispatch={() => {}} x={x} />);
    expect(seen).toEqual([null, "ARL-INV-0212"]);
  });
});
