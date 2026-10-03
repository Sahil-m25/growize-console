/* M13-S02-W1..S05-W1 and M13-S06-W1 — tickets and investor updates, both halves. */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { liveRead, runWrite } from "../api";
import type { ImBook } from "./im";
import { caseDeliveries, caseDeliveryList, caseHandover, caseList, caseMessages, caseMove, caseOpen, caseReply, deliveryLine } from "./cases";
import { updateList, updatePublish } from "./updates";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const book = (me: string): ImBook => ({ s: demo(), me });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const list = (me: string) => { const r = caseList.fixture(book(me), undefined); if (!r.ok) throw new Error(r.error); return r.data; };

describe("M13-S02-W1 — the Tickets register, fixture half", () => {
  it("Head of Finance: every open ticket in the order the UI case lists them, with the cuts", () => {
    const d = list("harsha");
    expect(d.rows.filter(t => t.state !== "closed").map(t => t.t)).toEqual([
      "Change the bank account for payouts", "Wants the Block A harvest note for her brother", "New address after a move to Baner",
      "Asked to move her quarterly call to evenings", "FIRC copy for the inward remittance", "Add a nominee"]);
    expect(d.cuts).toMatchObject({ state: "fresh", value: { open: 6, high: 2 } });
    expect(d.offersMine).toBe(true);
    expect(d.readOnly).toBe(false);
    expect(caseList.path()).toBe("/api/cases");
  });
  it("a KAM: only their own three, no Mine tab; the Auditor reads only; a seat without the page is refused", () => {
    const k = list("imran");
    expect(k.rows.map(t => t.t)).toEqual(["Change the bank account for payouts", "Wants the Block A harvest note for her brother", "New address after a move to Baner"]);
    expect(k.offersMine).toBe(false);
    expect(list("latha").readOnly).toBe(true);
    expect(caseList.fixture(book("pradeep"), undefined)).toMatchObject({ ok: false, status: 403 });
  });
  it("M13-S04-W1: a ticket its KAM handed on is a row they watch", async () => {
    const seen: ImAction[] = [];
    const b = book("imran");
    const r = await runWrite("fixture", caseHandover, b, (a: ImAction) => seen.push(a), { id: "TK-0114", expectedModifiedTime: null });
    expect(seen).toEqual([{ type: "handToFinance", id: "TK-0114" }]);
    expect(r).toMatchObject({ ok: true, data: { row: { id: "TK-0114", own: "meena" }, to: "meena" } });
  });
  it("the deliveries path names the ticket; the demo book keeps no thread; another manager's ticket is a 404", () => {
    expect(caseDeliveries.path("5001")).toBe("/api/cases/5001/deliveries");
    expect(caseDeliveries.path(null)).toBeNull();
    expect(caseDeliveries.fixture(book("imran"), "TK-0116")).toMatchObject({ ok: true, data: { label: null, replies: [] } });
    expect(caseDeliveries.fixture(book("neha"), "TK-0114")).toMatchObject({ ok: false, status: 404 });
    expect(deliveryLine(null)).toBeNull();
    expect(deliveryLine("Delivered")).toBe("Delivered");
    expect(deliveryLine("Not delivered yet")).toBe("Reply not delivered yet");
  });
});

describe("M13-S03-W1 — open, park, close, reply", () => {
  it("live: POST /api/cases with the route's body", async () => {
    const f = fetchOf(201, { row: { id: "77", t: "x" } });
    const r = await runWrite("live", caseOpen, book("meena"), () => {}, { investorId: "9", category: "Records", subject: "Copy", description: "d", priority: "normal", ownerId: "u1" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/cases");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ investorId: "9", category: "Records", subject: "Copy", description: "d", priority: "normal", ownerId: "u1" });
    expect(r).toMatchObject({ ok: true, data: { row: { id: "77" } } });
  });
  it("fixture: Finance Operations opens a Records ticket — newTicket runs and the row is TK-0118 owned by Meena", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", caseOpen, book("meena"), (a: ImAction) => seen.push(a),
      { investorId: "ARL-INV-0206", category: "Records", subject: "Wants a copy of the allocation letter", description: "", priority: "normal", ownerId: "meena" });
    expect(seen).toEqual([{ type: "newTicket", inv: "ARL-INV-0206", cat: "Records", t: "Wants a copy of the allocation letter", d: "", own: "meena", pri: "normal" }]);
    expect(r).toMatchObject({ ok: true, data: { row: { id: "TK-0118", cat: "Records", own: "meena", inv: "ARL-INV-0206" } } });
  });
  it("fixture: an Auditor cannot open one (403), and an investor outside the book is a 422", async () => {
    const a = { investorId: "ARL-INV-0206", category: "Records", subject: "x", description: "", priority: "normal" as const, ownerId: "latha" };
    expect(await runWrite("fixture", caseOpen, book("latha"), () => {}, a)).toMatchObject({ ok: false, status: 403 });
    expect(await runWrite("fixture", caseOpen, book("imran"), () => {}, { ...a, investorId: "ARL-INV-0208", ownerId: "imran" })).toMatchObject({ ok: false, status: 422 });
  });
  it("live: PATCH /api/cases/[id] {to, expectedModifiedTime}; a 409 reads as changed", async () => {
    const f = fetchOf(200, { row: { id: "5" }, already: false, modifiedTime: "2026-09-30T10:00:00+05:30" });
    await runWrite("live", caseMove, book("meena"), () => {}, { id: "5", to: "closed", expectedModifiedTime: "2026-09-29T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/cases/5");
    expect(f.mock.calls[0][1]!.method).toBe("PATCH");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ to: "closed", expectedModifiedTime: "2026-09-29T10:00:00+05:30" });
    const seen: ImAction[] = [];
    const c = await runWrite("live", caseMove, book("meena"), (a: ImAction) => seen.push(a), { id: "5", to: "waiting", expectedModifiedTime: null }, { fetch: fetchOf(409, { error: "x", code: "changed" }) });
    expect(c).toMatchObject({ ok: false, status: 409, error: "Changed by someone else — reload." });
    expect(seen).toEqual([{ type: "note", msg: "Changed by someone else — reload." }]);
  });
  it("fixture: Meena closes Add a nominee (moveTicket runs); Fahad may not close the bank ticket", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", caseMove, book("meena"), (a: ImAction) => seen.push(a), { id: "TK-0112", to: "closed", expectedModifiedTime: null });
    expect(seen).toEqual([{ type: "moveTicket", id: "TK-0112", state: "closed" }]);
    expect(r).toMatchObject({ ok: true, data: { row: { id: "TK-0112", state: "closed" } } });
    expect(await runWrite("fixture", caseMove, book("fahad"), () => {}, { id: "TK-0114", to: "closed", expectedModifiedTime: null })).toMatchObject({ ok: false, code: "refused" });
    expect(await runWrite("fixture", caseMove, book("neha"), () => {}, { id: "TK-0114", to: "closed", expectedModifiedTime: null })).toMatchObject({ ok: false, status: 404 });
  });
  it("M13-S04-W1 live: POST /api/cases/[id]/handover {expectedModifiedTime}", async () => {
    const f = fetchOf(200, { row: { id: "5" }, to: "u2", already: false });
    await runWrite("live", caseHandover, book("imran"), () => {}, { id: "5", expectedModifiedTime: "2026-09-29T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/cases/5/handover");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ expectedModifiedTime: "2026-09-29T10:00:00+05:30" });
  });
  it("M13-S05-W1: reply posts {message}; the fixture answers 'Not delivered yet' for the ticket's owner only", async () => {
    const f = fetchOf(201, { caseId: "5", noteId: "n", delivery: { eventId: "e", label: "Not delivered yet" } });
    const r = await runWrite("live", caseReply, book("imran"), () => {}, { id: "5", message: "Your note is on its way." }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/cases/5/reply");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ message: "Your note is on its way." });
    expect(r).toMatchObject({ ok: true, data: { delivery: { label: "Not delivered yet" } } });
    expect(await runWrite("fixture", caseReply, book("imran"), () => {}, { id: "TK-0116", message: "hi" })).toMatchObject({ ok: true, data: { delivery: { label: "Not delivered yet" } } });
    expect(await runWrite("fixture", caseReply, book("latha"), () => {}, { id: "TK-0116", message: "hi" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M13-S06-W1 — investor updates", () => {
  const up = (me: string) => { const r = updateList.fixture(book(me), undefined); if (!r.ok) throw new Error(r.error); return r.data; };
  it("Finance Operations: three updates and all four kinds; a KAM: Produce and Notice only; the Auditor reads only", () => {
    expect(up("meena").rows.map(u => u.n)).toEqual([7, 6, 1]);
    expect(up("meena").kinds).toEqual(["Produce", "Statement", "Compliance", "Notice"]);
    expect(up("imran").kinds).toEqual(["Produce", "Notice"]);
    expect(up("latha")).toMatchObject({ readOnly: true, kinds: [] });
    expect(up("latha").rows).toHaveLength(3);
    expect(updateList.fixture(book("pradeep"), undefined)).toMatchObject({ ok: false, status: 403 });
    expect(up("meena").rows.map(u => u.toText)).toEqual(["allotted investors only", "everyone on the book", "NRI investors only"]);
  });
  it("live: POST /api/updates {headline, kind, audience, body}", async () => {
    const f = fetchOf(201, { row: { id: "1", t: "x" }, predicate: "select id from Contacts", count: 15, pushed: { queued: 15, refused: 0 } });
    const r = await runWrite("live", updatePublish, book("meena"), () => {}, { headline: "Quarterly statement — Oct to Dec", kind: "Statement", audience: "all", body: "Statements on 5 January." }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/updates");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ headline: "Quarterly statement — Oct to Dec", kind: "Statement", audience: "all", body: "Statements on 5 January." });
    expect(r).toMatchObject({ ok: true, data: { count: 15 } });
  });
  it("fixture: Meena publishes a statement to everyone (the reducer's publish, 15 investors); a KAM's Statement is refused", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", updatePublish, book("meena"), (a: ImAction) => seen.push(a), { headline: "Quarterly statement — Oct to Dec", kind: "Statement", audience: "all", body: "b" });
    expect(seen).toEqual([{ type: "publish", t: "Quarterly statement — Oct to Dec", cat: "Statement", d: "b", to: "all" }]);
    expect(r).toMatchObject({ ok: true, data: { count: 15, row: { kind: "Statement", by: "meena", toText: "everyone on the book" } } });
    expect(await runWrite("fixture", updatePublish, book("imran"), () => {}, { headline: "x", kind: "Statement", audience: "all", body: "" })).toMatchObject({ ok: false, status: 403, code: "kind-not-yours" });
  });
});

describe("M13-S05-W1 — the ticket thread and the list of deliveries", () => {
  it("the thread route is per ticket and reads nothing without an id; the demo book keeps no thread", () => {
    expect(caseMessages.path("5001")).toBe("/api/cases/5001/messages");
    expect(caseMessages.path(null)).toBeNull();
    expect(caseMessages.fixture(book("imran"), "TK-0116")).toMatchObject({ ok: true, data: { caseId: "TK-0116", messages: [], truncated: false } });
    expect(caseMessages.fixture(book("neha"), "TK-0114")).toMatchObject({ ok: false, status: 404 });
    expect(caseMessages.fixture(book("pradeep"), "TK-0116")).toMatchObject({ ok: false, status: 403 });
  });
  it("live: the thread is the route's messages, as the route answered them", async () => {
    const m = { id: "9", kind: "reply", text: "We have updated it.", at: "2026-09-28T11:40", by: { id: "7", name: "Imran Sheikh" } };
    const f = fetchOf(200, { caseId: "5001", messages: [m], truncated: false });
    const r = await liveRead(caseMessages, "/api/cases/5001/messages", { fetch: f });
    expect(r).toEqual({ state: "ok", data: { caseId: "5001", messages: [m], truncated: false } });
    expect(f).toHaveBeenCalledWith("/api/cases/5001/messages", expect.anything());
  });
  it("one list read asks for every open row; nothing to ask, nothing read", () => {
    expect(caseDeliveryList.path([])).toBeNull();
    expect(caseDeliveryList.path(["5001", "5002"])).toBe("/api/cases/deliveries?ids=5001,5002");
    const ids = Array.from({ length: 150 }, (_, i) => String(1000 + i));
    expect(caseDeliveryList.path(ids)!.split("=")[1]!.split(",")).toHaveLength(100);
  });
  it("the fixture answers an entry only for tickets this seat may open, none with a reply yet", () => {
    const b = book("imran");
    const ids = list("imran").rows.map(t => t.id);
    const r = caseDeliveryList.fixture(b, [...ids, "TK-0114"]);
    if (!r.ok) throw new Error(r.error);
    expect(Object.keys(r.data.cases).sort()).toEqual(ids.sort());
    expect(Object.values(r.data.cases).every(c => c.label === null && c.replies.length === 0)).toBe(true);
    expect(caseDeliveryList.fixture(book("pradeep"), ids)).toMatchObject({ ok: false, status: 403 });
  });
  it("live: the list is the route's map, one request", async () => {
    const f = fetchOf(200, { cases: { "5001": { replies: [], label: "Not delivered yet" } } });
    const r = await liveRead(caseDeliveryList, "/api/cases/deliveries?ids=5001", { fetch: f });
    expect(r).toMatchObject({ state: "ok", data: { cases: { "5001": { label: "Not delivered yet" } } } });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
