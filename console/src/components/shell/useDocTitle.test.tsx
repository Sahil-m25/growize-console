/* W6-A11Y-4 — an open investor record names the page (WCAG 2.4.2). Effects are run inline here (no DOM in this suite). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ run: [] as Array<() => void | (() => void)> }));
vi.mock("react", async () => ({ ...(await vi.importActual<typeof import("react")>("react")), useEffect: (f: () => void | (() => void)) => { fx.run.push(f); } }));
const { useDocTitle, releaseStaleDocTitle } = await import("./useDocTitle");

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
  it("W6-KAM-2: closing a record always lands on the console title, even when the title it found was blank or a record's name", () => {
    doc.title = "";
    const c1 = mount(NAME);
    (c1[0] as () => void)();
    expect(doc.title).toBe(BASE);
    doc.title = NAME;   /* a stale record name found at mount (a second record opened over the first) */
    const c2 = mount("Harish Gowda · Investor · Growize console");
    (c2[0] as () => void)();
    expect(doc.title).toBe(BASE);
  });
  it("W6-KAM-2 (Open lead): off the record's page the record's name is put back, even while its hook is still mounted", () => {
    const loc = { pathname: "/inv" };
    (globalThis as unknown as { location: typeof loc }).location = loc;
    try {
      mount(NAME);
      expect(doc.title).toBe(NAME);
      loc.pathname = "/today";                 /* "Open lead" moved the page; the record re-renders once before it unmounts */
      fx.run.slice(1).forEach(f => f());       /* the per-render effect only */
      useDocTitle(NAME); fx.run.slice(-1).forEach(f => f());
      expect(doc.title).toBe(BASE);
      doc.title = NAME;
      releaseStaleDocTitle("/today");          /* the shell's path-change guard */
      expect(doc.title).toBe(BASE);
      loc.pathname = "/inv"; doc.title = NAME;
      releaseStaleDocTitle("/inv");            /* still on the record's page: untouched */
      expect(doc.title).toBe(NAME);
    } finally { delete (globalThis as unknown as { location?: unknown }).location; }
  });
  it("does nothing while no record is open", () => {
    mount(null);
    expect(doc.title).toBe(BASE);
  });
});
