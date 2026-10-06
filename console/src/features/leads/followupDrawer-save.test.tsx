/* D132 — the Leads/Today "Record follow-up" drawer (p:followup) used to dispatch only the reducer's saveFollowup, so a live
   save vanished on reload. Its Save follow-up / Save and next investor now go through POST /api/leads/[id]/followup — the
   lead page's own follow-up route (C1) — and re-read the book. React's hooks are stubbed (no DOM in this suite). */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { pinClock } from "@/lib/format";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type ConsoleState, type FollowupDraft } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { canPlan, canWork, conFor, lost } from "@/lib/selectors";
import type { ApiMode } from "@/lib/data/api";

const h = vi.hoisted(() => ({ mode: "live" as "live" | "fixture", state: null as unknown, dispatch: null as unknown as ReturnType<typeof vi.fn>,
  reload: null as unknown as ReturnType<typeof vi.fn>, fetch: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return { ...real, useState: (v: unknown) => [v, () => {}], useCallback: (f: unknown) => f };
});
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state: h.state, dispatch: h.dispatch, reloadData: h.reload }) }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return { ...real, useApiMode: (): ApiMode => h.mode,
    useApiWrite: (ep: never, book: never, d: never) => (a: never) => real.runWrite(h.mode, ep, book, d, a, { fetch: h.fetch as never }) };
});

await import("./followupDrawer");
const { drawerDef } = await import("@/components/shell/drawers/registry");

const MT = "2026-08-27T09:00:00+05:30";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const flush = () => new Promise(r => setTimeout(r, 0));
const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
function find(n: ReactNode, id: string): ReactElement<{ onClick?: () => void; disabled?: boolean; children?: ReactNode }> | null {
  if (Array.isArray(n)) { for (const c of n) { const f = find(c, id); if (f) return f; } return null; }
  if (!isValidElement(n)) return null;
  const el = n as ReactElement<{ id?: string; children?: ReactNode }>;
  if (el.props.id === id) return el as never;
  return find(el.props.children, id);
}
let lead: ConsoleState["LEADS"][number];
const draft = (): FollowupDraft => ({ channel: "call", outcome: "Interested", obj: ["Price"], note: "Wants the PDF", d: "2026-08-28", tm: "10:00",
  keep: false, complete: true, t: "Call back", nd: "2026-08-29", ntm: "18:00", nch: "call", noNext: false });
/** Expand function components (hooks are stubbed) down to host elements. */
function expand(n: ReactNode): ReactNode {
  if (Array.isArray(n)) return n.map(expand);
  if (!isValidElement(n)) return n;
  const el = n as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props.children) } } as ReactNode;
}
const foot = () => {
  const D = drawerDef("p:followup" as never)!;
  return expand((D.Foot as (p: unknown) => ReactNode)({ lead, id: lead.id }));
};

beforeAll(() => pinClock("15:36"));
beforeEach(() => {
  h.mode = "live"; h.dispatch = vi.fn(); h.reload = vi.fn(); h.fetch = vi.fn();
  const s = as("rohit");
  lead = { ...s.LEADS.find(l => l.own === "rohit" && !lost(l) && conFor(l, "call") && canWork(s, l) && canPlan(s, l))!, mt: MT };
  h.state = { ...s, LEADS: s.LEADS.map(l => (l.id === lead.id ? lead : l)), ui: { ...s.ui, FU: draft() } };
});

describe("p:followup — Save follow-up / Save and next investor", () => {
  it("live: posts the draft to the lead page's follow-up route with Modified_Time and a press key, then re-reads the book", async () => {
    h.fetch.mockResolvedValueOnce(json(200, { touchId: "1", nextId: "2", undoToken: null, undoUntil: null }));
    find(foot(), "fusavenext")!.props.onClick!(); await flush();
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe(`/api/leads/${lead.id}/followup`);
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBeTruthy();
    expect(JSON.parse(init.body)).toMatchObject({ expectedModifiedTime: MT, contact: { channel: "call", outcome: "Interested", note: "Wants the PDF · Objections: Price" },
      next: { text: "Call back", at: "2026-08-29T18:00:00+05:30", channel: "call" } });
    const types = h.dispatch.mock.calls.map(c => c[0].type);
    expect(types).not.toContain("saveFollowup");
    expect(types).toContain("closeDrawer");
    expect(h.dispatch.mock.calls.map(c => c[0]).find(a => a.type === "setUi" && "WORKADVANCE" in a.patch).patch.WORKADVANCE).toBe(lead.id);
    expect(h.reload).toHaveBeenCalledOnce();
  });
  it("live: a refusal is the route's words; the drawer stays open and nothing is re-read", async () => {
    h.fetch.mockResolvedValueOnce(json(403, { error: "Not saved — they have not agreed to calls.", code: "no-consent" }));
    find(foot(), "fusave")!.props.onClick!(); await flush();
    expect(h.dispatch.mock.calls.map(c => c[0].type)).not.toContain("closeDrawer");
    expect(h.reload).not.toHaveBeenCalled();
  });
  it("live: a lead read without its Modified_Time is refused before anything is sent", async () => {
    lead = { ...lead, mt: null };
    const st = h.state as ConsoleState;
    h.state = { ...st, LEADS: st.LEADS.map(l => (l.id === lead.id ? lead : l)) };
    find(foot(), "fusave")!.props.onClick!(); await flush();
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("fixture: still the reducer's saveFollowup, nothing sent", async () => {
    h.mode = "fixture";
    find(foot(), "fusave")!.props.onClick!(); await flush();
    expect(h.dispatch.mock.calls.map(c => c[0].type)).toContain("saveFollowup");
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
