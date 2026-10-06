/* D132 — the Investors-side care drawers and the record's ticket buttons used to change only the browser's copy. Here the
   drawer feet are called with React's hooks stubbed (no DOM in this suite): in live mode each press goes to its route with the
   record's version and nothing is dispatched to the reducer as a save; a refusal shows inline; a success closes the drawer
   (the live reads re-read via bumpLive). Fixture mode still runs the reducer action. Synthetic book only. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImDrawerKey, type ImInvestor, type ImState } from "@/lib/im";
import type { ApiMode } from "@/lib/data/api";

const h = vi.hoisted(() => ({ mode: "live" as "live" | "fixture", record: null as unknown, fetch: null as unknown as ReturnType<typeof vi.fn> }));
vi.mock("react", async () => {
  const real = await vi.importActual<typeof import("react")>("react");
  return { ...real, useState: (v: unknown) => [typeof v === "function" ? (v as () => unknown)() : v, () => {}], useRef: (v: unknown) => ({ current: v }), useCallback: (f: unknown) => f };
});
vi.mock("@/lib/data/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/data/api")>("@/lib/data/api");
  return {
    ...real,
    useApiMode: (): ApiMode => h.mode,
    useApiRead: (ep: { path: (a: unknown) => string | null; fixture: (b: unknown, a: unknown) => { ok: boolean; data?: unknown } }, book: unknown, args: unknown) => {
      if (h.mode === "fixture") { const r = ep.fixture(book, args); return r.ok ? { state: "ok", data: r.data } : { state: "error", err: r }; }
      const p = ep.path(args) || "";
      return /\/record$/.test(p) && h.record ? { state: "ok", data: h.record } : { state: "loading" };
    },
    useApiWrite: (ep: never, book: never, d: never) => (a: never, o?: { idempotencyKey?: string }) =>
      real.runWrite(h.mode, ep, book, d, a, { fetch: h.fetch as never, idempotencyKey: o?.idempotencyKey }),
  };
});

const { DRAWERS } = await import("./index");
const { TkRow } = await import("../inv/TkRow");

const ID = "554023000000400001", MT = "2026-10-06T09:00:00+05:30";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const live = (inv: Partial<ImInvestor> = {}) => {
  const demo = imDemoData();
  const x = { ...demo.INV.find(i => i.id === "ARL-INV-0212")!, id: ID, kam: "imran", ...inv };
  h.record = { record: { investor: x, version: MT, sections: ["who", "care"] } };
  return { data: { ...demo, INV: [], TKT: [] }, ui: initialImUi() } as ImState;   /* live: the demo book holds no investors */
};
const fixture = (k: ImDrawerKey, id: string, drafts: object = {}): ImState => {
  const ui = initialImUi(); ui.DRW = { k, id }; ui.drafts = { ...ui.drafts, ...drafts };
  return { data: imDemoData(), ui };
};
/** Expand function components (hooks are stubbed) until only host elements are left; find a button by its words. */
function expand(n: ReactNode): ReactNode {
  if (Array.isArray(n)) return n.map(expand);
  if (!isValidElement(n)) return n;
  const el = n as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  return { ...el, props: { ...el.props, children: expand(el.props.children) } } as ReactNode;
}
function find(n: ReactNode, words: string): ReactElement<{ onClick?: (e: unknown) => void; disabled?: boolean }> | null {
  if (Array.isArray(n)) { for (const c of n) { const f = find(c, words); if (f) return f; } return null; }
  if (!isValidElement(n)) return null;
  const el = n as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  const text = (c: ReactNode): string => Array.isArray(c) ? c.map(text).join("") : typeof c === "string" ? c : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : "";
  if (el.type === "button" && text(el.props.children).includes(words)) return el as never;
  return find(el.props.children, words);
}
const ev = { stopPropagation() {} };
const flush = () => new Promise(r => setTimeout(r, 0));
let dispatch: ReturnType<typeof vi.fn>;
beforeEach(() => { h.mode = "live"; h.fetch = vi.fn(); dispatch = vi.fn(); });
const foot = (k: ImDrawerKey, s: ImState, me: string, id = ID) => expand(DRAWERS[k].foot({ s, me, dispatch, id } as never));
const reducerSaves = (...types: string[]) => dispatch.mock.calls.map(c => c[0].type).filter(t => types.includes(t));

describe("KAM — Log a conversation (talk)", () => {
  it("live: Record it posts the conversation with the record's version and a press key, then closes the drawer", async () => {
    const s = live(); s.ui.drafts.CT = { ch: "visit", mood: "concern", note: "Asked about the payout date", next: "" };
    h.fetch.mockResolvedValueOnce(json(200, { contactId: ID, touchId: "9", introduced: false, modifiedTime: MT }));
    find(foot("talk", s, "imran"), "Record it")!.props.onClick!(ev); await flush();
    const [url, init] = h.fetch.mock.calls[0]!;
    expect(url).toBe(`/api/investors/${ID}/contact`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ expectedModifiedTime: MT, channel: "visit", mood: "concern", note: "Asked about the payout date" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/.{8,}/);
    expect(reducerSaves("logContact")).toEqual([]);
    expect(dispatch.mock.calls.map(c => c[0].type)).toContain("closeDrawer");
  });
  it("live: a refusal lands in the page note, the drawer stays open", async () => {
    h.fetch.mockResolvedValueOnce(json(403, { error: "Not saved — this is another manager's account.", code: "not-yours" }));
    find(foot("talk", live(), "imran"), "Record it")!.props.onClick!(ev); await flush();
    expect(dispatch.mock.calls.map(c => c[0])).toEqual([{ type: "note", msg: "Not saved — this is another manager's account." }]);
  });
  it("live: another KAM's account offers no Record it", () => {
    expect(find(foot("talk", live({ kam: "neha" }), "imran"), "Record it")).toBeNull();
  });
  it("live: the drawer is readable on the live record (the demo book is empty) and the next-contact override is Not available yet", () => {
    const s = live(); s.ui.DRW = { k: "talk", id: ID };
    const body = expand(DRAWERS.talk.body({ s, me: "imran", dispatch, id: ID } as never));
    expect(find(body, "In a month")!.props.disabled).toBe(true);
    expect(find(body, "On the cadence")!.props.disabled).toBe(false);
  });
  it("fixture: Record it still runs the reducer's logContact and sends nothing", async () => {
    h.mode = "fixture";
    find(foot("talk", fixture("talk", "ARL-INV-0212"), "imran", "ARL-INV-0212"), "Record it")!.props.onClick!(ev); await flush();
    expect(reducerSaves("logContact")).toEqual(["logContact"]);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("KAM — Change their details", () => {
  it("live: sends only the changed fields a live save may write, guarded by the version", async () => {
    const s = live(); s.ui.drafts.DET = { city: "Mysuru", ph: "+91 98220 41178", n: "Ignored Name" };
    h.fetch.mockResolvedValueOnce(json(200, { contactId: ID, fields: ["Mailing_City"], modifiedTime: MT }));
    find(foot("details", s, "imran"), "Save the changes")!.props.onClick!(ev); await flush();
    const [url, init] = h.fetch.mock.calls[0]!;
    expect([url, init.method]).toEqual([`/api/investors/${ID}/details`, "PUT"]);
    expect(JSON.parse(init.body)).toEqual({ expectedModifiedTime: MT, changes: { city: "Mysuru" } });
    expect(reducerSaves("saveDetails")).toEqual([]);
  });
  it("live: nothing changed → the button is disabled; the name and address inputs are Not available yet", () => {
    const s = live();
    expect(find(foot("details", s, "imran"), "Save the changes")!.props.disabled).toBe(true);
  });
});

describe("Compliance — KYC Pass it / Fail it", () => {
  it("live: Pass it posts result passed; Fail it posts failed with the reason; no reducer save", async () => {
    h.fetch.mockResolvedValue(json(200, { contactId: ID, kyc: "passed", on: "2026-10-06", noteId: null, modifiedTime: MT }));
    const f = foot("kyc", live({ kam: null }), "fahad");
    find(f, "Pass it")!.props.onClick!(ev); await flush();
    find(f, "Fail it")!.props.onClick!(ev); await flush();
    expect(h.fetch.mock.calls.map(c => [c[0], JSON.parse(c[1].body)])).toEqual([
      [`/api/investors/${ID}/kyc`, { expectedModifiedTime: MT, result: "passed" }],
      [`/api/investors/${ID}/kyc`, { expectedModifiedTime: MT, result: "failed", why: "Documents do not match" }],
    ]);
    expect(reducerSaves("passKyc", "failKyc")).toEqual([]);
  });
  it("live: no PAN on file → the route's words in the page note", async () => {
    h.fetch.mockResolvedValueOnce(json(422, { error: "There is no PAN on this record. KYC cannot pass without one.", code: "no-pan" }));
    find(foot("kyc", live(), "fahad"), "Pass it")!.props.onClick!(ev); await flush();
    expect(dispatch.mock.calls[0]![0]).toEqual({ type: "note", msg: "There is no PAN on this record. KYC cannot pass without one." });
  });
  it("a KAM (no kyc right) is offered neither button", () => {
    expect(find(foot("kyc", live(), "imran"), "Pass it")).toBeNull();
  });
});

describe("Record farm progress (field)", () => {
  it("live: disabled, Not available yet (no Zoho module holds it); fixture: the reducer's logField", () => {
    const s = live(); s.ui.drafts.FD = { blk: "A", st: "", head: "Flowering", d: "" };
    const b = find(foot("field", s, "imran"), "Record it")!;
    expect(b.props.disabled).toBe(true);
    expect(b.props.onClick).toBeUndefined();
  });
});

describe("the investor record's ticket buttons (TkRow)", () => {
  const t = { id: "554023000000500001", inv: ID, t: "Payout date", cat: "Query", opened: "01 Oct 10:00", by: "imran", own: "imran",
    pri: "normal" as const, state: "open" as const, d: "", sla: "5 working days", version: MT };
  it("live: Waiting on them / Close it are PATCH /api/cases/[id] with the Case's version; no reducer moveTicket", async () => {
    h.fetch.mockResolvedValue(json(200, { row: t, already: false, modifiedTime: MT }));
    const row = expand(<TkRow s={live()} me="imran" dispatch={dispatch} t={t} investorName="X" />);
    find(row, "Waiting on them")!.props.onClick!(ev); await flush();
    find(row, "Close it")!.props.onClick!(ev); await flush();
    expect(h.fetch.mock.calls.map(c => [c[0], c[1].method, JSON.parse(c[1].body)])).toEqual([
      [`/api/cases/${t.id}`, "PATCH", { to: "waiting", expectedModifiedTime: MT }],
      [`/api/cases/${t.id}`, "PATCH", { to: "closed", expectedModifiedTime: MT }],
    ]);
    expect(reducerSaves("moveTicket", "handToFinance")).toEqual([]);
  });
  it("live: a KAM's Bank ticket is handed to Finance through POST /api/cases/[id]/handover", async () => {
    h.fetch.mockResolvedValueOnce(json(200, { row: t, to: "meena", already: false }));
    find(expand(<TkRow s={live()} me="imran" dispatch={dispatch} t={{ ...t, cat: "Bank" }} />), "Hand it to Finance")!.props.onClick!(ev); await flush();
    expect([h.fetch.mock.calls[0]![0], h.fetch.mock.calls[0]![1].method]).toEqual([`/api/cases/${t.id}/handover`, "POST"]);
  });
  it("fixture: Close it still runs the reducer's moveTicket", async () => {
    h.mode = "fixture";
    const s = fixture("tkt", "x"), dt = s.data.TKT.find(x => x.state !== "closed" && x.cat !== "Bank" && x.own === "meena")!;
    find(expand(<TkRow s={s} me="meena" dispatch={dispatch} t={dt} />), "Close it")!.props.onClick!(ev); await flush();
    expect(reducerSaves("moveTicket")).toEqual(["moveTicket"]);
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
