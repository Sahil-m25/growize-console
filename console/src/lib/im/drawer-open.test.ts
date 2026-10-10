/* W7-FIN-1: "Money and the 10%" and "Mark fully paid…" did nothing — their drawer keys had no case in drawerReadable, which
   answers false for any key it does not list, so the reducer's openDrawer refused them silently. This file makes that class
   fail a test: every Investors-side drawer key has a seat that may open it, and every key a button under features/im opens is
   a key this file knows (so a new drawer added without a gate fails here, not on staging). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { drawerReadable, mayAskFullPaid, mayConvertLead, mayMarkFullPaid } from "./index";
import type { ImDrawerKey } from "./types";
import { act, kit } from "./test-kit";

/* Typed as a Record so `tsc` fails when ImDrawerKey grows a key this table does not name. */
const EVERY_KEY: Record<ImDrawerKey, true> = {
  kam: true, talk: true, claim: true, pay: true, send: true, verify: true, kyc: true, tkt: true, upd: true, field: true, details: true,
  payout: true, llp: true, addinv: true, applock: true, testlink: true, preview: true, convert: true, fullpaid: true, fullpaidask: true,
};
const KEYS = Object.keys(EVERY_KEY) as ImDrawerKey[];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}
const opened = new Set(sources(join(__dirname, "../../features/im"))
  .flatMap(f => [...readFileSync(f, "utf8").matchAll(/type:\s*"openDrawer",\s*k:\s*"([a-z]+)"/g)].map(m => m[1])));

describe("every drawer a button opens can be opened (W7-FIN-1)", () => {
  const s = kit();
  const seats = Object.keys(s.data.P);
  it("finds the buttons it guards", () => {
    expect(opened.size).toBeGreaterThan(10);
    expect(opened.has("convert") && opened.has("fullpaid") && opened.has("fullpaidask")).toBe(true);
  });
  it("knows every key a button under features/im opens", () => {
    expect([...opened].filter(k => !(k in EVERY_KEY))).toEqual([]);
  });
  it.each(KEYS)("some seat may open %s", k => {
    expect(seats.filter(w => drawerReadable(s, w, k, "A1"))).not.toEqual([]);
  });
  it("gates convert / fullpaid / fullpaidask by the same rule the buttons use", () => {
    for (const w of seats) {
      expect(drawerReadable(s, w, "convert", "L1")).toBe(mayConvertLead(s, w));
      expect(drawerReadable(s, w, "fullpaid", "A1")).toBe(mayMarkFullPaid(s, w));
      expect(drawerReadable(s, w, "fullpaidask", "A1")).toBe(mayAskFullPaid(s, w));
    }
    expect(drawerReadable(s, "ops1", "convert", null)).toBe(false);
    expect(mayConvertLead(s, "ops1") && mayMarkFullPaid(s, "ops1") && mayMarkFullPaid(s, "su")).toBe(true);
    expect(mayMarkFullPaid(s, "kam1") || mayConvertLead(s, "kam1")).toBe(false);
    expect(mayAskFullPaid(s, "kam1")).toBe(true);
  });
  it("the reducer opens them", () => {
    expect(act(kit(), "ops1", { type: "openDrawer", k: "convert", id: "L1" }).ui.DRW).toEqual({ k: "convert", id: "L1" });
    expect(act(kit(), "fin", { type: "openDrawer", k: "fullpaid", id: "R1" }).ui.DRW).toEqual({ k: "fullpaid", id: "R1" });
    expect(act(kit(), "kam1", { type: "openDrawer", k: "fullpaidask", id: "A1" }).ui.DRW).toEqual({ k: "fullpaidask", id: "A1" });
    expect(act(kit(), "kam1", { type: "openDrawer", k: "fullpaid", id: "A1" }).ui.DRW).toBeNull();
  });
});
