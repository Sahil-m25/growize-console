/* GC-1523 — the lead page of a converted lead, as it draws: the "Converted · investor ARL-INV-…" banner with the door to the
   investor record, no breach chip, no "Next step missing", no "Log a contact" or milestone to press, and the paperwork as it
   stands (signed / with Finance) rather than a beat that is the IR's. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import type { Lead, PersonKey } from "@/domain";
import { ST } from "@/domain";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import type { ApiMode, Read } from "@/lib/data/api";
import { todayList } from "@/lib/selectors";

const h = vi.hoisted(() => ({ mode: "fixture" as "live" | "fixture", state: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("@/lib/store", async (orig) => ({
  ...(await orig() as object),
  useConsole: () => ({ state: h.state, dispatch: () => {}, reloadData: () => {} }),
}));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return {
    ...real,
    useApiMode: (): ApiMode => h.mode,
    useApiRead: (ep: { fixture: (b: unknown, a: unknown) => unknown }, book: unknown, args: unknown): Read<unknown> => {
      if (args === null || args === undefined || args === false) return { state: "idle" } as Read<unknown>;
      const r = ep.fixture(book, args) as { ok: boolean; data?: unknown; error?: string };
      return r.ok ? { state: "ok", data: r.data } : { state: "error", err: r as never };
    },
  };
});

const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k: k as PersonKey });
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const { LeadPage } = await import("./LeadPage");
const { roundStanding } = await import("./Converted");

let state: ConsoleState, l: Lead;
beforeEach(() => {
  const s0 = as("rohit");
  const pick = todayList(s0).find((x) => x.done >= ST.TOUCH && x.done < ST.RESERVED)!;
  l = { ...pick, status: "Fully paid", investor: { id: "C-901", code: "ARL-INV-0901", st: "paid" } };
  state = { ...s0, LEADS: s0.LEADS.map((x) => (x.id === pick.id ? l : x)) };
  h.state = state;
});
const page = (id: string) => text(renderToStaticMarkup(<LeadPage id={id} />));

describe("GC-1523: the lead page of a converted lead", () => {
  it("shows the Converted banner with the investor's code and the door to the record", () => {
    const t = page(l.id);
    expect(t).toContain("Converted · investor ARL-INV-0901");
    expect(t).toContain("Open investor record ›");
    expect(t).toContain("this lead is read-only");
  });
  it("offers no working control: no Log a contact, no milestone, no next-step chip or breach", () => {
    const t = page(l.id);
    for (const gone of ["Log a contact", "Next step missing", "Set the next step", "Mark done", "Breached", "Slipping", "Set forecast"])
      expect(t).not.toContain(gone);
  });
  it("draws the paperwork as it stands, never as the IR's move", () => {
    const t = page(l.id);
    expect(t).toMatch(/Paperwork NDA · (signed and verified|with Finance)/);
    expect(t).not.toContain("your move");
  });
  it("a working lead still draws its controls (the change is the converted lead's only)", () => {
    const other = todayList(state).find((x) => x.done >= ST.TOUCH && x.done < ST.RESERVED && x.id !== l.id && x.consent)!;
    const t = page(other.id);
    expect(t).not.toContain("Converted ·");
    expect(t).toContain("Log a contact");
  });
});

describe("roundStanding — a round on a converted lead is signed or with Finance", () => {
  const r = (x: object) => ({ round: "nda", sent: false, verified: false, said: null, ...x }) as never;
  it("verified reads signed; anything short of it is Finance's", () => {
    expect(roundStanding(r({ verified: true, sent: true })).t).toBe("signed and verified");
    expect(roundStanding(r({ sent: true })).t).toBe("with Finance — out for signature");
    expect(roundStanding(r({ said: { by: null, at: "x" } })).t).toBe("with Finance — checking the signed copy");
    expect(roundStanding(r({})).t).toBe("with Finance");
  });
});
