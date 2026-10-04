/* M08-S05-NOTE-6 / -7 — out of office / back on through /api/availability, both halves (book = the lead side's ConsoleState),
   the absence drawer's refusal and note in the page, and the live roster put on the book. Demo NOW = 28 Aug 2026; Ananya is
   out 25–29 Aug and Nikhil covers her (fixtures/book/people.ts). */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import { avail, outFor } from "@/lib/selectors";
import { ApiModeProvider, liveRead, runWrite } from "../api";
import { availabilityClear, availabilityRead, availabilitySet, availFromWindows, BAD_DATES, datesOk, fixtureWindows, MAX_ABSENCE_DAYS, MAX_AHEAD_DAYS, NOT_YOURS_TO_CHANGE } from "./availability";
import * as server from "@/server/roster/roster";
import { createAvailability } from "@/server/roster/availability";

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
/** a dispatch that keeps what it was sent, and the state it leads to */
const recorder = (s: ConsoleState) => { const sent: Action[] = []; let cur = s; return { sent, now: () => cur, d: (a: Action) => { sent.push(a); cur = reducer(cur, a); } }; };
const K = (k: string) => k as PersonKey;

describe("GET /api/availability — the roster read", () => {
  it("fixture: the book's windows, and who is out today (Ananya, back on 29 Aug)", () => {
    const r = availabilityRead.fixture(as("kavya"), undefined);
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toEqual({ day: "2026-08-28", windows: [{ id: "ananya", from: "2026-08-25", to: "2026-08-29" }], out: [{ id: "ananya", backOn: "2026-08-29" }] });
    expect(availabilityRead.path()).toBe("/api/availability");
  });
  it("fixture: a spent or a leaver's record is no window", () => {
    const s = as("kavya");
    const spent = { ...s, AVAIL: { ...s.AVAIL, rohit: { why: "On leave", from: "2026-08-01", to: "2026-08-03", by: "rohit", at: "" }, vinay: { why: "Left the company", from: "—", to: "—", by: "", at: "", perm: true } } };
    expect(fixtureWindows(spent).map(w => w.id)).toEqual(["ananya"]);
  });
  it("live: the route's ids and days, anything else dropped; on the book as AVAIL with no reason", async () => {
    const f = fetchOf(200, { day: "2026-10-05", out: [{ id: "9007199254740995001", backOn: "2026-10-09" }],
      windows: [{ id: "9007199254740995001", from: "2026-10-05", to: "2026-10-09" }, { id: "x", from: "nope", to: "2026-10-09" }, { id: "9007199254740995005", from: "2026-10-12", to: "2026-10-14", why: "Sick" }] });
    const r = await liveRead(availabilityRead, "/api/availability", { fetch: f });
    if (r.state !== "ok") throw new Error("not ok");
    expect(r.data.windows).toEqual([{ id: "9007199254740995001", from: "2026-10-05", to: "2026-10-09" }, { id: "9007199254740995005", from: "2026-10-12", to: "2026-10-14" }]);
    const AVAIL = availFromWindows(r.data.windows);
    expect(AVAIL["9007199254740995005"]).toEqual({ why: "", from: "2026-10-12", to: "2026-10-14", by: "", at: "" });
    expect(JSON.stringify(AVAIL)).not.toContain("Sick");
  });
  it("availLive puts the live roster on the book — live only; the demo book keeps its own", () => {
    const s = as("kavya");
    const AVAIL = availFromWindows([{ id: "kavya", from: "2026-08-27", to: "2026-08-31" }]);
    expect(reducer({ ...s, FIXTURES: true }, { type: "availLive", AVAIL }).AVAIL).toBe(s.AVAIL);
    const live = reducer({ ...s, FIXTURES: false }, { type: "availLive", AVAIL });
    expect(live.AVAIL).toEqual(AVAIL);
    expect(avail(live, K("kavya"))).toBe(false);
    expect(outFor(live, K("ananya"))).toBeNull();
  });
});

describe("POST /api/availability — out from, back on", () => {
  it("live: the route's body, person always named (live keys are Zoho user ids); the reason never leaves", async () => {
    const f = fetchOf(200, { personId: "kavya", from: "2026-08-31", to: "2026-09-02" });
    const r = await runWrite("live", availabilitySet, as("kavya"), () => {}, { k: K("kavya"), from: "2026-08-31", to: "2026-09-02", why: "Sick leave" }, { fetch: f });
    expect(r).toEqual({ ok: true, data: { personId: "kavya", from: "2026-08-31", to: "2026-09-02" } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/availability");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(String(init!.body))).toEqual({ person: "kavya", from: "2026-08-31", to: "2026-09-02" });
    expect(String(init!.body)).not.toContain("Sick");
  });
  it("live: a refusal is the route's own words, nothing changed", async () => {
    const f = fetchOf(403, { error: NOT_YOURS_TO_CHANGE, code: "not-yours-to-change" });
    const r = await runWrite("live", availabilitySet, as("kavya"), () => {}, { k: K("rohit"), from: "2026-08-31", to: "2026-09-02" }, { fetch: f });
    expect(r).toMatchObject({ ok: false, status: 403, code: "not-yours-to-change", error: NOT_YOURS_TO_CHANGE });
  });
  it("fixture: Kavya books her own leave — setAvail runs, the window is on the book", () => {
    const rec = recorder(as("kavya"));
    const r = availabilitySet.fixture(rec.now(), rec.d, { k: K("kavya"), from: "2026-08-31", to: "2026-09-02", why: "Planned leave" });
    expect(r).toEqual({ ok: true, data: { personId: "kavya", from: "2026-08-31", to: "2026-09-02" } });
    expect(rec.sent).toEqual([{ type: "setAvail", k: "kavya", why: "Planned leave", from: "2026-08-31", to: "2026-09-02" }]);
    expect(rec.now().AVAIL.kavya).toMatchObject({ from: "2026-08-31", to: "2026-09-02", by: "kavya" });
  });
  it("fixture: an IR cannot book someone else (403, nothing dispatched); a manager may", () => {
    const rec = recorder(as("kavya"));
    expect(availabilitySet.fixture(rec.now(), rec.d, { k: K("rohit"), from: "2026-08-31", to: "2026-09-02" })).toMatchObject({ ok: false, status: 403, code: "not-yours-to-change", error: NOT_YOURS_TO_CHANGE });
    expect(rec.sent).toEqual([]);
    const m = recorder(as("tasneem"));
    expect(availabilitySet.fixture(m.now(), m.d, { k: K("rohit"), from: "2026-08-31", to: "2026-09-02" }).ok).toBe(true);
  });
  it("fixture: the route's date rule — from today, a later return, ≤30 days ahead, ≤60 days long (422, nothing dispatched)", () => {
    for (const [from, to] of [["2026-08-27", "2026-08-30"], ["2026-08-31", "2026-08-31"], ["2026-09-28", "2026-09-29"], ["2026-08-29", "2026-10-29"], ["2026-02-30", "2026-08-30"]]) {
      const rec = recorder(as("kavya"));
      expect(availabilitySet.fixture(rec.now(), rec.d, { k: K("kavya"), from: from!, to: to! }), `${from}–${to}`).toMatchObject({ ok: false, status: 422, code: "bad-dates", error: BAD_DATES });
      expect(rec.sent).toEqual([]);
    }
    expect([MAX_AHEAD_DAYS, MAX_ABSENCE_DAYS]).toEqual([server.MAX_AHEAD_DAYS, server.MAX_ABSENCE_DAYS]);
    /* the same answers as the route's writer (server/roster/availability.ts) on the same clock */
    const writer = createAvailability({ planeC: { record() {} }, roster: { forget() {} }, clock: () => Date.parse("2026-08-28T04:30:00Z") });
    for (const [from, to] of [["2026-08-27", "2026-08-30"], ["2026-08-28", "2026-08-29"], ["2026-09-27", "2026-11-26"], ["2026-09-28", "2026-09-29"], ["2026-08-29", "2026-10-29"]]) {
      expect(datesOk("2026-08-28", from!, to!), `${from}–${to}`).toBe(writer.set({ userId: "9007199254740995001", seat: "ir", mayChangeOthers: false }, { from, to }).ok);
    }
    expect(datesOk("2026-08-28", "2026-08-28", "2026-08-29")).toBe(true);
    expect(datesOk("2026-08-28", "2026-09-27", "2026-11-26")).toBe(true);
  });
  it("fixture: editing a started window's return date runs setOutTo (the drawer sends today as the start: no past day is filed)", () => {
    const rec = recorder(as("tasneem"));
    expect(availabilitySet.fixture(rec.now(), rec.d, { k: K("ananya"), from: "2026-08-25", to: "2026-09-01", change: "to" })).toMatchObject({ ok: false, code: "bad-dates" });
    const r = availabilitySet.fixture(rec.now(), rec.d, { k: K("ananya"), from: "2026-08-28", to: "2026-09-01", change: "to" });
    expect(rec.sent).toEqual([{ type: "setOutTo", k: "ananya", to: "2026-09-01" }]);
    expect(r).toMatchObject({ ok: true, data: { to: "2026-09-01" } });
  });
});

describe("DELETE /api/availability — mark back in (D44: the return ends their cover)", () => {
  it("live: DELETE with the person; the covers the route ended come back", async () => {
    const f = fetchOf(200, { personId: "ananya", from: null, to: null, covers: { cleared: 2, pending: 0 } });
    const r = await runWrite("live", availabilityClear, as("tasneem"), () => {}, { k: K("ananya") }, { fetch: f });
    expect(r).toEqual({ ok: true, data: { personId: "ananya", from: null, to: null, covers: { cleared: 2, pending: 0 } } });
    const [url, init] = f.mock.calls[0]!;
    expect([url, init!.method, JSON.parse(String(init!.body))]).toEqual(["/api/availability", "DELETE", { person: "ananya" }]);
  });
  it("fixture: Tasneem marks Ananya back — she is in, and Nikhil's cover of her ends (endCoverFor)", () => {
    const s = as("tasneem");
    expect(s.COVER.ananya).toBeTruthy();
    const rec = recorder(s);
    expect(availabilityClear.fixture(rec.now(), rec.d, { k: K("ananya") })).toEqual({ ok: true, data: { personId: "ananya", from: null, to: null } });
    expect(rec.sent).toEqual([{ type: "setAvail", k: "ananya" }]);
    expect(avail(rec.now(), K("ananya"))).toBe(true);
    expect(rec.now().COVER.ananya).toBeUndefined();
  });
  it("fixture: Kavya cannot mark Ananya back (403, nothing dispatched)", () => {
    const rec = recorder(as("kavya"));
    expect(availabilityClear.fixture(rec.now(), rec.d, { k: K("ananya") })).toMatchObject({ ok: false, status: 403, code: "not-yours-to-change" });
    expect(rec.sent).toEqual([]);
  });
});

/* ---- the absence drawer: refusal and note in the page, the reason not asked live ---- */
const view = vi.hoisted(() => ({ s: null as unknown as ConsoleState }));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig() as object), useConsole: () => ({ state: view.s, dispatch: () => {} }) }));
import { drawerDef, type DrawerProps } from "@/components/shell/drawers/registry";
import "@/components/shell/drawers/absence";
import { said } from "@/components/shell/drawers/absence";

const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const drawer = (s: ConsoleState, id: string, fixtures: boolean) => {
  view.s = s;
  const def = drawerDef("absence")!;
  const props = { id } as unknown as DrawerProps;
  const Foot = def.Foot!;
  return { body: renderToStaticMarkup(<ApiModeProvider fixtures={fixtures}><def.Body {...props} /></ApiModeProvider>),
    foot: renderToStaticMarkup(<ApiModeProvider fixtures={fixtures}><Foot {...props} /></ApiModeProvider>) };
};

describe("the absence drawer", () => {
  it("a refusal is shown in the drawer (role=alert), in the route's words", () => {
    const dispatched: Action[] = [];
    said((a) => dispatched.push(a as Action), { ok: false, status: 422, code: "bad-dates", error: BAD_DATES });
    expect(dispatched).toEqual([{ type: "setUi", patch: { AVERR: BAD_DATES, AVNOTE: null } }]);
    const s = as("kavya");
    const { body } = drawer({ ...s, ui: { ...s.ui, AVERR: BAD_DATES } }, "kavya", true);
    expect(body).toContain('role="alert"');
    expect(text(body)).toContain(BAD_DATES);
  });
  it("after Mark back in, the covers it ended (or could not) are said", () => {
    const notes: unknown[] = [];
    const d = (a: unknown) => notes.push((a as { patch: { AVNOTE: unknown } }).patch.AVNOTE);
    said(d, { ok: true, data: { personId: "a", from: null, to: null, covers: { cleared: 2, pending: 0 } } });
    said(d, { ok: true, data: { personId: "a", from: null, to: null, covers: { cleared: 1, pending: 1 } } });
    said(d, { ok: true, data: { personId: "a", from: null, to: null, covers: { cleared: 0, pending: null } } });
    said(d, { ok: true, data: { personId: "a", from: null, to: null, covers: { cleared: 0, pending: 0 } } });
    expect(notes).toEqual(["Marked back in. 2 lead covers ended.", "Marked back in. 1 cover ended; 1 could not be ended and end on its own date.",
      "Marked back in. Their lead covers could not be read — any still running end on their own date.", null]);
  });
  it("fixture asks the private reason; live does not (the route takes none) and Save needs only the dates", () => {
    const s = as("kavya");
    expect(text(drawer(s, "kavya", true).body)).toContain("Absence reason");
    expect(drawer(s, "kavya", true).foot).toContain("disabled");
    const live = { ...s, FIXTURES: false };
    const d = drawer(live, "kavya", false);
    expect(text(d.body)).not.toContain("Absence reason");
    expect(d.foot).not.toContain("disabled");
    expect(text(d.foot)).toContain("Save availability");
  });
  it("Ananya out: the Foot offers Mark back in; live her record shows no reason or recorder", () => {
    const s = as("tasneem");
    expect(text(drawer(s, "ananya", true).foot)).toContain("Mark back in");
    const live = { ...s, FIXTURES: false, AVAIL: availFromWindows([{ id: "ananya", from: "2026-08-25", to: "2026-08-29" }]) };
    const d = drawer(live, "ananya", false);
    expect(text(d.foot)).toContain("Mark back in");
    expect(text(d.body)).not.toContain("Recorded by");
    expect(text(d.body)).toContain("Back 29 Aug");
  });
});
