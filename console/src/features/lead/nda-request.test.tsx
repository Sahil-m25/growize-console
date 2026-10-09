/* G1 (D136 proposed) — the lead page's Paperwork row: while the NDA (or the agreed supplementary) waits on Finance's send, the IR
   is offered "Ask Finance to send the NDA"; once asked, the row says it is on Finance's to-do list. The row is the route's answer
   (GET /api/leads/[id]/paperwork), fed through a mocked read. Run: npx vitest run src/features/lead/nda-request.test.tsx */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { ST } from "@/domain";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import type { Read } from "@/lib/data/api";

const h = vi.hoisted(() => ({ state: null as unknown, row: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state: h.state, dispatch: () => {}, reloadData: () => {} }) }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return { ...real, useApiMode: () => "live",
    useApiRead: (ep: { path: (a: unknown) => string | null }, _b: unknown, args: unknown): Read<unknown> =>
      /\/paperwork$/.test(ep.path(args) || "") && h.row ? { state: "ok", data: h.row } : { state: "loading" } };
});
const { LeadPage } = await import("./LeadPage");

const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k: k as PersonKey });
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const round = (k: "nda" | "supp", over: Record<string, unknown> = {}) => ({ round: k, title: k === "nda" ? "NDA" : "Supplementary agreement",
  next: { k: "sent", t: "Send it for signature", who: "Finance" }, told: null, reminders: 0, said: null, draft: null, agreed: null, back: null, requested: null,
  sent: false, verified: false, ...over });
const wait = { next: { k: "wait", t: "Waits", who: null } };

let state: ConsoleState;
beforeEach(() => { state = as("rohit"); h.state = state; h.row = null; });
const mine = () => state.LEADS.find((l) => l.own === "rohit" && !l.lost && l.done >= ST.TOUCH && l.done < ST.RESERVED)!;
const page = (id: string) => text(renderToStaticMarkup(<LeadPage id={id} />));

describe("G1 on the lead page Paperwork row", () => {
  it("the NDA waiting on Finance offers 'Ask Finance to send the NDA'", () => {
    const l = mine();
    h.row = { leadId: l.id, modifiedTime: "t", rounds: [round("nda"), round("supp", wait)], offers: [{ round: "nda", beat: "request", channels: [], rowToken: "tok" }], suppUnread: false };
    const t = page(l.id);
    expect(t).toContain("NDA — with Finance in the IM portal");
    expect(t).toContain("Ask Finance to send the NDA");
  });
  it("once asked, the row says so instead of offering it again", () => {
    const l = mine();
    h.row = { leadId: l.id, modifiedTime: "t", rounds: [round("nda", { requested: { at: "2026-09-26T10:30:00+05:30" } }), round("supp", wait)], offers: [], suppUnread: false };
    const t = page(l.id);
    expect(t).toContain("Asked Finance to send it · 2026-09-26 — it is on Finance's to-do list.");
    expect(t).not.toContain("Ask Finance to send the NDA");
  });
  it("the agreed supplementary waiting on Finance offers 'Ask Finance to send the supplementary'", () => {
    const l = mine();
    h.row = { leadId: l.id, modifiedTime: "t", rounds: [round("nda", { next: { k: "done", t: "Signed and verified", who: null }, verified: true, sent: true }), round("supp")],
      offers: [{ round: "supp", beat: "request", channels: [], rowToken: "tok" }], suppUnread: false };
    expect(page(l.id)).toContain("Ask Finance to send the supplementary");
  });
  it("no offer from the route (not the IR's lead, or sent already) → no button, only Finance's line", () => {
    const l = mine();
    h.row = { leadId: l.id, modifiedTime: "t", rounds: [round("nda"), round("supp", wait)], offers: [], suppUnread: false };
    const t = page(l.id);
    expect(t).toContain("Finance sends it for signature.");
    expect(t).not.toContain("Ask Finance");
  });
});
