/* C3 — intake, ownership and updates endpoints: both halves of leadAdd / leadImport / leadAssign / leadUpdatesRead and the
   duplicate lookup. Live: what each posts and how a refusal reads. Fixture: the same answers from the demo book, and the reducer
   action each one replaces still runs (FIXTURE_MODE keeps working). */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { initialState, reducer, type Action } from "@/lib/state";
import type { PersonKey } from "@/domain";
import { runWrite, type ApiResult } from "../api";
import { addArgsOf, duplicateLookup, IMPORT_CHUNK, importRowsOf, leadAdd, leadImport, ROW_WHY } from "./intake";
import { kindsOfGroup, leadAssign, leadUpdatesRead, UPDATE_KINDS } from "./ownership";
import { addDraft, ADD0 } from "@/features/add/state";
import { csvRead } from "@/features/add/csv";

const as = (k: string) => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const sent = (f: ReturnType<typeof fetchOf>) => JSON.parse(f.mock.calls[0][1]!.body as string);
const headers = (f: ReturnType<typeof fetchOf>) => f.mock.calls[0][1]!.headers as Record<string, string>;
const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const nop = () => {};

/** a sink for dispatch that also applies the action to the state, so the fixture's effect can be read back */
const applying = (st: ReturnType<typeof as>) => { let s = st; const seen: Action[] = []; return { dispatch: (a: Action) => { seen.push(a); s = reducer(s, a); }, seen, get: () => s }; };

describe("Add, live half", () => {
  const args = { name: "Asha Rao", mobile: "98450 33021", source: "Website" as const };
  it("posts the lead to /api/leads with one Idempotency-Key per press, the same key again on a retry", async () => {
    const f = fetchOf(200, { leadId: "L9", ownerId: "U1", replayed: false });
    const r = await runWrite("live", leadAdd, {} as never, nop as never, args as never, { fetch: f, idempotencyKey: "press-1" });
    expect(f.mock.calls[0][0]).toBe("/api/leads");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(headers(f)["Idempotency-Key"]).toBe("press-1");
    expect(sent(f)).toMatchObject({ name: "Asha Rao", mobile: "98450 33021", source: "Website" });
    expect(data(r)).toEqual({ leadId: "L9", ownerId: "U1", replayed: false });
    const g = fetchOf(200, { leadId: "L9", ownerId: "U1", replayed: true });
    await runWrite("live", leadAdd, {} as never, nop as never, args as never, { fetch: g, idempotencyKey: "press-1" });
    expect(headers(g)["Idempotency-Key"]).toBe("press-1");
    const h = fetchOf(200, {});
    await runWrite("live", leadAdd, {} as never, nop as never, args as never, { fetch: h });
    expect(headers(h)["Idempotency-Key"]).toMatch(/\S{8,}/);
  });
  it("a refusal reads as the route's own sentence (field missing, duplicate)", async () => {
    const miss = fetchOf(422, { error: "Not added — Zoho has no Introduced_By field on Leads yet.", code: "introducer-field-missing" });
    const r = await runWrite("live", leadAdd, {} as never, nop as never, args as never, { fetch: miss });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("introducer-field-missing"); expect(r.error).toMatch(/Introduced_By/); }
    const dup = fetchOf(409, { error: "Not added — the book already has this number.", code: "duplicate-mobile" });
    const d = await runWrite("live", leadAdd, {} as never, nop as never, args as never, { fetch: dup });
    expect(d.ok || d.code).toBe("duplicate-mobile");
  });
});

describe("Add, form → route body", () => {
  const draft = (patch: object) => addDraft({ ...ADD0, ...patch } as never);
  it("an introducer outside ARL or none sends none; a named one is sent; consent how only travels with a consent", () => {
    const base = { ADDN: " Asha Rao ", ADDPH: "98450 33021", ADDSRC: "Referral — investor", ADDU: "2" };
    expect(addArgsOf(draft({ ...base, ADDBY: "ext" }), 2, null).introducedById).toBeNull();
    expect(addArgsOf(draft({ ...base, ADDBY: null }), 2, null).introducedById).toBeNull();
    expect(addArgsOf(draft({ ...base, ADDBY: "U7" }), 2, null).introducedById).toBe("U7");
    const none = addArgsOf(draft({ ...base, ADDHOW: "person" }), 0, "U1");
    expect(none).toMatchObject({ name: "Asha Rao", mobile: "98450 33021", units: null, consentHow: null, ownerId: "U1", eventId: null });
    const some = addArgsOf(draft({ ...base, ADDCON: { msg: true, call: false, email: false, visit: false }, ADDHOW: "person" }), 2, null);
    expect(some.consentHow).toBe("person");
    expect(some.consent).toEqual({ msg: true, call: false, email: false, visit: false });
    expect(addArgsOf(draft({ ...base, ADDSRC: "Events", ADDEV: "E-01" }), 0, null).eventId).toBe("E-01");
  });
});

describe("Add, fixture half", () => {
  it("runs the reducer's addLead and answers with the new lead", () => {
    const st = reducer(as("rohit"), { type: "setUi", patch: { ADDN: "Zed Test", ADDPH: "98450 33999", ADDSRC: "Website" } });
    const sink = applying(st);
    const r = leadAdd.fixture(st, sink.dispatch, {} as never);
    expect(sink.seen).toEqual([{ type: "addLead" }]);
    const d = data(r);
    expect(sink.get().LEADS.some(l => l.id === d.leadId && l.n === "Zed Test")).toBe(true);
    expect(d.replayed).toBe(false);
  });
  it("an incomplete form is refused like the route would (and the reducer's own refusal stays silent)", () => {
    const st = as("rohit");
    const r = leadAdd.fixture(st, nop as never, {} as never);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
});

describe("the duplicate lookup", () => {
  it("live: the number goes in the body, never the URL, and the answer is the route's", async () => {
    const f = fetchOf(200, { status: "own", leadId: "L1", firstName: "Meera" });
    const r = await duplicateLookup("live", as("rohit"), "98450 33077", { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/duplicate");
    expect(f.mock.calls[0][0]).not.toMatch(/33077/);
    expect(sent(f)).toEqual({ mobile: "98450 33077" });
    expect(data(r)).toEqual({ status: "own", leadId: "L1", firstName: "Meera" });
    const no = await duplicateLookup("live", as("rohit"), "123", { fetch: fetchOf(422, { error: "Not checked — write the mobile as ten Indian digits.", code: "invalid-mobile" }) });
    expect(no.ok || no.code).toBe("invalid-mobile");
  });
  it("fixture: the book's own match on the ten digits — own, somebody else's, or none", async () => {
    const st = as("rohit");
    const mine = st.LEADS.find(l => l.own === "rohit")!;
    const theirs = st.LEADS.find(l => l.own && l.own !== "rohit")!;
    const a = data(await duplicateLookup("fixture", st, mine.ph));
    expect(a).toMatchObject({ status: "own", leadId: mine.id });
    const b = data(await duplicateLookup("fixture", st, theirs.ph));
    expect(b).toMatchObject({ status: "visible", leadId: theirs.id });
    expect(data(await duplicateLookup("fixture", st, "98450 30000"))).toEqual({ status: "none" });
  });
});

describe("Import a file", () => {
  const csv = (st: ReturnType<typeof as>) => csvRead(st, "event.csv", "Name,Mobile,Email,Units\nAsha Rao,98450 33021,asha@example.invalid,2\nX,98450 33022,,\nRavi Menon,98450 33023,,\n");
  it("only the rows the preview called good go, in order, with the route's keys", () => {
    const st = as("rohit");
    expect(importRowsOf(csv(st))).toEqual([
      { name: "Asha Rao", mobile: "98450 33021", email: "asha@example.invalid", units: 2 },
      { name: "Ravi Menon", mobile: "98450 33023", units: null },
    ]);
    expect(IMPORT_CHUNK).toBeLessThanOrEqual(200);
  });
  it("live: posts the event, the owner and the rows to /api/leads/import with its key; per-row verdicts come back", async () => {
    const out = { added: 1, refused: 1, rows: [{ row: 0, status: "added", leadId: "L1", ownerId: "U1", replayed: false }, { row: 1, status: "refused", reason: "duplicate-mobile", message: "x" }] };
    const f = fetchOf(200, out);
    const r = await runWrite("live", leadImport, {} as never, nop as never, { eventId: "E1", ownerId: "U1", rows: [{ name: "Asha Rao", mobile: "98450 33021" }] }, { fetch: f, idempotencyKey: "file-1-c0" });
    expect(f.mock.calls[0][0]).toBe("/api/leads/import");
    expect(headers(f)["Idempotency-Key"]).toBe("file-1-c0");
    expect(sent(f)).toEqual({ eventId: "E1", ownerId: "U1", rows: [{ name: "Asha Rao", mobile: "98450 33021" }] });
    expect(data(r)).toEqual(out);
    expect(ROW_WHY["duplicate-mobile"]).toMatch(/already has this number/);
  });
  it("fixture: runs the reducer's csvImport and counts the rows it added; with no event it is refused", () => {
    const st0 = as("rohit");
    const ev = st0.EVENTS.find(e => e.state === "done")!;
    const withCsv = reducer(st0, { type: "setUi", patch: { CSV: csv(st0), CSVEV: ev.id } });
    const sink = applying(withCsv);
    const r = leadImport.fixture(withCsv, sink.dispatch, { eventId: ev.id, ownerId: "rohit", rows: [] });
    expect(sink.seen).toEqual([{ type: "csvImport" }]);
    expect(data(r)).toMatchObject({ added: 2, refused: 0 });
    expect(sink.get().LEADS.length).toBe(st0.LEADS.length + 2);
    const noEv = reducer(st0, { type: "setUi", patch: { CSV: csv(st0), CSVEV: null } });
    const bad = leadImport.fixture(noEv, nop as never, { eventId: "", ownerId: null, rows: [] });
    expect(bad.ok).toBe(false);
  });
});

describe("Assign to me", () => {
  const unowned = (name: string) => { const st = as(name); const l = st.LEADS.find(x => !x.own); return { st, l }; };
  it("live: posts an empty body to the lead's assign route; the owner is never in the body", async () => {
    const f = fetchOf(200, { leadId: "L1", ownerId: "U1", modifiedTime: "t" });
    const r = await runWrite("live", leadAssign, {} as never, nop as never, { id: "L1" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/L1/assign");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(sent(f)).toEqual({});
    expect(data(r).ownerId).toBe("U1");
    const owned = await runWrite("live", leadAssign, {} as never, nop as never, { id: "L1" }, { fetch: fetchOf(409, { error: "Not assigned — somebody already carries this lead.", code: "already-owned" }) });
    expect(owned.ok || owned.code).toBe("already-owned");
  });
  it("fixture: an IR takes an unowned lead through the reducer's assign; an owned one is refused 409", () => {
    const { st, l } = unowned("rohit");
    expect(l).toBeTruthy();
    const sink = applying(st);
    const r = leadAssign.fixture(st, sink.dispatch, { id: l!.id });
    if (!r.ok) throw new Error(r.error);
    expect(sink.seen).toEqual([{ type: "assign", id: l!.id, to: "rohit" }]);
    expect(sink.get().LEADS.find(x => x.id === l!.id)!.own).toBe("rohit");
    const again = leadAssign.fixture(sink.get(), nop as never, { id: l!.id });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already-owned");
  });
  it("fixture: a lead outside the book is 404", () => {
    const r = leadAssign.fixture(as("rohit"), nop as never, { id: "nope" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("Mark updates read", () => {
  it("a page group maps to the route's kinds; the groups the route does not keep map to none; all maps to every kind", () => {
    expect(kindsOfGroup("owner")).toEqual(["owner"]);
    expect(kindsOfGroup("stage")).toEqual(["stage"]);
    expect(kindsOfGroup("move")).toEqual([]);
    expect(kindsOfGroup("access")).toEqual([]);
    expect(kindsOfGroup()).toEqual([...UPDATE_KINDS]);
  });
  it("live: posts the kinds to /api/leads/updates/read (never the investor-updates route)", async () => {
    const f = fetchOf(200, { ok: true });
    await runWrite("live", leadUpdatesRead, {} as never, nop as never, { kinds: ["owner"], k: "owner" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/leads/updates/read");
    expect(sent(f)).toEqual({ kinds: ["owner"] });
  });
  it("fixture: runs the reducer's markRead, one group or all", () => {
    const st = as("rohit");
    const sink = applying(st);
    expect(leadUpdatesRead.fixture(st, sink.dispatch, { kinds: ["owner"], k: "owner" }).ok).toBe(true);
    expect(leadUpdatesRead.fixture(st, sink.dispatch, { kinds: [...UPDATE_KINDS] }).ok).toBe(true);
    expect(sink.seen).toEqual([{ type: "markRead", k: "owner" }, { type: "markRead" }]);
  });
});
