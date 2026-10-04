/* M18-S09-NOTE-9 — a continuing sheet load reads as progress, never as "loaded" */
import { describe, expect, it } from "vitest";
import { loadingLine, runningCounts, runningOf, sheetTag } from "./sheet-progress";

const mid = { loaded: 40, duplicates: 3, refused: 1, continuing: { done: 44, total: 120 } };
const end = { loaded: 116, duplicates: 3, refused: 1, continuing: null };

describe("sheet-progress", () => {
  it("is running only while the answer is continuing", () => {
    expect(runningOf(mid)).toEqual({ done: 44, total: 120, loaded: 40, duplicates: 3, refused: 1 });
    expect(runningOf(end)).toBeNull();
  });
  it("says how far it has got, with the running counts", () => {
    const r = runningOf(mid)!;
    expect(loadingLine(r)).toBe("Loading — 44 of 120 rows so far");
    expect(runningCounts(r)).toBe("40 loaded so far, 3 skipped as duplicates, 1 left on the sheet");
    expect(runningCounts({ ...r, refused: 0 })).not.toContain("left on the sheet");
  });
  it("the tag reads loaded only when finished", () => {
    expect(sheetTag(false, runningOf(mid)).text).toBe("loading");
    expect(sheetTag(true, runningOf(mid)).text).toBe("loading");
    expect(sheetTag(false, null).text).toBe("loaded");
    expect(sheetTag(true, null).text).toBe("ready to load");
  });
});
