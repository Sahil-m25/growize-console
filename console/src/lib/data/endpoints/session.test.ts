/* M01-S01-W1 / M01-S02-W1 / M01-S10-W1 — the session endpoint, the live one-person book, and step-up. */
import { describe, expect, it, vi } from "vitest";
import { demoBook } from "@fixtures/book";
import { emptyDataset } from "@/lib/data/empty";
import { signInAdmits } from "@/lib/data/admission";
import { initialState, reducer } from "@/lib/state";
import { navFor } from "@/lib/selectors/access";
import { pageReadable, who } from "@/lib/im";
import { liveRead } from "../api";
import { sessionRead, stepUpHref, stepUpReturnOf, stepUpStatus, withSessionAccess, type SessionAnswer } from "./session";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ZID = "4000000000000000001";

/* what GET /api/session answers for a live Head of Finance (server/access/session-access over accessBook) */
const HEAD: NonNullable<SessionAnswer["access"]> = {
  lead: { n: "", i: "", seat: "fin", mgr: null, on: true, c: 1, em: "", ph: "", ext: "the Investors pages" },
  im: { n: "", i: "", r: "head", c: 1, em: "" },
  grants: {},
};
const IR: NonNullable<SessionAnswer["access"]> = {
  lead: { n: "", i: "", seat: "ir", mgr: null, on: true, c: 1, em: "", ph: "" }, im: null, grants: {},
};

describe("GET /api/session — pick", () => {
  it("keeps who, the refusal, signedOut and the live access; drops anything else", () => {
    const a = sessionRead.pick({ session: { who: ZID, seat: "head" }, access: HEAD, extra: 1 });
    expect(a).toEqual({ session: { who: ZID, seat: "head" }, access: HEAD });
    expect(sessionRead.pick({ session: null, signedOut: "expired", refusal: { code: "no-seat", message: "No console access" } }))
      .toEqual({ session: null, signedOut: "expired", refusal: { code: "no-seat", message: "No console access" } });
    expect(sessionRead.pick({ session: null, signedOut: "whatever" })).toEqual({ session: null });
  });
  it("live: reads the route", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { session: { who: ZID, seat: "ir" }, access: IR }));
    const r = await liveRead(sessionRead, "/api/session", { fetch: f });
    expect(f.mock.calls[0]).toBeTruthy();
    expect(r).toEqual({ state: "ok", data: { session: { who: ZID, seat: "ir" }, access: IR } });
  });
  it("fixture: the signed-in demo person, and no access (the demo book holds everyone)", () => {
    const s0 = reducer(initialState(), { type: "hydrate", ds: demoBook(), version: 1, fixtures: true });
    expect(sessionRead.fixture(s0, undefined)).toEqual({ ok: true, data: { session: null } });
    const s1 = reducer(s0, { type: "signIn", k: "rohit" });
    expect(sessionRead.fixture(s1, undefined)).toEqual({ ok: true, data: { session: { who: "rohit", seat: "ir" } } });
  });
});

describe("the live book gets the signed-in person (the Investors side rendered nothing live)", () => {
  it("empty book: nobody is admitted, the Investors side reads nobody", () => {
    const ds = emptyDataset("2026-09-30T10:00");
    expect(signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, ZID)).toBe(false);
    expect(pageReadable({ data: ds.im }, ZID, "inv")).toBe(false);
  });
  it("a Head of Finance: admitted, the Investors pages read, the lead rail keeps its seat rule", () => {
    const ds = withSessionAccess(emptyDataset("2026-09-30T10:00"), ZID, HEAD);
    expect(signInAdmits({ PEOPLE: ds.PEOPLE, GRANT: ds.GRANT, im: ds.im }, ZID)).toBe(true);
    expect(who({ data: ds.im }, ZID).r).toBe("head");
    expect(pageReadable({ data: ds.im }, ZID, "inv")).toBe(true);
    expect(pageReadable({ data: ds.im }, ZID, "pay")).toBe(false);   /* not an Investors page key: the rail decides */
    const s = reducer(reducer(initialState(), { type: "hydrate", ds, version: 0, fixtures: false }), { type: "signIn", k: ZID });
    expect(s.authed).toBe(true);
    expect(s.WHO).toBe(ZID);
  });
  it("an IR: the lead side only — no Investors seat is invented", () => {
    const ds = withSessionAccess(emptyDataset("2026-09-30T10:00"), ZID, IR);
    expect(ds.im.P[ZID]).toBeUndefined();
    expect(pageReadable({ data: ds.im }, ZID, "inv")).toBe(false);
    const s = reducer(reducer(initialState(), { type: "hydrate", ds, version: 0, fixtures: false }), { type: "signIn", k: ZID });
    expect(s.authed).toBe(true);
    expect(navFor(s).map((n) => n.k)).toContain("leads");
  });
  it("B-15: the person's name, initials, email and badge from the book survive the session overlay; the seat is the session's", () => {
    const base = emptyDataset("2026-09-30T10:00");
    const ds0 = { ...base,
      PEOPLE: { [ZID]: { n: "IR A Test", i: "IA", seat: "ir" as const, mgr: null, on: true, c: 5 as const, em: "ira@example.test", ph: "", sq: true } },
      im: { ...base.im, P: { [ZID]: { n: "Head Test", i: "HT", r: "head" as const, c: 3, em: "head@example.test" } } } };
    const ds = withSessionAccess(ds0, ZID, { ...HEAD, lead: { ...HEAD.lead, i: "XY" } });
    expect(ds.PEOPLE[ZID]).toMatchObject({ n: "IR A Test", i: "IA", em: "ira@example.test", c: 5, sq: true, seat: "fin", ext: "the Investors pages" });
    expect(ds.im.P[ZID]).toMatchObject({ n: "Head Test", i: "HT", em: "head@example.test", c: 3, r: "head" });
    /* no book record of the person (the people read failed): the session's own values stand */
    const bare = withSessionAccess(base, ZID, { ...IR, lead: { ...IR.lead, i: "IA", c: 5 } });
    expect(bare.PEOPLE[ZID]).toMatchObject({ n: "", i: "IA", c: 5, seat: "ir" });
  });
  it("is a copy: the book it was given is not changed", () => {
    const ds = emptyDataset("2026-09-30T10:00");
    withSessionAccess(ds, ZID, HEAD);
    expect(ds.PEOPLE).toEqual({});
    expect(ds.im.P).toEqual({});
  });
});

describe("step-up (M01-S10-W1)", () => {
  it("the navigation carries the action and where to come back to", () => {
    expect(stepUpHref("reveal", "/inv")).toBe("/api/auth/step-up?action=reveal&back=%2Finv");
  });
  it("status: path per action; fixture never has a step-up open", () => {
    expect(stepUpStatus.path(null)).toBeNull();
    expect(stepUpStatus.path("release")).toBe("/api/auth/step-up/status?action=release");
    const r = stepUpStatus.fixture(null, "reveal");
    expect(r.ok && r.data.valid).toBe(false);
  });
  it("reads only the callback's own codes off the address", () => {
    expect(stepUpReturnOf("ok")).toBe("ok");
    expect(stepUpReturnOf("locked")).toBe("locked");
    expect(stepUpReturnOf("<script>")).toBeNull();
    expect(stepUpReturnOf(null)).toBeNull();
  });
});
