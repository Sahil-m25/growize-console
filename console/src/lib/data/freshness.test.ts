import { describe, expect, it } from "vitest";
import { FRESH_MS, freshness, nextDataRead, type DataRead } from "./freshness";

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

/* M01-S09-W1 — the store takes failed and the source from /api/data's own fresh block */
describe("nextDataRead", () => {
  const prev: DataRead = { at: 1_000, failed: false, source: "zoho" };
  it("a live 200 that lost a secondary book is a failed read, dated the route's last good read", () => {
    expect(nextDataRead(prev, true, { ds: {}, fresh: { source: "zoho", at: 5_000, failed: true } }, 9_000)).toEqual({ at: 5_000, failed: true, source: "zoho" });
  });
  it("a live 503 keeps the last good read and says it failed", () => {
    expect(nextDataRead(prev, false, { error: "source-unavailable", fresh: { source: "zoho", at: null, failed: true } }, 9_000)).toEqual({ at: 1_000, failed: true, source: "zoho" });
  });
  it("source 'none' is no live source connected: nothing is claimed current", () => {
    const r = nextDataRead(prev, true, { ds: {}, fresh: { source: "none", at: null, failed: false } }, 9_000);
    expect(r).toEqual({ at: null, failed: false, source: "none" });
    expect(freshness(r.at, r.failed, 9_000).line).toBe("");
  });
  it("fixtures read now; nothing back at all is a failed read", () => {
    expect(nextDataRead(prev, true, { ds: {}, fresh: { source: "fixtures", at: 7, failed: false } }, 9_000)).toEqual({ at: 9_000, failed: false, source: "fixtures" });
    expect(nextDataRead(prev, false, null, 9_000)).toEqual({ ...prev, failed: true });
  });
});
