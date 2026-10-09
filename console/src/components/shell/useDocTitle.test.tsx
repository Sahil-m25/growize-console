/* W6-A11Y-4 — an open investor record names the page (WCAG 2.4.2). Effects are run inline here (no DOM in this suite). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ run: [] as Array<() => void | (() => void)> }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useEffect: (f: () => void | (() => void)) => { fx.run.push(f); } }));
const { useDocTitle } = await import("./useDocTitle");

const BASE = "Growize IR Console — Investor workspace";
const NAME = "Radhika Menon · Investor · Growize console";
const doc = { title: BASE };
beforeEach(() => { fx.run = []; (globalThis as unknown as { document: typeof doc }).document = doc; doc.title = BASE; });
const mount = (t: string | null) => { fx.run = []; useDocTitle(t); return fx.run.map(f => f()); };

describe("useDocTitle", () => {
  it("sets a meaningful title, puts it back if something blanks it, and restores the old one on close", () => {
    const cleanups = mount(NAME);
    expect(doc.title).toBe(NAME);
    doc.title = "";
    mount(NAME);   /* the next render says it again */
    expect(doc.title).toBe(NAME);
    doc.title = NAME;
    (cleanups[0] as () => void)();
    expect(doc.title).toBe(BASE);
  });
  it("does nothing while no record is open", () => {
    mount(null);
    expect(doc.title).toBe(BASE);
  });
});
