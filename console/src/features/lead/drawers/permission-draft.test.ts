/* B-03 — the permission drawer preloads what Zoho holds: the ticked channels (conFor, now that `consent` reads back) and the
   time permission was given (conAtIso), so a second save neither unticks a channel nor moves "given at" to now. */
import { describe, expect, it } from "vitest";
import type { Lead } from "@/domain";
import { buildPermissionDraft } from "./call";

const lead = (f: Partial<Lead>): Lead => ({ id: "554023000000700001", consent: true, con: { msg: true, email: false, call: true }, ...f }) as Lead;
const state = { NOW: new Date("2026-10-08T10:00:00+05:30") };

describe("buildPermissionDraft (B-03)", () => {
  it("preloads the recorded channels, how, and the time it was given", () => {
    const d = buildPermissionDraft(state, lead({ conHow: "call", conAtIso: "2026-10-07T23:32" }));
    expect(d.con).toEqual({ msg: true, call: true, email: false, visit: false });
    expect(d.how).toBe("call");
    expect([d.date, d.time]).toEqual(["2026-10-07", "23:32"]);
  });
  it("with nothing recorded, nothing is ticked and the time defaults to now", () => {
    const d = buildPermissionDraft(state, lead({ consent: false, con: {} }));
    expect(d.con).toEqual({ msg: false, call: false, email: false, visit: false });
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.time).toMatch(/^\d{2}:\d{2}$/);
  });
});
