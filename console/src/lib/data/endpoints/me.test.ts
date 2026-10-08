/* C4 / Me — the three endpoints, both halves. Live: the route, the body and nothing else (no email, no user id, no row).
   Fixture: the reducer action the page always dispatched, answering as the route would. */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import type { PersonKey } from "@/domain";
import { initialState, reducer, type Action, type ConsoleState } from "@/lib/state";
import { runWrite } from "../api";
import { activityExportLog, BAD_INITIALS, myDetails, myStyle, NAME_TOO_SHORT } from "./me";

const as = (k: string): ConsoleState => reducer(initialState(demoBook()), { type: "signIn", k: k as PersonKey });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const recorder = (s: ConsoleState) => { const sent: Action[] = []; let cur = s; return { sent, now: () => cur, d: (a: Action) => { sent.push(a); cur = reducer(cur, a); } }; };
const bodyOf = (f: ReturnType<typeof fetchOf>) => JSON.parse(String(f.mock.calls[0]![1]!.body));

describe("PATCH /api/me — name and mobile", () => {
  it("live: a name change sends the name alone; a mobile change sends the mobile alone (B-26: never a blank name)", async () => {
    const f = fetchOf(200, { name: "Asha Rao", mobile: null });
    const r = await runWrite("live", myDetails, as("kavya"), () => {}, { f: "n", v: " Asha Rao ", name: "Kavya" }, { fetch: f });
    expect(r).toEqual({ ok: true, data: { name: "Asha Rao", mobile: null } });
    expect(f.mock.calls[0]![0]).toBe("/api/me");
    expect(f.mock.calls[0]![1]!.method).toBe("PATCH");
    expect(bodyOf(f)).toEqual({ name: "Asha Rao" });
    const g = fetchOf(200, { name: null, mobile: "+919845033021" });
    await runWrite("live", myDetails, as("kavya"), () => {}, { f: "ph", v: "98450 33021", name: "" }, { fetch: g });
    expect(bodyOf(g)).toEqual({ mobile: "98450 33021" });
  });
  it("live: the route's refusal comes back in its own words and nothing is dispatched", async () => {
    const d = vi.fn();
    const r = await runWrite("live", myDetails, as("kavya"), d, { f: "ph", v: "123", name: "Kavya" },
      { fetch: fetchOf(422, { error: "Nothing changed — write the mobile as ten Indian digits, or + and the country code.", code: "invalid-mobile" }) });
    expect(r).toMatchObject({ ok: false, status: 422, code: "invalid-mobile" });
    expect(d).not.toHaveBeenCalled();
  });
  it("fixture: runs setMe and answers the new name and mobile; a short name is refused before the reducer", async () => {
    const s = as("kavya"), rec = recorder(s);
    const r = await runWrite("fixture", myDetails, s, rec.d, { f: "n", v: "Kavya Iyer", name: s.PEOPLE[s.WHO]!.n });
    expect(r).toMatchObject({ ok: true, data: { name: "Kavya Iyer" } });
    expect(rec.sent).toEqual([{ type: "setMe", f: "n", v: "Kavya Iyer" }]);
    expect(rec.now().PEOPLE[s.WHO]!.n).toBe("Kavya Iyer");
    const none = recorder(s);
    expect(await runWrite("fixture", myDetails, s, none.d, { f: "n", v: "K", name: "Kavya" })).toEqual({ ok: false, status: 422, code: "refused", error: NAME_TOO_SHORT });
    expect(none.sent).toEqual([]);
  });
});

describe("PUT /api/me/style — badge and initials", () => {
  it("live: initials send {i}; a badge sends {c, sq}; both go to the style route", async () => {
    const f = fetchOf(200, { i: "KI" });
    await runWrite("live", myStyle, as("kavya"), () => {}, { kind: "initials", v: " ki " }, { fetch: f });
    expect(f.mock.calls[0]![0]).toBe("/api/me/style");
    expect(f.mock.calls[0]![1]!.method).toBe("PUT");
    expect(bodyOf(f)).toEqual({ i: "ki" });
    const g = fetchOf(200, { c: 5, sq: true });
    await runWrite("live", myStyle, as("kavya"), () => {}, { kind: "badge", c: 5, sq: true }, { fetch: g });
    expect(bodyOf(g)).toEqual({ c: 5, sq: true });
  });
  it("fixture: setMe i and setMyStyle run; blank initials and a colour off the wheel are refused with nothing dispatched", async () => {
    const s = as("kavya"), rec = recorder(s);
    expect(await runWrite("fixture", myStyle, s, rec.d, { kind: "badge", c: 6, sq: true })).toEqual({ ok: true, data: { c: 6, sq: true } });
    expect(await runWrite("fixture", myStyle, s, rec.d, { kind: "initials", v: "k-i" })).toEqual({ ok: true, data: { i: "KI" } });
    expect(rec.sent).toEqual([{ type: "setMyStyle", c: 6, sq: true }, { type: "setMe", f: "i", v: "k-i" }]);
    expect(rec.now().PEOPLE[s.WHO]).toMatchObject({ c: 6, sq: true, i: "KI" });
    const none = recorder(s);
    expect(await runWrite("fixture", myStyle, s, none.d, { kind: "initials", v: "--" })).toMatchObject({ ok: false, error: BAD_INITIALS });
    expect(await runWrite("fixture", myStyle, s, none.d, { kind: "badge", c: 9, sq: false })).toMatchObject({ ok: false, status: 422 });
    expect(none.sent).toEqual([]);
  });
});

describe("POST /api/activity/export — the export's log line", () => {
  const info = { view: "person" as const, rows: 30, exported: 4, filename: "activity-by-person.csv" };
  it("live: the view code and the row count only, with an Idempotency-Key; no file name, no rows", async () => {
    const f = fetchOf(200, { logged: true, replayed: false });
    const r = await runWrite("live", activityExportLog, as("kavya"), () => {}, info, { fetch: f, idempotencyKey: "press-0001-aaaa" });
    expect(r).toEqual({ ok: true, data: { logged: true, replayed: false } });
    expect(f.mock.calls[0]![0]).toBe("/api/activity/export");
    expect(bodyOf(f)).toEqual({ view: "person", rows: 30 });
    expect((f.mock.calls[0]![1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("press-0001-aaaa");
  });
  it("fixture: the same 'Exported the activity log' line the CSV always dispatched", async () => {
    const s = as("kavya"), rec = recorder(s);
    expect(await runWrite("fixture", activityExportLog, s, rec.d, info)).toEqual({ ok: true, data: { logged: true, replayed: false } });
    expect(rec.sent).toEqual([{ type: "log", what: "Exported the activity log", lead: null,
      note: "30 activity rows · 4 exported person rows · activity-by-person.csv", kind: "admin" }]);
  });
});
