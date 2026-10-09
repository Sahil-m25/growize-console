/* W3-E2E-5 — Documents > Verify opened nothing live: the drawer gate looked the paper up in the demo book (DOCS), which is
   empty live, so the reducer refused openDrawer and the drawer host refused to draw. Live, the row is GET /api/documents'
   and the drawer opens by the row's key; the routes re-derive the right on the press. Synthetic book only. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { docRefOf, drawerReadable, imReducer, initialImUi, may, type ImState } from "@/lib/im";
import type { ApiMode } from "@/lib/data/api";
import type { DocRow } from "@/server/documents/list";

const ALLOT = "554023000000600001", CONTACT = "554023000000400208";
const row = (paper: DocRow["paper"], label: string): DocRow => ({
  key: `${paper}:${ALLOT}`, paper, label, scope: "allotment", module: "LLP_UnitAllocation_Module", recordId: ALLOT,
  party: "Synthetic Investor / B", contactId: CONTACT, llpId: null, requestId: "90071992547409981", method: "Aadhaar OTP",
  state: "sent", verifiedAt: null, sign: { status: "sent", sentAt: "2026-10-09T10:00:00+05:30", sentBy: "Finance", expiresAt: null }, yourMove: null,
});
/* one allotment carrying two papers: the drawer must open on the one pressed, not the first with that record id */
const ROWS: DocRow[] = [row("allocation-letter", "Allocation letter · Synthetic Investor / B"), row("supplementary", "Supplementary agreement · Synthetic Investor / B")];

const h = vi.hoisted(() => ({ mode: "live" as "live" | "fixture" }));
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return {
    ...real,
    useApiMode: (): ApiMode => h.mode,
    useApiRead: (ep: { path: (a: unknown) => string | null }, _book: unknown, args: unknown) => {
      const p = ep.path(args) || "";
      if (/\/api\/documents\/list/.test(p)) return { state: "ok", data: { side: "investors", cut: "all", rows: ROWS, outCount: 2, files: null, actions: { send: true, verify: true }, truncated: false, fresh: {} } };
      return { state: "loading" };
    },
    useApiWrite: () => async () => ({ ok: true }),
  };
});
const { ImDrawer } = await import("../drawers/index");

const FIN = "meena";
/** live: the demo book holds no documents (and no investors) — what the Finance seat's console carries on staging */
const live = (): ImState => ({ data: { ...imDemoData(), DOCS: [], INV: [] }, ui: initialImUi() });
const text = (x: string) => x.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");

beforeEach(() => { h.mode = "live"; });

describe("W3-E2E-5: Documents > Verify opens the drawer live", () => {
  it("the reducer opens verify on a Documents row key though the demo book holds no documents", () => {
    const s = live();
    expect(may(s, FIN, "doc")).toBe(true);
    const r = imReducer(s, FIN, { type: "openDrawer", k: "verify", id: `supplementary:${ALLOT}`, seed: { DREF: "" } });
    expect(r.ui.DRW).toEqual({ k: "verify", id: `supplementary:${ALLOT}` });
  });
  it("a seat that does not verify papers is still refused; the demo book still walls a paper it holds", () => {
    const s = live();
    expect(may(s, "imran", "doc")).toBe(false);
    expect(imReducer(s, "imran", { type: "openDrawer", k: "verify", id: `supplementary:${ALLOT}` }).ui.DRW).toBeNull();
    const demo: ImState = { data: imDemoData(), ui: initialImUi() };
    expect(drawerReadable(demo, "fahad", "verify", "D-041")).toBe(true);
    expect(drawerReadable(demo, "fahad", "verify", "fema:D-041")).toBe(true);
    expect(drawerReadable(demo, "fahad", "verify", null)).toBe(false);
    expect(docRefOf("supplementary:554023000000600001")).toBe("554023000000600001");
    expect(docRefOf("D-041")).toBe("D-041");
  });
  it("renders 'Verify the signed copy' for the pressed paper, with The signed copy is here / Nothing has come back", () => {
    const s = live(); s.ui.DRW = { k: "verify", id: `supplementary:${ALLOT}` };
    const html = renderToStaticMarkup(<ImDrawer s={s} me={FIN} dispatch={() => {}} docked={false} />);
    const t = text(html);
    expect(html).toContain('role="dialog"');
    expect(t).toContain("Verify the signed copy");
    expect(t).toContain("Supplementary agreement");
    expect(t).not.toContain("Allocation letter ·");
    expect(t).toContain("The signed copy is here");
    expect(t).toContain("Nothing has come back");
  });
});

/* the Documents page's Verify button dispatches openDrawer by the row's key (the page's own elements; child components
   are not run — no DOM in this suite) */
function find(n: ReactNode, words: string, out: ReactElement<{ onClick?: (e: unknown) => void }>[] = []): ReactElement<{ onClick?: (e: unknown) => void }>[] {
  if (Array.isArray(n)) { n.forEach((c) => find(c, words, out)); return out; }
  if (!isValidElement(n)) return out;
  const el = n as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (typeof el.type === "function") return out;
  if (el.type === "button" && el.props.children === words) out.push(el as never);
  find(el.props.children, words, out);
  return out;
}
describe("W3-E2E-5: the Documents list", () => {
  it("Verify sends the row's key, so the drawer opens on that paper", async () => {
    const { ImDocs } = await import("./index");
    const s = live(); s.ui.SEC = { ...s.ui.SEC, docs: "all" };
    const dispatch = vi.fn();
    const buttons = find(ImDocs({ s, me: FIN, dispatch }), "Verify");
    expect(buttons.length).toBe(2);
    buttons[1]!.props.onClick!({ stopPropagation() {} });
    expect(dispatch).toHaveBeenCalledWith({ type: "openDrawer", k: "verify", id: `supplementary:${ALLOT}`, seed: { DREF: "" } });
  });
});
