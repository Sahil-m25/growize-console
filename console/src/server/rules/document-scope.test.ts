/* M19-S06-T01 — document scopes (D70): Personal on the investor, Allotment on investor × LLP they hold, Project on a farm. */
import { describe, expect, it } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { I, initialImUi, uploadGate, uploadsFor, type ImState } from "@/lib/im";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const MB = 1024 * 1024;
const file = { File_Name: "a.pdf", File_Size: MB, File_Type: "application/pdf" };
const msg = (g: { ok: true } | { ok: false; msg: string | null }) => (g.ok ? "" : g.msg);

describe("document scope", () => {
  it("an Allotment paper needs an LLP the investor holds", () => {
    const s = demo();
    const t = { Scope: "Allotment" as const, Doc_Type: "Signed NDA", Investor: "ARL-INV-0208", LLP: "B", ...file };
    expect(uploadGate(s, "harsha", t)).toEqual({ ok: true });
    expect(msg(uploadGate(s, "harsha", { ...t, LLP: "A" }))).toMatch(/holds nothing on that farm/);
    expect(msg(uploadGate(s, "harsha", { ...t, Investor: null }))).toBe("Pick the investor it belongs to.");
  });
  it("a Project (farm) paper needs a real farm and no investor", () => {
    const s = demo();
    const t = { Scope: "Project" as const, Doc_Type: "Farm report", Investor: null, LLP: "A", ...file };
    expect(uploadGate(s, "harsha", t)).toEqual({ ok: true });
    expect(msg(uploadGate(s, "harsha", { ...t, LLP: "ZZ" }))).toBe("Pick the farm it belongs to.");
    expect(msg(uploadGate(s, "harsha", { ...t, LLP: null }))).toBe("Pick the farm it belongs to.");
  });
  it("an unknown scope is refused before anything else is checked", () => {
    const s = demo();
    expect(msg(uploadGate(s, "harsha", { Scope: "Everywhere" as never, Doc_Type: "Signed NDA", Investor: "ARL-INV-0208", LLP: "B", ...file })))
      .toBe("Pick where the file belongs: Personal, Allotment or Farm.");
  });
  it("an investor's list holds only their own papers plus the farm papers of farms they hold", () => {
    const s = demo();
    const list = uploadsFor(s, "harsha", "ARL-INV-0208");
    const x = I(s, "harsha", "ARL-INV-0208")!;
    expect(x).toBeTruthy();
    expect(list.length).toBeGreaterThan(0);
    for (const u of list) {
      if (u.Scope === "Project") expect(x.blocks[u.LLP || ""]).toBeTruthy();
      else expect(u.Investor).toBe("ARL-INV-0208");
    }
    expect(uploadsFor(s, "harsha", "ARL-INV-9999")).toEqual([]);
  });
});
