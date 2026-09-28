import { describe, expect, it } from "vitest";
import { FRESH_MS, freshness } from "./freshness";

const fmt = (ms: number) => "T" + ms;
describe("freshness (M01-S03)", () => {
  it("says nothing before the first read", () => {
    expect(freshness(null, false, 1000, fmt)).toEqual({ tone: "reading", line: "", retry: false, block: null });
  });
  it("is live with the real read time inside five minutes", () => {
    expect(freshness(100, false, 100 + FRESH_MS, fmt)).toEqual({ tone: "live", line: "Data read T100", retry: false, block: null });
  });
  it("is stale past the ceiling, with Retry", () => {
    const f = freshness(100, false, 101 + FRESH_MS, fmt);
    expect(f).toMatchObject({ tone: "stale", line: "Data read T100 · over 5 minutes ago", retry: true, block: null });
  });
  it("a failed read inside the ceiling is stale with an error block", () => {
    const f = freshness(100, true, 200, fmt);
    expect(f.tone).toBe("stale");
    expect(f.retry).toBe(true);
    expect(f.block).toContain("The last read failed. What you see was read at T100");
  });
  it("a failed read past the ceiling, or with nothing read, is an error — never old numbers silently", () => {
    expect(freshness(100, true, 101 + FRESH_MS, fmt)).toMatchObject({ tone: "error", line: "Data could not be read · last read T100", retry: true });
    const none = freshness(null, true, 5, fmt);
    expect(none).toMatchObject({ tone: "error", line: "Data could not be read", retry: true });
    expect(none.block).toBe("The data source did not answer, so nothing here is shown as current.");
  });
});
