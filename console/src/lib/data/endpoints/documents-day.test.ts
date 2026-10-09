import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dayOf } from "./documents";

describe("W4-E-2: dayOf says the day in IST", () => {
  it("the drawer's raw stamp becomes a day", () => expect(dayOf("2026-10-23T12:05+05:30")).toBe("23 Oct"));
  it("a UTC stamp late in the day rolls to the next IST day", () => expect(dayOf("2026-10-22T20:00:00Z")).toBe("23 Oct"));
  it("a plain date and a wall-time stamp read as written", () => {
    expect(dayOf("2026-08-26")).toBe("26 Aug");
    expect(dayOf("2026-08-26T09:00:00")).toBe("26 Aug");
  });
  it("the Verify drawer prints the expiry through dayOf, never raw", () => {
    const src = readFileSync(new URL("../../../features/im/drawers/index.tsx", import.meta.url), "utf8");
    expect(src).toContain("link expires ${dayOf(sg.expiresAt)}");
    expect(src).not.toContain("link expires ${sg.expiresAt}");
  });
});
