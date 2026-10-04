/* The wiring adapter (phase 2b, D104): the transport, the two halves, and the three pilot endpoints. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { ApiModeProvider, CHANGED, UNREACHABLE, apiFetch, bumpLive, liveRead, runWrite, useApiRead, type ReadEndpoint } from "./api";
import { farmList, farmOne, type FarmList } from "./endpoints/farms";
import { investorRecord } from "./endpoints/investors";
import { receiptMatch } from "./endpoints/receipts";
import type { ImBook } from "./endpoints/im";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));

describe("apiFetch — the live transport", () => {
  it("answers the route's JSON on a 2xx and sends a JSON body and the Idempotency-Key", async () => {
    const f = fetchOf(200, { match: { receiptId: "1", state: "matched" } });
    const r = await apiFetch("POST", "/api/x", { body: { a: 1 }, idempotencyKey: "k1", fetch: f });
    expect(r).toEqual({ ok: true, data: { match: { receiptId: "1", state: "matched" } } });
    const init = f.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
  });
  it("carries the route's own message and code on a refusal", async () => {
    const r = await apiFetch("POST", "/api/x", { fetch: fetchOf(403, { error: "Not the matcher.", code: "not-matcher" }) });
    expect(r).toEqual({ ok: false, status: 403, code: "not-matcher", error: "Not the matcher." });
  });
  it("reads every 409 'changed' the same way (M09-S03)", async () => {
    for (const code of ["changed", "receipt-changed"]) {
      const r = await apiFetch("PUT", "/api/x", { fetch: fetchOf(409, { error: "whatever", code, recordId: "9" }) });
      expect(r).toEqual({ ok: false, status: 409, code, error: CHANGED, recordId: "9" });
    }
    expect(CHANGED).toBe("Changed by someone else — reload.");
  });
  it("never throws when the console is not reached", async () => {
    const r = await apiFetch("GET", "/api/x", { fetch: async () => { throw new TypeError("offline"); } });
    expect(r).toEqual({ ok: false, status: 0, code: "network", error: UNREACHABLE });
  });
});

describe("the two halves", () => {
  it("fixture mode paints on the first render from the book; live mode waits for the route", () => {
    const ep: ReadEndpoint<number, void, number> = { path: () => "/api/n", pick: j => j as number, fixture: n => ({ ok: true, data: n * 2 }) };
    const Probe = () => { const r = useApiRead(ep, 21, undefined); return <i>{r.state === "ok" ? r.data : r.state}</i>; };
    expect(renderToStaticMarkup(<ApiModeProvider fixtures><Probe /></ApiModeProvider>)).toBe("<i>42</i>");
    expect(renderToStaticMarkup(<ApiModeProvider fixtures={false}><Probe /></ApiModeProvider>)).toBe("<i>loading</i>");
  });
  it("a live write posts to the route, and a refusal goes to the page note, not a throw", async () => {
    const seen: ImAction[] = [];
    const f = fetchOf(403, { error: "A receipt is matched by someone other than the person who recorded it.", code: "same-hand" });
    const r = await runWrite("live", receiptMatch, { s: demo(), me: "meena" }, (a: ImAction) => seen.push(a), { id: "5001", expectedModifiedTime: "2026-09-01T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/receipts/5001/match");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ expectedModifiedTime: "2026-09-01T10:00:00+05:30" });
    expect(r.ok).toBe(false);
    expect(seen).toEqual([{ type: "note", msg: "A receipt is matched by someone other than the person who recorded it." }]);
  });
  it("a live write's success picks the route's answer and dispatches nothing", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("live", receiptMatch, { s: demo(), me: "harsha" }, (a: ImAction) => seen.push(a), { id: "5001", expectedModifiedTime: null },
      { fetch: fetchOf(200, { match: { receiptId: "5001", state: "matched", duplicate: false } }) });
    expect(r).toMatchObject({ ok: true, data: { receiptId: "5001", state: "matched" } });
    expect(seen).toEqual([]);
  });
  it("a live read picks the route's answer", async () => {
    const body: FarmList = { rows: [], truncated: false, totals: { state: "error", reason: "x", lastGoodAt: null } as never, superUser: true };
    expect(await liveRead(farmList, "/api/farms", { fetch: fetchOf(200, body) })).toEqual({ state: "ok", data: body });
    expect(await liveRead(farmList, "/api/farms", { fetch: fetchOf(503, { error: "This page reads Zoho once sign-in is connected.", code: "not-configured" }) }))
      .toMatchObject({ state: "error", err: { status: 503, code: "not-configured" } });
    bumpLive();
  });
});

describe("M11-S01-W1 — farms, fixture half", () => {
  it("one FarmRow per demo LLP, counted off the allotments, as the route shapes it", () => {
    const r = farmList.fixture({ s: demo(), me: "harsha" }, undefined);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.rows.map(x => x.id)).toEqual(imDemoData().LLP!.map(l => l.id));
    const a = r.data.rows.find(x => x.block === "A")!;
    expect(a).toMatchObject({ name: "Block A — Doddaballapura", status: "Active", onSale: false, version: null });
    expect(a.freeUnits).toBe(Math.max(0, a.totalUnits! - a.reservedUnits - a.issuedUnits));
    expect(r.data.rows.find(x => x.status === "Draft")!.onSale).toBe(false);
    expect(r.data.superUser).toBe(false);
  });
  it("one LLP: PAN and GST masked, SPOCs without roles, 404 for an unknown id; a seat without Farms is refused", () => {
    const b: ImBook = { s: demo(), me: "harsha" };
    const one = farmOne.fixture(b, "LLP-A");
    if (!one.ok) throw new Error(one.error);
    expect(one.data.farm.pan).toMatch(/^AA•+0A$/);
    expect(one.data.farm.spocs[0]).toEqual({ name: "Harsha Bhat", phone: "+91 98450 10401" });
    expect(farmOne.fixture(b, "LLP-ZZ")).toMatchObject({ ok: false, status: 404 });
    expect(farmOne.path(null)).toBeNull();
    expect(farmList.fixture({ s: demo(), me: "pradeep" }, undefined)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M09-S03-W1 — the investor record, fixture half", () => {
  it("Finance: Money and Paper, no Care; the book's own investor object", () => {
    const s = demo();
    const r = investorRecord.fixture({ s, me: "harsha" }, "ARL-INV-0208");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.record.sections).toEqual(["who", "hold", "money", "paper", "jrn", "tkt"]);
    expect(r.data.record.investor).toBe(s.data.INV.find(x => x.id === "ARL-INV-0208"));
    expect(r.data.record.money!.due).toBe(2250000);
    expect(r.data.record.kyc).toMatchObject({ status: "passed" });
  });
  it("a KAM: Care and no Money or Paper, no KYC; nobody else's investor", () => {
    const r = investorRecord.fixture({ s: demo(), me: "imran" }, "ARL-INV-0205");
    if (!r.ok) throw new Error(r.error);
    expect(r.data.record.sections).toEqual(["who", "hold", "care", "jrn", "tkt"]);
    expect(r.data.record.money).toBeNull();
    expect(r.data.record.kyc).toBeNull();
    expect(investorRecord.fixture({ s: demo(), me: "imran" }, "ARL-INV-0208")).toMatchObject({ ok: false, status: 404 });
    expect(investorRecord.path(null)).toBeNull();
    expect(investorRecord.path("ARL-INV-0205")).toBe("/api/investors/ARL-INV-0205/record");
  });
});

describe("M10-S02-W1 — Match it, fixture half", () => {
  const pending = (): ImState => {
    const s = demo();
    s.data.TXN.unshift({ id: "T-0050", inv: "ARL-INV-0208", kind: "balance", amt: 2250000, mode: "RTGS", utr: "U50", on: "02 Sep 10:00", by: "meena", rec: "pending" });
    return s;
  };
  it("the Head of Finance: the reducer's matchReceipt runs and the answer is the route's", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", receiptMatch, { s: pending(), me: "harsha" }, (a: ImAction) => seen.push(a), { id: "T-0050", expectedModifiedTime: null });
    expect(r).toEqual({ ok: true, data: { receiptId: "T-0050", state: "matched" } });
    expect(seen).toEqual([{ type: "matchReceipt", tid: "T-0050" }]);
  });
  it("D113: the recorder matches her own ordinary receipt — no second person", async () => {
    const r = await runWrite("fixture", receiptMatch, { s: pending(), me: "meena" }, () => {}, { id: "T-0050", expectedModifiedTime: null });
    expect(r).toEqual({ ok: true, data: { receiptId: "T-0050", state: "matched" } });
  });
  it("a refund's recorder: the reducer's own refusal comes back as a 422 (D22 keeps the second hand)", async () => {
    const s = demo();
    s.data.TXN.unshift({ id: "T-0051", inv: "ARL-INV-0205", kind: "refund", amt: 100000, mode: "NEFT", utr: "U51", on: "02 Sep 11:00", by: "meena", rec: "pending" });
    const r = await runWrite("fixture", receiptMatch, { s, me: "meena" }, () => {}, { id: "T-0051", expectedModifiedTime: null });
    expect(r).toMatchObject({ ok: false, status: 422, code: "refused" });
  });
});
