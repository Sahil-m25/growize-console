import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { runWrite } from "../api";
import { leadEmailSend, leadGate } from "./lead";
import { coverEnd, coverStart } from "./cover";
import { holdExtend, holdRelease, holdsLand, holdsList } from "./holds";
import { leadClaim, receiptPrepare, receiptRecord } from "./claims";
/* the app account card has one endpoint module, ./app (M10-S21-W1 owns /api/investors/[id]/unlock) */
import { appCard as appAccount, appLock, appUnlock } from "./app";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const book = { s: demo(), me: "harsha" };
const nop = () => {};
const sent = (f: ReturnType<typeof fetchOf>) => JSON.parse(f.mock.calls[0][1]!.body as string);

describe("the lead journey, live halves post to the routes", () => {
  it("email send", async () => {
    const f = fetchOf(200, { email: { sent: true } });
    await runWrite("live", leadEmailSend, {} as never, nop as never, { id: "L1", expectedModifiedTime: "t", tpl: "t1", s: "s", b: "m", to: "a@b.c" } as never, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/email");
    expect(sent(f)).toMatchObject({ expectedModifiedTime: "t", template: "t1", subject: "s", message: "m", to: "a@b.c" });
  });
  it("gate path", () => { expect(leadGate.path("L1")).toBe("/api/leads/L1/gate"); expect(leadGate.path(null)).toBeNull(); });
  it("cover start and end", async () => {
    const f = fetchOf(200, { cover: {} });
    await runWrite("live", coverStart, {} as never, nop as never, { id: "L1", expectedModifiedTime: "t", duration: "1 week" } as never, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/cover");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(sent(f)).toEqual({ expectedModifiedTime: "t", duration: "1 week" });
    const g = fetchOf(200, { cover: {} });
    await runWrite("live", coverEnd, {} as never, nop as never, { id: "L1", expectedModifiedTime: "t" } as never, { fetch: g });
    expect(g.mock.calls[0][1]!.method).toBe("DELETE");
  });
  it("claim posts to the lead's claim route", async () => {
    const f = fetchOf(200, { claim: { state: "open" } });
    await runWrite("live", leadClaim, {} as never, nop as never, { id: "L1", expectedModifiedTime: "t", amount: 5 } as never, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/claim");
  });
});

describe("holds and receipts", () => {
  it("hold routes", async () => {
    const f = fetchOf(200, { hold: {} });
    await runWrite("live", holdExtend, book, nop as never, { id: "A1", days: 7, reason: "r", expectedModifiedTime: null } as never, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/holds/A1/extend");
    const g = fetchOf(200, { hold: {} });
    await runWrite("live", holdRelease, book, nop as never, { id: "A1", expectedModifiedTime: null } as never, { fetch: g });
    expect(g.mock.calls[0][0]).toBe("/api/holds/A1/release");
  });
  it("fixture lists answer ok", () => {
    expect(holdsList.fixture(book)).toMatchObject({ ok: true });
    expect(holdsLand.fixture(book)).toMatchObject({ ok: true });
  });
  it("prepare then record, with a per-press Idempotency-Key", async () => {
    const f = fetchOf(200, { prepared: {} });
    await runWrite("live", receiptPrepare, book, nop as never, { allotmentId: "A1" } as never, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/receipts/prepare");
    const g = fetchOf(200, { receipt: {} });
    await runWrite("live", receiptRecord, book, nop as never, {} as never, { fetch: g, idempotencyKey: "K1" });
    expect(g.mock.calls[0][0]).toBe("/api/receipts");
    expect((g.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("K1");
  });
});

describe("the app account", () => {
  const id = imDemoData().INV[0].id;
  it("fixture card is the route's shape", () => {
    const r = appAccount.fixture(book, id);
    expect(r).toMatchObject({ ok: true, data: { card: { contactId: id } } });
  });
  it("live unlock and lock use /api/investors/[id]/unlock", async () => {
    const f = fetchOf(200, { card: {}, already: false });
    await runWrite("live", appUnlock, book, nop as never, { id, expectedModifiedTime: null }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe(`/api/investors/${id}/unlock`);
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    const g = fetchOf(200, { card: {}, already: false });
    await runWrite("live", appLock, book, nop as never, { id, reason: "paused", expectedModifiedTime: null }, { fetch: g });
    expect(g.mock.calls[0][1]!.method).toBe("DELETE");
    expect(sent(g)).toEqual({ reason: "paused", expectedModifiedTime: null });
  });
  it("fixture lock dispatches lockApp", async () => {
    const seen: ImAction[] = [];
    await runWrite("fixture", appLock, book, (a: ImAction) => seen.push(a), { id, reason: "paused", expectedModifiedTime: null });
    expect(seen.length === 0 || seen[0].type === "lockApp").toBe(true);
  });
});
