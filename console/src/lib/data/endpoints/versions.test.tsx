/* The stale-edit guard end to end on the client: every guarded write sends back the version its read carried
   (Zoho's Modified_Time), live, and a stale one comes back as the route's 409 → "Changed by someone else — reload."
   M07-S05 email · M08-S05 cover (Lead.mt) · M12-S02 typed-slot upload on an allotment (HoldingLine.version) ·
   M13-S02/S03/S04 tickets (CaseRow.version) · M14-S02 events (EventRow.modifiedTime). The fixture halves carry
   FIXTURE_VERSION in the same place, and a fixture write with it keeps working. */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { demoBook } from "@fixtures/book";
import type { Lead, PersonKey } from "@/domain";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { initialState, reducer, type ConsoleState } from "@/lib/state";
import { CHANGED, liveRead, runWrite } from "../api";
import type { ImBook } from "./im";
import { leadEmailSend } from "./lead";
import { coverEnd, coverStart } from "./cover";
import { investorRecord } from "./investors";
import { documentUpload, type UploadArgs } from "./documents";
import { caseHandover, caseList, caseMove } from "./cases";
import { eventChange, eventList, eventOne, type ChangeArgs } from "./events";
import { FIXTURE_VERSION } from "./version";

const V = "2026-09-29T10:15:00+05:30";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const sent = (f: ReturnType<typeof fetchOf>) => JSON.parse(String(f.mock.calls[0]![1]!.body)) as Record<string, unknown>;
const imBook = (me: string): ImBook => ({ s: { data: imDemoData(), ui: initialImUi() } as ImState, me });
const lead = (me: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: me as PersonKey });

describe("M07-S05 / M08-S05 — the lead's Modified_Time (Lead.mt) goes back on the email and the cover", () => {
  const l = { id: "9007199254740996201", mt: V, em: "a@example.com" } as Pick<Lead, "id" | "mt" | "em">;
  it("M07-S05 email send sends the lead's mt as expectedModifiedTime; a stale one is the 409 'reload'", async () => {
    const f = fetchOf(200, { sent: true, notice: "Sent." });
    await runWrite("live", leadEmailSend, lead("rohit"), () => {}, { id: l.id, expectedModifiedTime: l.mt ?? null, to: l.em, tpl: "intro", s: "Hello", b: "Body" }, { fetch: f });
    expect(f.mock.calls[0]![0]).toBe(`/api/leads/${l.id}/email`);
    expect(sent(f).expectedModifiedTime).toBe(V);
    const r = await runWrite("live", leadEmailSend, lead("rohit"), () => {}, { id: l.id, expectedModifiedTime: "2026-09-01T09:00:00+05:30", to: l.em, tpl: "intro", s: "Hello", b: "Body" },
      { fetch: fetchOf(409, { error: "Not sent — the lead changed in Zoho since it was opened.", code: "lead-changed" }) });
    expect(r).toMatchObject({ ok: false, status: 409, error: CHANGED });
  });
  it("M08-S05 cover start and end send the lead's mt; a stale one is the 409 'reload'", async () => {
    const f = fetchOf(200, { leadId: l.id, coverById: "u2", coverUntil: "2026-10-05" });
    await runWrite("live", coverStart, lead("rohit"), () => {}, { id: l.id, expectedModifiedTime: l.mt ?? null, duration: "today" as never }, { fetch: f });
    expect(f.mock.calls[0]![1]!.method).toBe("POST");
    expect(sent(f)).toMatchObject({ expectedModifiedTime: V });
    const g = fetchOf(200, { leadId: l.id, coverById: null, coverUntil: null });
    await runWrite("live", coverEnd, lead("rohit"), () => {}, { id: l.id, expectedModifiedTime: l.mt ?? null }, { fetch: g });
    expect(g.mock.calls[0]![1]!.method).toBe("DELETE");
    expect(sent(g)).toEqual({ expectedModifiedTime: V });
    const r = await runWrite("live", coverEnd, lead("rohit"), () => {}, { id: l.id, expectedModifiedTime: "2026-09-01T09:00:00+05:30" },
      { fetch: fetchOf(409, { error: "the lead changed in Zoho since it was opened", code: "lead-changed" }) });
    expect(r).toMatchObject({ ok: false, status: 409, error: CHANGED });
  });
});

describe("M12-S02 — an allotment's Modified_Time (HoldingLine.version) goes back on a typed-slot upload", () => {
  const upload = (expected: string | null): UploadArgs => ({ scope: "allotment", recordId: "A1", slot: "allotment_letter", name: "l.pdf", expected,
    bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf",
    book: { key: "k", Scope: "Allotment", Doc_Type: "Allocation letter", Investor: "C1", LLP: "EKA", File_Size: 4, File_Type: "application/pdf" } });
  it("the record's holding carries the version and the upload URL sends it as expected; a stale one is the 409 'reload'", async () => {
    const rec = await liveRead(investorRecord, "/api/investors/C1/record", { fetch: fetchOf(200, { record: { id: "C1", version: "x", holdings: [{ id: "A1", version: V }] } }) });
    if (rec.state !== "ok") throw new Error("read failed");
    const h = rec.data.record.holdings[0]!;
    expect(h.version).toBe(V);
    const f = fetchOf(200, { uploaded: { scope: "allotment", recordId: "A1" } });
    await runWrite("live", documentUpload, imBook("harsha"), () => {}, upload(h.version), { idempotencyKey: "K1", fetch: f });
    expect(f.mock.calls[0]![0]).toBe(`/api/documents/upload?scope=allotment&id=A1&slot=allotment_letter&name=l.pdf&expected=${encodeURIComponent(V)}`);
    const r = await runWrite("live", documentUpload, imBook("harsha"), () => {}, upload("2026-09-01T09:00:00+05:30"),
      { idempotencyKey: "K2", fetch: fetchOf(409, { error: "Not saved yet — the record changed in Zoho.", code: "record-changed" }) });
    expect(r).toMatchObject({ ok: false, status: 409, error: CHANGED });
  });
  it("fixture: every holding carries the stable demo version", () => {
    const b = imBook("harsha");
    const id = b.s.data.INV.find(x => (b.s.data.ALLOT ?? []).some(a => a.Customer === x.id))!.id;
    const r = investorRecord.fixture(b, id);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.record.holdings.length).toBeGreaterThan(0);
    expect(r.data.record.holdings.every(h => h.version === FIXTURE_VERSION)).toBe(true);
  });
});

describe("M13-S02/S03/S04 — a ticket's Modified_Time (CaseRow.version) goes back on park/close and the handover", () => {
  const row = { id: "5", number: "TK-5", inv: "9", t: "x", cat: "Bank", opened: "", by: "staff", own: "u1", pri: "normal", state: "open", d: "", sla: "", version: V };
  it("GET /api/cases rows carry version; PATCH and the handover send it as expectedModifiedTime; a stale one is the 409 'reload'", async () => {
    const reg = await liveRead(caseList, "/api/cases", { fetch: fetchOf(200, { rows: [row], truncated: false, cuts: { state: "fresh", value: {}, asOf: 0 }, mine: 0, readOnly: false, offersMine: true }) });
    if (reg.state !== "ok") throw new Error("read failed");
    const t = reg.data.rows[0]!;
    expect(t.version).toBe(V);
    const f = fetchOf(200, { row, already: false, modifiedTime: V });
    await runWrite("live", caseMove, imBook("meena"), () => {}, { id: t.id, to: "closed", expectedModifiedTime: t.version ?? null }, { fetch: f });
    expect(sent(f)).toEqual({ to: "closed", expectedModifiedTime: V });
    const g = fetchOf(200, { row, to: "meena", already: false });
    await runWrite("live", caseHandover, imBook("imran"), () => {}, { id: t.id, expectedModifiedTime: t.version ?? null }, { fetch: g });
    expect(g.mock.calls[0]![0]).toBe("/api/cases/5/handover");
    expect(sent(g)).toEqual({ expectedModifiedTime: V });
    const stale = { error: "Someone else changed this ticket after you opened it.", code: "changed" };
    const seen: ImAction[] = [];
    const a = await runWrite("live", caseMove, imBook("meena"), (x: ImAction) => seen.push(x), { id: "5", to: "waiting", expectedModifiedTime: "2026-09-01T09:00:00+05:30" }, { fetch: fetchOf(409, stale) });
    expect(a).toMatchObject({ ok: false, status: 409, error: CHANGED });
    expect(seen).toEqual([{ type: "note", msg: CHANGED }]);
    expect(await runWrite("live", caseHandover, imBook("imran"), () => {}, { id: "5", expectedModifiedTime: "2026-09-01T09:00:00+05:30" }, { fetch: fetchOf(409, stale) }))
      .toMatchObject({ ok: false, status: 409, error: CHANGED });
  });
  it("fixture: every row carries the stable demo version, and a fixture write with it keeps working", async () => {
    const r = caseList.fixture(imBook("meena"), undefined);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.rows.length).toBeGreaterThan(0);
    expect(r.data.rows.every(x => x.version === FIXTURE_VERSION)).toBe(true);
    const open = r.data.rows.find(x => x.state === "open" && x.cat !== "Bank")!;
    const seen: ImAction[] = [];
    const w = await runWrite("fixture", caseMove, imBook("meena"), (a: ImAction) => seen.push(a), { id: open.id, to: "closed", expectedModifiedTime: open.version ?? null });
    expect(w.ok).toBe(true);
    expect(seen[0]).toEqual({ type: "moveTicket", id: open.id, state: "closed" });
  });
});

describe("M14-S02 — an event's Modified_Time (EventRow.modifiedTime) goes back on the correction", () => {
  const ev = { id: "E1", name: "Club", startsOn: "2026-10-10", endsOn: "2026-10-10", city: "Pune", type: "Society", channel: "Direct", state: "planned", cost: 0,
    staff: [], stats: { captured: null, tagged: 0, qualified: 0, reserved: 0, costPerQualified: null, costHiddenWhy: "no-capture" }, modifiedTime: V };
  const change = (modifiedTime: string | null): ChangeArgs => ({ id: "E1", n: "Club", type: "Society", ch: "Direct", from: "2026-10-10", to: "2026-10-10", city: "Pune", cost: 0, state: "planned", off: 0, staff: [], modifiedTime });
  it("GET /api/events/[id] carries modifiedTime; PATCH sends it; a stale one is the 409 conflict → 'reload'", async () => {
    const one = await liveRead(eventOne, "/api/events/E1", { fetch: fetchOf(200, { event: ev, leads: [], othersCount: 0, truncated: false }) });
    if (one.state !== "ok") throw new Error("read failed");
    expect(one.data.event.modifiedTime).toBe(V);
    const f = fetchOf(200, { event: { eventId: "E1", name: "Club", moved: [], taggedStay: 0, modifiedTime: V } });
    await runWrite("live", eventChange, lead("tasneem"), () => {}, change(one.data.event.modifiedTime), { fetch: f });
    expect(f.mock.calls[0]![1]!.method).toBe("PATCH");
    expect(sent(f).modifiedTime).toBe(V);
    const r = await runWrite("live", eventChange, lead("tasneem"), () => {}, change("2026-09-01T09:00:00+05:30"),
      { fetch: fetchOf(409, { error: "somebody changed this event since you opened it; reopen it and try again", code: "conflict" }) });
    expect(r).toMatchObject({ ok: false, status: 409, error: CHANGED });
  });
  it("GET /api/events rows carry modifiedTime; the fixture half carries the stable demo version", async () => {
    const l = await liveRead(eventList, "/api/events", { fetch: fetchOf(200, { upcoming: [ev], completed: [], truncated: false, stats: { state: "fresh", value: [], asOf: 0 } }) });
    if (l.state !== "ok") throw new Error("read failed");
    expect(l.data.upcoming[0]!.modifiedTime).toBe(V);
    const fx = eventList.fixture(lead("rohit"), undefined);
    if (!fx.ok) throw new Error(fx.error);
    expect([...fx.data.upcoming, ...fx.data.completed].every(e => e.modifiedTime === FIXTURE_VERSION)).toBe(true);
  });
});
