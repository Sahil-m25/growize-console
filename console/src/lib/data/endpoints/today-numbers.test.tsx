/* Phase 2b wiring, unit group 2 — Today, Numbers, Activity, Logs and the error beacon (M05-S06/S07/S08, M16-S08/S09,
   M15-S03/S05, M18-S04). Each endpoint: the fixture half for an allowed seat and a refused one, the path, and (for the beacon)
   what a failed live write sends. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { imDemoData } from "@fixtures/im/demo";
import { initialState, reducer } from "@/lib/state";
import { initialImUi, type ImState } from "@/lib/im";
import type { PersonKey } from "@/domain";
import { runWrite, type ApiResult } from "../api";
import type { ImBook } from "./im";
import { investorsToday } from "./today";
import { investorQueue, type InvestorQueue } from "./queues";
import { investorsSection, investorsSideOffer } from "./numbers";
import { activityRead, recordHistory } from "./activity";
import { logsRead } from "./logs";
import { receiptMatch } from "./receipts";

const s = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const book = (me: string): ImBook => ({ s: s(), me });
const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };

describe("Today — the four headline figures (M05-S06-W1)", () => {
  it("Harsha: ₹8.88 Cr banked, ₹1.13 Cr outstanding, 40 / 96 units, 6 tickets, read at the demo clock (NOW is midnight)", () => {
    const d = data(investorsToday.fixture(book("harsha"), undefined));
    expect(d.money.state === "fresh" && d.money.value.banked).toBe(88_750_000);
    expect(d.units.state === "fresh" && [d.units.value.held, d.units.value.released]).toEqual([40, 96]);
    expect(d.tickets.state === "fresh" && d.tickets.value.open).toBe(6);
    expect(d.stale).toBe(false);
    expect(new Date((d.asOf ?? 0) + 5.5 * 3_600_000).toISOString().slice(11, 16)).toBe("00:00");
  });
  it("a KAM has no such figures (403), and the path is the route", () => {
    const r = investorsToday.fixture(book("imran"), undefined);
    expect(!r.ok && r.status).toBe(403);
    expect(investorsToday.path()).toBe("/api/numbers/investors-today");
  });
});

describe("Today — Waiting on you (M05-S07-W1/W2, M05-S08-W1)", () => {
  it("Harsha: the claim, then the two holds — one control each; no 'send' or 'declined' row exists", () => {
    const q = data(investorQueue.fixture(book("harsha"), undefined)) as Extract<InvestorQueue, { side: "money" }>;
    expect(q.side).toBe("money");
    expect(q.rows.map(r => [r.kind, r.action])).toEqual([["claim", "Answer it"], ["hold", "Open the record"], ["hold", "Open the record"]]);
    expect(q.rows[0]!.from).toBe("Rohit");
    expect([q.waiting, q.today]).toEqual([3, 1]);
    expect(q.rows.every(r => !("send" === r.kind as string || "declined" === r.kind as string))).toBe(true);
  });
  it("the Auditor's queue is empty and read-only; Fahad's is KYC and FEMA", () => {
    const l = data(investorQueue.fixture(book("latha"), undefined));
    expect(l.side === "money" && [l.readOnly, l.rows.length]).toEqual([true, 0]);
    const f = data(investorQueue.fixture(book("fahad"), undefined));
    expect(f.side === "money" && f.rows.map(r => r.kind)).toEqual(["kyc", "fema"]);
  });
  it("Imran: the AM tiles (gone quiet / accounts / tickets on you / conversations) and Divya's Assign manager", () => {
    const i = data(investorQueue.fixture(book("imran"), undefined));
    expect(i.side).toBe("am");
    if (i.side === "am") {
      expect(i.book).toBe("kam");
      expect(i.tiles).toEqual({ goneQuiet: 2, accountsHeld: 4, ticketsOpenOnYou: 3, conversationsLogged: 9 });
      expect(JSON.stringify(i)).not.toMatch(/banked|outstanding|amount/i);
    }
    const d = data(investorQueue.fixture(book("divya"), undefined));
    expect(d.side === "am" && d.book).toBe("head");
    expect(d.side === "am" && d.rows.find(r => r.kind === "nokam")?.action).toBe("Assign manager");
  });
  it("an Administrator has no Today (403); the path is the route", () => {
    const r = investorQueue.fixture(book("pradeep"), undefined);
    expect(!r.ok && r.status).toBe(403);
    expect(investorQueue.path()).toBe("/api/queues/investors");
    expect(investorQueue.pick({ queue: { side: "money" } })).toEqual({ side: "money" });
  });
});

describe("Numbers — the Investors side (M16-S08-W1, M16-S09-W1)", () => {
  it("offers a KAM and the Head of AM only Service, and Finance every section", () => {
    for (const me of ["imran", "divya"]) expect(data(investorsSideOffer.fixture(book(me), undefined)).side?.sections).toEqual(["svc"]);
    expect(data(investorsSideOffer.fixture(book("harsha"), undefined)).side?.sections).toEqual(["cash", "risk", "paper", "comp", "svc"]);
    expect(investorsSideOffer.path()).toBe("/api/numbers/investors-side");
  });
  it("Collection: ₹8.88 Cr banked, ₹1.13 Cr committed not yet in, ₹52 Cr programme, 17% — and 403 money-hidden to a KAM", () => {
    const c = data(investorsSection.fixture(book("latha"), "cash"));
    expect(c.section === "cash" && [c.collection.banked, c.collection.outstanding, c.collection.programme, c.collection.pctOfProgramme])
      .toEqual([88_750_000, 11_250_000, 520_000_000, 17]);
    const r = investorsSection.fixture(book("imran"), "cash");
    expect(!r.ok && [r.status, r.code]).toEqual([403, "money-hidden"]);
  });
  it("Paper lists the FEMA declaration for Joseph Mathew; Compliance lists one row", () => {
    const p = data(investorsSection.fixture(book("harsha"), "paper"));
    expect(p.section === "paper" && p.rows.map(r => [r.document, r.party, r.sentAt, r.method])).toEqual([["FEMA declaration", "Joseph Mathew", "26 Aug 16:20", "Class 3 DSC"]]);
    const c = data(investorsSection.fixture(book("fahad"), "comp"));
    expect(c.section === "comp" && [c.count, c.rows[0]!.name, c.rows[0]!.kyc, c.rows[0]!.missing.includes("fema")]).toEqual([1, "Joseph Mathew", "pending", true]);
  });
  it("the path encodes the section — Service too (M16-S08-W2); no section reads nothing", () => {
    expect(investorsSection.path("comp")).toBe("/api/numbers/investors-side?section=comp");
    expect(investorsSection.path("svc")).toBe("/api/numbers/investors-side?section=svc");
    expect(investorsSection.path(null)).toBeNull();
  });
  it("Service (M16-S08-W2): Divya reads the tiles, tiers, load and the manager rows; Imran his own row and no pool; the Auditor reads the tiles only", () => {
    const d = data(investorsSection.fixture(book("divya"), "svc"));
    if (d.section !== "svc") throw new Error("not svc");
    expect([d.book, d.tiles.goneQuiet, d.team, d.managers.length, d.pool?.accounts, d.pool?.shouldBeNamed]).toEqual(["head", 2, 2, 2, 5, 1]);
    expect(d.tiers.A + d.tiers.B + d.tiers.C).toBe(13);
    const k = data(investorsSection.fixture(book("imran"), "svc"));
    if (k.section !== "svc") throw new Error("not svc");
    expect([k.book, k.managers.map(m => m.id), k.pool, k.managers[0]!.accounts]).toEqual(["kam", ["imran"], null, 4]);
    expect(k.load.perMonth).toBe(3.3);
    const a = data(investorsSection.fixture(book("latha"), "svc"));
    expect(a.section === "svc" && a.book).toBe("kam");
  });
});

describe("Activity — the Investors side (M15-S03-W1)", () => {
  it("Harsha reads his own 3 entries; Administration reads the audit with details withheld; a KAM reads none", () => {
    const h = data(activityRead.fixture(book("harsha"), { person: null, kind: null }));
    expect([h.total, h.solo, h.rows.every(r => r.byId === "harsha")]).toEqual([3, true, true]);
    const a = data(activityRead.fixture(book("sahil"), { person: null, kind: null }));
    expect(a.adminView || a.total).toBeTruthy();
    const k = data(activityRead.fixture(book("imran"), { person: null, kind: null }));
    expect(k.total).toBe(0);
  });
  it("the person and kind cuts are the route's own parameters", () => {
    expect(activityRead.path({ person: null, kind: null })).toBe("/api/activity?side=investors&limit=200");
    expect(activityRead.path({ person: "1234", kind: "money" })).toBe("/api/activity?side=investors&limit=200&person=1234&kind=money");
    expect(activityRead.path(null)).toBeNull();
    const cut = data(activityRead.fixture(book("sahil"), { person: "meena", kind: null }));
    expect(cut.rows.length).toBe(6);
    expect(cut.rows.every(r => r.byId === "meena")).toBe(true);
  });
  it("a record's history: the path needs an id", () => {
    expect(recordHistory.path({ module: "Contacts", id: null })).toBeNull();
    expect(recordHistory.path({ module: "Contacts", id: "1" })).toBe("/api/activity/history?module=Contacts&id=1");
  });
});

describe("Logs (M15-S05-W1)", () => {
  const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
  it("Sahil reads the rows with actor chips and where sign-in history lives; a filter is the route's actor", () => {
    const st = as("sahil");
    const all = data(logsRead.fixture(st, { actor: null }));
    expect(all.total).toBe(all.rows.length);
    expect(all.signInHistory.where).toMatch(/Login History/);
    expect(Object.values(all.byActor).reduce((a, b) => a + b, 0)).toBe(all.total);
    expect(logsRead.path({ actor: null })).toBe("/api/logs");
    expect(logsRead.path({ actor: "42" })).toBe("/api/logs?actor=42");
  });
});

describe("the error beacon (M18-S04-W1)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("a live write that the console could not carry out reports ids and status only; a 4xx refusal reports nothing", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(globalThis, "window", { value: { location: { pathname: "/pay" } }, configurable: true });
    Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: beacon }, configurable: true });
    const failing = (status: number) => vi.fn(async () => new Response(JSON.stringify({ error: "no", code: "zoho-down" }), { status, headers: { "x-request-id": "req-1" } }));
    const a = { id: "1", expectedModifiedTime: null };
    await runWrite("live", receiptMatch, book("meena"), () => {}, a, { fetch: failing(409) });
    expect(beacon).not.toHaveBeenCalled();
    await runWrite("live", receiptMatch, book("meena"), () => {}, a, { fetch: failing(502) });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/errors");
    expect(JSON.parse(await blob.text())).toEqual({ source: "save-failed", route: "/pay", requestId: "req-1", zohoStatus: 502, zohoCode: "zoho-down" });
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { navigator?: unknown }).navigator;
  });
});
