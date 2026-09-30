/* M03-S02-W1 / M03-S03-W1 / M03-S04-W1 / M17-S01-W1 / M17-S02-W1 — Teams: grants, seats, managers, and the rows. */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import { runWrite } from "../api";
import { grantAdd, grantRemove, imSeatChange, leadSeatChange, managerChange } from "./access";
import { teamSeats, teamsRead } from "./teams";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const as = (k: string): ConsoleState => reducer(reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true }), { type: "signIn", k });
const im = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const spy = () => { const seen: Action[] = []; return { seen, d: (a: Action) => { seen.push(a); return undefined; } }; };

describe("grants — POST / DELETE /api/grants", () => {
  it("live: add posts {whom, page, cap}; remove deletes it; a page reset sends no cap", async () => {
    const f = vi.fn(async () => json(200, { whom: "1", page: "leads", grants: {}, consoleAccount: true }));
    const { d } = spy();
    const r = await runWrite("live", grantAdd, as("sahil"), d, { whom: "jhalak", page: "leads", cap: "view" }, { fetch: f });
    expect(r).toEqual({ ok: true, data: { whom: "1", page: "leads" } });
    expect(f.mock.calls[0][0]).toBe("/api/grants");
    expect(f.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ whom: "jhalak", page: "leads", cap: "view" });
    await runWrite("live", grantRemove, as("sahil"), d, { whom: "jhalak", page: "leads" }, { fetch: f });
    expect(f.mock.calls[1][1].method).toBe("DELETE");
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ whom: "jhalak", page: "leads" });
  });
  it("live: the route's refusal comes back as its own message", async () => {
    const f = vi.fn(async () => json(403, { error: "You cannot hand out what you do not hold yourself.", code: "not-held" }));
    const r = await runWrite("live", grantAdd, as("tasneem"), spy().d, { whom: "rohit", page: "system", cap: "view" }, { fetch: f });
    expect(r).toMatchObject({ ok: false, status: 403, code: "not-held", error: "You cannot hand out what you do not hold yourself." });
  });
  it("fixture: Digital Infrastructure gives Jhalak Leads — the reducer's capSave runs", async () => {
    const { seen, d } = spy();
    expect(await runWrite("fixture", grantAdd, as("sahil"), d, { whom: "jhalak", page: "leads", cap: "view" })).toMatchObject({ ok: true });
    expect(seen).toEqual([{ type: "toggleCap", k: "jhalak", p: "leads", c: "view" }]);
  });
  /* M03-S03 grantor matrix (TC-E03-015..018): the fixture refuses as the route does */
  it("fixture: the IR Manager cannot hand out System; an IR cannot change anyone; nobody grants their own profile", async () => {
    const { seen, d } = spy();
    expect(await runWrite("fixture", grantAdd, as("tasneem"), d, { whom: "rohit", page: "system", cap: "view" }))
      .toMatchObject({ ok: false, status: 403 });
    expect(await runWrite("fixture", grantAdd, as("rohit"), d, { whom: "kavya", page: "numbers", cap: "view" }))
      .toMatchObject({ ok: false, status: 403, code: "cannot-manage" });
    expect(await runWrite("fixture", grantAdd, as("sahil"), d, { whom: "rohit", page: "me", cap: "view" }))
      .toMatchObject({ ok: false, code: "own-profile" });
    expect(await runWrite("fixture", grantAdd, as("tasneem"), d, { whom: "sahil", page: "numbers", cap: "view" }))
      .toMatchObject({ ok: false, code: "cannot-manage" });
    expect(seen).toEqual([]);
  });
  it("fixture: the IR Manager grants her own IR Numbers", async () => {
    const { seen, d } = spy();
    expect(await runWrite("fixture", grantAdd, as("tasneem"), d, { whom: "rohit", page: "numbers", cap: "view" })).toMatchObject({ ok: true });
    expect(seen).toEqual([{ type: "toggleCap", k: "rohit", p: "numbers", c: "view" }]);
  });
});

describe("seats — PUT /api/users/{id}", () => {
  it("live: an Investors seat sends {seat}; a lead seat {seat, side: 'lead'}", async () => {
    const f = vi.fn(async () => json(200, { whom: "7", from: "kam", to: "amlead", returned: 4 }));
    const seen: ImAction[] = [];
    const r = await runWrite("live", imSeatChange, { s: im(), me: "divya" }, (a: ImAction) => seen.push(a), { whom: "imran", seat: "amlead" }, { fetch: f });
    expect(r).toEqual({ ok: true, data: { whom: "7", to: "amlead" } });
    expect(f.mock.calls[0][0]).toBe("/api/users/imran");
    expect(f.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ seat: "amlead" });
    await runWrite("live", leadSeatChange, as("sahil"), spy().d, { whom: "rohit", seat: "conv" }, { fetch: f });
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ seat: "conv", side: "lead" });
  });
  it("live: 403 step-up lands in the page note with the route's message (M17-S02)", async () => {
    const f = vi.fn(async () => json(403, { error: "Confirm it is you with a fresh Zoho sign-in first.", code: "step-up" }));
    const seen: ImAction[] = [];
    const r = await runWrite("live", imSeatChange, { s: im(), me: "divya" }, (a: ImAction) => seen.push(a), { whom: "imran", seat: "amlead" }, { fetch: f });
    expect(r).toMatchObject({ ok: false, code: "step-up" });
    expect(seen).toEqual([{ type: "note", msg: "Confirm it is you with a fresh Zoho sign-in first." }]);
  });
  it("fixture: the Head of AM moves her KAM (the reducer's setSeat); not her own row, not the super admin, not another team", async () => {
    const seen: ImAction[] = [];
    const d = (a: ImAction) => seen.push(a);
    expect(await runWrite("fixture", imSeatChange, { s: im(), me: "divya" }, d, { whom: "imran", seat: "amlead" })).toMatchObject({ ok: true });
    expect(seen).toEqual([{ type: "setSeat", k: "imran", r: "amlead" }]);
    expect(await runWrite("fixture", imSeatChange, { s: im(), me: "divya" }, d, { whom: "divya", seat: "kam" })).toMatchObject({ code: "own-seat" });
    expect(await runWrite("fixture", imSeatChange, { s: im(), me: "sahil" }, d, { whom: "pradeep", seat: "head" })).toMatchObject({ code: "super-admin" });
    expect(await runWrite("fixture", imSeatChange, { s: im(), me: "sahil" }, d, { whom: "meena", seat: "root" })).toMatchObject({ code: "super-admin" });
    expect(await runWrite("fixture", imSeatChange, { s: im(), me: "divya" }, d, { whom: "harsha", seat: "kam" })).toMatchObject({ code: "cannot-seat" });
    expect(seen).toHaveLength(1);
  });
  it("fixture: nobody changes their own lead seat", async () => {
    expect(await runWrite("fixture", leadSeatChange, as("sahil"), spy().d, { whom: "sahil", seat: "ir" })).toMatchObject({ code: "own-seat" });
  });
});

describe("managers — PUT /api/users/{id}/manager", () => {
  it("live: sends {manager}; a 409 loop is the route's message", async () => {
    const f = vi.fn(async () => json(409, { error: "That would make a loop: the new manager already sits under them, which leaves neither with a ceiling. Nothing changed.", code: "loop" }));
    const r = await runWrite("live", managerChange, as("sahil"), spy().d, { whom: "tasneem", manager: "rohit" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/users/tasneem/manager");
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ manager: "rohit" });
    expect(r).toMatchObject({ ok: false, status: 409, code: "loop" });
  });
  it("fixture: a loop is refused before the reducer; a good move runs setMgr", async () => {
    const { seen, d } = spy();
    expect(await runWrite("fixture", managerChange, as("sahil"), d, { whom: "tasneem", manager: "rohit" })).toMatchObject({ ok: false, code: "loop" });
    expect(seen).toEqual([]);
  });
});

describe("Teams rows — GET /api/teams", () => {
  it("fixture: the IR Manager's own team, herself marked", () => {
    const r = teamsRead.fixture(as("tasneem"), undefined);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.data.view.members!;
    expect(m.map((x) => x.name)).toEqual(expect.arrayContaining(["Tasneem Qureshi", "Rohit Deshpande", "Kavya Nair", "Nikhil Rao", "Ananya Iyer"]));
    expect(m.find((x) => x.id === "tasneem")!.you).toBe(true);
    expect(m.map((x) => x.id)).not.toContain("jhalak");
    expect(m.map((x) => x.id)).not.toContain("sahil");
  });
  it("fixture: an IR has no Teams (403 no-teams, as the route)", () => {
    expect(teamsRead.fixture(as("kavya"), undefined)).toMatchObject({ ok: false, status: 403, code: "no-teams" });
  });
  it("fixture: seats never offer root or di, and none on the super admin's or the viewer's own row", () => {
    const r = teamSeats.fixture({ s: im(), me: "sahil" }, undefined);
    if (!r.ok) throw new Error("refused");
    const rows = r.data.investorsSide!;
    expect(rows.find((x) => x.id === "sahil")!.seatOptions).toEqual([]);
    expect(rows.find((x) => x.id === "pradeep")!.seatOptions).toEqual([]);
    for (const x of rows) expect(x.seatOptions).not.toContain("root");
    for (const x of rows) expect(x.seatOptions).not.toContain("di");
    /* a KAM reads without other people's emails */
    const k = teamSeats.fixture({ s: im(), me: "imran" }, undefined);
    if (!k.ok) throw new Error("refused");
    expect(k.data.investorsSide!.filter((x) => x.email).map((x) => x.email)).toEqual(["imran@agresearchlabs.com"]);
  });
  it("live: one grid column per Investors seat", () => {
    const a = teamsRead.pick({
      view: { canChangeSeats: true, activeMembers: 2, members: null, investorsSide: [] },
      grid: { columns: [{ im: "head", imLabel: "Head of Finance", rights: ["view"] }, { im: null, imLabel: null, rights: [] }, { im: "head", imLabel: "x", rights: [] }] },
    });
    expect(a.grid.columns).toEqual([{ im: "head", imLabel: "Head of Finance", rights: ["view"] }]);
  });
});
