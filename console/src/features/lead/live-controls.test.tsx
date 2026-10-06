/* The integration pass, as the page draws it (ir-write-map.md): on the live console (Zoho sign-in) nothing that is still
   local-only pretends to save — the call outcome, material and pack, forecast evidence, the hold asks and the payment
   report are shown disabled or "Not available yet" — and a gate that is shut with nobody to wait on (who: null) says its
   own words instead of "Mark done". Fixture mode draws every control as before. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { ST } from "@/domain";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import type { ApiMode, Read } from "@/lib/data/api";

const h = vi.hoisted(() => ({ mode: "live" as "live" | "fixture", gate: null as unknown, notes: [] as unknown[], state: null as unknown }));
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
    /* the reads the page makes, answered as the routes would: the gate, the notes; anything else is still loading */
    useApiRead: (ep: { path: (a: unknown) => string | null; fixture: (b: unknown, a: unknown) => unknown }, book: unknown, args: unknown): Read<unknown> => {
      if (h.mode === "fixture") { const r = ep.fixture(book, args) as { ok: boolean; data?: unknown; error?: string }; return r.ok ? { state: "ok", data: r.data } : { state: "error", err: r as never }; }
      const p = ep.path(args) || "";
      if (/\/gate$/.test(p) && h.gate) return { state: "ok", data: h.gate };
      if (/\/notes$/.test(p)) return { state: "ok", data: h.notes };
      return { state: "loading" };
    },
  };
});

const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k: k as PersonKey });
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const { LeadPage } = await import("./LeadPage");
const { drawerDef } = await import("@/components/shell/drawers/registry");
type DrawerProps = import("@/components/shell/drawers/registry").DrawerProps;

let state: ConsoleState;
beforeEach(() => { h.mode = "live"; state = as("rohit"); h.state = state; h.gate = null; h.notes = []; });

/** One of rohit's open leads past first touch, with its next rung his to mark. */
const mine = () => state.LEADS.find((l) => l.own === "rohit" && !l.lost && l.done >= ST.TOUCH && l.done < ST.RESERVED)!;
const page = (id: string) => text(renderToStaticMarkup(<LeadPage id={id} />));
const drawer = (k: string, id: string) => {
  const D = drawerDef(k as never)!;
  const lead = state.LEADS.find((l) => l.id === id)!;
  const p = { lead, id } as unknown as DrawerProps;
  return text(renderToStaticMarkup(<>{D.Body ? <D.Body {...p} /> : null}{D.Foot ? <D.Foot {...p} /> : null}</>));
};

describe("LeadPage on the live console", () => {
  it("a gate shut with nobody to wait on says the gate's words, not Mark done", () => {
    const l = mine();
    h.gate = { leadId: l.id, gate: "advance", met: false, who: null, says: "The advance has not been confirmed yet.", holdUntil: null, payment: null };
    const t = page(l.id);
    expect(t).toContain("The advance has not been confirmed yet.");
    expect(t).not.toContain("Mark done");
  });
  it("an open gate offers Mark done", () => {
    const l = mine();
    h.gate = { leadId: l.id, gate: null, met: true, who: null, says: null, holdUntil: null, payment: null };
    expect(page(l.id)).toMatch(/Mark done|Mark first contact made/);
  });
  it("the Latest note is the one read back from Zoho", () => {
    const l = mine();
    h.notes = [{ t: "Read back from Zoho", who: "rohit", at: "27 Sep 10:00", d: "2026-09-27" }];
    expect(page(l.id)).toContain("Latest note: “Read back from Zoho”");
  });
});

describe("local-only controls on the live console", () => {
  it("call outcome and objections: disabled, Not available yet", () => {
    const l = mine();
    const html = renderToStaticMarkup(<>{(() => { const D = drawerDef("call" as never)!; const B = D.Body!; return <B {...({ lead: l, id: l.id } as unknown as DrawerProps)} />; })()}</>);
    expect(text(html)).toContain("Not available yet.");
    expect(html).toMatch(/disabled=""[^>]*title="Not available yet"/);
  });
  it("material and produce pack: read-only, Not available yet", () => {
    const l = mine();
    expect(drawer("material", l.id)).toContain("Not available yet");
    expect(drawer("pack", l.id)).toContain("Not available yet");
  });
  it("forecast evidence is not offered", () => {
    const l = state.LEADS.find((x) => x.own === "rohit" && !x.lost && x.done >= ST.QUALIFIED && x.fc)!;
    expect(drawer("forecast", l.id)).not.toContain("Evidence");
  });
  it("fixture mode draws them as before", () => {
    h.mode = "fixture";
    const l = mine();
    expect(drawer("material", l.id)).not.toContain("Not available yet");
    const f = state.LEADS.find((x) => x.own === "rohit" && !x.lost && x.done >= ST.QUALIFIED && x.fc)!;
    expect(drawer("forecast", f.id)).toContain("Evidence");
  });
});
