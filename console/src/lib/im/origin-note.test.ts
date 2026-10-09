/* W4-3 — the Care card's "Brought in by" tail never prints a doubled or dangling separator. */
import { describe, expect, it } from "vitest";
import { originNote } from "./selectors";

describe("W4-3: originNote", () => {
  it("source and lead", () => expect(originNote({ src: "Events", lead: "L1", leadName: "Meenakshi Sundaram" })).toBe("Events · lead Meenakshi Sundaram"));
  it("empty source gives no doubled separator", () => {
    const t = originNote({ src: "", lead: "1454168000003024601", leadName: "Meenakshi Sundaram" });
    expect(t).toBe("lead Meenakshi Sundaram");
    expect(t).not.toMatch(/·\s*·/);
  });
  it("source only", () => expect(originNote({ src: "Events", lead: "1454168000003024601" })).toBe("Events"));
  it("nothing at all", () => expect(originNote({ src: "" })).toBe(""));
});
